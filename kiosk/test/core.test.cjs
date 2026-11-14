const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DemoStore, normalizeCard, quote } = require('../electron/core.cjs');
const { KioskSession } = require('../electron/session.cjs');
const { ApiGateway } = require('../electron/gateway.cjs');
test('computer start stays bound to the current authenticated session and retries the same pending operation', async () => {
  let resolveStart;
  const requests = [];
  const gateway = {
    login: async () => ({ accessToken: 'current-member-token' }),
    dashboard: async () => ({ member: { name: 'Kaan', username: 'kaan' }, features: {} }), logout: async () => {},
    startComputer: async (token, request) => { requests.push({ token, request }); return new Promise(resolve => { resolveStart = resolve; }); },
    computerStatus: async () => ({ status: 'not_started' }),
  };
  const kiosk = new KioskSession({ gateway, mode: 'connected' });
  const payload = { terminalId: '1', operationId: 'ebd09a10-41ed-4155-8cfe-3a311a9e475e', memberId: 'forged' };
  await assert.rejects(() => kiosk.run('startComputer', payload));
  await kiosk.scan('SENGOR');
  const first = kiosk.run('startComputer', payload);
  await assert.rejects(() => kiosk.run('startComputer', payload), /zaten sürüyor/);
  resolveStart({ status: 'pending' }); await first;
  assert.deepEqual(requests[0], { token: 'current-member-token', request: { terminalId: '1', operationId: payload.operationId } });
  await assert.rejects(() => kiosk.run('startComputer', { ...payload, terminalId: '2' }), /devam eden/);
  const retry = kiosk.run('startComputer', payload);
  resolveStart({ status: 'started' }); await retry;
  assert.equal(kiosk.session.unresolvedStart, undefined);
  await assert.rejects(() => kiosk.run('computerStatus', { ...payload, operationId: 'bad' }));
  assert.equal((await kiosk.run('computerStatus', payload)).status, 'not_started');
  assert.equal(requests.length, 2, 'Status lookup must never submit a new native start');
  const late = kiosk.run('startComputer', { ...payload, terminalId: '2' });
  kiosk.lock(); resolveStart({ status: 'started' });
  await assert.rejects(() => late, /Oturum kapandı/);
});

test('computer gateway sends both device and member credentials and no caller-supplied member ID', async () => {
  const original = global.fetch;
  const gateway = new ApiGateway({ apiBaseUrl: 'http://127.0.0.1:3001/api/v1', deviceKey: 'k'.repeat(48) });
  try {
    global.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:3001/api/v1/kiosk/computers/1/start');
      assert.equal(options.headers.Authorization, 'Bearer member-token');
      assert.equal(options.headers['X-Kiosk-Key'], 'k'.repeat(48));
      assert.deepEqual(JSON.parse(options.body), { operationId: 'operation' });
      return Response.json({ status: 'started' });
    };
    await gateway.startComputer('member-token', { terminalId: '1', operationId: 'operation', memberId: 'forged' });
  } finally { global.fetch = original; }
});

test('computer status is a GET and cannot create an unsubmitted operation', async () => {
  const original = global.fetch;
  const gateway = new ApiGateway({ apiBaseUrl: 'http://127.0.0.1:3001/api/v1', deviceKey: 'k'.repeat(48) });
  try {
    global.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:3001/api/v1/kiosk/computers/1/start/operation');
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      return Response.json({ status: 'not_started' });
    };
    assert.equal((await gateway.computerStatus('token', { terminalId: '1', operationId: 'operation' })).status, 'not_started');
  } finally { global.fetch = original; }
});
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
  for (const amount of [99, 1000001, 100.5, NaN]) assert.throws(() => quote(amount, promotions, now));
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
test('active connected sessions stay open and renew the server token', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const renewed = [];
  const gateway = {
    login: async () => ({ accessToken: 'opaque' }),
    dashboard: async () => ({ member: { id: '1' }, features: {} }),
    keepKioskAlive: async token => { renewed.push(token); },
  };
  const kiosk = new KioskSession({ gateway, mode: 'connected' });
  await kiosk.scan('001234');
  for (let i = 0; i < 12; i++) {
    now += 60000;
    assert.equal((await kiosk.run('activity')).remaining, 90);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(renewed.length, 12);
  assert.ok(renewed.every(token => token === 'opaque'));
  assert.ok(kiosk.session);
});
test('only an explicit confirmation renews the idle timer during a warning', async t => {
  const kiosk = new KioskSession({ demo: await fixture(t), mode: 'demo', idleSeconds: 30 });
  await kiosk.scan('DEMO0001');
  kiosk.session.activity = Date.now() - 25000;
  const warning = kiosk.countdown();
  assert.ok(warning.remaining <= 5);
  assert.ok((await kiosk.run('activity')).remaining <= 5);
  const renewed = await kiosk.run('keepAlive');
  assert.equal(renewed.remaining, 30);
  assert.ok(renewed.revision > warning.revision);
  kiosk.session.activity = Date.now() - 31000;
  await assert.rejects(() => kiosk.run('keepAlive'), /tekrar giriş/);
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
  gateway.quote = async (token, payload) => { assert.equal(token, 'opaque'); assert.equal(payload.promotionId, 'selected'); return { amount:20000, bonus:2000, total:22000 }; };
  assert.equal((await kiosk.run('quote', { amount:20000, promotionId:'selected' })).bonus, 2000);
  for (const action of ['create','settle','payment']) await assert.rejects(() => kiosk.run(action, { amount:20000 }), /POS bağlantısı/);
  kiosk.lock();
});
test('configured Ödeal sessions use the authenticated gateway and cannot simulate approval', async () => {
  const payload = { amount: 20000, key: 'odeal-checkout-unique' };
  const pending = { id: 'server-pos-order', status: 'pending' };
  const gateway = {
    login: async () => ({ accessToken: 'opaque' }),
    dashboard: async () => ({ member: { id: '1' }, pendingPayments: [pending], features: { topup: true, odealPos: true } }),
    logout: async () => {},
    createPosPayment: async (token, request) => {
      assert.equal(token, 'opaque');
      assert.deepEqual(request, payload);
      return pending;
    },
    posPayment: async (token, id) => {
      assert.equal(token, 'opaque');
      assert.equal(id, pending.id);
      return { ...pending, status: 'completed' };
    },
  };
  const kiosk = new KioskSession({ gateway, mode: 'connected' });
  const account = await kiosk.scan('001234');
  assert.equal(account.features.topup, true);
  assert.deepEqual(account.pendingPayments, [pending]);
  assert.deepEqual(await kiosk.run('create', payload), pending);
  await assert.rejects(() => kiosk.run('settle', { id: pending.id, outcome: 'approved' }), /POS cihazından/);
  const finished = await kiosk.run('payment', { id: pending.id });
  assert.equal(finished.status, 'completed');
  assert.equal(kiosk.session.awaitingCompletionChoice, true);
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
test('gateway retries transient account reads once and preserves authentication failures', async () => {
  const gateway = new ApiGateway({ apiBaseUrl: 'https://example.com', deviceKey: 'x'.repeat(48) });
  let attempts = 0;
  gateway.request = async () => {
    if (++attempts === 1) throw Object.assign(new Error('offline'), { status: 503 });
    return { wallet: { balance: 2500 } };
  };
  assert.equal((await gateway.dashboard('token')).wallet.balance, 2500);
  assert.equal(attempts, 2);
  gateway.request = async () => { attempts++; throw Object.assign(new Error('expired'), { status: 401 }); };
  await assert.rejects(() => gateway.dashboard('token'), /expired/);
  assert.equal(attempts, 3);
});

test('only the current card suffix is hidden; real surnames remain intact', async () => {
  const names = ['Kaan 001234', 'Deniz Dede'];
  const gateway = { login:async () => ({ accessToken:'opaque' }), dashboard:async () => ({ member:{ id:'1', name:names.shift(), username:'kaan' }, features:{} }), logout:async () => {} };
  const kiosk = new KioskSession({ gateway, mode:'connected' });
  assert.equal((await kiosk.scan('001234')).member.name, 'Kaan');
  assert.equal((await kiosk.run('dashboard')).member.name, 'Deniz Dede');
  kiosk.lock();
});

test('completed topup uses the regular idle warning and repeated approval does not reset it', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const payment = await kiosk.run('create', { amount:20000, key:'completion-test-unique' });
  const result = await kiosk.run('settle', { id:payment.id, outcome:'approved' });
  assert.equal(result.status, 'completed');
  const activity = Date.now() - 80000;
  kiosk.session.activity = activity;
  await kiosk.run('settle', { id:payment.id, outcome:'approved' });
  assert.equal(kiosk.session.activity, activity);
  await assert.rejects(() => kiosk.run('continueSession'), /onayla/);
  assert.equal((await kiosk.run('keepAlive')).remaining, 90);
  kiosk.tick(kiosk.session.activity + 90000);
  assert.equal(kiosk.session, null);
  await assert.rejects(() => kiosk.run('continueSession'));
  assert.equal((await kiosk.scan('DEMO0002')).member.name, 'Deniz');
});
test('only explicit continue restores normal navigation and a later topup offers the choice again', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const p = await kiosk.run('create', { amount:20000, key:'continue-test-first' });
  await kiosk.run('settle', { id:p.id, outcome:'approved' });
  await assert.rejects(() => kiosk.run('transactions'), /Başka bir işlem yap/);
  await kiosk.run('continueSession');
  assert.equal(kiosk.session.awaitingCompletionChoice, false);
  assert.equal(kiosk.session.card, 'DEMO0001');
  await kiosk.run('transactions');
  const next = await kiosk.run('create', { amount:5000, key:'continue-test-second' });
  await kiosk.run('settle', { id:next.id, outcome:'approved' });
  assert.equal(kiosk.session.completionPaymentId, next.id);
  assert.equal(kiosk.remaining(), 90);
});
test('finish immediately clears session, while declined payments do not require a completion choice', async t => {
  const demo = await fixture(t); const kiosk = new KioskSession({ demo, mode:'demo' });
  await kiosk.scan('DEMO0001');
  const p = await kiosk.run('create', { amount:20000, key:'finish-test-unique' });
  await kiosk.run('settle', { id:p.id, outcome:'declined' });
  assert.equal(kiosk.session.awaitingCompletionChoice, undefined);
  const next = await kiosk.run('create', { amount:5000, key:'finish-test-second' });
  await kiosk.run('settle', { id:next.id, outcome:'approved' });
  await kiosk.run('logout'); assert.equal(kiosk.session, null);
  await assert.rejects(() => kiosk.run('dashboard'));
});
