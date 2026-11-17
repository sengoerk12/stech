import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transaction } from "@stech/contracts";
import { kioskHistory } from "../src/cafe/kiosk-history";
import { openDatabase } from "../src/database/database";

test("kiosk history collects ten per category across pages and separates wheel credits from deposits", async () => {
  const db = await openDatabase();
  try {
    const paid = "550e8400-e29b-41d4-a716-446655440000";
    const wheel = "550e8400-e29b-41d4-a716-446655440001";
    await db.query("INSERT INTO app_users(id,cafe_member_id) VALUES('member','1')");
    await db.query(
      "INSERT INTO payment_orders(id,user_id,idempotency_key,amount,bonus,status) VALUES($1,'member','order',500,0,'completed')",
      [paid],
    );
    const row = (kind: Transaction["kind"], number: number, amount = 500, creditId?: string) => ({
      kind, amount, creditId, id: kind + number, title: kind, balanceAfter: 50000,
      createdAt: new Date(Date.UTC(2026, 10, 15, 0, 0, number)).toISOString(),
    });
    const deposit = row("topup", 42, 500, paid);
    const award = row("topup", 41, 500, wheel);
    const calls: (string | undefined)[] = [];
    const result = await kioskHistory(db, async cursor => {
      calls.push(cursor);
      return cursor
        ? { items: [award, ...Array.from({ length: 12 }, (_, i) => row("bonus", 12 - i)), row("adjustment", 0)] }
        : { items: [row("usage", 44, -500), row("topup", 43, -500), deposit, ...Array.from({ length: 12 }, (_, i) => row("topup", 30 - i))], nextCursor: "older" };
    }, async () => Array.from({ length: 12 }, (_, i) => ({
      id: "coin" + i, kind: "s_coin" as const, amount: 2,
      title: "Yüklemeden kazanılan S Coin", createdAt: row("bonus", 60 - i).createdAt,
    })));
    assert.deepEqual(calls, [undefined, "older"]);
    for (const kind of ["topup", "bonus", "s_coin"])
      assert.equal(result.items.filter(item => item.kind === kind).length, 10);
    assert.ok(result.items.some(item => item.kind === "topup" && item.id === deposit.id));
    assert.deepEqual(result.items.filter(item => item.kind === "game_reward").map(item => item.id), [award.id]);
    assert.ok(result.items.every(item => item.amount > 0 && !("creditId" in item)));
  } finally {
    await db.close();
  }
});
