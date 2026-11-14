import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";

test("Ödeal kiosk dispatch, isolation and exactly-once credit through a verified notification", async (t) => {
  const deviceKey = "test-kiosk-".repeat(5);
  const requestKey = "test-notification-".repeat(3);
  const webhookBase = "https://stech.example/api/v1/webhooks/odeal";
  const realFetch = globalThis.fetch;
  let configured = false;
  const baskets: any[] = [];
  let deleteAllowed = false;
  const deleted: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    if (!url.startsWith("https://api.sandbox.odeal.com/")) return realFetch(url, options);
    if (url.endsWith("/configuration")) {
      return Response.json({
        basketType: "SIMPLE",
        odealRequestKey: requestKey,
        ...(configured ? {
          paymentSucceededUrl: webhookBase + "/payment-succeeded",
          paymentCancelledUrl: webhookBase + "/payment-cancelled",
          paymentFailedUrl: webhookBase + "/payment-failed",
          basketCancelledUrl: webhookBase + "/basket-cancelled",
        } : {}),
      });
    }
    if (url.endsWith("/basket/delete")) {
      assert.equal(options?.method, "DELETE");
      const reference = new Headers(options?.headers).get("referenceCode")!;
      assert.ok(baskets.some(basket => basket.referenceCode === reference));
      if (!deleteAllowed) return Response.json({ result: false }, { status: 409 });
      deleted.push(reference);
      return Response.json({ result: true });
    }
    assert.ok(url.endsWith("/basket"));
    baskets.push(JSON.parse(String(options?.body)));
    return Response.json({ result: true });
  });
  const app = await createApp({
    ENVIRONMENT: "test", DEMO_PASSWORD: "test-password", KIOSK_DEVICE_KEY: deviceKey,
    ODEAL_POS_ENV: "stage", ODEAL_MERCHANT_KEY: "test-merchant", ODEAL_SECRET_KEY: "test-secret",
    ODEAL_REQUEST_KEY: requestKey, ODEAL_DEVICE_CODE: "KIOSK1",
    ODEAL_CITY: "İstanbul", ODEAL_TOWN: "Kadıköy", ODEAL_BASKET_TYPE: "SIMPLE",
    ODEAL_VAT_RATE: "20", ODEAL_WEBHOOK_BASE_URL: webhookBase,
  });
  try {
    await app.listen(0, "127.0.0.1");
    const api = await app.getUrl() + "/api/v1";
    const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
      realFetch(api + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
    const registration = await post("/auth/register", {
      username: "odeal_test", name: "Deneme Üyesi", password: "test-password", phone: "5555555555",
    });
    assert.equal(registration.status, 201);
    const login = await post("/kiosk/password-login", { identifier: "odeal_test", password: "test-password" }, { "X-Kiosk-Key": deviceKey });
    const auth = { Authorization: "Bearer " + (await login.json()).accessToken };
    const kiosk = { ...auth, "X-Kiosk-Key": deviceKey };
    const checkout = (key: string, headers = kiosk, amount = 20000) =>
      post("/kiosk/pos-payments", { amount }, { ...headers, "Idempotency-Key": key });
    assert.equal((await checkout("test-order-001-unique")).status, 503);
    assert.equal(baskets.length, 0);
    configured = true;
    assert.equal((await checkout("test-under-minimum", kiosk, 99)).status, 400);
    assert.equal((await checkout("test-order-001-unique", { ...kiosk, "X-Kiosk-Key": "wrong" })).status, 401);
    const dashboard = async () => (await realFetch(api + "/kiosk/dashboard", { headers: kiosk })).json();
    const initial = (await dashboard()).wallet.balance;
    const responses = await Promise.all([
      checkout("test-order-001-unique"), checkout("test-order-001-unique"),
    ]);
    assert.deepEqual(responses.map(r => r.status), [201, 201]);
    const [first, second] = await Promise.all(responses.map(r => r.json()));
    assert.equal(first.id, second.id);
    assert.equal(baskets.length, 1);
    assert.equal(baskets[0].externalDeviceKey, "KIOSK1");
    assert.equal(baskets[0].referenceCode, first.id);
    assert.deepEqual(baskets[0].customer, {
      referenceCode: "NIHAI-TUKETICI", type: "INDIVIDUAL",
      name: "NİHAİ", surname: "TÜKETİCİ", identityNumber: "11111111111",
      city: "İstanbul", town: "Kadıköy",
    });
    assert.deepEqual(baskets[0].paymentOptions, [{ type: "CREDITCARD", amount: 200 }]);
    assert.equal((await checkout("test-order-002-unique")).status, 409);
    assert.equal((await post("/payments/" + first.id + "/simulate", { outcome: "succeeded" }, auth)).status, 404);
    const payload = {
      PaymentRefCode: "odeal-payment-001",
      BasketDetail: { BasketRefCode: first.id, ExternalDeviceKey: "KIOSK1" },
      PaymentDetail: { Amount: 200, AuthCode: "123456", PaymentMethod: "Kredi Kartı / Banka Kartı" },
    };
    const notify = (body = payload, key = requestKey) =>
      post("/webhooks/odeal/payment-succeeded", body, { "X-ODEAL-REQUEST-KEY": key });
    assert.equal((await notify(payload, "wrong")).status, 401);
    assert.equal((await notify({ ...payload, PaymentDetail: { ...payload.PaymentDetail, Amount: 199 } })).status, 400);
    assert.equal((await dashboard()).wallet.balance, initial);
    for (const r of await Promise.all([notify(), notify()])) assert.equal(r.status, 201);
    const status = async () => (await realFetch(api + "/kiosk/pos-payments/" + first.id, { headers: kiosk })).json();
    for (let i = 0; i < 40; i++) {
      if ((await status()).status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await status()).status, "completed");
    assert.equal((await dashboard()).wallet.balance, initial + 20000 + first.bonus);
    assert.equal((await notify()).status, 201);
    assert.equal((await dashboard()).wallet.balance, initial + 20000 + first.bonus);
    for (const [index, wrap] of [true, false].entries()) {
      const next = await (await checkout("test-cancellation-" + index)).json();
      const basket = { BasketRefCode: next.id, ExternalDeviceKey: "KIOSK1", GrossPrice: 200 };
      const cancel = (data: typeof basket, key = requestKey) =>
        post("/webhooks/odeal/basket-cancelled", wrap ? { Basket: data } : data, { "X-ODEAL-REQUEST-KEY": key });
      const status = async () => (await realFetch(api + "/kiosk/pos-payments/" + next.id, { headers: kiosk }).then(r => r.json())).status;
      assert.equal((await cancel(basket, "wrong")).status, 401);
      assert.equal((await cancel({ ...basket, GrossPrice: 199 })).status, 400);
      assert.equal(await status(), "pending");
      assert.equal((await cancel(basket)).status, 201);
      assert.equal((await cancel(basket)).status, 201);
      assert.equal(await status(), "failed");
      assert.equal((await dashboard()).wallet.balance, initial + 20000 + first.bonus);
    }
    const abandoned = await (await checkout("test-cancel-on-kiosk", kiosk, 100)).json();
    assert.equal(abandoned.amount, 100);
    assert.deepEqual(baskets.at(-1).paymentOptions, [{ type: "CREDITCARD", amount: 1 }]);
    const cancel = (headers = kiosk) => post("/kiosk/pos-payments/" + abandoned.id + "/cancel", {}, headers);
    assert.equal((await cancel({ ...kiosk, "X-Kiosk-Key": "wrong" })).status, 401);
    assert.equal((await cancel()).status, 409);
    assert.equal((await dashboard()).pendingPayments[0].id, abandoned.id);
    deleteAllowed = true;
    assert.equal((await (await cancel()).json()).status, "failed");
    assert.equal((await (await cancel()).json()).status, "failed");
    const declined = await (await checkout("test-cancel-after-failed")).json();
    const paymentFailed = {
      BasketDetail: { BasketRefCode: declined.id, ExternalDeviceKey: "KIOSK1" },
      PaymentDetail: { Amount: 200, FailReason: "İşlem iptal edildi" },
    };
    assert.equal((await post("/webhooks/odeal/payment-failed", paymentFailed, { "X-ODEAL-REQUEST-KEY": requestKey })).status, 201);
    assert.deepEqual(deleted, [abandoned.id, declined.id]);
    assert.equal((await dashboard()).pendingPayments.length, 0);
    assert.equal((await dashboard()).wallet.balance, initial + 20000 + first.bonus);
  } finally {
    await app.close();
  }
});
