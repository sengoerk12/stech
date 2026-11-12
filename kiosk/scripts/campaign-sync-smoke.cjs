const { _electron: electron } = require('@playwright/test');
const { createServer } = require('node:http');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  let campaigns = [];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/quote')) {
      let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
        const input = JSON.parse(body);
        try { res.end(JSON.stringify(require('../electron/core.cjs').quote(input.amount, campaigns, Date.now(), input.promotionId))); }
        catch (error) { res.statusCode = 400; res.end(JSON.stringify({ message: error.message })); }
      }); return;
    }
    if (req.url.endsWith('/card-login')) return res.end(JSON.stringify({ accessToken: 'test-token' }));
    if (req.url.endsWith('/dashboard')) return res.end(JSON.stringify({
      member: { id: 'test', name: 'Test', username: 'test' }, wallet: { balance: 0 },
      promotions: campaigns, transactions: [], pendingPayments: [], features: { topup: false },
    }));
    res.end(JSON.stringify({ items: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'stech-campaign-sync-'));
  const config = path.join(dataDir, 'kiosk.config.json');
  await writeFile(config, JSON.stringify({ mode: 'connected', idleSeconds: 120,
    apiBaseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, deviceKey: 'a'.repeat(40), adminPinHash: 'a'.repeat(128) }));
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, '..'), '--portrait-preview'],
      env: { ...process.env, STECH_KIOSK_CONFIG: config, STECH_KIOSK_DATA_DIR: dataDir } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'Üye kartını okut' }).waitFor();
    await page.keyboard.type('TEST0001'); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Kampanyalar', exact: true }).click();
    await page.getByRole('heading', { name: 'Şu an aktif kampanya yok.' }).waitFor();
    campaigns = [{ id: 'sync', title: 'Senkron kampanya', description: 'Admin açıklaması', terms: 'Koşullar aynen aktarılır.',
      bonusPercent: 15, minimumAmount: 40000, maxBonus: 20000, accent: 'blue', startsAt: '2020-01-01', endsAt: '2099-01-01' }];
    await page.getByRole('heading', { name: 'Senkron kampanya', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.campaign-blue').count(), 1);
    await page.getByRole('button', { name: /Kampanyayı incele/ }).first().click();
    await page.getByText('Koşullar aynen aktarılır.').waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /400,00/);
    campaigns = [{ ...campaigns[0], title: 'Düzenlenen kampanya', bonusPercent: 20 }];
    await page.getByRole('dialog').getByRole('heading', { name: 'Düzenlenen kampanya' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Geri dön', exact: true }).click();
    await page.getByRole('button', { name: 'Bakiye yükle', exact: true }).first().click();
    await page.getByRole('button', { name: '500 TL', exact: true }).click();
    await page.getByRole('button', { name: /Düzenlenen kampanya uygula/ }).click();
    await page.waitForFunction(() => document.querySelector('.summary-row .positive')?.textContent.includes('100,00'));
    assert.equal(await page.getByRole('button', { name: /POS ile ödemeye geç/ }).isDisabled(), true);
    campaigns.push(...Array.from({ length: 7 }, (_, index) => ({ ...campaigns[0], id: 'extra-' + index, title: 'Ek kupon ' + (index + 1) })));
    await page.waitForFunction(() => document.querySelectorAll('.coupon-list .bonus-coupon').length === 8);
    const layout = await page.evaluate(() => { const content = document.querySelector('.content'); const coupons = document.querySelector('.coupon-list'); return { fits: content.scrollHeight <= content.clientHeight + 1, horizontal: coupons.scrollWidth > coupons.clientWidth }; });
    assert.equal(layout.fits, true, 'Topup controls must fit without vertical scrolling');
    assert.equal(layout.horizontal, true, 'Extra coupons must scroll horizontally');
    for (const key of ['clear', '4', '5', '8']) await page.locator('[data-action="key:' + key + '"]').click();
    await page.locator('.s-coin-quote').getByText('4 S Coin', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(__dirname, '../dist/coupon-preview.png'), fullPage: true });
    await page.getByRole('button', { name: '100 TL', exact: true }).click();
    await page.locator('.quote-error').waitFor();
    await page.getByRole('button', { name: 'Ana ekran', exact: true }).click();
    const homeTrack = page.locator('.home-campaign-track');
    assert.equal(await homeTrack.locator('.campaign-ticket').count(), 8);
    assert.equal(await page.locator('.home-campaign-controls').count(), 0);
    await homeTrack.scrollIntoViewIfNeeded();
    const box = await homeTrack.boundingBox();
    const touch = await page.context().newCDPSession(page);
    const point = fraction => ({ x: box.x + box.width * fraction, y: box.y + box.height / 2 });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(.9)] });
    for (const fraction of [.78, .64, .5, .36, .22, .1]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(fraction)] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await page.waitForFunction(() => {
      const track = document.querySelector('.home-campaign-track');
      return Math.abs(track.scrollLeft - track.clientWidth) <= 1;
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    campaigns = campaigns.map((campaign, index) => index === 1 ? { ...campaign, title: 'Güncellenen ikinci kupon' } : campaign);
    const secondCard = homeTrack.locator('.campaign-ticket').nth(1);
    await secondCard.getByRole('heading', { name: 'Güncellenen ikinci kupon' }).waitFor({ timeout: 15000 });
    assert.equal(await homeTrack.evaluate(track => Math.round(track.scrollLeft / track.clientWidth)), 1);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const track = document.querySelector('.home-campaign-track');
      return Math.abs(track.scrollLeft - track.clientWidth * 2) <= 1;
    }, null, { timeout: 6500 });
    await secondCard.getByRole('button', { name: /Kampanyayı incele/ }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Güncellenen ikinci kupon' }).waitFor();
    await page.getByRole('button', { name: 'Geri dön', exact: true }).click();
    await page.getByRole('button', { name: 'Kampanyalar', exact: true }).click();
    await page.getByRole('button', { name: /Kampanyayı incele/ }).first().click();
    campaigns = [];
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 15000 });
    await page.getByRole('heading', { name: 'Şu an aktif kampanya yok.' }).waitFor({ timeout: 15000 });
    assert.deepEqual(errors, []);
    await app.evaluate(({ app, BrowserWindow }) => {
      globalThis.closeErrors = [];
      process.on('uncaughtException', error => globalThis.closeErrors.push(error.message));
      app.removeAllListeners('window-all-closed');
      BrowserWindow.getAllWindows().forEach(window => window.destroy());
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.deepEqual(await app.evaluate(() => globalThis.closeErrors), [], 'Closing a window must stop session timers');
    console.log('PASS: connected kiosk receives, renders, updates and removes campaigns without refresh.');
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
    server.closeAllConnections();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
