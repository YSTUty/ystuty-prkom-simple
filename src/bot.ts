import {
  Telegraf,
  Composer,
  TelegramError,
  Context as TelegrafContext,
} from 'telegraf';
import { TelegrafSessionRedis } from '@ivaniuk/telegraf-session-redis';
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types';
import * as tt from 'telegraf/typings/core/types/typegram';
import * as _ from 'lodash';

import { app, prkomApi } from './app.class';
import * as xEnv from './environment';
import {
  IContext,
  ITextMessageContext,
  AbiturientInfoResponse,
  NotifyType,
  INarrowedContext,
} from './interfaces';
import * as keyboardFactory from './keyboard.factory';
import { redisClient } from './redis.service';
import * as utils from './utils';
import { userCounter, tgInfoCounter } from './prometheus';

// if (!xEnv.TELEGRAM_BOT_TOKEN) {
//   throw new Error('TELEGRAM_BOT_TOKEN is not defined');
// }

export const redisSession = new TelegrafSessionRedis({
  client: redisClient,
  getSessionKey: (ctx) =>
    ctx.from && ctx.chat && `session:${ctx.from.id}:${ctx.chat.id}`,
});
const rateLimiter = new utils.RateLimiter(1, 1e3);

export const botCatchException = async (
  exception: Error,
  ctxOrChatId: IContext | string | number,
) => {
  if (exception instanceof TelegramError) {
    if (
      exception.description.includes('bot was blocked by the user') ||
      exception.description.includes('user is deactivated') ||
      exception.description.includes('chat not found')
    ) {
      let fromId = -1;
      let chatId = -1;

      let ctx = ctxOrChatId;
      if (typeof ctx === 'string' || typeof ctx === 'number') {
        fromId = chatId = Number(ctx);
      } else {
        fromId = ctx.from.id;
        chatId = ctx.chat.id;
      }

      const key = `session:${fromId}:${chatId}`;
      let session = await redisSession.getSession(key);
      if (session.isBlockedBot) {
        return true;
      }

      session.isBlockedBot = true;
      await redisSession.saveSession(key, session);
      return true;
    }
  }
};

const bot = new Telegraf(xEnv.TELEGRAM_BOT_TOKEN);
bot.catch(async (exception: any, ctx: IContext) => {
  if (!(await botCatchException(exception, ctx))) {
    console.error(exception);
  }
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
bot.use((ctx: IContext, next) => {
  if (!ctx.session.chatId) {
    ctx.state.isFirst = true;
    ctx.session.startAt = new Date();
    userCounter.inc({ bot: ctx.botInfo.username });
    notifyAdmin(
      `<b>[DEBUG]</b> New user: <code>${ctx.from.id}</code> - ${
        ctx.from.username ? `@${ctx.from.username}` : 'no username'
      }`,
    );
  }

  if (ctx.session.isBlockedBot) {
    delete ctx.session.isBlockedBot;
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

bot.on(
  'my_chat_member',
  (ctx: INarrowedContext<tt.Update.MyChatMemberUpdate>) => {
    const { status } = ctx.myChatMember.new_chat_member;
    if (status === 'kicked' || status === 'left') {
      ctx.session.isBlockedBot = true;
      userCounter.dec({ bot: ctx.botInfo.username });
    } else if (status === 'member') {
      userCounter.inc({ bot: ctx.botInfo.username });
    }
  },
);

bot.start(async (ctx: ITextMessageContext & { startPayload: string }) => {
  const newUidRegexp = /uid\-\-(?<uid>[0-9]{3}\-[0-9]{3}-[0-9]{3}[ _][0-9]{2})/;
  let newUid: string = null;
  if (ctx.startPayload) {
    let res = ctx.startPayload.match(newUidRegexp)?.groups;
    if (res) {
      newUid = res.uid.replace(/_/, ' ');
    }
  }

  const { npm_package_homepage } = process.env;
  await ctx.replyWithHTML(
    [
      `Привет! 👋`,
      `Бот позволяет подписаться на уведомления об изменениях в <a href="${xEnv.YSTUTY_PRKOM_URL}/">списках поступающих ЯГТУ</a>.`,
      ...(ctx.state.isFirst || !newUid
        ? [
            ``,
            `• "Уникальный код" — "УК" — это номер СНИЛСа.`,
            ``,
            `• Для начала отслеживания изменений отправь сообщение с <i>уникальным кодом</i>;`,
            `• или используй команду с указанием параметра <code>/watch 123-456-789 10</code>, где <i>123-456-789 10</i> - уникальный код для наблюдения.`,
            `• Используй /info, чтобы узнать текущее состояние.`,
          ]
        : []),
      ``,
      `Информация об обновлениях бота от YSTUty <a href="https://t.me/ystuty_log">в Telegram канале</a> и <a href="https://vk.com/ystuty">в группе VK</a>`,
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
    case undefined:
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

  tgInfoCounter.inc({ bot: ctx.botInfo.username, cmd: 'info' });

  const applications = res.data;
  applications.sort((a, b) => a.item.priority - b.item.priority);

  for (const app of applications) {
    const { info, originalInfo, item, payload } = app;
    const totalSeats = info.numbersInfo.total ?? 0;
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
      `• Приоритет: <code>${item.priority}</code>${
        item.isHightPriority ? ' <b>(Высший)</b>' : ''
      }`,
      `• Состояние: <code>${utils.getAbiturientInfoStateString(
        item.state,
      )}</code> ${utils.getStatusColor(
        item.isGreen,
        item.isRed || (totalSeats && totalSeats - payload.beforeGreens < 1),
      )}`,
      `• Позиция: <code>${item.position}/${totalSeats}</code>`,
      `• Позиция по оригиналам: <code>${payload.beforeOriginals + 1}</code>`,
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
      `• Оригинал: <code>${
        item.originalInUniversity || item.originalFromEGPU ? '✅' : '✖️'
      }</code>`,
      ``,
      ...(payload.beforeGreens + payload.afterGreens > 0
        ? [
            `• Итоговая позиция: <code>${payload.beforeGreens + 1}</code>`,
            `• До проходит: <code>${payload.beforeGreens}</code> чел.`,
            `• После проходит: <code>${payload.afterGreens}</code> чел.`,
          ]
        : []),
    ];
    await ctx.replyWithHTML(
      message.join('\n'),
      keyboardFactory.viewFile(app.filename, item.uid),
    );
  }
});
bot.command('info', onInfo);
bot.hears(
  new RegExp(`^${keyboardFactory.KeyboardKeys.main.info}`, 'i'),
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

  tgInfoCounter.inc({ bot: ctx.botInfo.username, cmd: 'short_info' });

  const applications = res.data;
  const firstApp = applications.at(0);

  applications.sort((a, b) => a.item.priority - b.item.priority);

  const originalInEmoji =
    firstApp.item.originalInUniversity || firstApp.item.originalFromEGPU
      ? '✅'
      : '✖️';

  let message: string[] = [
    `<b>УК</b>: [<code>${uid}</code>]`,
    ``,
    `📄 ${utils.taggerSmart(firstApp.originalInfo.buildDate)}`,
    `  ├── Сумма баллов: <code>${firstApp.item.totalScore || 'нету'}</code>`,
    `  └── Оригинал: <code>${originalInEmoji}</code>`,
  ];

  for (const app of res.data) {
    const { info, originalInfo, item, payload } = app;

    // const textHash = encodeURIComponent(uid.split('-').pop());
    // const viewLink = `${xEnv.YSTU_PRKOM_URL}/${app.filename}#:~:text=${textHash}`;
    const viewLink = `${xEnv.YSTUTY_PRKOM_URL}/view/${app.filename}?userUid=${uid}`;

    const totalSeats = info.numbersInfo.total ?? 0;
    const badPosition = totalSeats && totalSeats - payload.beforeGreens < 1;
    const posStr = `${item.position}/${totalSeats}`;
    const coloredBallEmoji = utils.getStatusColor(
      item.isGreen,
      item.isRed || badPosition,
    );

    let content = [
      ``,
      `  ✦ •  · · ··· <a href="${viewLink}">[Посмотреть на сайте]</a>  ··· · ·  •  ✦`,
      `📃─ ${utils.taggerSep(originalInfo.competitionGroupName)}`,
      `├── ${utils.taggerSmart(originalInfo.formTraining)}`,
      `├── ${utils.taggerSmart(originalInfo.levelTraining)}`,
      `├── ${utils.taggerSmart(originalInfo.basisAdmission)}`,
      `└── ${utils.taggerSmart(originalInfo.numbersInfo)}`,
      `      ├── Состояние: <code>${utils.getAbiturientInfoStateString(
        item.state,
      )}</code> ${coloredBallEmoji}`,
      `      ├── Приоритет: <code>${item.priority}</code>${
        item.isHightPriority ? ' <b>(Высший)</b>' : ''
      }`,
      `      ├── Позиция по оригиналам: <code>${
        payload.beforeOriginals + 1
      }</code>`,
      `      └── Позиция: <code>${posStr}</code>`,
      ...(payload.beforeGreens + payload.afterGreens > 0
        ? [
            `         └── Итоговая позиция: <code>${
              payload.beforeGreens + 1
            }</code>`,
            `            ├── До проходит: <code>${payload.beforeGreens}</code> чел.`,
            `            └── После проходит: <code>${payload.afterGreens}</code> чел.`,
          ]
        : []),
    ];

    if ([...message, ...content].join('\n').length > 4096) {
      await ctx.replyWithHTML(message.join('\n'));
      message.length = 0;
    }

    message.push(...content);
  }

  await ctx.replyWithHTML(message.join('\n'));
});
bot.command('minfo', onShortInfo);
bot.hears(
  new RegExp(`^${keyboardFactory.KeyboardKeys.main.minfo}`, 'i'),
  onShortInfo as any,
);

const onWatch = (ctx: ITextMessageContext) => {
  const newUidRegexp = /.*?(?<uid>[0-9]{3}\-[0-9]{3}-[0-9]{3}[ _][0-9]{2})$/;
  let uid: string = null;
  const uidRes = ctx.message.text.match(newUidRegexp)?.groups;
  if (uidRes) {
    uid = uidRes.uid.replace(/_/, ' ');
  }
  const oldUid = ctx.session.uid;

  if (!uid || uid.length === 0 || uid.length > 16) {
    ctx.replyWithHTML(
      `Необходимо указать корректный <i>уникальный код</i> для наблюдения.\n` +
        `Например, <code>/watch 123-456-789 10</code>.\n` +
        `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }
  if (oldUid && oldUid === uid) {
    ctx.replyWithHTML(
      `⭐️ УК [<code>${uid}</code>] уже отслеживается`,
      keyboardFactory.main(ctx as IContext),
    );
    return;
  }

  if (oldUid !== uid || !ctx.session.loadCount) {
    ctx.session.loadCount = 0;
  }
  ctx.session.uid = uid;
  ctx.session.notifyType = NotifyType.All;

  ctx.replyWithHTML(
    oldUid && oldUid !== uid
      ? `⭐️ Изменено наблюдение с [<code>${oldUid}</code>] на [<code>${uid}</code>]`
      : `⭐️ Добавлено в наблюдение: [<code>${uid}</code>]`,
    keyboardFactory.main(ctx as IContext),
  );
};
bot.command('watch', onWatch);
bot.hears(/^([0-9]{3}\-[0-9]{3}-[0-9]{3}[ _][0-9]{2})$/, onWatch as any);

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
  new RegExp(`^${keyboardFactory.KeyboardKeys.main.stop}`, 'i'),
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
  new RegExp(`^${keyboardFactory.KeyboardKeys.main.resume}`, 'i'),
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
    `^(${keyboardFactory.KeyboardKeys.notify.all}|${keyboardFactory.KeyboardKeys.notify.important})`,
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
