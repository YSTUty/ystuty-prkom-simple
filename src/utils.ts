import { createHash } from 'crypto';
import { Markup } from 'telegraf';
import * as xEnv from './environment';

export const md5 = (str: string) => createHash('md5').update(str).digest('hex');

export function MAP_replacer(key, value) {
  if (value instanceof Map) {
    return {
      dataType: 'Map',
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  } else {
    return value;
  }
}

export function MAP_reviver(key, value) {
  if (typeof value === 'object' && value !== null) {
    if (value.dataType === 'Map') {
      return new Map(value.value);
    }
  }
  return value;
}

export const greenger = (isGreen: boolean, cond2 = true) =>
  isGreen ? (cond2 ? '🟡' : '🟢') : '🔴';

export const tgKeyboard_ViewFile = (filename: string) =>
  Markup.inlineKeyboard([
    ...[
      filename
        ? [
            Markup.button.url(
              'Посмотреть на сайте',
              `${xEnv.YSTU_URL}/files/prkom_svod/${filename}`,
            ),
          ]
        : [],
    ],
  ]);

export const taggerSmart = (str: string, tag = 'b') =>
  str.replace(/([^-:.]+)( - |: )([^-:\.]+[^ ]+)/gi, `$1$2<${tag}>$3</${tag}>`);

export const taggerSep = (str: string, tag = 'b') =>
  str.replace(/([^-:]+)( - |: )(.*)$/i, `$1$2<${tag}>$3</${tag}>`);
