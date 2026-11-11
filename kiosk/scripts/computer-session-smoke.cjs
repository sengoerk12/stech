const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ApiGateway } = require('../electron/gateway.cjs');
const { KioskSession } = require('../electron/session.cjs');
(async () => {
  let starts = 0, checks = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const reply = value => res.end(JSON.stringify(value));
    if (req.url.endsWith('/card-login')) return reply({ accessToken: 'test-token' });
    if (req.url.endsWith('/dashboard')) return reply({ member: { name: 'Kaan', username: 'kaan', joinedAt: '2026-01-01' }, wallet: { balance: 50000 }, promotions: [], transactions: [], features: {} });
    if (req.url.endsWith('/computers')) return reply({ startSupported: true, computers: [{ id: '1', name: 'PC-1', available: true, virtual: true, status: 'available' }] });
    if (req.url.endsWith('/start')) {
      starts++;
      if (starts === 1) { res.statusCode = 503; return reply({ message: 'PanCafe ekranına ulaşılamadı.' }); }
      return reply({ status: 'failed', message: 'PanCafe’deki açık menüyü kapatıp tekrar dene.' });
    }
    if (req.url.includes('/start/')) {
      checks++; assert.equal(req.method, 'GET');
      return reply({ status: 'not_started', message: 'Bu işlem PanCafe’de başlatılmadı. Bilgisayarı yeniden seçebilirsin.' });
    }
    return reply({ items: [] });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gateway = new ApiGateway({ apiBaseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, deviceKey: 'a'.repeat(48) });
  const session = new KioskSession({ gateway, mode: 'connected' });
  const browser = await chromium.launch({ headless: true, channel: process.env.STECH_BROWSER_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('testKioskCall', async (action, payload) => {
    try { return { ok: true, data: action === 'info' ? { mode: 'connected', station: 'Test' } : await session.run(action, payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  await page.addInitScript(() => { window.stech = { call: (...args) => window.testKioskCall(...args), on: () => {} }; });
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, '../ui/index.html')).href);
    await page.getByRole('heading', { name: 'Üye kartını okut' }).waitFor();
    await page.keyboard.type('TEST0001'); await page.keyboard.press('Enter');
    await page.locator('.shell').waitFor();
    await page.getByRole('button', { name: 'Bilgisayarlar', exact: true }).click();
    const open = page.getByRole('button', { name: 'Oturum aç', exact: true });
    await open.click(); await page.getByRole('button', { name: 'Oturumu başlat', exact: true }).click();
    await page.getByRole('button', { name: 'Durumu kontrol et' }).waitFor();
    assert.equal(await open.isDisabled(), true);
    assert.equal(starts, 1);
    await page.getByRole('button', { name: 'Durumu kontrol et' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-action="computer-select:1"]').disabled);
    assert.equal(starts, 1); assert.equal(checks, 1);
    await open.click(); await page.getByRole('button', { name: 'Oturumu başlat', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-action="computer-select:1"]').disabled);
    assert.equal(starts, 2);
    assert.match(await page.locator('#toast').innerText(), /PanCafe’deki açık menüyü/);
    assert.deepEqual(errors, []);
    console.log('Computer error recovery passed: GET-only status, no duplicate start, retry unlocked, friendly native error.');
  } finally { session.lock(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exit(1); });
