import { Telegraf } from 'telegraf';
import * as xEnv from './environment';

let bot: Telegraf = null;

if (xEnv.TELEGRAM_BOT_TOKEN) {
  bot = new Telegraf(xEnv.TELEGRAM_BOT_TOKEN);
  bot
    .start(async (ctx) => {
      ctx.replyWithHTML(`Hello, chatId: <code>${ctx.chat.id}</code>`);
    })
    .launch();
  bot.catch((e) => {
    console.error(e);
  });
}

export { bot };
