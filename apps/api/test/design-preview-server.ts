import 'reflect-metadata';
import {resolve} from 'node:path';
import {createApp} from '../src/app';

// Isolated, in-memory test server. Never imports the production .env file.
async function main() {
  const app = await createApp({
    ENVIRONMENT: 'test', ADMIN_SETUP_TOKEN: 'ui-test-only', DEMO_PASSWORD: 'test',
    ADMIN_WEB_DIR: resolve('../admin'), KIOSK_UI_DIR: resolve('../../kiosk/ui'),
  });
  await app.listen(3009, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
void main();
