import * as xEnv from './environment';
import { App } from './app.class';
import { bot } from './bot';

async function bootstrap() {
  console.log(`Run app [${new Date().toLocaleString()}]`);
  if (xEnv.WATCHING_UIDS.length === 0) {
    console.log('No watching uids');
    return;
  }

  const app = new App();
  app.init().then();

  process.stdin.resume();
  process.on('SIGINT', () => app.save(true));

  if (bot) {
    bot.command('app', (ctx) => {
      console.log('app', app);
      ctx.reply('see console');
    });
    bot.command('watch', (ctx) => {
      const [, ...rest] = ctx.message.text.split(' ');
      const uid = rest.join(' ');

      if (app.botTargets.has(uid)) {
        const { id: lastChatId } = app.botTargets.get(uid);
        if (lastChatId !== ctx.chat.id) {
          ctx.replyWithHTML(
            `За номером <code>${uid}</code> уже кто-то наблюдал, но сейчас была произведена отмена.\n` +
              `Чтобы установить наблюдение, отправь сообщение еще раз.`,
          );
          bot.telegram
            .sendMessage(
              lastChatId,
              `🚨 Наблюдение за номером <code>${uid}</code> было отключено по новоу запросу наблюдения за ним от юзера <code>${ctx.chat.id}</code>; @${ctx.from.username}\n` +
                `Чтобы установить наблюдение, отправь сообщение еще раз.`,
              { parse_mode: 'HTML' },
            )
            .catch(console.error);
          app.botTargets.delete(uid);
          return;
        } else {
          ctx.replyWithHTML(`Already watching uid: <code>${uid}</code>`);
          return;
        }
      }

      app.botTargets.set(uid, {
        id: ctx.chat.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
      });
      ctx.replyWithHTML(`Add watching uid: <code>${uid}</code>`);
    });
  }
}
bootstrap();
