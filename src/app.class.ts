import axios from 'axios';
import * as _ from 'lodash';
import { Markup } from 'telegraf';
import { promisify } from 'util';

import * as xEnv from './environment';
import { bot, redisSession } from './bot';
import { BotTarget, MagaResponseInfo } from './types';
import { md5 } from './utils';
import { cacheManager } from './cache-manager.util';

//
const { client: redisClient } = redisSession;
const redisKeys: (pattern: string) => Promise<string[]> = promisify(
  redisClient.keys,
).bind(redisClient);
const redisMGet: (keys: string[]) => Promise<string[]> = promisify(
  redisClient.mget,
).bind(redisClient);
//

export const prkomApi = axios.create({
  baseURL: xEnv.YSTUTY_PRKOM_URL,
  timeout: 60e3,
});

// TODO: rename ii
const CACHEFILE_LAST_DAT = 'app_setting';

export class App {
  /** @deprecated Use redis session */
  public botTargets: Record<number, Partial<BotTarget>> = {};

  public lastData = new Map<string, Map<string, MagaResponseInfo>>();

  public async init() {
    await this.load();
    this.runWatcher().then();
  }

  public async getTargetKeys() {
    const prefix = `${xEnv.REDIS_PREFIX}session:`;
    const keys = await redisKeys(`${prefix}*`);
    return keys.map((key) => key.replace(prefix, ''));
  }

  public async getTargetChatIds() {
    const keys = await this.getTargetKeys();
    return keys.map((key) => Number(key.split(':')[0]));
  }

  public async getTarget(id: number) {
    const key = `${id}:${id}`;
    const session = await (redisSession as any).getSession(key);
    return session;
  }

  public async getTargets(ids: number[] = null) {
    if (!ids || ids.length === 0) {
      ids = await this.getTargetChatIds();
    }

    const keys = ids.map((id) => `${id}:${id}`);
    const data = await redisMGet(keys);
    const sessions = data.map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    });

    return ids.reduce(
      (prev, id, index) => ({
        ...prev,
        ...(sessions[index] && { [id]: sessions[index] }),
      }),
      {},
    ) as Record<number, BotTarget>;
  }

  public async setTarget(id: number, session: any) {
    const key = `${id}:${id}`;
    redisSession.saveSession(key, session);
  }

  public async load() {
    const { lastData, botTargets } =
      (await cacheManager.readData(CACHEFILE_LAST_DAT, true)) || {};

    if (lastData && lastData instanceof Map) {
      this.lastData = lastData;
    }

    // TODO: remove it
    // ! for support old version
    if (botTargets && botTargets instanceof Map) {
      for (const [k, v] of botTargets.entries()) {
        if (v.id) {
          this.botTargets[v.id] = { ...v, uid: k };
        }
      }
    } else {
      this.botTargets = botTargets;
    }
  }

  public async save() {
    await cacheManager.update(
      CACHEFILE_LAST_DAT,
      {
        lastData: this.lastData,
        botTargets: this.botTargets,
      },
      9e12,
    );
  }

  public async runWatcher() {
    do {
      console.log(new Date().toLocaleString(), '[runWatcher] execute');

      const targets = await this.getTargets();
      const targetEntries = Object.entries({ ...this.botTargets, ...targets });
      const targetUids = targetEntries.flatMap(([, v]) => v.uid);

      const uids = _.uniq(
        [...xEnv.WATCHING_UIDS, ...targetUids].filter(Boolean),
      );
      for (const uid of uids) {
        try {
          const { data: list } = await prkomApi.get<MagaResponseInfo[]>(
            `/admission/get/${uid}`,
          );

          if (list.length === 0) {
            for (const [, v] of targetEntries) {
              if (v.uid === uid) {
                if ((v.loadCount = (v.loadCount || 0) + 1) > 3) {
                  v.uid = null;
                  this.lastData.delete(uid);
                }
              }
            }
            continue;
          }

          if (!this.lastData.has(uid)) {
            const apps = new Map<string, MagaResponseInfo>();
            this.lastData.set(uid, apps);
          }

          for (const app of list) {
            const { info, item } = app;

            const apps = this.lastData.get(uid);
            const hashName = md5(
              [
                info.competitionGroupName,
                info.formTraining,
                info.levelTraining,
                info.directionTraining,
                info.basisAdmission,
                info.sourceFunding,
              ].join(';'),
            );

            if (apps.has(hashName)) {
              const { info: lastInfo, item: lastItem } = apps.get(hashName);

              const changes: string[] = [];

              const posDif = lastItem.position - item.position;
              if (posDif !== 0) {
                changes.push(
                  `🍥 <b>ПОЗИЦИЯ</b> изменена ${
                    posDif > 0 ? '☝️' : '👇'
                  } (было: <code>${lastItem.position}</code>; стало: <code>${
                    item.position
                  }</code>)`,
                );
              }

              if (lastInfo.numbersInfo !== info.numbersInfo) {
                changes.push(
                  `💺 <b>МЕСТА</b> изменны (было: <code>${lastInfo.numbersInfo}</code>; стало: <code>${info.numbersInfo}</code>)`,
                );
              }

              if (lastItem.totalScore !== item.totalScore) {
                changes.push(
                  `🌟 <b>СУММА БАЛЛОВ</b> изменена (было: <code>${lastItem.totalScore}</code>; стало: <code>${item.totalScore}</code>)`,
                );
              }

              if (lastItem.scoreInterview !== item.scoreInterview) {
                changes.push(
                  `⭐️ <b>БАЛЛЫ СОБЕСА</b> изменены (было: <code>${lastItem.scoreInterview}</code>; стало: <code>${item.scoreInterview}</code>)`,
                );
              }

              if (lastItem.scoreExam !== item.scoreExam) {
                changes.push(
                  `❇️ <b>БАЛЛЫ ЭКЗА</b> изменены (было: <code>${lastItem.scoreExam}</code>; стало: <code>${item.scoreExam}</code>)`,
                );
              }

              if (changes.length > 0) {
                if (bot) {
                  const chatIds = _.uniq(
                    [
                      xEnv.TELEGRAM_CHAT_ID,
                      ...targetEntries.map(
                        ([chatId, v]) => v.uid === uid && chatId,
                      ),
                    ].filter(Boolean),
                  );

                  for (const chatId of chatIds) {
                    bot.telegram
                      .sendMessage(
                        chatId,
                        `🦄 <b>(CHANGES DETECTED)</b> Уникальный код: [<code>${uid}</code>]\n` +
                          `<b>ComGroup:</b> <code>"${info.competitionGroupName}"</code>\n` +
                          `<b>FormTraining:</b> <code>"${info.formTraining}"</code>\n` +
                          `<b>DocBuildDate:</b> <code>"${info.buildDate}"</code>\n` +
                          `\nИзменения:\n` +
                          `${changes.join('\n')}`,
                        {
                          parse_mode: 'HTML',
                          ...Markup.inlineKeyboard([
                            ...[
                              app.filename
                                ? [
                                    Markup.button.url(
                                      'Посмотреть на сайте',
                                      `${xEnv.YSTU_URL}/files/prkom_svod/${app.filename}`,
                                    ),
                                  ]
                                : [],
                            ],
                          ]),
                        },
                      )
                      .catch(console.error);
                  }
                }

                console.log(
                  new Date().toLocaleString(),
                  `(CHANGES) [${uid}] 🚨 Detected changes on "${info.competitionGroupName}"`,
                );
                console.log(changes.join('\n'));
              }
            }

            // update last data
            apps.set(hashName, app);
          }

          await new Promise((resolve) => setImmediate(resolve));
        } catch (error) {
          console.error(error);
        }
      }

      this.save().then();

      console.log(new Date().toLocaleString(), '[runWatcher] delay 2 minutes');
      await new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1e3));
    } while (true);
  }
}

export const app = new App();
