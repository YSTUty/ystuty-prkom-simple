import 'dotenv/config';

export enum EnvType {
  DEV = 'development',
  PROD = 'production',
  TEST = 'testing',
}

// environment
export const NODE_ENV: EnvType =
  (process.env.NODE_ENV as EnvType) || EnvType.DEV;

export const CACHE_PATH: string = process.env.CACHE_PATH || './.cache-store';

export const YSTU_URL: string = process.env.YSTU_URL || 'https://www.ystu.ru';
export const YSTUTY_PRKOM_URL: string =
  process.env.YSTUTY_PRKOM_URL || 'http://ystuty_prkom';

export const WATCHING_UIDS: string[] =
  (process.env.WATCHING_UIDS &&
    process.env.WATCHING_UIDS.split(',')
      .map((e) => e.trim())
      .filter(Boolean)) ||
  [];

export const TELEGRAM_BOT_TOKEN: string =
  process.env.TELEGRAM_BOT_TOKEN || null;
export const TELEGRAM_CHAT_ID: number = +process.env.TELEGRAM_CHAT_ID || null;

// Redis
export const REDIS_HOST: string = process.env.REDIS_HOST || '127.0.0.1';
export const REDIS_PORT: number = +process.env.REDIS_PORT || 6379;
export const REDIS_PASSWORD: string = process.env.REDIS_PASSWORD;
export const REDIS_DATABASE: number = +process.env.REDIS_DATABASE || 0;
export const REDIS_PREFIX: string =
  process.env.REDIS_PREFIX ?? 'tg.bot.ystuty-prkom:';
