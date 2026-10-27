import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { openDatabase } from "../src/database/database";
import { PersistentMockCafeAdapter } from "../src/cafe/persistent-mock";

test("registration: isolated zero wallets, salted credentials and accounts survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stech-registration-"));
  let db = await openDatabase({ directory });
  try {
    let cafe = new PersistentMockCafeAdapter(db, "secret");
    await cafe.initialize();
    const input = {
      username: "new_member",
      name: "Yeni Üye",
      password: "TestPassword123!",
    };
    const member = await cafe.register(input);
    assert.equal(member.name, input.name);
    assert.equal(member.phone, "");
    assert.equal(member.email, "");
    assert.equal(member.level, "");
    assert.equal((await cafe.getBalance(member.id)).balance, 0);
    assert.deepEqual(await cafe.getTransactions(member.id), []);
    await assert.rejects(cafe.register({ ...input, username: "NEW_MEMBER" }));
    await assert.rejects(cafe.register({ ...input, username: "DEMO" }));
    const other = await cafe.register({
      ...input,
      username: "second_member",
      email: "second@example.com",
    });
    const rows = (
      await db.query<{ password_hash: string; salt: string }>(
        "SELECT password_hash,salt FROM demo_members",
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].password_hash, input.password);
    assert.notEqual(rows[0].password_hash, rows[1].password_hash);
    assert.notEqual(rows[0].salt, rows[1].salt);
    assert.equal((await db.query("SELECT id FROM app_users")).rows.length, 3);
    await cafe.addBalance(other.id, 10000, 0, "registration-other-topup");
    assert.equal((await cafe.getBalance(member.id)).balance, 0);
    assert.deepEqual(await cafe.getTransactions(member.id), []);
    assert.equal((await cafe.getBalance("demo-member")).balance, 74250);
    await db.close();
    db = await openDatabase({ directory });
    cafe = new PersistentMockCafeAdapter(db, "secret");
    await cafe.initialize();
    assert.equal(
      (await cafe.authenticate("NEW_MEMBER", input.password))?.id,
      member.id,
    );
    assert.equal(await cafe.authenticate("new_member", "wrong-password"), null);
    assert.deepEqual(await cafe.getUser(member.id), member);
    assert.equal((await cafe.getBalance(member.id)).balance, 0);
    assert.deepEqual(await cafe.getTransactions(member.id), []);
  } finally {
    await db.close();
  }
});

test("HTTP registration validates inputs, rejects balance injection and logs into an empty account", async () => {
  const app = await createApp({ ENVIRONMENT: "test" });
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const register = (body: unknown) =>
    fetch(url + "/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const input = {
    username: "http_member",
    name: "Test Üye",
    password: "TestPassword123!",
  };
  try {
    for (const invalid of [
      { ...input, balance: 10000 },
      { ...input, password: "123" },
      { ...input, name: "   " },
      { ...input, email: "bad" },
    ])
      assert.equal((await register(invalid)).status, 400);
    const response = await register(input);
    assert.equal(response.status, 201);
    const tokens = (await response.json()) as { accessToken: string };
    const dashboardResponse = await fetch(url + "/api/v1/me/dashboard", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = (await dashboardResponse.json()) as any;
    assert.equal(dashboard.wallet.balance, 0);
    assert.equal(dashboard.member.name, input.name);
    assert.equal(dashboard.member.email, "");
    assert.deepEqual(dashboard.transactions, []);
    assert.deepEqual(dashboard.pendingPayments, []);
    assert.equal(dashboard.member.password_hash, undefined);
    assert.equal(
      (await register({ ...input, username: "HTTP_MEMBER" })).status,
      409,
    );
  } finally {
    await app.close();
  }
});
