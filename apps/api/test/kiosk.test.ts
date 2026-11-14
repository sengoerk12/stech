import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/database/database';
import { PersistentMockCafeAdapter } from '../src/cafe/persistent-mock';
import { PersistentAuthService } from '../src/auth/persistent-service';
import { KioskCardAuth } from '../src/auth/kiosk';
import { createApp } from '../src/app';
const key = 'k'.repeat(48);
const hash = (uid: string) => createHash('sha256').update(uid).digest('hex');
test('kiosk device auth, card isolation, short session, revocation', async () => {
  const db = await openDatabase();
  try {
    const cafe = new PersistentMockCafeAdapter(db, 'secret'); await cafe.initialize();
    const auth = new PersistentAuthService(db, cafe);
    const kiosk = new KioskCardAuth(key, { cards:[{ cardHash:hash('001234'), userId:'demo-member' }] }, cafe, auth);
    await assert.rejects(() => kiosk.login('wrong', '001234'));
    await assert.rejects(() => kiosk.login(undefined, '001234'));
    await assert.rejects(() => kiosk.login(key, '999999'));
    await assert.rejects(() => kiosk.login(key, "1234' OR true"));
    const tokens = await kiosk.login(key, ' 001234 ');
    assert.equal(tokens.expiresIn, 600); assert.equal('refreshToken' in tokens, false);
    assert.equal(await auth.user(tokens.accessToken), 'demo-member');
    const sessions = await db.query<{ kind:string }>('SELECT kind FROM auth_sessions');
    assert.deepEqual(sessions.rows.map(s => s.kind), ['access']);
    await db.query("UPDATE auth_sessions SET expires_at=$1", [new Date(Date.now() + 30000)]);
    assert.equal((await auth.keepKioskAlive(tokens.accessToken)).expiresIn, 600);
    const [renewed] = (await db.query<{ expires_at: Date }>("SELECT expires_at FROM auth_sessions")).rows;
    assert.ok(new Date(renewed.expires_at).getTime() > Date.now() + 590000);
    await auth.logout(tokens.accessToken); await assert.rejects(() => auth.user(tokens.accessToken));
    await assert.rejects(() => auth.keepKioskAlive(tokens.accessToken));
    const expired = await kiosk.login(key, '001234');
    await db.query("UPDATE auth_sessions SET expires_at=$1", [new Date(Date.now() - 1000)]);
    await assert.rejects(() => auth.keepKioskAlive(expired.accessToken));
    const mobile = await auth.login('demo', 'secret');
    await assert.rejects(() => auth.keepKioskAlive(mobile.accessToken));
    assert.throws(() => new KioskCardAuth(key, { cards:[{ cardHash:hash('001234'), userId:'demo-member' },{ cardHash:hash('001234'), userId:'other' }] }, cafe, auth));
  } finally { await db.close(); }
});
test('PanCafe card lookup requires device authorization first', async () => {
  let calls = 0;
  const cafe = { authenticateCard:async (uid:string) => { calls++; return uid === '001234' ? { id:'pan-member' } : null; } } as any;
  const auth = { kioskAccess:async (id:string) => ({ member:id }) } as any;
  const kiosk = new KioskCardAuth(key, { cards:[] }, cafe, auth);
  await assert.rejects(() => kiosk.login('wrong', '001234')); assert.equal(calls, 0);
  assert.deepEqual(await kiosk.login(key, '001234'), { member:'pan-member' });
  await assert.rejects(() => kiosk.login(key, '998877')); assert.equal(calls, 2);
});
test('HTTP kiosk login disabled until configured', async () => {
  const app = await createApp({ ENVIRONMENT:'test' });
  try {
    await app.listen(0, '127.0.0.1'); const url = await app.getUrl();
    const response = await fetch(url + '/api/v1/kiosk/card-login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ cardUid:'001234' }) });
    assert.equal(response.status, 503);
  } finally { await app.close(); }
});

test('HTTP configured kiosk issues a usable session only to its device key', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'stech-kiosk-http-'));
  const file = join(dir, 'cards.json');
  await writeFile(file, JSON.stringify({ cards:[{ cardHash:hash('001234'), userId:'demo-member' }] }));
  const app = await createApp({ ENVIRONMENT:'test', KIOSK_DEVICE_KEY:key, KIOSK_CARD_MAP_FILE:file, DEMO_PASSWORD:'test-member-password' });
  try {
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl() + '/api/v1';
    const login = (body:unknown, deviceKey = key) => fetch(base + '/kiosk/card-login', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Kiosk-Key':deviceKey }, body:JSON.stringify(body) });
    assert.equal((await login({ cardUid:'001234' }, 'wrong')).status, 401);
    assert.equal((await login({ cardUid:'001234', userId:'someone-else' })).status, 400);
    assert.equal((await login({ cardUid:'999999' })).status, 401);
    const response = await login({ cardUid:'001234' }); assert.equal(response.status, 201);
    const tokens = await response.json() as { accessToken:string; expiresIn:number };
    assert.equal(tokens.expiresIn, 600); assert.equal('refreshToken' in tokens, false);
    const headers = { Authorization:`Bearer ${tokens.accessToken}` };
    const keepAlive = (deviceKey: string) => fetch(base + '/kiosk/session/keep-alive', { method:'POST', headers:{ ...headers, 'X-Kiosk-Key':deviceKey } });
    assert.equal((await keepAlive('wrong')).status, 401);
    assert.equal((await keepAlive(key)).status, 201);
    const dashboard = await fetch(base + '/me/dashboard', { headers });
    assert.equal(dashboard.status, 200); assert.equal((await dashboard.json() as any).member.username, 'demo');
    await fetch(base + '/auth/logout', { method:'POST', headers });
    assert.equal((await fetch(base + '/me/dashboard', { headers })).status, 401);

    const passwordLogin = (password: string, deviceKey = key) => fetch(base + '/kiosk/password-login', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'X-Kiosk-Key':deviceKey },
      body:JSON.stringify({ identifier:' demo ', password }),
    });
    assert.equal((await passwordLogin('test-member-password', 'wrong')).status, 401);
    assert.equal((await passwordLogin('wrong')).status, 401);
    const passwordResponse = await passwordLogin('test-member-password');
    assert.equal(passwordResponse.status, 201);
    const passwordTokens = await passwordResponse.json() as { accessToken:string; expiresIn:number };
    assert.equal(passwordTokens.expiresIn, 600);
    assert.equal('refreshToken' in passwordTokens, false);
    const passwordHeaders = { Authorization:`Bearer ${passwordTokens.accessToken}` };
    const passwordDashboard = await fetch(base + '/me/dashboard', { headers:passwordHeaders });
    assert.equal(passwordDashboard.status, 200);
    assert.equal((await passwordDashboard.json() as any).member.username, 'demo');
    await fetch(base + '/auth/logout', { method:'POST', headers:passwordHeaders });
    assert.equal((await fetch(base + '/me/dashboard', { headers:passwordHeaders })).status, 401);
  } finally { await app.close(); await rm(dir, { recursive:true, force:true }); }
});
