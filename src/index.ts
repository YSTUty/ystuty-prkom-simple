import { app } from './app.class';

async function bootstrap() {
  console.log(`Run app [${new Date().toLocaleString()}]`);

  await app.init();

  process.stdin.resume();
  process.on('SIGINT', async () => {
    await app.save();
    process.exit();
  });
}
bootstrap();
