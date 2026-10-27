import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockCafeSystemAdapter } from "../src/cafe/mock";
import { MockPaymentProvider } from "../src/payments/provider";
import { PaymentService, calculateQuote } from "../src/payments/service";
import { AuthService } from "../src/auth/service";
import { assertDevelopment, createApp } from "../src/app";
const setup = () => {
  const cafe = new MockCafeSystemAdapter("secret");
  const provider = new MockPaymentProvider();
  return { cafe, provider, payments: new PaymentService(cafe, provider) };
};
test("bonus thresholds, cap, expiration and integer rounding", async () => {
  const { cafe } = setup();
  const promotions = await cafe.getAvailablePromotions("demo-member");
  const now = Date.parse("2026-10-19");
  assert.equal(calculateQuote(5000, promotions, now).bonus, 0);
  assert.equal(calculateQuote(19999, promotions, now).bonus, 0);
  assert.equal(calculateQuote(20000, promotions, now).bonus, 2000);
  assert.equal(calculateQuote(23456, promotions, now).bonus, 2345);
  assert.equal(calculateQuote(50000, promotions, now).bonus, 5000);
  assert.equal(calculateQuote(50001, promotions, now).bonus, 5000);
  assert.equal(calculateQuote(1000000, promotions, now).bonus, 100000);
  assert.equal(
    calculateQuote(50000, promotions, Date.parse("2027-01-01")).bonus,
    0,
  );
  assert.throws(() => calculateQuote(10000.5, promotions, now));
  assert.throws(() => calculateQuote(4999, promotions, now));
  assert.throws(() => calculateQuote(1000001, promotions, now));
});
test("duplicate and concurrent callbacks credit exactly once", async () => {
  const { cafe, payments } = setup();
  const p = await payments.create("demo-member", 50000, "a");
  const event = {
    eventId: "e1",
    paymentId: p.id,
    amount: 50000,
    currency: "TRY" as const,
    status: "succeeded" as const,
  };
  await Promise.all(Array.from({ length: 20 }, () => payments.accept(event)));
  assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
  assert.equal((await cafe.getTransactions("demo-member")).length, 5);
  assert.equal(payments.get("demo-member", p.id).status, "completed");
});
test("failed payment never credits balance", async () => {
  const { cafe, payments } = setup();
  const p = await payments.create("demo-member", 50000, "a");
  await payments.accept({
    eventId: "e1",
    paymentId: p.id,
    amount: p.amount,
    currency: "TRY",
    status: "failed",
  });
  assert.equal((await cafe.getBalance("demo-member")).balance, 74250);
});
test("idempotency keys bind to user and amount", async () => {
  const { payments } = setup();
  const [a, b] = await Promise.all([
    payments.create("demo-member", 50000, "a"),
    payments.create("demo-member", 50000, "a"),
  ]);
  assert.equal(a.id, b.id);
  await assert.rejects(() => payments.create("demo-member", 25000, "a"));
  assert.throws(() => payments.get("another-user", a.id));
});
test("amount tampering is rejected", async () => {
  const { payments, cafe } = setup();
  const p = await payments.create("demo-member", 50000, "a");
  await assert.rejects(() =>
    payments.accept({
      eventId: "e1",
      paymentId: p.id,
      amount: 1,
      currency: "TRY",
      status: "succeeded",
    }),
  );
  assert.equal((await cafe.getBalance("demo-member")).balance, 74250);
});
test("webhook signature and replay window", () => {
  const { provider } = setup();
  const timestamp = String(Date.now());
  const raw = Buffer.from(
    JSON.stringify({
      eventId: "1",
      paymentId: "1",
      amount: 50000,
      currency: "TRY",
      status: "succeeded",
    }),
  );
  assert.equal(
    provider.verifyWebhook(raw, provider.sign(raw, timestamp), timestamp)
      .amount,
    50000,
  );
  assert.throws(() => provider.verifyWebhook(raw, "bad", timestamp));
  assert.throws(() =>
    provider.verifyWebhook(
      Buffer.from("{}"),
      provider.sign(raw, timestamp),
      timestamp,
    ),
  );
  const expired = String(Date.now() - 600000);
  assert.throws(() =>
    provider.verifyWebhook(raw, provider.sign(raw, expired), expired),
  );
});
test("ambiguous remote timeout retries same operation without double credit", async () => {
  const { cafe, provider } = setup();
  const original = cafe.addBalance.bind(cafe);
  let first = true;
  cafe.addBalance = async (...args) => {
    const result = await original(...args);
    if (first) {
      first = false;
      throw new Error("Connection lost after remote commit");
    }
    return result;
  };
  const payments = new PaymentService(cafe, provider);
  const p = await payments.create("demo-member", 50000, "a");
  const event = {
    eventId: "e1",
    paymentId: p.id,
    amount: p.amount,
    currency: "TRY" as const,
    status: "succeeded" as const,
  };
  await assert.rejects(() => payments.accept(event));
  assert.equal(payments.get("demo-member", p.id).status, "transferring");
  await payments.accept(event);
  assert.equal((await cafe.getBalance("demo-member")).balance, 129250);
});
test("refresh rotation detects reuse and revokes entire session family", async () => {
  const { cafe } = setup();
  const auth = new AuthService(cafe);
  const first = await auth.login("demo", "secret");
  const second = auth.refresh(first.refreshToken);
  assert.equal(auth.user(second.accessToken), "demo-member");
  assert.throws(() => auth.refresh(first.refreshToken));
  assert.throws(() => auth.user(second.accessToken));
});
test("invalid credentials and logout", async () => {
  const { cafe } = setup();
  const auth = new AuthService(cafe);
  await assert.rejects(() => auth.login("demo", "wrong"));
  const tokens = await auth.login("demo", "secret");
  auth.logout(tokens.accessToken);
  assert.throws(() => auth.user(tokens.accessToken));
});
test("production and staging fail closed", () => {
  assert.throws(() => assertDevelopment({ ENVIRONMENT: "production" }));
  assert.throws(() => assertDevelopment({ ENVIRONMENT: "staging" }));
  assert.throws(() => assertDevelopment({ NODE_ENV: "production" }));
  assert.throws(() => assertDevelopment({ CAFE_ADAPTER: "real" }));
});
test("HTTP: authentication, validation, payment, balance, unauthorized access", async () => {
  const app = await createApp({ ENVIRONMENT: "test", DEMO_PASSWORD: "secret" });
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    key?: string,
  ) =>
    fetch(url + "/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request("/me/dashboard")).status, 401);
    const login = await request("/auth/login", "POST", {
      identifier: "demo",
      password: "secret",
    });
    assert.equal(login.status, 201);
    const { accessToken } = (await login.json()) as { accessToken: string };
    assert.equal(
      (
        await request(
          "/payments",
          "POST",
          { amount: 50000, userId: "victim" },
          accessToken,
          "key-1234567890123",
        )
      ).status,
      400,
    );
    const response = await request(
      "/payments",
      "POST",
      { amount: 50000 },
      accessToken,
      "key-1234567890123",
    );
    assert.equal(response.status, 201);
    const payment = (await response.json()) as { id: string };
    assert.equal(
      (
        await request(
          `/payments/${payment.id}/simulate`,
          "POST",
          { outcome: "succeeded" },
          accessToken,
        )
      ).status,
      201,
    );
    const dashboard = (await (
      await request("/me/dashboard", "GET", undefined, accessToken)
    ).json()) as { wallet: { balance: number } };
    assert.equal(dashboard.wallet.balance, 129250);
    assert.equal((await request("/webhooks/payment", "POST", {})).status, 400);
  } finally {
    await app.close();
  }
});
