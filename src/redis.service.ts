import Redis from 'ioredis';
import * as xEnv from './environment';

export const redisClient = new Redis(xEnv.REDIS_PORT, xEnv.REDIS_HOST, {
  password: xEnv.REDIS_PASSWORD,
  db: xEnv.REDIS_DATABASE,
  keyPrefix: xEnv.REDIS_PREFIX,
});
