import { Telegraf, Composer, Context } from 'telegraf';
import { TelegrafSessionRedis } from '@ivaniuk/telegraf-session-redis';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';
import * as _ from 'lodash';

import { app, prkomApi } from './app.class';
import * as xEnv from './environment';
import {
  IContext,
  ITextMessageContext,
  AbiturientInfoResponse,
  NotifyType,
} from './interfaces';
import * as keyboardFactory from './keyboard.factory';
import { redisClient } from './redis.service';
import * as utils from './utils';

// if (!xEnv.TELEGRAM_BOT_TOKEN) {
//   throw new Error('TELEGRAM_BOT_TOKEN is not defined');
// }

export const redisSession = new TelegrafSessionRedis({
  client: redisClient,
  getSessionKey: (ctx) =>
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
  { command: 'minfo', description: 'Show short info' },
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

bot.start(async (ctx: ITextMessageContext & { startPayload: string }) => {
  const newUidRegexp = /uid\-\-(?<uid>[0-9]{3}\-[0-9]{3}-[0-9]{3}[ _][0-9]{2})/;
  let newUid: string = null;
  if (ctx.startPayload) {
    let res = ctx.startPayload.match(newUidRegexp)?.groups;
    if (res) {
      newUid = res.uid.replace(/_/, ' ');
    }
  }

  let prkomLink = 'https://www.ystu.ru/files/prkom_svod/';

  const { npm_package_homepage } = process.env;
  await ctx.replyWithHTML(
    [
      `Привет! 👋`,
      `Бот позволяет подписаться на уведомления об изменениях в <a href="${prkomLink}">списках поступающих ЯГТУ</a>.`,
      ``,
      `• Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      `• Используй /info, чтобы узнать текущее состояние.`,
      ``,
      `Информация об обновлениях бота в <a href="https://vk.com/ystuty">группе VK YSTUty</a>`,
      ``,
      `<code>v${process.env.npm_package_version}</code>`,
      ...(npm_package_homepage
        ? [`<a href="${npm_package_homepage}">View source code on GitHub</a>`]
        : []),
    ].join('\n'),
    {
      disable_web_page_preview: true,
      ...keyboardFactory.main(ctx as IContext),
    },
  );

  if (newUid) {
    if (ctx.session.uid !== newUid || !ctx.session.loadCount) {
      ctx.session.loadCount = 0;
    }
    ctx.session.uid = newUid;
    ctx.session.notifyType = NotifyType.All;

    ctx.replyWithHTML(
      `⭐️ Добавлено в наблюдение: <code>${newUid}</code>`,
      keyboardFactory.main(ctx as IContext),
    );
  }
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

const onInfo = Composer.fork(async (ctx: ITextMessageContext) => {
  const [, ...rest] = ctx.message.text.split(' ').filter(Boolean);
  let uid = rest.join(' ') || ctx.session.uid;

  if (!uid || uid.length > 16) {
    ctx.replyWithHTML(
      `Наблюдение по умолчанию не установлено.\n` +
        `Необходимо указать корректный <i>уникальный код</i> для проверки.\n` +
        `Например, <code>/info 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.\n\n` +
        `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  const res = await prkomApi.get<AbiturientInfoResponse[]>(
    `/v1/admission/get/${uid}?original=true`,
  );

  if (res.data.length === 0) {
    ctx.replyWithHTML(
      `Нет данных для отображения.\n` +
        `Убедитесь в правильности Уникального кода.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  const applications = res.data;
  applications.sort((a, b) => a.item.priority - b.item.priority);

  for (const app of applications) {
    const { info, originalInfo, item, payload } = app;
    const totalSeats = info.numbersInfo.total || null;
    const message = [
      `<b>УК</b>: [<code>${item.uid}</code>]`,
      ``,
      `• ${utils.taggerSmart(originalInfo.buildDate)}`,
      `• ${utils.taggerSep(originalInfo.competitionGroupName)}`,
      `• ${utils.taggerSmart(originalInfo.formTraining)}`,
      `• ${utils.taggerSmart(originalInfo.levelTraining)}`,
      `• ${utils.taggerSmart(originalInfo.basisAdmission)}`,
      `• ${utils.taggerSmart(originalInfo.numbersInfo)}`,
      ``,
      `• Позиция: <code>${item.position}/${totalSeats}</code> ${utils.greenger(
        item.isGreen,
        totalSeats && totalSeats - payload.beforeGreens < 1,
      )}`,
      `• Сумма баллов: <code>${item.totalScore || 'нету'}</code>`,
      ...('scoreExam' in item
        ? [`• Баллы за экзамен: <code>${item.scoreExam || 'нету'}</code>`]
        : 'scoreSubjects' in item && item.scoreSubjects.length > 0
        ? [
            `• Баллы по предметам:`,
            ...item.scoreSubjects.map(
              ([num, name]) =>
                `  ∟ <i>${_.truncate(name, { length: 32 })}</i>: <code>${
                  num || 'нету'
                }</code>`,
            ),
          ]
        : []),
      // `• Баллы за собес: <code>${item.scoreInterview || 'нету'}</code>`,
      `• Оригинал: <code>${item.originalInUniversity ? '✅' : '✖️'}</code>`,
      `• Приоритет: <code>${item.priority}/${item.priorityHight}</code>`,
      payload.beforeGreens + payload.afterGreens > 0
        ? [
            ``,
            `• До проходит: <code>${payload.beforeGreens}</code> чел.`,
            `• После проходит: <code>${payload.afterGreens}</code> чел.`,
          ]
        : [],
    ];
    await ctx.replyWithHTML(
      message.join('\n'),
      keyboardFactory.viewFile(app.filename, item.uid),
    );
  }
});
bot.command('info', onInfo);
bot.hears(
  new RegExp(keyboardFactory.KeyboardKeys.main.info, 'i'),
  onInfo as any,
);

const onShortInfo = Composer.fork(async (ctx: ITextMessageContext) => {
  const newUidRegexp = /.*(?<uid>[0-9]{3}\-[0-9]{3}-[0-9]{3}[ _][0-9]{2})$/;
  let newUid: string = null;
  let uidRes = ctx.message.text.match(newUidRegexp)?.groups;
  if (uidRes) {
    newUid = uidRes.uid.replace(/_/, ' ');
  }
  let uid = newUid || ctx.session.uid;

  if (!uid || uid.length > 16) {
    ctx.replyWithHTML(
      `Наблюдение по умолчанию не установлено.\n` +
        `Необходимо указать корректный <i>уникальный код</i> для проверки.\n` +
        `Например, <code>/info 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.\n\n` +
        `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  const res = await prkomApi.get<AbiturientInfoResponse[]>(
    `/v1/admission/get/${uid}?original=true`,
  );

  if (res.data.length === 0) {
    ctx.replyWithHTML(
      `Нет данных для отображения.\n` +
        `Убедитесь в правильности Уникального кода.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  const applications = res.data;
  const firstApp = applications.at(0);

  applications.sort((a, b) => a.item.priority - b.item.priority);

  let message: string[] = [
    `<b>УК</b>: [<code>${uid}</code>]`,
    ``,
    `• ${utils.taggerSmart(firstApp.originalInfo.buildDate)}`,
  ];

  for (const app of res.data) {
    const { info, originalInfo, item, payload } = app;
    const viewLink = `${xEnv.YSTU_URL}/files/prkom_svod/${
      app.filename
    }#:~:text=${encodeURIComponent(uid).replace(/\-/g, '%2D')}`;
    const totalSeats = info.numbersInfo.total || null;
    const badPosition = totalSeats && totalSeats - payload.beforeGreens < 1;
    const originalInEmoji = item.originalInUniversity ? '✅' : '✖️';
    const posStr = `${item.position}/${totalSeats}`;
    const greengerEmoji = utils.greenger(item.isGreen, badPosition);

    message.push(
      ``,
      `✦ • · · · · · <a href="${viewLink}">[На сайте]</a> · · · · · • ✦`,
      `├── ${utils.taggerSep(originalInfo.competitionGroupName)}`,
      `├── ${utils.taggerSmart(originalInfo.formTraining)}`,
      `├── ${utils.taggerSmart(originalInfo.levelTraining)}`,
      `├── ${utils.taggerSmart(originalInfo.basisAdmission)}`,
      `└── ${utils.taggerSmart(originalInfo.numbersInfo)}`,
      `      ├── Позиция: <code>${posStr}</code> ${greengerEmoji}`,
      `      ├── Сумма баллов: <code>${item.totalScore || 'нету'}</code>`,
      `      ├── Оригинал: <code>${originalInEmoji}</code>`,
      `      └── Приоритет: <code>${item.priority}/${item.priorityHight}</code>`,
    );
  }
  await ctx.replyWithHTML(message.join('\n'));
});
bot.command('minfo', onShortInfo);
bot.hears(
  new RegExp(keyboardFactory.KeyboardKeys.main.minfo, 'i'),
  onShortInfo as any,
);

bot.command('watch', (ctx: ITextMessageContext) => {
  const [, ...rest] = ctx.message.text.split(' ').filter(Boolean);
  const uid = rest.join(' ');

  if (uid.length === 0 || uid.length > 16) {
    ctx.replyWithHTML(
      `Необходимо указать корректный <i>уникальный код</i> для наблюдения.\n` +
        `Например, <code>/watch 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  if (ctx.session.uid !== uid || !ctx.session.loadCount) {
    ctx.session.loadCount = 0;
  }
  ctx.session.uid = uid;
  ctx.session.notifyType = NotifyType.All;

  ctx.replyWithHTML(
    `⭐️ Добавлено в наблюдение: <code>${uid}</code>`,
    keyboardFactory.main(ctx as IContext),
  );
});

const onStop = (ctx: ITextMessageContext) => {
  if (!ctx.session.uid) {
    ctx.replyWithHTML(
      `🔍 Наблюдение не было установлено`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  ctx.session.notifyType = NotifyType.Disabled;
  ctx.replyWithHTML(
    `✋ Наблюдение остановлено`,
    keyboardFactory.main(ctx as IContext),
  );
};
bot.command('stop', onStop);
bot.hears(
  new RegExp(keyboardFactory.KeyboardKeys.main.stop, 'i'),
  onStop as any,
);

const onResume = (ctx: ITextMessageContext) => {
  if (!ctx.session.uid) {
    ctx.replyWithHTML(
      `🔍 Наблюдение не было установлено`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  ctx.session.notifyType = NotifyType.All;
  ctx.replyWithHTML(
    `▶️ Наблюдение возобновлено`,
    keyboardFactory.main(ctx as IContext),
  );
};
bot.command('resume', onResume);
bot.hears(
  new RegExp(keyboardFactory.KeyboardKeys.main.resume, 'i'),
  onResume as any,
);

const onNotifyChange = (ctx: ITextMessageContext) => {
  if (!ctx.session.uid) {
    ctx.replyWithHTML(
      `🔍 Наблюдение не было установлено`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  if (ctx.message.text === keyboardFactory.KeyboardKeys.notify.important) {
    ctx.session.notifyType = NotifyType.Important;
  } else {
    ctx.session.notifyType = NotifyType.All;
  }

  ctx.replyWithHTML(
    `🔔 Уведомленя: ${NotifyType[ctx.session.notifyType]}`,
    keyboardFactory.main(ctx as IContext),
  );
};
bot.hears(
  new RegExp(
    `${keyboardFactory.KeyboardKeys.notify.all}|${keyboardFactory.KeyboardKeys.notify.important}`,
    'i',
  ),
  onNotifyChange as any,
);

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
