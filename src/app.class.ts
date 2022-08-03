import axios from 'axios';
import * as _ from 'lodash';
import { Markup } from 'telegraf';

import * as xEnv from './environment';
import { bot } from './bot';
import { MagaResponseInfo } from './types';
import { md5 } from './utils';
import { cacheManager } from './cache-manager.util';

const prkomApi = axios.create({
  baseURL: xEnv.YSTUTY_PRKOM_URL,
  timeout: 60e3,
});

const APP_SETTING = 'app_setting';

export class App {
  public botTargets = new Map<
    string,
    {
      id: number;
      first_name: string;
      last_name: string;
      username: string;
    }
  >();
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

    if (botTargets && botTargets instanceof Map) {
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

      for (const uid of xEnv.WATCHING_UIDS) {
        try {
          const res = await prkomApi.get<MagaResponseInfo[]>(
            `/admission/get/${uid}`,
          );
          // console.log(res.data);

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
                  `🍥 <b>position</b> changed to ${
                    posDif > 0 ? 'UP' : 'DOWN'
                  } (last <code>${lastItem.position}</code>; new: <code>${
                    item.position
                  }</code>)`,
                );
              }

              if (lastInfo.numbersInfo !== info.numbersInfo) {
                changes.push(
                  `⭐️ <b>numbersInfo</b> changed (last: <code>${lastInfo.numbersInfo}</code>; new: <code>${info.numbersInfo}</code>)`,
                );
              }

              if (lastItem.totalScore !== item.totalScore) {
                changes.push(
                  `🌟 <b>totalScore</b> changed (last: <code>${lastItem.totalScore}</code>; new: <code>${item.totalScore}</code>)`,
                );
              }

              if (lastItem.scoreInterview !== item.scoreInterview) {
                changes.push(
                  `❇️ <b>scoreInterview</b> changed (last: <code>${lastItem.scoreInterview}</code>; new: <code>${item.scoreInterview}</code>)`,
                );
              }

              if (changes.length > 0) {
                if (bot) {
                  const chatIds = _.uniq(
                    [
                      xEnv.TELEGRAM_CHAT_ID,
                      this.botTargets.get(uid)?.id,
                    ].filter(Boolean),
                  );

                  for (const chatId of chatIds) {
                    bot.telegram
                      .sendMessage(
                        chatId,
                        `🦄 <b>(CHANGES DETECTED)</b> UID: [<code>${uid}</code>]\n` +
                          `<b>ComGroup:</b> <code>"${info.competitionGroupName}"</code>\n` +
                          `<b>FormTraining:</b> <code>"${info.formTraining}"</code>\n` +
                          `<b>DocBuildDate:</b> <code>"${info.buildDate}"</code>\n` +
                          `\nChanges:\n` +
                          `${changes.join('\n')}`,
                        {
                          parse_mode: 'HTML',
                          ...Markup.inlineKeyboard([
                            Markup.button.url(
                              'View on site',
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
