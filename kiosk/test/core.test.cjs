const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DemoStore, normalizeCard, quote } = require('../electron/core.cjs');
const { KioskSession } = require('../electron/session.cjs');
const { ApiGateway } = require('../electron/gateway.cjs');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stech-kiosk-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const demo = new DemoStore(join(dir, 'wallet.json')); await demo.initialize(); return demo;
}
test('NFC preserves leading zeros and rejects SQL/control characters', () => {
  assert.equal(normalizeCard(' 0010abcf '), '0010ABCF');
  for (const card of ['', 'abc', "1234' OR 1=1", '1234\n5678', null, {}]) assert.throws(() => normalizeCard(card));
});
test('quotes use integer kurus, threshold, cap and expiration', () => {
  const promotions = [{ startsAt:'2026-01-01', endsAt:'2027-01-01', minimumAmount:20000, bonusPercent:10, maxBonus:100000 }];
  const now = Date.parse('2026-10-29');
  assert.equal(quote(19999, promotions, now).bonus, 0);
  assert.equal(quote(20000, promotions, now).total, 22000);
  assert.equal(quote(23456, promotions, now).bonus, 2345);
  assert.equal(quote(1000000, promotions, now).bonus, 100000);
  assert.equal(quote(20000, promotions, Date.parse('2027-01-01')).bonus, 0);
  for (const amount of [4999, 1000001, 5000.5, NaN]) assert.throws(() => quote(amount, promotions, now));
});
test('concurrent POS approvals credit once and survive restart', async t => {
  const demo = await fixture(t); const before = (await demo.dashboard('DEMO0001')).wallet.balance;
  const p = await demo.create('DEMO0001', 20000, 'same-key');
  await Promise.all(Array.from({ length:20 }, () => demo.settle('DEMO0001', p.id, 'approved')));
  assert.equal((await demo.dashboard('DEMO0001')).wallet.balance, before + p.amount + p.bonus);
  const fresh = new DemoStore(demo.file); await fresh.initialize();
  assert.equal(fresh.get('DEMO0001', p.id).status, 'completed');
  assert.equal((await fresh.create('DEMO0001', 20000, 'same-key')).id, p.id);
  assert.throws(() => fresh.get('DEMO0002', p.id));
  await assert.rejects(() => fresh.create('DEMO0001', 50000, 'same-key'));
});
test('decline never credits and cannot later become approved', async t => {
  const demo = await fixture(t); const before = (await demo.dashboard('DEMO0002')).wallet.balance;
  const p = await demo.create('DEMO0002', 50000, 'decline-key');
  await demo.settle('DEMO0002', p.id, 'declined'); await demo.settle('DEMO0002', p.id, 'approved');
  assert.equal((await demo.dashboard('DEMO0002')).wallet.balance, before);
  assert.equal(demo.get('DEMO0002', p.id).status, 'failed');
});
test('failed storage rolls balance back in memory', async t => {
  const demo = await fixture(t); const p = await demo.create('DEMO0001', 20000, 'failure-key');
  const before = (await demo.dashboard('DEMO0001')).wallet.balance;
  demo.save = async () => { throw new Error('disk full'); };
  await assert.rejects(() => demo.settle('DEMO0001', p.id, 'approved'));
  assert.equal((await demo.dashboard('DEMO0001')).wallet.balance, before);
  assert.equal(demo.get('DEMO0001', p.id).status, 'pending');
});
test('idle clears customer and blocks API calls', async t => {
  const demo = await fixture(t); let locks = 0;
  const kiosk = new KioskSession({ demo, mode:'demo', idleSeconds:30, onLock:() => locks++ });
  await kiosk.scan('DEMO0001'); const start = kiosk.session.activity;
  kiosk.tick(start + 30001); assert.equal(kiosk.session, null); assert.equal(locks, 1);
  await assert.rejects(() => kiosk.run('dashboard'));
  assert.equal((await kiosk.scan('DEMO0002')).member.name, 'Deniz');
});
test('activity cannot extend five minute hard limit', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001'); const start = kiosk.session.started;
  kiosk.touch(start + 299000); kiosk.tick(start + 300001); assert.equal(kiosk.session, null);
});
test('late response cannot reopen locked session', async () => {
  let finish; const demo = { dashboard: () => new Promise(resolve => finish = resolve) };
  const kiosk = new KioskSession({ demo, mode:'demo' }); const scan = kiosk.scan('DEMO0001');
  kiosk.lock(); finish({ member:{ name:'Kaan' }, features:{} });
  await assert.rejects(scan); assert.equal(kiosk.session, null);
});
test('connected mode never enables POS simulation or topup', async () => {
  const gateway = { login:async () => ({ accessToken:'opaque' }), dashboard:async () => ({ member:{ id:'1' }, features:{ topup:true } }), logout:async () => {} };
  const kiosk = new KioskSession({ gateway, mode:'connected' });
  assert.equal((await kiosk.scan('001234')).features.topup, false);
  for (const action of ['quote','create','settle','payment']) await assert.rejects(() => kiosk.run(action, { amount:20000 }), /POS bağlantısı/);
  kiosk.lock();
});
test('unknown and overlapping cards cannot switch customers', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await assert.rejects(() => kiosk.scan('UNKNOWN1')); assert.equal(kiosk.session, null);
  await kiosk.scan('DEMO0001'); await assert.rejects(() => kiosk.scan('DEMO0002'));
  assert.equal(kiosk.session.card, 'DEMO0001');
});
test('gateway rejects insecure remote endpoints and missing keys', () => {
  assert.throws(() => new ApiGateway({ apiBaseUrl:'http://192.168.1.2:3001', deviceKey:'x'.repeat(48) }));
  assert.throws(() => new ApiGateway({ apiBaseUrl:'https://example.com', deviceKey:'' }));
  assert.doesNotThrow(() => new ApiGateway({ apiBaseUrl:'http://127.0.0.1:3001/api/v1', deviceKey:'x'.repeat(48) }));
});

test('only the current card suffix is hidden; real surnames remain intact', async () => {
  const names = ['Kaan 001234', 'Deniz Dede'];
  const gateway = { login:async () => ({ accessToken:'opaque' }), dashboard:async () => ({ member:{ id:'1', name:names.shift(), username:'kaan' }, features:{} }), logout:async () => {} };
  const kiosk = new KioskSession({ gateway, mode:'connected' });
  assert.equal((await kiosk.scan('001234')).member.name, 'Kaan');
  assert.equal((await kiosk.run('dashboard')).member.name, 'Deniz Dede');
  kiosk.lock();
});

test('completed topup starts a fixed 20s deadline; touches and repeated approval cannot extend it', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const payment = await kiosk.run('create', { amount:20000, key:'completion-test-unique' });
  const result = await kiosk.run('settle', { id:payment.id, outcome:'approved' });
  assert.equal(result.completionSeconds, 20);
  const deadline = kiosk.session.completionDeadline;
  kiosk.touch(deadline - 1000);
  await kiosk.run('settle', { id:payment.id, outcome:'approved' });
  assert.equal(kiosk.session.completionDeadline, deadline);
  assert.equal(kiosk.remaining(deadline - 1000), 1);
  kiosk.tick(deadline); assert.equal(kiosk.session, null);
  await assert.rejects(() => kiosk.run('continueSession'));
  assert.equal((await kiosk.scan('DEMO0002')).member.name, 'Deniz');
});
test('only explicit continue restores normal navigation and a later topup starts a new countdown', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const p = await kiosk.run('create', { amount:20000, key:'continue-test-first' });
  await kiosk.run('settle', { id:p.id, outcome:'approved' });
  await assert.rejects(() => kiosk.run('transactions'), /Başka bir işlem yap/);
  await kiosk.run('continueSession');
  assert.equal(kiosk.session.completionDeadline, undefined);
  assert.equal(kiosk.session.card, 'DEMO0001');
  await kiosk.run('transactions');
  const next = await kiosk.run('create', { amount:5000, key:'continue-test-second' });
  await kiosk.run('settle', { id:next.id, outcome:'approved' });
  assert.equal(kiosk.session.completionPaymentId, next.id);
  assert.equal(kiosk.remaining(), 20);
});
test('finish immediately clears session, while declined payments do not start a completion countdown', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const p = await kiosk.run('create', { amount:20000, key:'finish-test-unique' });
  await kiosk.run('settle', { id:p.id, outcome:'declined' });
  assert.equal(kiosk.session.completionDeadline, undefined);
  const next = await kiosk.run('create', { amount:5000, key:'finish-test-second' });
  await kiosk.run('settle', { id:next.id, outcome:'approved' });
  await kiosk.run('logout'); assert.equal(kiosk.session, null);
  await assert.rejects(() => kiosk.run('dashboard'));
});
test('completion deadline is configurable and hard session expiry remains authoritative', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo', completionSeconds:10 });
  await kiosk.scan('DEMO0001');
  const p = await kiosk.run('create', { amount:5000, key:'config-test-unique' });
  const done = await kiosk.run('settle', { id:p.id, outcome:'approved' });
  assert.equal(done.completionSeconds, 10);
  kiosk.session.started = kiosk.session.completionDeadline - 311000;
  kiosk.tick(); assert.equal(kiosk.session, null);
});
