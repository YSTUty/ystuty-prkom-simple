import axios from 'axios';
import * as _ from 'lodash';

import * as xEnv from './environment';
import { bot, botCatchException, notifyAdmin, redisSession } from './bot';
import {
  AbiturientInfoStateType,
  ISessionState,
  LastAbiturientInfo,
  AbiturientInfoResponse,
  NotifyType,
} from './interfaces';
import { cacheManager } from './cache-manager.util';
import * as keyboardFactory from './keyboard.factory';
import { redisClient } from './redis.service';
import { getAbiturientInfoStateString, getStatusColor, md5 } from './utils';
import { userCounter, startMetric } from './prometheus';

export const prkomApi = axios.create({
  baseURL: xEnv.YSTUTY_PRKOM_API_URL,
  timeout: 60e3,
});

// TODO: rename ii
const CACHEFILE_LAST_DAT = 'app_setting';

// !!
const testFake = false;

export class App {
  public lastData = new Map<string, Map<string, LastAbiturientInfo>>();

  public showPositions: boolean;

  public async init() {
    await this.load();
    await this.checkVersion();

    try {
      bot.botInfo ??= await bot.telegram.getMe();
      const availableSessions = Object.values(await this.getTargets()).filter(
        (e) => !e.isBlockedBot,
      );
      console.log('Counter users set', availableSessions.length);
      userCounter.set({ bot: bot.botInfo.username }, availableSessions.length);
    } catch (err) {
      console.error(err);
    }

    startMetric();
    this.showPositions =
      (await redisClient.get('app:options:showPositions')) === 'true';

    this.runWatcherSafe().then();
  }

  public async toggleShowPositions(state?: boolean) {
    state ??= (await redisClient.get('app:options:showPositions')) === 'true';
    this.showPositions = !state;

    await redisClient.set(
      'app:options:showPositions',
      String(this.showPositions),
    );
    return this.showPositions;
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

  public setTarget(id: number, session: any) {
    const key = `session:${id}:${id}`;
    return redisSession.saveSession(key, session);
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
    ) as Record<number, ISessionState>;
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

  public async runWatcherSafe() {
    do {
      console.log(new Date().toLocaleString(), '[runWatcher] execute');

      try {
        const targets = await this.getTargets();
        const targetEntries = Object.entries(targets);
        const targetUids = targetEntries.flatMap(([, v]) => v.uid);
        const uids = _.uniq(
          [...xEnv.WATCHING_UIDS, ...targetUids].filter(Boolean),
        );
        if (testFake) {
          uids.push(...Array.from({ length: 1500 }, () => '123-456-789 00'));
        }

        for (const arr of _.chunk(uids, 400)) {
          await this.runWatcher(arr, targetEntries);
        }
      } catch (err) {
        console.error(err);
        notifyAdmin(`[Error] runWatcher: ${err.message}`);
      }

      this.save().then();

      console.log(new Date().toLocaleString(), '[runWatcher] delay 2 minutes');
      await new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1e3));

      await new Promise((resolve) => setImmediate(resolve));
    } while (true);
  }

  protected async runWatcher(
    uids: string[],
    targetEntries: [string, ISessionState][],
  ) {
    const { data: list } = await prkomApi.get<AbiturientInfoResponse[]>(
      testFake
        ? `/v1/admission/get_many?original=true&uids=${uids.join(',')}`
        : `/v1/admission/get/fake?original=true&uids=${uids.join(',')}`,
    );

    const mapList = new Map<string, Map<string, AbiturientInfoResponse>>();

    for (const info of list) {
      const { uid } = info.item;
      if (!mapList.has(uid)) {
        mapList.set(uid, new Map());
      }
      mapList.get(uid).set(info.filename, info);
    }

    for (const uid of uids) {
      try {
        if (!mapList.has(uid)) {
          for (const [, session] of targetEntries) {
            if (session.uid === uid) {
              if ((session.loadCount = (session.loadCount || 0) + 1) > 3) {
                session.uid = null;
                this.lastData.delete(uid);
              }
            }
          }
          continue;
        }

        if (!this.lastData.has(uid)) {
          const apps = new Map<string, LastAbiturientInfo>();
          this.lastData.set(uid, apps);
        }

        for (const app of mapList.get(uid).values()) {
          const { originalInfo, info, item } = app;
          if (!originalInfo) continue;
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

            let isImportant = false;
            let isNewEnrolled = false;
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
              if (!item.isGreen) {
                isImportant = true;
              }
              changes.push(
                `💺 <b>МЕСТА</b> изменны (было зачислено: <code>${lastInfo.numbersInfo.enrolled}</code>;` +
                  ` стало зачислено: <code>${info.numbersInfo.enrolled}</code>)`,
              );
            } else if (
              lastInfo.numbersInfo.toenroll !== info.numbersInfo.toenroll
            ) {
              if (!item.isGreen) {
                isImportant = true;
              }
              changes.push(
                `💺 <b>МЕСТА</b> изменны (было к зачислению: <code>${lastInfo.numbersInfo.toenroll}</code>;` +
                  ` стало к зачислению: <code>${info.numbersInfo.toenroll}</code>)`,
              );
            }

            if (lastItem.state !== item.state) {
              changes.push(
                `❇️ <b>Состояние</b> изменено (было: <code>${getAbiturientInfoStateString(
                  lastItem.state,
                )}</code>; стало: <code>${getAbiturientInfoStateString(
                  item.state,
                )}</code>)`,
              );
              isImportant = true;
              if (item.state === AbiturientInfoStateType.Enrolled) {
                isNewEnrolled = true;
              }
            }

            const posDif = lastItem.position - item.position;
            if (this.showPositions && posDif !== 0) {
              if (posDif > 0) {
                isImportant = true;
              }
              changes.push(
                `🍥 <b>ПОЗИЦИЯ</b> изменена ${
                  posDif > 0 ? '👍' : '👎'
                } (было: <code>${lastItem.position}</code>; стало: <code>${
                  item.position
                }</code>)`,
              );
            }

            if (
              !isNewEnrolled &&
              ((lastItem.isGreen !== null &&
                lastItem.isGreen !== item.isGreen) ||
                (lastItem.isRed !== null && lastItem.isRed !== item.isRed) ||
                (lastTotalSeats && totalSeats && lastTotalSeats !== totalSeats))
            ) {
              isImportant = true;
              changes.push(
                `🚀 <b>СТАТУС</b> изменен (было: <code>${getStatusColor(
                  lastItem.isGreen,
                  lastItem.isRed ||
                    (lastTotalSeats && lastItem.position > lastTotalSeats),
                )}</code>; стало: <code>${getStatusColor(
                  item.isGreen,
                  item.isRed ||
                    (totalSeats && totalSeats - app.payload.beforeGreens < 1),
                )}</code>)`,
              );
            }

            if (lastItem.totalScore !== item.totalScore) {
              isImportant = true;
              changes.push(
                `🌟 <b>СУММА БАЛЛОВ</b> изменена (было: <code>${lastItem.totalScore}</code>; стало: <code>${item.totalScore}</code>)`,
              );
            }

            // if (lastItem.scoreInterview !== item.scoreInterview) {
            //   changes.push(
            //     `⭐️ <b>БАЛЛЫ СОБЕСА</b> изменены (было: <code>${lastItem.scoreInterview}</code>; стало: <code>${item.scoreInterview}</code>)`,
            //   );
            // }

            if (
              'scoreExam' in lastItem &&
              'scoreExam' in item &&
              lastItem.scoreExam !== item.scoreExam
            ) {
              isImportant = true;
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
                      ([chatId, session]) =>
                        session.isBlockedBot !== true &&
                        session.uid === uid &&
                        (!session.notifyType ||
                          session.notifyType !== NotifyType.Disabled) &&
                        (session.notifyType == NotifyType.All ||
                          (session.notifyType === NotifyType.Important &&
                            isImportant)) &&
                        Number(chatId),
                    ),
                  ].filter(Boolean),
                );

                for (const chatId of chatIds) {
                  bot.telegram
                    .sendMessage(
                      chatId,
                      `${[
                        `🦄 <b>(CHANGES DETECTED)</b>`,
                        `<b>УК</b>: [<code>${uid}</code>]`,
                        ``,
                        `<b>• ${originalInfo.competitionGroupName}</b>`,
                        `<b>• ${originalInfo.formTraining}</b>`,
                        `<b>• ${originalInfo.buildDate}</b>`,
                        `<b>• ${originalInfo.numbersInfo}</b>`,
                        ``,
                        `Изменения:`,
                        ...changes,
                      ].join('\n')}`,
                      {
                        parse_mode: 'HTML',
                        ...keyboardFactory.viewFile(app.filename, uid),
                      },
                    )
                    .then(() => {
                      if (isNewEnrolled) {
                        bot.telegram.sendMessage(chatId, `🎉`).then((e) => {
                          bot.telegram.sendMessage(
                            chatId,
                            `🦄 <b>(HAPPY)</b>\n` +
                              `УК: [<code>${uid}</code>]\n` +
                              `🎉 Поздравляем с зачилением!`,
                            {
                              parse_mode: 'HTML',
                              reply_to_message_id: e.message_id,
                            },
                          );
                        });
                      }
                    })
                    .catch(async (err) => {
                      if (!(await botCatchException(err, chatId))) {
                        console.error(err);
                      }
                    });
                }
              }

              console.log(
                new Date().toLocaleString(),
                `(CHANGES) [${uid}] 🚨 Detected changes on "${info.competitionGroupName}"`,
              );
              // console.log(changes.join('\n'));
            }
          }

          const cloneApp = _.cloneDeep(app);
          delete cloneApp.originalInfo;
          // update last data
          apps.set(hashName, cloneApp);
        }

        await new Promise((resolve) => setImmediate(resolve));
      } catch (error) {
        console.log(`[Error] Watcher (${uid}):`);
        console.error(error);
      }
    }
  }
}

export const app = new App();
