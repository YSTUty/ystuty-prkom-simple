import { Telegraf, Composer, Context } from 'telegraf';
import { TelegrafSessionRedis } from '@ivaniuk/telegraf-session-redis';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';

import { app, prkomApi } from './app.class';
import * as xEnv from './environment';
import { ITextMessageContext } from './telegraf.interface';
import { MagaResponseInfo } from './types';
import { redisClient } from './redis.service';

// if (!xEnv.TELEGRAM_BOT_TOKEN) {
//   throw new Error('TELEGRAM_BOT_TOKEN is not defined');
// }

export const redisSession = new TelegrafSessionRedis({
  client: redisClient,
  getSessionKey: (ctx: Context) =>
    ctx.from && ctx.chat && `session:${ctx.from.id}:${ctx.chat.id}`,
});

let bot = new Telegraf(xEnv.TELEGRAM_BOT_TOKEN);
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

bot.use(redisSession.middleware());
bot.use((ctx: any, next) => {
  // !
  const oldValues = app.botTargets[ctx.from.id];
  delete app.botTargets[ctx.from.id];

  if (!ctx.session.chatId) {
    notifyAdmin(
      `<b>[DEBUG]</b> New user: <code>${ctx.from.id}</code> <code>@${ctx.from.username}</code>`,
    );
  }

  const toSession = {
    ...oldValues,
    chatId: ctx.from.id,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    username: ctx.from.username,
  };

  for (const key in toSession) {
    if (toSession[key] !== undefined) {
      ctx.session[key] = toSession[key];
    }
  }

  next();
});

bot.start((ctx) => {
  ctx.replyWithHTML(
    `Привет! Бот помогает отслеживать изменения в списке поступления ЯГТУ.\n` +
      `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.\n\n` +
      `<code>v${process.env.npm_package_version}</code>`,
  );
});

bot.command('app', (ctx) => {
  if (!xEnv.TELEGRAM_ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  console.log('app', app);
  ctx.reply('see console');
});

bot.command(
  'info',
  Composer.fork(async (ctx: ITextMessageContext) => {
    const target = ctx.session.uid ? ctx.session : app.botTargets[ctx.from.id];

    if (!target || !target.uid) {
      ctx.replyWithHTML(
        `Наблюдение не установлено.\n` +
          `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      );
      return;
    }

    const res = await prkomApi.get<MagaResponseInfo[]>(
      `/admission/get/${target.uid}`,
    );

    if (res.data.length === 0) {
      ctx.replyWithHTML(
        `Нет данных для отображения.\n` +
          `Убедитесь в правильности Уникального кода.`,
      );
      return;
    }

    for (const app of res.data) {
      const { info, item } = app;
      ctx.replyWithHTML(
        `• <b>УК: ${item.uid}</b>\n` +
          `• ${info.buildDate}\n` +
          `• ${info.competitionGroupName}\n` +
          `• ${info.formTraining}\n` +
          `• ${info.levelTraining}\n` +
          `• ${info.basisAdmission}\n` +
          `• ${info.numbersInfo}\n` +
          `\n` +
          `• Позиция: <code>${item.position}</code>\n` +
          `• Сумма баллов: <code>${item.totalScore}</code>\n`,
      );
    }
  }),
);

bot.command('watch', (ctx: ITextMessageContext) => {
  const [, ...rest] = ctx.message.text.split(' ');
  const uid = rest.join(' ');

  if (uid.length === 0 || uid.length > 20) {
    ctx.replyWithHTML(
      `Необходимо указать корректный <i>уникальный код</i> для наблюдения.\n` +
        `Например, <code>/watch 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.`,
    );
    return;
  }

  if (!app.botTargets[ctx.from.id]) {
    app.botTargets[ctx.from.id] = {
      chatId: ctx.chat.id,
      loadCount: 0,
      uid,
    };
  }

  if (ctx.session.uid !== uid || !ctx.session.loadCount) {
    ctx.session.loadCount = 0;
    app.botTargets[ctx.from.id].loadCount = 0;
  }
  ctx.session.uid = uid;
  app.botTargets[ctx.from.id].uid = uid;

  ctx.replyWithHTML(`Добавлено в наблюдение: <code>${uid}</code>`);
});

export const notifyAdmin = async (
  message: string,
  extra: ExtraReplyMessage = {},
) => {
  // TODO: FIX BIG SPAM
  for (const uid of xEnv.TELEGRAM_ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(uid, message, {
        parse_mode: 'HTML',
        disable_notification: true,
        ...extra,
      });
    } catch {}
  }
};

export { bot };
