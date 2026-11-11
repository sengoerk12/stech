// Explicit opt-in: this starts a real, billable PanCafe member session.
if (process.env.STECH_LIVE_SESSION_TEST !== 'true' || !process.env.STECH_TEST_CARD)
  throw new Error('Set STECH_LIVE_SESSION_TEST=true and STECH_TEST_CARD for this operator-authorized test.');
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const output = process.env.STECH_TEST_OUTPUT;
  if (!output || !process.env.STECH_KIOSK_CONFIG) throw new Error('Test output and kiosk configuration required.');
  const app = await electron.launch({ executablePath: path.resolve(__dirname, '../dist/win-unpacked/kiosk.exe'),
    args: ['--portrait-preview'], env: { ...process.env } });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('heading', { name: 'Üye kartını okut' }).waitFor();
    await page.keyboard.type(process.env.STECH_TEST_CARD, { delay: 40 }); await page.keyboard.press('Enter');
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Bilgisayarlar', exact: true }).click();
    const pc = page.locator('.computer-card').filter({ has: page.getByRole('heading', { name: process.env.STECH_TEST_PC || 'PC-1', exact: true }) });
    await pc.getByRole('button', { name: 'Oturum aç', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'kiosk-before-start.png') });
    await pc.getByRole('button', { name: 'Oturum aç', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: path.join(output, 'kiosk-start-confirm.png') });
    await page.getByRole('button', { name: 'Oturumu başlat', exact: true }).click();
    await page.waitForFunction(() => !startingComputer, null, { timeout: 60000 });
    const state = await page.evaluate(() => ({ pending: computerStart, computers: computerData, page: state.page }));
    await fs.writeFile(path.join(output, 'kiosk-session-result.json'), JSON.stringify(state, null, 2));
    await page.screenshot({ path: path.join(output, 'kiosk-after-start.png') });
    assert.equal(state.pending, undefined, 'Native start was not confirmed; inspect the existing operation before any retry.');
    assert.equal(state.computers.computers.find(pc => pc.name === (process.env.STECH_TEST_PC || 'PC-1')).status, 'occupied');
    assert.deepEqual(errors, []);
    console.log('Packaged kiosk → API → PanCafe virtual session start confirmed.');
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
