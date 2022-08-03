import { Telegraf } from 'telegraf';
import * as xEnv from './environment';

let bot: Telegraf = null;

if (xEnv.TELEGRAM_BOT_TOKEN) {
  bot = new Telegraf(xEnv.TELEGRAM_BOT_TOKEN);
  bot.catch((e) => {
    console.error(e);
  });
  bot.launch().then(() => {
    console.log('Bot launched');
  });

  bot.telegram.setMyCommands([
    { command: 'start', description: 'Show menu' },
    { command: 'info', description: 'Show my info' },
    { command: 'watch', description: 'Set watcher' },
  ]);
}

export { bot };
