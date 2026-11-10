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
    await page.getByRole('button', { name: /Kampanyayı incele/ }).click();
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
    await page.screenshot({ path: path.join(__dirname, '../dist/coupon-preview.png'), fullPage: true });
    await page.getByRole('button', { name: '100 TL', exact: true }).click();
    await page.locator('.quote-error').waitFor();
    await page.getByRole('button', { name: 'Kampanyalar', exact: true }).click();
    await page.getByRole('button', { name: /Kampanyayı incele/ }).click();
    campaigns = [];
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 15000 });
    await page.getByRole('heading', { name: 'Şu an aktif kampanya yok.' }).waitFor({ timeout: 15000 });
    assert.deepEqual(errors, []);
    console.log('PASS: connected kiosk receives, renders, updates and removes campaigns without refresh.');
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
    server.closeAllConnections();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
