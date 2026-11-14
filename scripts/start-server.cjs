'use strict';

require('reflect-metadata');
const { createApp } = require('../apps/api/dist/apps/api/src/app.js');

async function start() {
  const api = await createApp();
  await api.listen(3091, '127.0.0.1');
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
