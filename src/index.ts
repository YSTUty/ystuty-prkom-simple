import { App, prkomApi } from './app.class';
import { bot } from './bot';
import { MagaResponseInfo } from './types';

async function bootstrap() {
  console.log(`Run app [${new Date().toLocaleString()}]`);

  const app = new App();
  app.init().then();

  process.stdin.resume();
  process.on('SIGINT', () => app.save(true));

  if (bot) {
    bot.command('app', (ctx) => {
      console.log('app', app);
      ctx.reply('see console');
    });

    bot.start(async (ctx) => {
      ctx.replyWithHTML(
        `Привет! Бот помогает отслеживать изменения в списке поступления ЯГТУ.\n` +
          `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
      );
    });
    bot.command('info', async (ctx) => {
      const target = app.botTargets[ctx.from.id];

      if (!target || !target.uid) {
        ctx.replyWithHTML(
          `Наблюдение не установлено.\n` +
            `Используй <code>/watch 123-456-789 10</code>, чтобы указать <i>уникальный код</i> для наблюдения.`,
        );
        return;
      }

      const res = await prkomApi.get<MagaResponseInfo[]>(
        `/admission/get/${target.uid}`,
      );

      if (res.data.length === 0) {
        ctx.replyWithHTML(
          `Нет данных для отображения.\n` +
            `Убедитесь в правильности Уникального кода.`,
        );
        return;
      }

      for (const app of res.data) {
        const { info, item } = app;
        ctx.replyWithHTML(
          `• <b>УК: ${item.uid}</b>\n` +
            `• ${info.buildDate}\n` +
            `• ${info.competitionGroupName}\n` +
            `• ${info.formTraining}\n` +
            `• ${info.levelTraining}\n` +
            `• ${info.basisAdmission}\n` +
            `• ${info.numbersInfo}\n` +
            `\n` +
            `• Позиция: <code>${item.position}</code>\n` +
            `• Сумма баллов: <code>${item.totalScore}</code>\n`,
        );
      }
    });
    bot.command('watch', (ctx) => {
      const [, ...rest] = ctx.message.text.split(' ');
      const uid = rest.join(' ');

      if (uid.length === 0 || uid.length > 20) {
        ctx.replyWithHTML(
          `Необходимо указать корректный <i>уникальный код</i> для наблюдения.\n` +
            `Например, <code>/watch 123-456-789 10</code>.\n` +
            `Указаный код не проверяется на стороне бота, поэтому нужно указать корректный, как на сайте.`,
        );
        return;
      }

      if (!app.botTargets[ctx.from.id]) {
        app.botTargets[ctx.from.id] = {
          chatId: ctx.chat.id,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          username: ctx.from.username,
          loadCount: 0,
          uid,
        };
      }

      app.botTargets[ctx.from.id].uid = uid;
      ctx.replyWithHTML(`Добавлено в наблюдение: <code>${uid}</code>`);

      // const { id: lastChatId } = app.botTargets.get(uid);
      // if (lastChatId === ctx.chat.id) {
      //   ctx.replyWithHTML(`Этот УК уже в наблюдении: <code>${uid}</code>`);
      //   return;
      // }

      // ctx.replyWithHTML(
      //   `За номером <code>${uid}</code> уже кто-то наблюдал, но сейчас была произведена отмена.\n` +
      //     `Чтобы установить наблюдение, отправь сообщение еще раз.\n` +
      //     `<code>/watch ${uid}</code>`,
      // );
      // bot.telegram
      //   .sendMessage(
      //     lastChatId,
      //     `🚨 Наблюдение за номером <code>${uid}</code> было отключено по новоу запросу наблюдения за ним от юзера <code>${ctx.chat.id}</code>; @${ctx.from.username}\n` +
      //       `Чтобы установить наблюдение, отправь сообщение еще раз.\n` +
      //       `<code>/watch ${uid}</code>`,
      //     { parse_mode: 'HTML' },
      //   )
      //   .catch(console.error);

      // app.botTargets.delete(uid);
    });
  }
}
bootstrap();
