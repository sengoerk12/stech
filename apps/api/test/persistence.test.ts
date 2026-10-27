import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Database } from "../src/database/database";
import { PersistentMockCafeAdapter } from "../src/cafe/persistent-mock";
import { PersistentPaymentService } from "../src/payments/persistent-service";
import { PersistentAuthService } from "../src/auth/persistent-service";
import { MockPaymentProvider } from "../src/payments/provider";
async function services(db: Database) {
  const cafe = new PersistentMockCafeAdapter(db, "secret");
  await cafe.initialize();
  return {
    cafe,
    payments: new PersistentPaymentService(db, cafe, new MockPaymentProvider()),
    auth: new PersistentAuthService(db, cafe),
  };
}
test("SQL: 50 TL minimum and 200 TL bonus threshold apply to stored payments", async () => {
  const db = await openDatabase();
  try {
    const { cafe, payments } = await services(db);
    await assert.rejects(() => payments.create("demo-member", 4999, "too-low"));
    const minimum = await payments.create("demo-member", 5000, "minimum-50");
    assert.equal(minimum.bonus, 0);
    assert.equal((await payments.quote("demo-member", 19999)).bonus, 0);
    const bonusPayment = await payments.create(
      "demo-member",
      20000,
      "threshold-200",
    );
    assert.equal(bonusPayment.bonus, 2000);
    assert.equal((await payments.quote("demo-member", 23456)).bonus, 2345);
    assert.equal((await payments.quote("demo-member", 200000)).bonus, 20000);
    await payments.accept({
      eventId: "minimum-paid",
      paymentId: minimum.id,
      amount: 5000,
      currency: "TRY",
      status: "succeeded",
    });
    await payments.accept({
      eventId: "threshold-paid",
      paymentId: bonusPayment.id,
      amount: 20000,
      currency: "TRY",
      status: "succeeded",
    });
    assert.equal((await cafe.getBalance("demo-member")).balance, 101250);
  } finally {
    await db.close();
  }
});
test("SQL: payment, wallet, sessions, preferences and idempotency survive database restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stech-persistence-"));
  let db = await openDatabase({ directory });
  try {
    const first = await services(db);
    const tokens = await first.auth.login("demo", "secret");
    const p = await first.payments.create(
      "demo-member",
      50000,
      "persistent-key",
    );
    const event = {
      eventId: "restart-event",
      paymentId: p.id,
      amount: 50000,
      currency: "TRY" as const,
      status: "succeeded" as const,
    };
    assert.equal((await first.payments.accept(event)).status, "completed");
    await db.query(
      `INSERT INTO notification_preferences(user_id,marketing) VALUES('demo-member',true)`,
    );
    await db.close();
    db = await openDatabase({ directory });
    const second = await services(db);
    assert.equal(await second.auth.user(tokens.accessToken), "demo-member");
    assert.equal(
      (await second.payments.create("demo-member", 50000, "persistent-key")).id,
      p.id,
    );
    assert.equal((await second.payments.accept(event)).status, "completed");
    assert.equal((await second.cafe.getBalance("demo-member")).balance, 129250);
    assert.equal((await second.cafe.getTransactions("demo-member")).length, 5);
    assert.equal(
      (
        await db.query<{ marketing: boolean }>(
          `SELECT marketing FROM notification_preferences WHERE user_id='demo-member'`,
        )
      ).rows[0].marketing,
      true,
    );
    assert.equal(
      (await db.query("SELECT * FROM transfer_ledger")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
test("SQL: durable outbox recovers ambiguous remote commit without another credit", async () => {
  const db = await openDatabase();
  try {
    const { cafe, payments } = await services(db);
    const add = cafe.addBalance.bind(cafe);
    let failOnce = true;
    cafe.addBalance = async (...args) => {
      const result = await add(...args);
      if (failOnce) {
        failOnce = false;
        throw new Error("Lost response after commit");
      }
      return result;
    };
    const p = await payments.create("demo-member", 50000, "retry-key");
    const result = await payments.accept({
      eventId: "event",
      paymentId: p.id,
      amount: p.amount,
      currency: "TRY",
      status: "succeeded",
    });
    assert.equal(result.status, "transferring");
    assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
    await db.query(`UPDATE transfer_jobs SET next_attempt_at='2000-01-01'`);
    const restartedWorker = new PersistentPaymentService(
      db,
      cafe,
      new MockPaymentProvider(),
    );
    await restartedWorker.drain();
    assert.equal(
      (await restartedWorker.get("demo-member", p.id)).status,
      "completed",
    );
    assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
    assert.equal(
      (await db.query("SELECT * FROM demo_wallet_operations")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
test("SQL: two workers and concurrent callbacks produce one transfer", async () => {
  const db = await openDatabase();
  try {
    const { cafe, payments } = await services(db);
    const second = new PersistentPaymentService(
      db,
      cafe,
      new MockPaymentProvider(),
    );
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? payments : second).create("demo-member", 50000, "same-key"),
      ),
    );
    assert.equal(new Set(created.map((p) => p.id)).size, 1);
    const event = {
      eventId: "concurrent",
      paymentId: created[0].id,
      amount: 50000,
      currency: "TRY" as const,
      status: "succeeded" as const,
    };
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? payments : second).accept(event),
      ),
    );
    assert.equal(
      (await payments.get("demo-member", event.paymentId)).status,
      "completed",
    );
    assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
    assert.equal(
      (await db.query("SELECT * FROM transfer_ledger")).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
test("SQL: rejection, wrong amount, idempotency conflict and user isolation", async () => {
  const db = await openDatabase();
  try {
    const { cafe, payments } = await services(db);
    const p = await payments.create("demo-member", 50000, "key");
    await assert.rejects(() => payments.get("victim", p.id));
    await assert.rejects(() => payments.create("demo-member", 25000, "key"));
    await assert.rejects(() =>
      payments.accept({
        eventId: "bad",
        paymentId: p.id,
        amount: 10000,
        currency: "TRY",
        status: "succeeded",
      }),
    );
    assert.equal(
      (
        await payments.accept({
          eventId: "failed",
          paymentId: p.id,
          amount: p.amount,
          currency: "TRY",
          status: "failed",
        })
      ).status,
      "failed",
    );
    assert.equal((await cafe.getBalance("demo-member")).balance, 74250);
    assert.equal(
      (await db.query("SELECT * FROM transfer_jobs")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("SQL: refresh replay commits revocation even when returning unauthorized", async () => {
  const db = await openDatabase();
  try {
    const { auth } = await services(db);
    const first = await auth.login("demo", "secret");
    const results = await Promise.allSettled([
      auth.refresh(first.refreshToken),
      auth.refresh(first.refreshToken),
    ]);
    const success = results.find(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof auth.refresh>>
      > => r.status === "fulfilled",
    );
    assert.ok(success);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    await assert.rejects(() => auth.user(success.value.accessToken));
    await assert.rejects(() => auth.refresh(success.value.refreshToken));
  } finally {
    await db.close();
  }
});
test("SQL: wallet and both ledger entries roll back together on a bonus insert failure", async () => {
  const db = await openDatabase();
  try {
    await services(db);
    const faultDb: Database = {
      ...db,
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            query: async (sql, params) => {
              if (
                sql.startsWith("INSERT INTO demo_wallet_transactions") &&
                params?.[2] === "bonus"
              )
                throw new Error("Injected failure");
              return tx.query(sql, params);
            },
          }),
        ),
    };
    const cafe = new PersistentMockCafeAdapter(faultDb, "secret");
    await assert.rejects(() =>
      cafe.addBalance("demo-member", 50000, 5000, "atomic-test"),
    );
    assert.equal((await cafe.getBalance("demo-member")).balance, 74250);
    assert.equal((await cafe.getTransactions("demo-member")).length, 3);
    assert.equal(
      (await db.query("SELECT * FROM demo_wallet_operations")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("SQL: a worker can recover an expired processing lease", async () => {
  const db = await openDatabase();
  try {
    const { payments, cafe } = await services(db);
    const p = await payments.create("demo-member", 50000, "lease");
    await db.query(
      `UPDATE payment_orders SET status='transferring' WHERE id=$1`,
      [p.id],
    );
    await db.query(
      `INSERT INTO transfer_jobs(payment_id,status,lease_until) VALUES($1,'processing','2000-01-01')`,
      [p.id],
    );
    await payments.drain();
    assert.equal((await payments.get("demo-member", p.id)).status, "completed");
    assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
  } finally {
    await db.close();
  }
});
