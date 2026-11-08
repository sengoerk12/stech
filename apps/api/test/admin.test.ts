import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { openDatabase } from "../src/database/database";
import { AdminService } from "../src/admin/service";
import { PanCafeBridgeClient } from "../src/cafe/pancafe";
import { PersistentPaymentService } from "../src/payments/persistent-service";
import { PersistentMockCafeAdapter } from "../src/cafe/persistent-mock";
import { MockPaymentProvider } from "../src/payments/provider";
test("Admin HTTP: one-time setup, isolated sessions, role enforcement, dynamic quotes, audit, topup pause", async () => {
  const app = await createApp({
    ENVIRONMENT: "test",
    ADMIN_SETUP_TOKEN: "setup-test-secret",
    DEMO_PASSWORD: "member-pass",
  });
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    let token = "";
    async function call(
      route: string,
      body?: unknown,
      method = body ? "POST" : "GET",
      headers: Record<string, string> = {},
    ) {
      return fetch(base + "/api/v1/" + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    assert.equal((await call("admin/members")).status, 401);
    const input = { username: "owner", password: "A-strong-pass123!" };
    assert.equal(
      (
        await call("admin/auth/setup", input, "POST", {
          "X-Setup-Token": "wrong",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("admin/auth/setup", input, "POST", {
          "X-Setup-Token": "setup-test-secret",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call("admin/auth/setup", input, "POST", {
          "X-Setup-Token": "setup-test-secret",
        })
      ).status,
      409,
    );
    const owner = await (await call("admin/auth/login", input)).json();
    token = owner.token;
    const promo = (await (await call("admin/promotions")).json())[0];
    assert.equal(
      (await call("admin/promotions", { ...promo, bonusPercent: 20 }, "PUT"))
        .status,
      200,
    );
    assert.equal(
      (await call("admin/promotions", { ...promo, bonusPercent: 30 }, "PUT"))
        .status,
      409,
    );
    const member = await (
      await call("auth/login", { identifier: "demo", password: "member-pass" })
    ).json();
    const quote = await (
      await call("payments/quote", { amount: 20000 }, "POST", {
        Authorization: "Bearer " + member.accessToken,
      })
    ).json();
    assert.equal(quote.bonus, 4000);
    assert.equal(
      (
        await call("admin/promotions", undefined, "GET", {
          Authorization: "Bearer " + member.accessToken,
        })
      ).status,
      401,
    );
    assert.equal((await call("me/dashboard")).status, 401);
    assert.equal(
      (
        await call("admin/accounts", {
          username: "viewer",
          password: "Viewer-password123!",
          role: "viewer",
        })
      ).status,
      201,
    );
    const viewer = await (
      await call("admin/auth/login", {
        username: "viewer",
        password: "Viewer-password123!",
      })
    ).json();
    assert.equal(
      (
        await call("admin/promotions", { ...promo, revision: 2 }, "PUT", {
          Authorization: "Bearer " + viewer.token,
        })
      ).status,
      403,
    );
    const announce = {
      id: randomUUID(),
      title: "Yeni duyuru",
      body: "S TECH oyun zamanı",
      active: true,
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2035-01-01T00:00:00Z",
    };
    assert.equal(
      (await call("admin/content/announcements", announce, "PUT")).status,
      200,
    );
    const dashboard = await (
      await call("me/dashboard", undefined, "GET", {
        Authorization: "Bearer " + member.accessToken,
      })
    ).json();
    assert.equal(dashboard.announcements[0].title, announce.title);
    const payment = await (
      await call("payments", { amount: 20000 }, "POST", {
        Authorization: "Bearer " + member.accessToken,
        "Idempotency-Key": randomUUID(),
      })
    ).json();
    assert.equal(payment.bonus, 4000);
    assert.equal(
      (
        await call(
          "admin/content/settings",
          {
            id: randomUUID(),
            topupEnabled: false,
            supportText: "Destek için şubeye başvur.",
          },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call("payments/quote", { amount: 20000 }, "POST", {
          Authorization: "Bearer " + member.accessToken,
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await call(
          `payments/${payment.id}/simulate`,
          { outcome: "succeeded" },
          "POST",
          { Authorization: "Bearer " + member.accessToken },
        )
      ).status,
      201,
    );
    const records = await (await call("admin/audit")).text();
    assert.ok(records.includes("admin.promotion.save"));
    assert.ok(!records.includes(input.password));
    await call("admin/auth/logout", {});
    assert.equal((await call("admin/overview")).status, 401);
  } finally {
    await app.close();
  }
});
test("Admin adjustment retries use one remote receipt and reject altered payload; native history debit is adjustment", async () => {
  const db = await openDatabase();
  try {
    const cafe = new PersistentMockCafeAdapter(db, "test");
    await cafe.initialize();
    let balance = 0,
      remoteCalls = 0;
    const receipts = new Map<string, number>();
    let loseResponse = true;
    const bridge = new PanCafeBridgeClient(
      { installationId: "test", displayName: "Test", apiKey: "x".repeat(48) },
      undefined,
      async (_url, options) => {
        const d = JSON.parse(String(options?.body));
        remoteCalls++;
        if (!receipts.has(d.operationId)) {
          balance += d.delta;
          receipts.set(d.operationId, balance);
        }
        if (loseResponse) {
          loseResponse = false;
          throw new Error("lost response");
        }
        return new Response(
          JSON.stringify([
            {
              RESULT_CODE: "ok",
              BALANCE_TL: (receipts.get(d.operationId)! / 100).toFixed(2),
            },
          ]),
        );
      },
    );
    const service = new AdminService(
      db,
      bridge,
      new PersistentPaymentService(db, cafe, new MockPaymentProvider()),
      { ADMIN_SETUP_TOKEN: "secret" },
    );
    await service.setup(
      { username: "owner", password: "Owner-password123!" },
      "secret",
      "127.0.0.1",
    );
    const login = await service.login({
      username: "owner",
      password: "Owner-password123!",
    });
    const actor = await service.authorize("Bearer " + login.token);
    const request = {
      operationId: randomUUID(),
      memberId: 2,
      username: "kaan2",
      delta: 5000,
      bonusDelta: 0,
      expectedBalance: 0,
      expectedBonus: 0,
      reason: "Manual test deposit",
    };
    await assert.rejects(service.adjust(actor, request));
    assert.equal(balance, 5000);
    assert.equal((await service.adjust(actor, request)).balance, 5000);
    await service.adjust(actor, request);
    assert.equal(remoteCalls, 2);
    assert.equal(balance, 5000);
    await assert.rejects(service.adjust(actor, { ...request, delta: 6000 }));
    const audit = await service.audit();
    assert.equal(
      audit.filter((r: any) => r.event === "admin.balance.completed").length,
      1,
    );
  } finally {
    await db.close();
  }
});
