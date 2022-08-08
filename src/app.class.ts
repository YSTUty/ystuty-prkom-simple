import axios from 'axios';
import * as _ from 'lodash';

import * as xEnv from './environment';
import { bot, notifyAdmin, redisSession } from './bot';
import { BotTarget, LastMagaInfo, MagaResponseInfo } from './types';
import { greenger, md5, tgKeyboard_ViewFile } from './utils';
import { cacheManager } from './cache-manager.util';
import { redisClient } from './redis.service';

export const prkomApi = axios.create({
  baseURL: xEnv.YSTUTY_PRKOM_URL,
  timeout: 60e3,
});

// TODO: rename ii
const CACHEFILE_LAST_DAT = 'app_setting';

export class App {
  public lastData = new Map<string, Map<string, LastMagaInfo>>();

  public async init() {
    await this.load();
    await this.checkVersion();
    this.runWatcher().then();
  }

  public async getTargetKeys() {
    const prefix = `${xEnv.REDIS_PREFIX}session:`;
    const keys = await redisClient.keys(`${prefix}*`);
    return keys.map((key) => key.replace(prefix, ''));
  }

  public async getTargetChatIds() {
    const keys = await this.getTargetKeys();
    return keys.map((key) => Number(key.split(':')[0]));
  }

  public async getTarget(id: number) {
    const key = `session:${id}:${id}`;
    const session = await redisSession.getSession(key);
    return session;
  }

  public async setTarget(id: number, session: any) {
    const key = `session:${id}:${id}`;
    redisSession.saveSession(key, session);
  }

  public async getTargets(ids: number[] = null) {
    if (!ids || ids.length === 0) {
      ids = await this.getTargetChatIds();
    }
    if (ids.length === 0) {
      return {};
    }

    const keys = ids.map((id) => `session:${id}:${id}`);
    const data = await redisClient.mget(keys);
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

  public async checkVersion() {
    const curVer = process.env.npm_package_version;
    const lastVer = await redisClient.get('app:last-version');

    if (lastVer !== curVer) {
      await redisClient.set('app:last-version', curVer);
      if (lastVer) {
        console.log(`✨ App version changed from ${lastVer} to ${curVer}`);
        // ? TODO: add notify other users
        notifyAdmin(
          `✨ Bot updated from <code>v${lastVer}</code> to <code>v${curVer}</code>`,
        );
      }
    }
  }

  public async load() {
    const { lastData, botTargets } =
      (await cacheManager.readData(CACHEFILE_LAST_DAT, true)) || {};

    if (lastData && lastData instanceof Map) {
      this.lastData = lastData;
    }
  }

  public async save() {
    await cacheManager.update(
      CACHEFILE_LAST_DAT,
      { lastData: this.lastData },
      9e12,
    );
  }

  public async runWatcher() {
    do {
      console.log(new Date().toLocaleString(), '[runWatcher] execute');

      const targets = await this.getTargets();
      const targetEntries = Object.entries(targets);
      const targetUids = targetEntries.flatMap(([, v]) => v.uid);

      const uids = _.uniq(
        [...xEnv.WATCHING_UIDS, ...targetUids].filter(Boolean),
      );
      for (const uid of uids) {
        try {
          const { data: list } = await prkomApi.get<MagaResponseInfo[]>(
            `/admission/get/${uid}?original=true`,
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
            const apps = new Map<string, LastMagaInfo>();
            this.lastData.set(uid, apps);
          }

          for (const app of list) {
            const { originalInfo, info, item } = app;

            const apps = this.lastData.get(uid);
            // TODO: use hashName = md5(app.filename);
            const hashName = md5(
              [
                originalInfo.competitionGroupName,
                originalInfo.formTraining,
                originalInfo.levelTraining,
                originalInfo.directionTraining,
                originalInfo.basisAdmission,
                originalInfo.sourceFunding,
              ].join(';'),
            );

            if (apps.has(hashName)) {
              const { info: lastInfo, item: lastItem } = apps.get(hashName);

              const changes: string[] = [];

              const lastTotalSeats = lastInfo.numbersInfo.total || null;
              const totalSeats = info.numbersInfo.total || null;

              if (lastInfo.numbersInfo.total !== info.numbersInfo.total) {
                changes.push(
                  `💺 <b>МЕСТА</b> изменны (было всего мест: <code>${lastInfo.numbersInfo.total}</code>;` +
                    ` стало всего мест: <code>${info.numbersInfo.total}</code>)`,
                );
              } else if (
                lastInfo.numbersInfo.enrolled !== info.numbersInfo.enrolled
              ) {
                changes.push(
                  `💺 <b>МЕСТА</b> изменны (было зачислено: <code>${lastInfo.numbersInfo.enrolled}</code>;` +
                    ` стало зачислено: <code>${info.numbersInfo.enrolled}</code>)`,
                );
              } else if (
                lastInfo.numbersInfo.toenroll !== info.numbersInfo.toenroll
              ) {
                changes.push(
                  `💺 <b>МЕСТА</b> изменны (было к зачислению: <code>${lastInfo.numbersInfo.toenroll}</code>;` +
                    ` стало к зачислению: <code>${info.numbersInfo.toenroll}</code>)`,
                );
              }

              const posDif = lastItem.position - item.position;
              if (posDif !== 0) {
                changes.push(
                  `🍥 <b>ПОЗИЦИЯ</b> изменена ${
                    posDif > 0 ? '👍' : '👎'
                  } (было: <code>${lastItem.position}</code>; стало: <code>${
                    item.position
                  }</code>)`,
                );
              }

              if (
                lastItem.isGreen !== item.isGreen ||
                (lastTotalSeats && totalSeats && lastTotalSeats !== totalSeats)
              ) {
                changes.push(
                  `🚀 <b>СТАТУС</b> изменен (было: <code>${greenger(
                    lastItem.isGreen,
                    lastTotalSeats && lastItem.position > lastTotalSeats,
                  )}</code>; стало: <code>${greenger(
                    item.isGreen,
                    totalSeats && item.position > totalSeats,
                  )}</code>)`,
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
                        `🦄 <b>(CHANGES DETECTED)</b>\n` +
                          `Уникальный код: [<code>${uid}</code>]\n` +
                          `<b>• ${originalInfo.competitionGroupName}</b>\n` +
                          `<b>• ${originalInfo.formTraining}</b>\n` +
                          `<b>• ${originalInfo.buildDate}</b>\n` +
                          `<b>• ${originalInfo.numbersInfo}</b>\n` +
                          `\nИзменения:\n` +
                          `${changes.join('\n')}`,
                        {
                          parse_mode: 'HTML',
                          ...tgKeyboard_ViewFile(app.filename),
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

            delete app.originalInfo;
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
