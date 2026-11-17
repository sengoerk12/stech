const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ApiGateway } = require('../electron/gateway.cjs');
const { KioskSession } = require('../electron/session.cjs');
(async () => {
  const operationIds = [];
  let ready = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const reply = value => res.end(JSON.stringify(value));
    if (req.url.endsWith('/card-login')) return reply({ accessToken: 'test-token' });
    if (req.url.endsWith('/dashboard')) return reply({ member: { name: 'Kaan', username: 'kaan', joinedAt: '2026-01-01' }, wallet: { balance: 50000 }, promotions: [], transactions: [], features: {} });
    if (req.url.endsWith('/computers')) return reply({ startSupported: true, computers: [{ id: '1', name: 'PC-1', available: true, canStart: true, canWake: true, virtual: false, status: 'wakeable' }] });
    if (req.url.endsWith('/start')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      operationIds.push(JSON.parse(body).operationId);
      if (operationIds.length === 2) { res.statusCode = 503; return reply({ message: 'PanCafe bağlantısı geçici olarak kesildi.' }); }
      if (!ready) return reply({ status: 'waking', message: 'Bilgisayarınız açılıyor.' });
      if (operationIds.length === 4) return reply({ status: 'pending', message: 'PanCafe’de oturumunuz başlatılıyor…' });
      return reply({ status: 'started', message: 'PanCafe’de üye oturumun başladı.' });
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
    // Tür seçimi → bilgisayar seçimi (sarı çerçeve) → onay.
    await page.getByRole('button', { name: /Diğer bilgisayarlar/ }).click();
    const open = page.getByRole('button', { name: 'PC-1, Kapalı, açılabilir', exact: true });
    const confirm = page.getByRole('button', { name: 'Onayla ve oturumu başlat', exact: true });
    await open.click();
    assert.equal(await open.getAttribute('aria-pressed'), 'true');
    assert.equal(operationIds.length, 0);
    await confirm.click();
    const waking = page.getByRole('status').filter({ hasText: 'Bilgisayarınız açılıyor' });
    await waking.waitFor();
    assert.equal(await open.isDisabled(), true);
    await page.waitForTimeout(6500);
    assert.equal(operationIds.length, 3);
    assert.equal(await waking.isVisible(), true);
    ready = true;
    await page.getByRole('status').filter({ hasText: 'PanCafe’de oturumunuz başlatılıyor' }).waitFor();
    await page.locator('#toast').filter({ hasText: 'PanCafe’de üye oturumun başladı.' }).waitFor();
    assert.equal(operationIds.length, 5);
    assert.equal(new Set(operationIds).size, 1);
    assert.deepEqual(errors, []);
    console.log('Computer start passed: waking, transient disconnect, confirmation and success with one operation ID.');
  } finally { session.lock(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exit(1); });
