import { Gauge, register, Pushgateway } from 'prom-client';
import * as xEnv from './environment';

export const gateway = xEnv.PROMETHEUS_PUSHGATEWAY_URL
  ? new Pushgateway(xEnv.PROMETHEUS_PUSHGATEWAY_URL)
  : null;

// telegram_bot_users_count{instance="",job="telegram_bot_metrics",bot="$BOT_NAME"}
export const userCounter = new Gauge({
  name: 'telegram_bot_users_count',
  help: 'Total number of new users in the Telegram bot',
  labelNames: ['bot'],
});

register.registerMetric(userCounter);

const jobName = 'telegram_bot_metrics';

export const pushMetricsToGateway = () => {
  gateway.pushAdd({ jobName }).then((response) => {
    // console.log('Metrics pushed to the Pushgateway', response.body);
  });
};

let interval: NodeJS.Timeout = null;
export const startMetric = () => {
  interval = setInterval(() => pushMetricsToGateway(), 15e3);
  pushMetricsToGateway();
};

process.on('exit', () => {
  if (interval) {
    clearInterval(interval);
  }
  pushMetricsToGateway();
});