import "reflect-metadata";
import "dotenv/config";
import { createApp } from "./app";
async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
bootstrap().catch(() => {
  console.error(
    "API startup failed. Check environment and integration configuration.",
  );
  process.exit(1);
});
