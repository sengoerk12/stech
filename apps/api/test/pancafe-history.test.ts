import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPanCafeHistory } from "../src/cafe/pancafe-history";
import type { PanCafeRow } from "../src/cafe/pancafe-reader";

function record(change: PanCafeRow = {}): PanCafeRow {
  return { HISTORY_ID: "4", USERNAME: "kaans", RAW_AMOUNT_TL: "100.00", BALANCE_TL: "200.00",
    PREVIOUS_BALANCE_TL: "100.00", OCCURRED_DATE: "2026-10-23", OCCURRED_TIME: "20:44:39.8650",
    TERMINALNAME: "", NOTE: "Hesaba para yüklendi.", PAYMENT_ID: null, PAID_KURUS: null,
    BONUS_KURUS: null, CREDIT_BALANCE_TL: null, ...change };
}
const map = (row: PanCafeRow) => mapPanCafeHistory(row, "kaans", "test-install");
test("native history: actual cashier records, timestamps, stable IDs and zero-value events", () => {
  const item = map(record())[0];
  assert.equal(item.kind, "topup"); assert.equal(item.amount, 10000); assert.equal(item.balanceAfter, 20000);
  assert.equal(item.title, "Kasadan bakiye yükleme");
  assert.equal(item.createdAt, "2026-10-23T17:44:39.865Z");
  assert.equal(map(record())[0].id, item.id);
  assert.deepEqual(map(record({ RAW_AMOUNT_TL: "0.00", NOTE: "Üye Hesabı Oluşturuldu." })), []);
  // A live PC may spend credit between history records. A cashier deposit keeps its own amount.
  assert.equal(map(record({ PREVIOUS_BALANCE_TL: "500.00" }))[0].amount, 10000);
});
test("native history: debits, unsigned costs, withdrawals, bonuses and unknown adjustments", () => {
  const cost = record({ RAW_AMOUNT_TL: "25.00", BALANCE_TL: "75.00", PREVIOUS_BALANCE_TL: "100.00", NOTE: "", TERMINALNAME: "PC 27" });
  assert.equal(map(cost)[0].amount, -2500); assert.equal(map(cost)[0].kind, "usage");
  assert.equal(map(cost)[0].title, "PC kullanımı · PC 27");
  assert.equal(map({ ...cost, RAW_AMOUNT_TL: "-25.00", PREVIOUS_BALANCE_TL: null })[0].amount, -2500);
  assert.equal(map({ ...cost, NOTE: "Hesaptan para çıkarıldı." })[0].kind, "adjustment");
  assert.equal(map({ ...cost, NOTE: "Hesaptan para çıkarıldı." })[0].amount, -2500);
  assert.equal(map(record({ NOTE: "Bonus aktarıldı." }))[0].kind, "bonus");
  assert.equal(map(record({ NOTE: "Manuel düzenleme", PREVIOUS_BALANCE_TL: null }))[0].kind, "adjustment");
});
test("native history: mobile receipt splits paid and bonus once, with native balances", () => {
  const operation = "a8544b1a-34a8-46b2-8364-0002be2d3b4e";
  const row = record({ HISTORY_ID: "5", RAW_AMOUNT_TL: "220.00", BALANCE_TL: "420.00", PREVIOUS_BALANCE_TL: "200.00",
    NOTE: `S TECH test payment ${operation}`, PAYMENT_ID: operation, PAID_KURUS: "20000", BONUS_KURUS: "2000", CREDIT_BALANCE_TL: "420.00" });
  const items = map(row);
  assert.equal(items.length, 2); assert.equal(items.reduce((n, item) => n + item.amount, 0), 22000);
  assert.equal(items[0].balanceAfter, 42000); assert.equal(items[1].balanceAfter, 40000);
  assert.notEqual(items[0].id, items[1].id);
  assert.throws(() => map({ ...row, BONUS_KURUS: "3000" }));
  assert.throws(() => map({ ...row, CREDIT_BALANCE_TL: "421.00" }));
});
test("native history: malformed records and other members fail closed", () => {
  assert.throws(() => map(record({ USERNAME: "kaan2" })));
  const invalid: PanCafeRow[] = [{ RAW_AMOUNT_TL: "bad" }, { OCCURRED_DATE: "2026-02-30" },
    { OCCURRED_TIME: "25:00:00" }, { HISTORY_ID: "wrong" }, { BALANCE_TL: null }];
  for (const change of invalid)
    assert.throws(() => map(record(change)));
});
