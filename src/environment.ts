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

export const YSTU_PRKOM_URL: string =
  process.env.YSTU_PRKOM_URL || 'https://ystu.ru/files/prkom_svod';
export const YSTUTY_PRKOM_URL: string =
  process.env.YSTUTY_PRKOM_URL || 'https://prkom.ystuty.ru';
export const YSTUTY_PRKOM_API_URL: string =
  process.env.YSTUTY_PRKOM_API_URL || 'http://ystuty_prkom/api';

export const WATCHING_UIDS: string[] =
  (process.env.WATCHING_UIDS &&
    process.env.WATCHING_UIDS.split(',')
      .map((e) => e.trim())
      .filter(Boolean)) ||
  [];

export const TELEGRAM_BOT_TOKEN: string =
  process.env.TELEGRAM_BOT_TOKEN || null;
// For debug messages
export const TELEGRAM_CHAT_ID: number = +process.env.TELEGRAM_CHAT_ID || null;

export const TELEGRAM_ADMIN_IDS: number[] =
  (process.env.TELEGRAM_ADMIN_IDS &&
    process.env.TELEGRAM_ADMIN_IDS.split(',')
      .map((e) => Number(e.trim()))
      .filter(Boolean)) ||
  [];

// Prometheus
export const PROMETHEUS_PUSHGATEWAY_URL: string =
  process.env.PROMETHEUS_PUSHGATEWAY_URL || '';

// Redis
export const REDIS_HOST: string = process.env.REDIS_HOST || 'redis';
export const REDIS_PORT: number = +process.env.REDIS_PORT || 6379;
export const REDIS_PASSWORD: string = process.env.REDIS_PASSWORD;
export const REDIS_DATABASE: number = +process.env.REDIS_DATABASE || 0;
export const REDIS_PREFIX: string =
  process.env.REDIS_PREFIX ?? 'tg.bot.ystuty-prkom:';
