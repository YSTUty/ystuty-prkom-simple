import { createHash } from 'crypto';
import { RateLimiter as Limiter } from 'limiter';
import { AbiturientInfoStateType } from './interfaces';

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

export const getStatusColor = (isGreen: boolean, isBad = true) =>
  isGreen || !isBad ? (isGreen ? '🟢' : '🟡') : '🔴';

export const taggerSmart = (str: string, tag = 'b') =>
  str.replace(/([^-:.]+)( - |: )([^-:\.]+[^ ]+)/gi, `$1$2<${tag}>$3</${tag}>`);

export const taggerSep = (str: string, tag = 'b') =>
  str.replace(/([^-:]+)( - |: )(.*)$/i, `$1$2<${tag}>$3</${tag}>`);

export const getAbiturientInfoStateString = (val: AbiturientInfoStateType) => {
  return {
    [AbiturientInfoStateType.Unknown]: 'Неизвестно',
    [AbiturientInfoStateType.Submitted]: 'Подано',
    [AbiturientInfoStateType.Enrolled]: 'Зачислен',
  }[val];
};

export class RateLimiter {
  private limiters: Record<number, Limiter> = {};

  constructor(private amount: number, private interval: number) {}

  /**
   * Takes a token from the rate limiter.
   * @param key A key which identifies the entity being limited (Ex: user ID, chat ID, etc.).
   * @returns Whether this action exceeds the rate limit.
   */
  public async take(key: number): Promise<boolean> {
    let limiter = this.limiters[key];

    if (!limiter) {
      limiter = new Limiter({
        interval: this.interval,
        tokensPerInterval: this.amount,
      });
      this.limiters[key] = limiter;
    }

    if (limiter.getTokensRemaining() < 1) return true;

    await limiter.removeTokens(1);

    return false;
  }
}
