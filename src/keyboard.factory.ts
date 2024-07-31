import { Markup } from 'telegraf';
import * as xEnv from './environment';
import { IContext, NotifyType } from './interfaces';

export const viewFile = (filename: string, uid: string) =>
  Markup.inlineKeyboard([
    ...[
      filename
        ? [
            Markup.button.url(
              'Посмотреть список (app)',
              `${xEnv.YSTUTY_PRKOM_URL}/view/${filename}?userUid=${uid}`,
            ),
          ]
        : [],
    ],
    ...[
      filename
        ? [
            Markup.button.url(
              'Посмотреть список (html)',
              `${
                xEnv.YSTU_PRKOM_URL
              }/${filename}?userUid=${uid}#:~:text=${encodeURIComponent(
                uid.split('-').pop(),
              )}`,
            ),
          ]
        : [],
    ],
  ]);

export const KeyboardKeys = {
  main: {
    info: 'Инфо',
    minfo: 'Краткая инфа',
    // settings: 'Настройки',
    stop: 'Приостановить',
    resume: 'Возобновить',
    help: 'Описание/помощь',
  },
  notify: {
    all: 'Вкл "Все уведомления"',
    important: 'Вкл "Только важные"',
  },
};

export const main = (ctx: IContext) =>
  Markup.keyboard([
    [KeyboardKeys.main.info, KeyboardKeys.main.minfo],
    [
      ...(ctx.session.uid
        ? [
            ctx.session.notifyType !== NotifyType.All
              ? KeyboardKeys.notify.all
              : KeyboardKeys.notify.important,
            ctx.session.notifyType !== NotifyType.Disabled
              ? KeyboardKeys.main.stop
              : KeyboardKeys.main.resume,
          ]
        : []),
    ],
    [KeyboardKeys.main.help],
  ]).resize();
