import axios from 'axios';
import * as _ from 'lodash';
import { Markup } from 'telegraf';

import * as xEnv from './environment';
import { bot } from './bot';
import { MagaResponseInfo } from './types';
import { md5 } from './utils';
import { cacheManager } from './cache-manager.util';

export const prkomApi = axios.create({
  baseURL: xEnv.YSTUTY_PRKOM_URL,
  timeout: 60e3,
});

const APP_SETTING = 'app_setting';

export class App {
  public botTargets: Record<
    number,
    {
      chatId: number;
      first_name: string;
      last_name: string;
      username: string;
      loadCount: number;
      uid: string;
      // uids: string[];
    }
  > = {};

  public lastData = new Map<string, Map<string, MagaResponseInfo>>();

  public async init() {
    await this.load();
    this.runWatcher().then();
  }

  public async load() {
    const { lastData, botTargets } =
      (await cacheManager.readData(APP_SETTING, true)) || {};

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

  public async save(exit = false) {
    await cacheManager.update(
      APP_SETTING,
      {
        lastData: this.lastData,
        botTargets: this.botTargets,
      },
      9e12,
    );
    if (exit) {
      process.exit();
    }
  }

  public async runWatcher() {
    do {
      console.log(new Date().toLocaleString(), '[runWatcher] execute');

      const targetValues = Object.values(this.botTargets);
      const targetUids = targetValues.flatMap((e) => e.uid);

      const uids = _.uniq(
        [...xEnv.WATCHING_UIDS, ...targetUids].filter(Boolean),
      );
      for (const uid of uids) {
        try {
          const res = await prkomApi.get<MagaResponseInfo[]>(
            `/admission/get/${uid}`,
          );
          // console.log(res.data);

          if (res.data.length === 0) {
            for (const [k, v] of Object.entries(this.botTargets)) {
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

          for (const app of res.data) {
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
                      ...targetValues.map((e) => e.uid === uid && e.chatId),
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
                            Markup.button.url(
                              'Посмотреть на сайте',
                              `${xEnv.YSTU_URL}/files/prkom_svod/${app.filename}`,
                            ),
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
