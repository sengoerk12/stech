const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
for (const dir of ['electron', 'ui', 'scripts', 'test']) {
  for (const file of fs.readdirSync(path.join(__dirname, '..', dir))) {
    if (!/\.(cjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', dir, file)], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
console.log('Kiosk JavaScript syntax checks passed.');
