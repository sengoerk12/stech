import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PanCafeReadOnlyClient,
  panCafeMoney,
} from "../src/cafe/pancafe-reader";

test("PanCafe money is converted exactly and missing balances fail closed", () => {
  assert.equal(panCafeMoney("0.00"), 0);
  assert.equal(panCafeMoney("742.50"), 74250);
  assert.equal(panCafeMoney("-0.10"), -10);
  assert.equal(panCafeMoney("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  for (const value of [
    null,
    undefined,
    "",
    "NaN",
    "1.001",
    "1e4",
    "90071992547409.92",
  ])
    assert.throws(() => panCafeMoney(value));
});

test("PanCafe binding checks both member ID and username and does not add bonus twice", async () => {
  const queries: string[] = [];
  const client = new PanCafeReadOnlyClient(async (sql) => {
    queries.push(sql);
    return [
      {
        ID: "2",
        USERNAME: "stech",
        NAME: "",
        LASTNAME: "",
        BALANCE_TL: "200.00",
        BONUS_TL: "20.00",
      },
    ];
  });
  const member = await client.readMember(2, "stech");
  assert.equal(member.balance, 20000);
  assert.equal(member.availableBonus, 2000);
  assert.equal(member.name, "");
  assert.equal(member.email, "");
  await assert.rejects(() => client.readMember(2, "someone_else"));
  await assert.rejects(() => client.readMember(1, "stech"));
  await assert.rejects(() => client.readMember(NaN, "stech"));
  assert(
    queries.every(
      (sql) => sql.trim().startsWith("SELECT ") && !sql.includes("PASSWORD"),
    ),
  );
  await assert.rejects(() =>
    new PanCafeReadOnlyClient(async () => []).readMember(2, "stech"),
  );
  await assert.rejects(() =>
    new PanCafeReadOnlyClient(async () => {
      throw new Error("Database unavailable");
    }).readMember(2, "stech"),
  );
});
