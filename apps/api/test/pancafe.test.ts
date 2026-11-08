import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PanCafeSystemAdapter, PanCafeBridgeClient } from "../src/cafe/pancafe";
import { openDatabase } from "../src/database/database";
import type { PanCafeRow } from "../src/cafe/pancafe-reader";
import { PanCafeSimulationAdapter } from "../src/cafe/pancafe-simulation";
import { PersistentPaymentService } from "../src/payments/persistent-service";
import { MockPaymentProvider } from "../src/payments/provider";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";

const config = {
  installationId: "test-installation",
  displayName: "2.stech",
  apiKey: "x".repeat(48),
};

for (const nativeCredit of [false, true]) {
test(`HTTP: PanCafe mock checkout uses the ${nativeCredit ? "native" : "isolated"} destination`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "stech-simulation-http-"));
  const configPath = join(directory, "connection.json");
  await writeFile(configPath, JSON.stringify({ ...config, allowBalanceCredit: nativeCredit }));
  const bridge = new TestBridge();
  const realFetch = globalThis.fetch;
  let app: Awaited<ReturnType<typeof createApp>>;
  try {
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "http://127.0.0.1:3002");
      const rows = await bridge.request(url.pathname + url.search,
        options?.body ? JSON.parse(String(options.body)) : undefined);
      return new Response(JSON.stringify(rows), { status: rows ? 200 : 401 });
    };
    app = await createApp({ ENVIRONMENT: "test", CAFE_ADAPTER: "pancafe",
      PAYMENT_PROVIDER: "mock", PANCAFE_PAYMENT_SIMULATION: "true",
      PANCAFE_BALANCE_CREDIT: String(nativeCredit),
      PANCAFE_BRIDGE_CONFIG: configPath });
  } finally {
    globalThis.fetch = realFetch;
  }
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const login = await realFetch(base + "/api/v1/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "kaan2", password: "PanCafePassword!" }),
    });
    assert.equal(login.status, 201);
    const tokens = await login.json() as { accessToken: string };
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` };
    const dashboard = () => realFetch(base + "/api/v1/me/dashboard", { headers }).then(r => r.json()) as Promise<any>;
    const before = await dashboard();
    assert.equal(before.features.topup, true);
    assert.equal(before.wallet.balance, 20000);
    assert.equal(before.testWallet?.balance, nativeCredit ? undefined : 0);
    const created = await realFetch(base + "/api/v1/payments", {
      method: "POST", headers: { ...headers, "Idempotency-Key": "http-simulation-unique" },
      body: JSON.stringify({ amount: 20000 }),
    });
    assert.equal(created.status, 201);
    const payment = await created.json() as { id: string; bonus: number };
    assert.equal(payment.bonus, 2000);
    const finish = () => realFetch(base + `/api/v1/payments/${payment.id}/simulate`, {
      method: "POST", headers, body: JSON.stringify({ outcome: "succeeded" }),
    });
    const completed = await finish();
    assert.equal(completed.status, 201);
    assert.equal((await completed.json() as { status: string }).status, "completed");
    await finish();
    const after = await dashboard();
    assert.equal(after.wallet.balance, nativeCredit ? 42000 : 20000);
    assert.equal(after.testWallet?.balance, nativeCredit ? undefined : 22000);
    assert.equal(after.transactions.length, 2);
    assert.equal(bridge.rows[1].BALANCE_TL, nativeCredit ? "420.00" : "200.00");
    const historyResponse = await realFetch(base + "/api/v1/me/transactions", { headers });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as { items: unknown[] };
    assert.equal(history.items.length, 2);
    const sessionResponse = await realFetch(base + "/api/v1/me/session-history", { headers });
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), { items: [] });
    assert.equal((await realFetch(base + "/api/v1/me/transactions")).status, 401);
    assert.equal((await realFetch(base + "/api/v1/me/session-history")).status, 401);
    assert.equal((await realFetch(base + "/api/v1/me/transactions?cursor=unsafe", { headers })).status, 400);
  } finally {
    await app.close();
  }
});
}

test("PanCafe simulation credits only isolated test wallets, with bonus and idempotency", async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge();
    const source = new PanCafeSystemAdapter(db, bridge, config);
    const member = await source.authenticate("kaan2", "PanCafePassword!");
    const other = await source.authenticate("first", "PanCafePassword!");
    assert(member && other);
    let nativeWrites = 0;
    source.addBalance = async () => {
      nativeWrites++;
      throw new Error("Native write must never be called");
    };
    const simulation = new PanCafeSimulationAdapter(db, source);
    await simulation.initialize();
    const payments = new PersistentPaymentService(db, simulation, new MockPaymentProvider());
    assert.equal((await simulation.getBalance(member.id)).balance, 0);
    assert.deepEqual(await simulation.getTransactions(member.id), []);
    assert.equal((await payments.quote(member.id, 5000)).bonus, 0);
    assert.equal((await payments.quote(member.id, 19999)).bonus, 0);
    assert.equal((await payments.quote(member.id, 23456)).bonus, 2345);
    await assert.rejects(() => payments.create(member.id, 4999, "too-low"));
    const payment = await payments.create(member.id, 20000, "test-payment-unique");
    assert.equal(payment.simulation, true);
    assert.equal(payment.bonus, 2000);
    const event = {
      eventId: "simulation-paid", paymentId: payment.id, amount: 20000,
      currency: "TRY" as const, status: "succeeded" as const,
    };
    const completed = await payments.accept(event);
    assert.equal(completed.status, "completed");
    assert.equal(completed.balanceAfter, 22000);
    await payments.accept(event);
    await payments.accept({ ...event, eventId: "duplicate-provider-delivery" });
    assert.equal((await simulation.getBalance(member.id)).balance, 22000);
    assert.equal((await simulation.getTransactions(member.id)).length, 2);
    assert.equal((await simulation.getBalance(other.id)).balance, 0);
    assert.equal((await source.getBalance(member.id)).balance, 20000);
    assert.equal(nativeWrites, 0);
    await assert.rejects(() => payments.get(other.id, payment.id));
    const failed = await payments.create(member.id, 5000, "failed-simulation");
    await payments.accept({ ...event, paymentId: failed.id, eventId: "failed-test", amount: 5000, status: "failed" });
    assert.equal((await simulation.getBalance(member.id)).balance, 22000);
    const reopened = new PanCafeSimulationAdapter(db, source);
    assert.equal((await reopened.getBalance(member.id)).balance, 22000);
    assert.equal((await db.query("SELECT * FROM demo_members")).rows.length, 0);
    await assert.rejects(() => simulation.getBalance("unknown-user"));
  } finally {
    await db.close();
  }
});
test("Native destination credits PanCafe once and never replays old isolated simulations", async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge();
    const source = new PanCafeSystemAdapter(db, bridge, { ...config, allowBalanceCredit: true });
    const member = await source.authenticate("kaan2", "PanCafePassword!");
    assert(member);
    const isolated = new PanCafeSimulationAdapter(db, source);
    await isolated.initialize();
    const oldPayments = new PersistentPaymentService(db, isolated, new MockPaymentProvider());
    const old = await oldPayments.create(member.id, 5000, "old-isolated-payment");
    isolated.delayTransfer(old.id, 60000);
    await oldPayments.accept({ eventId: "old-event", paymentId: old.id, amount: 5000, currency: "TRY", status: "succeeded" });
    await db.query("UPDATE transfer_jobs SET next_attempt_at=now()-interval '1 second'");
    const destination = new PanCafeSimulationAdapter(db, source, true);
    const payments = new PersistentPaymentService(db, destination, new MockPaymentProvider(), "pancafe");
    await payments.drain();
    assert.equal(bridge.credits.size, 0);
    await assert.rejects(() => payments.get(member.id, old.id));
    await assert.rejects(() => payments.create(member.id, 5000, "old-isolated-payment"));
    const payment = await payments.create(member.id, 20000, "new-native-payment");
    assert.equal(payment.creditedToCafe, true);
    const event = { eventId: "native-paid", paymentId: payment.id, amount: 20000, currency: "TRY" as const, status: "succeeded" as const };
    await Promise.all([payments.accept(event), payments.accept(event)]);
    await payments.accept({ ...event, eventId: "another-delivery" });
    assert.equal((await payments.get(member.id, payment.id)).status, "completed");
    assert.equal((await source.getBalance(member.id)).balance, 42000);
    assert.equal((await destination.getBalance(member.id)).balance, 42000);
    assert.equal(bridge.credits.size, 1);
    assert.equal((await destination.getTransactions(member.id)).length, 2);
    assert.equal((await isolated.getBalance(member.id)).balance, 0);
    const failed = await payments.create(member.id, 5000, "native-failed-payment");
    await payments.accept({ ...event, eventId: "native-failed", paymentId: failed.id, amount: 5000, status: "failed" });
    assert.equal((await source.getBalance(member.id)).balance, 42000);
    assert.equal(bridge.credits.size, 1);
  } finally { await db.close(); }
});

test("Native history pagination and sessions stay scoped to the authenticated member", async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge();
    const source = new PanCafeSystemAdapter(db, bridge, config);
    const member = await source.authenticate("kaan2", "PanCafePassword!");
    assert(member);
    const row = (id: number): PanCafeRow => ({ HISTORY_ID: String(id), USERNAME: "kaan2", RAW_AMOUNT_TL: "1.00", BALANCE_TL: `${id}.00`,
      PREVIOUS_BALANCE_TL: `${id - 1}.00`, OCCURRED_DATE: "2026-10-27", OCCURRED_TIME: "12:00:00.0000", NOTE: "Hesaba para yüklendi.", TERMINALNAME: "" });
    bridge.historyRows = Array.from({ length: 205 }, (_, i) => row(205 - i));
    const first = await source.getTransactionPage(member.id);
    assert.equal(first.items.length, 100); assert.equal(first.nextCursor, "106");
    const second = await source.getTransactionPage(member.id, first.nextCursor);
    const last = await source.getTransactionPage(member.id, second.nextCursor);
    assert.equal(last.items.length, 5); assert.equal(last.nextCursor, undefined);
    assert.equal(new Set([...first.items, ...second.items, ...last.items].map(item => item.id)).size, 205);
    await assert.rejects(() => source.getTransactionPage(member.id, "0 OR 1=1"));
    await assert.rejects(() => source.getTransactionPage("unlinked-user"));
    bridge.historyRows[0].USERNAME = "first";
    const original = bridge.request.bind(bridge);
    bridge.request = async (path, body) => path.startsWith("/transactions?") ? [bridge.historyRows[0]] : original(path, body);
    await assert.rejects(() => source.getTransactionPage(member.id));
    bridge.request = original;
    bridge.sessionRows = [{ SESSION_ID: "123", MEMBER_ID: "2", USERNAME: "kaan2", TERMINALNAME: "PC 27",
      STARTED_AT: "2026-10-27 12:00:00.0000", ENDED_AT: "2026-10-27 12:10:00.0000", DURATION_MINUTES: "10", USAGE_AMOUNT_TL: "25.50" }];
    const sessions = await source.getSessionHistory(member.id);
    assert.equal(sessions.items[0].usageAmount, 2550);
    assert.equal(sessions.items[0].durationMinutes, 10);
    assert.equal(sessions.items[0].startedAt, "2026-10-27T09:00:00.000Z");
    bridge.sessionRows[0].ENDED_AT = "invalid";
    await assert.rejects(() => source.getSessionHistory(member.id));
  } finally { await db.close(); }
});

function fixture(id: string, username: string): PanCafeRow {
  return {
    ID: id,
    USERNAME: username,
    NAME: "Kaan",
    LASTNAME: "",
    GSM: "",
    PHONE: "",
    EMAIL: "",
    JOINED_AT: "2026-10-23",
    BALANCE_TL: "200.00",
    BONUS_TL: "20.00",
    ACCSTATUS: "1",
    ACCTYPE: "0",
  };
}
class TestBridge extends PanCafeBridgeClient {
  historyRows: PanCafeRow[] = [];
  sessionRows: PanCafeRow[] = [];
  credits = new Map<string, { memberId: number; username: string; amount: number; bonus: number; balance: string }>();
  rows = [fixture("1", "first"), fixture("2", "kaan2")];
  lastRegistration: unknown;
  constructor() {
    super(config);
  }
  override async request(path: string, body?: any) {
    if (path === "/card-member") {
      const matches = this.rows.filter(row => row.LASTNAME?.trim().toUpperCase() === body.cardUid);
      return matches.length === 1 && matches[0].ACCSTATUS === "1" ? matches : null;
    }
    if (path === "/credit") {
      const previous = this.credits.get(body.operationId);
      if (previous) {
        assert.equal(previous.memberId, body.memberId);
        assert.equal(previous.username, body.username);
        assert.equal(previous.amount, body.amount);
        assert.equal(previous.bonus, body.bonus);
        return [{ RESULT_CODE: "ok", BALANCE_TL: previous.balance }];
      }
      const member = this.rows.find(row => row.ID === String(body.memberId) && row.USERNAME === body.username);
      assert(member);
      const before = member.BALANCE_TL!;
      member.BALANCE_TL = (Number(member.BALANCE_TL) + (body.amount + body.bonus) / 100).toFixed(2);
      this.credits.set(body.operationId, { ...body, balance: member.BALANCE_TL });
      this.historyRows.unshift({ HISTORY_ID: String(this.historyRows.length + 1), USERNAME: body.username,
        RAW_AMOUNT_TL: ((body.amount + body.bonus) / 100).toFixed(2), BALANCE_TL: member.BALANCE_TL,
        PREVIOUS_BALANCE_TL: before, OCCURRED_DATE: "2026-10-23", OCCURRED_TIME: "22:13:54.0000",
        TERMINALNAME: "S TECH Mobile", NOTE: `S TECH test payment ${body.operationId}`,
        PAYMENT_ID: body.operationId, PAID_KURUS: String(body.amount), BONUS_KURUS: String(body.bonus),
        CREDIT_BALANCE_TL: member.BALANCE_TL });
      return [{ RESULT_CODE: "ok", BALANCE_TL: member.BALANCE_TL }];
    }
    if (path === "/authenticate")
      return body.password === "PanCafePassword!"
        ? this.rows.filter((row) => row.USERNAME === body.identifier)
        : null;
    if (path === "/register") {
      this.lastRegistration = body;
      const row = fixture("3", body.username);
      row.BALANCE_TL = "0.00";
      row.BONUS_TL = "0.00";
      this.rows.push(row);
      return [row];
    }
    const url = new URL(path, "http://127.0.0.1:3002");
    if (url.pathname === "/transactions") {
      const before = Number(url.searchParams.get("before") ?? Infinity);
      return this.historyRows.filter(row => row.USERNAME === url.searchParams.get("username") && Number(row.HISTORY_ID) < before).slice(0, 101);
    }
    if (url.pathname === "/session-history") {
      return this.sessionRows.filter(row => row.MEMBER_ID === url.searchParams.get("id") && row.USERNAME === url.searchParams.get("username"));
    }
    return this.rows.filter(
      (row) =>
        row.ID === url.searchParams.get("id") &&
        row.USERNAME === url.searchParams.get("username"),
    );
  }
}
test("PanCafe login uses PanCafe credentials and links only the same native username", async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge();
    const adapter = new PanCafeSystemAdapter(db, bridge, config);
    assert.equal(await adapter.authenticate("kaan2", "wrong"), null);
    const kaan = await adapter.authenticate("kaan2", "PanCafePassword!");
    assert(kaan);
    const repeated = await adapter.authenticate("kaan2", "PanCafePassword!");
    assert.equal(repeated?.id, kaan.id);
    assert.equal(kaan.username, "kaan2");
    assert.equal((await adapter.getBalance(kaan.id)).balance, 20000);
    bridge.rows[1].BALANCE_TL = "82.50";
    assert.equal((await adapter.getBalance(kaan.id)).balance, 8250);
    const first = await adapter.authenticate("first", "PanCafePassword!");
    assert(first);
    assert.notEqual(first.id, kaan.id);
    assert.equal((await adapter.getUser(first.id)).username, "first");
    await assert.rejects(() => adapter.getBalance("unlinked-mobile-user"));
    assert.equal((await db.query("SELECT * FROM demo_wallets")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM demo_members")).rows.length, 0);
    assert.equal(
      (await db.query("SELECT * FROM cafe_member_links")).rows.length,
      2,
    );
    bridge.rows[1].ID = "99";
    await assert.rejects(() =>
      adapter.authenticate("kaan2", "PanCafePassword!"),
    );
    await assert.rejects(() => adapter.addBalance(kaan.id, 5000, 0, "00000000-0000-0000-0000-000000000001"));
  } finally {
    await db.close();
  }
});

test("PanCafe registration forwards identical credentials and creates no separate wallet", async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge();
    const adapter = new PanCafeSystemAdapter(db, bridge, config);
    const input = {
      username: "newmember",
      name: "Yeni Üye",
      password: "PanCafePassword!",
    };
    const member = await adapter.register(input);
    assert.deepEqual(bridge.lastRegistration, input);
    assert.equal(member.username, input.username);
    assert.equal((await adapter.getBalance(member.id)).balance, 0);
    assert.equal(
      (await adapter.authenticate(input.username, input.password))?.id,
      member.id,
    );
    assert.equal((await db.query("SELECT * FROM demo_wallets")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM demo_members")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("PanCafe bridge rejects credential leakage and keeps access key off the URL", async () => {
  const client = new PanCafeBridgeClient(
    config,
    undefined,
    async (url, options) => {
      assert(!String(url).includes(config.apiKey));
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        `Bearer ${config.apiKey}`,
      );
      return new Response(
        JSON.stringify([
          { ...fixture("2", "kaan2"), PASSWORD: "should-not-return" },
        ]),
        { status: 200 },
      );
    },
  );
  await assert.rejects(() =>
    client.request("/authenticate", {
      identifier: "kaan2",
      password: "private",
    }),
  );
  const offline = new PanCafeBridgeClient(config, undefined, async () => {
    throw new Error("offline");
  });
  await assert.rejects(() => offline.request("/member?id=2&username=kaan2"));
  assert.throws(
    () => new PanCafeBridgeClient(config, "http://192.168.1.1:3002"),
  );
});

test('PanCafe kiosk resolves LASTNAME card IDs, rejects duplicate/inactive cards and creates no password', async () => {
  const db = await openDatabase();
  try {
    const bridge = new TestBridge(); bridge.rows[1].LASTNAME = '00123456';
    const cafe = new PanCafeSystemAdapter(db, bridge, config);
    const member = await cafe.authenticateCard('00123456'); assert(member);
    assert.equal(member.username, 'kaan2');
    assert.equal((await cafe.getBalance(member.id)).balance, 20000);
    assert.equal((await cafe.getUser(member.id)).id, member.id);
    assert.equal((await cafe.authenticateCard('00123456'))?.id, member.id);
    assert.equal(await cafe.authenticateCard('123456'), null);
    bridge.rows[0].LASTNAME = '00123456'; assert.equal(await cafe.authenticateCard('00123456'), null);
    bridge.rows[0].LASTNAME = ''; bridge.rows[1].ACCSTATUS = '0'; assert.equal(await cafe.authenticateCard('00123456'), null);
    assert.equal((await db.query('SELECT * FROM demo_members')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM demo_wallets')).rows.length, 0);
  } finally { await db.close(); }
});
