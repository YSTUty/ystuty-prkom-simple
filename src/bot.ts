import { Telegraf, Composer, Context } from 'telegraf';
import { TelegrafSessionRedis } from '@ivaniuk/telegraf-session-redis';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';

import { app, prkomApi } from './app.class';
import * as xEnv from './environment';
import { ITextMessageContext } from './telegraf.interface';
import { MagaResponseInfo } from './types';
import { redisClient } from './redis.service';
import * as utils from './utils';

// if (!xEnv.TELEGRAM_BOT_TOKEN) {
//   throw new Error('TELEGRAM_BOT_TOKEN is not defined');
// }

export const redisSession = new TelegrafSessionRedis({
  client: redisClient,
  getSessionKey: (ctx: Context) =>
    ctx.from && ctx.chat && `session:${ctx.from.id}:${ctx.chat.id}`,
});
const rateLimiter = new utils.RateLimiter(1, 1e3);

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
  { command: 'stop', description: 'Stop watcher' },
]);

bot.use(redisSession.middleware());
bot.use((ctx: any, next) => {
  if (!ctx.session.chatId) {
    notifyAdmin(
      `<b>[DEBUG]</b> New user: <code>${ctx.from.id}</code> <code>@${ctx.from.username}</code>`,
    );
  }

  const toSession = {
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

  return next();
});

bot.on('message', async (ctx, next) => {
  const limited = await rateLimiter.take(ctx.from.id);

  if (limited) {
    await ctx.reply('Подожди пару секунд... 🥵');
    return;
  }
  return await next();
});

bot.start((ctx) => {
  const { npm_package_homepage } = process.env;
  ctx.replyWithHTML(
    `Привет! 👋\n` +
      `Бот позволяет подписаться на уведомления об изменениях в списках поступающих в ЯГТУ.\n\n` +
      `• Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.\n` +
      `• Используй /info, чтобы узнать текущее состояние.\n\n` +
      `Информация об обновлениях бота в <a href="https://vk.com/ystuty">группе VK YSTUty</a>\n\n` +
      `<code>v${process.env.npm_package_version}</code>` +
      (!npm_package_homepage
        ? ''
        : `\n<a href="${npm_package_homepage}">Перейти в репозиторий</a>`),
    { disable_web_page_preview: true },
  );
});

bot.command('app', (ctx) => {
  if (!xEnv.TELEGRAM_ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  console.log('app', app);
  ctx.reply('see console');
});

bot.command('dump', async (ctx) => {
  if (!xEnv.TELEGRAM_ADMIN_IDS.includes(ctx.from.id)) {
    return;
  }

  const [, type] = ctx.message.text.split(' ').filter(Boolean);

  switch (type?.toLowerCase()) {
    case 'full': {
      const targets = await app.getTargets();
      ctx.replyWithDocument({
        source: Buffer.from(
          JSON.stringify(
            { lastData: app.lastData, targets },
            utils.MAP_replacer,
            2,
          ),
        ),
        filename: 'dump-full.json',
      });
      return;
    }
    case 'targets': {
      const targets = await app.getTargets();
      console.log('targets', targets);

      ctx.replyWithDocument({
        source: Buffer.from(JSON.stringify({ targets }, utils.MAP_replacer, 2)),
        filename: 'dump-targets.json',
      });
      return;
    }
    case 'lastdata': {
      ctx.replyWithDocument({
        source: Buffer.from(
          JSON.stringify({ lastData: app.lastData }, utils.MAP_replacer, 2),
        ),
        filename: 'dump-lastdata.json',
      });
      return;
    }
    default: {
      ctx.replyWithHTML(
        'Unknown type.\n' +
          'Use <code>/dump full</code>\n' +
          'Use <code>/dump targets</code>\n' +
          'Use <code>/dump lastdata</code>',
      );
      return;
    }
  }
});

bot.command(
  'info',
  Composer.fork(async (ctx: ITextMessageContext) => {
    const [, ...rest] = ctx.message.text.split(' ').filter(Boolean);
    let uid = rest.join(' ') || ctx.session.uid;

    if (!uid || uid.length > 16) {
      ctx.replyWithHTML(
        `Наблюдение по умолчанию не установлено.\n` +
          `Необходимо указать корректный <i>уникальный код</i> для проверки.\n` +
          `Например, <code>/info 123-456-789 10</code>.\n` +
          `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.\n\n` +
          `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      );
      return;
    }

    const res = await prkomApi.get<MagaResponseInfo[]>(
      `/admission/get/${uid}?original=true`,
    );

    if (res.data.length === 0) {
      ctx.replyWithHTML(
        `Нет данных для отображения.\n` +
          `Убедитесь в правильности Уникального кода.`,
      );
      return;
    }

    for (const app of res.data) {
      const { info, originalInfo, item, payload } = app;
      const totalSeats = info.numbersInfo.total || null;
      const message = [
        `• <b>УК: ${item.uid}</b>`,
        `• ${utils.taggerSmart(originalInfo.buildDate)}`,
        `• ${utils.taggerSep(originalInfo.competitionGroupName)}`,
        `• ${utils.taggerSmart(originalInfo.formTraining)}`,
        `• ${utils.taggerSmart(originalInfo.levelTraining)}`,
        `• ${utils.taggerSmart(originalInfo.basisAdmission)}`,
        `• ${utils.taggerSmart(originalInfo.numbersInfo)}`,
        ``,
        `• Позиция: <code>${
          item.position
        }/${totalSeats}</code> ${utils.greenger(
          item.isGreen,
          totalSeats && totalSeats - payload.beforeGreens < 1,
        )}`,
        `• Сумма баллов: <code>${item.totalScore || 'нету'}</code>`,
        `• Баллы за экзамен: <code>${item.scoreExam || 'нету'}</code>`,
        `• Баллы за собес: <code>${item.scoreInterview || 'нету'}</code>`,
        `• Оригинал: <code>${item.original ? '✅' : '✖️'}</code>`,
        ``,
        `• До проходит: <code>${payload.beforeGreens}</code> чел.`,
        `• После проходит: <code>${payload.afterGreens}</code> чел.`,
      ];
      await ctx.replyWithHTML(
        message.join('\n'),
        utils.tgKeyboard_ViewFile(app.filename),
      );
    }
  }),
);

bot.command('watch', (ctx: ITextMessageContext) => {
  const [, ...rest] = ctx.message.text.split(' ').filter(Boolean);
  const uid = rest.join(' ');

  if (uid.length === 0 || uid.length > 16) {
    ctx.replyWithHTML(
      `Необходимо указать корректный <i>уникальный код</i> для наблюдения.\n` +
        `Например, <code>/watch 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.`,
    );
    return;
  }

  if (ctx.session.uid !== uid || !ctx.session.loadCount) {
    ctx.session.loadCount = 0;
  }
  ctx.session.uid = uid;
  delete ctx.session.powerOff;

  ctx.replyWithHTML(`Добавлено в наблюдение: <code>${uid}</code>`);
});

bot.command('stop', (ctx: ITextMessageContext) => {
  if (!ctx.session.uid) {
    ctx.replyWithHTML(`Наблюдение не было установлено`);
    return;
  }

  ctx.session.powerOff = true;
  ctx.replyWithHTML(`Наблюдение остановлено`);
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
