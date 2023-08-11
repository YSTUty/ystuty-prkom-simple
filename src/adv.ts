import * as Fs from 'fs-extra';
import * as Path from 'path';
import { TelegramError } from 'telegraf';

import { bot } from './bot';
import { MAP_reviver } from './utils';
import { CACHE_PATH } from './environment';
import { ISessionState, LastAbiturientInfo } from './interfaces';

export class Adv {
  public inProcess = false;
  public counter: Record<string, number> = {};
  public filter: (abiturInfo: LastAbiturientInfo) => boolean = () => true;

  public jsonData: {
    lastData: Map<string, Map<string, LastAbiturientInfo>>;
    targets: Record<number | string, ISessionState>;
  } = null;
  public advDoneFilePath: string;
  public fromChatId: string | number;
  public messageId: number;

  constructor(public readonly path = CACHE_PATH) {
    this.advDoneFilePath = `${Path.resolve(this.path, 'adv-done')}.data`;
  }

  public setMessage(fromChatId: string | number, messageId: number) {
    this.fromChatId = fromChatId;
    this.messageId = messageId;
  }

  public async loadJson(path: string) {
    const filePath = `${Path.resolve(this.path, path)}.json`;
    const str = await Fs.readFile(filePath, 'utf8');
    try {
      this.jsonData = JSON.parse(str, MAP_reviver);
      return true;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  public filterUsers(cb: (abiturInfo: LastAbiturientInfo) => boolean) {
    if (!this.jsonData) return false;

    const activeUsers = Object.entries(this.jsonData.targets).filter(
      ([, v]) => !v.isBlockedBot && v.uid,
    );

    /** Id tg пользователей для расслки */
    const targetUsers: number[] = [];

    for (const [tgId, session] of activeUsers) {
      if (!this.jsonData.lastData.has(session.uid)) {
        continue;
      }

      const data = this.jsonData.lastData.get(session.uid);
      for (const abiturInfo of data.values()) {
        if (cb(abiturInfo)) {
          targetUsers.push(Number(tgId));
        }
        break;
      }
    }

    // return activeUsers.map(([e]) => e).sort();
    return targetUsers;
  }

  public async send(chatId: string | number, skipIt = 0) {
    // return Math.random() > 0.3;

    try {
      const msg = await bot.telegram.forwardMessage(
        chatId,
        this.fromChatId,
        this.messageId,
      );
      return msg.message_id;
    } catch (err) {
      if (skipIt > 2) {
        console.log(`Skip (${chatId})`);
        return false;
      }
      if (err instanceof TelegramError) {
        if (err.response.error_code === 429) {
          const retry_after = err.response.parameters.retry_after || 20;
          console.log(`Wait ${retry_after} sec. (${chatId})`);
          await new Promise((resolve) =>
            setTimeout(resolve, retry_after * 1e3),
          );

          return this.send(chatId, ++skipIt);
        }
      }
      console.error(err);
      return false;
    }
  }

  public async run(advId: string = 'info-1', test = false) {
    if (this.inProcess) {
      return false;
    }
    try {
      this.counter[advId] = 0;
      this.inProcess = true;
      await this.loadJson('dump-full');

      let advDoneStr: string;
      try {
        advDoneStr = await Fs.readFile(this.advDoneFilePath, 'utf8');
      } catch {}
      const ignoreIds: number[] = [];
      if (advDoneStr) {
        const strArr = advDoneStr.split('\n');
        for (const str of strArr) {
          const [timestamp, tgId, type, state, doneAdvId, jsonPayload] =
            str.split('||');
          if (type === 'send' && state === 'ok' && doneAdvId === advId) {
            ignoreIds.push(Number(tgId));
          }
        }
      }

      // * Filter users by AbiturientInfo
      const ids = this.filterUsers(this.filter);

      if (!ids) {
        return null;
      }

      const filteredIds = ids.filter((e) => !ignoreIds.includes(e));
      // const filteredIds = ids.filter((e) => [336136352, 508291082].includes(e));
      console.log('filteredIds', filteredIds);
      if (test) {
        return filteredIds;
      }

      for (const tgId of filteredIds) {
        let msgId = await this.send(tgId);
        if (msgId) {
          this.counter[advId] = this.counter[advId] + 1;
        }
        try {
          await Fs.appendFile(
            this.advDoneFilePath,
            `${[
              Date.now(),
              tgId,
              'send',
              msgId !== false ? 'ok' : 'fail',
              advId,
              JSON.stringify({ ...(msgId && { msgId }) }),
            ].join('||')}\n`,
          );
        } catch (err) {
          console.error(err);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        // if (!state) {
        //   break;
        // }
      }

      return true;
    } catch (err) {
      console.error(err);
      return false;
    } finally {
      this.inProcess = false;
    }
  }
}

export const adv = new Adv();
