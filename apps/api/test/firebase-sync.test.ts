import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PanCafeFirebaseSync, type MemberSnapshot } from "../src/cafe/firebase-sync";
import { planFirebaseBalance, reconcileFirebaseBalance } from "../src/cafe/firebase-balance";
import { PanCafeBridgeClient } from "../src/cafe/pancafe";
import type { PanCafeRow } from "../src/cafe/pancafe-reader";
import { Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

const member: PanCafeRow = {
  ID: "12", USERNAME: "demo", NAME: "Deneme", LASTNAME: "00AB1234",
  GSM: "05000000000", EMAIL: "demo@example.test", NATIONAL_ID: "00000000000",
  POSTAL_ADDRESS: "Örnek adres", ACCSTATUS: "1", BALANCE_TL: "100.50", BONUS_TL: "5.25",
};

test("Firebase mirrors PanCafe balance changes, retries failed writes and skips unchanged rows", async () => {
  const row = { ...member };
  const writes: unknown[][] = [];
  let fail = true;
  const worker = new PanCafeFirebaseSync(async () => [row], async (page) => {
    if (fail) throw new Error("Firestore unavailable");
    writes.push(page);
  });
  await assert.rejects(worker.syncOnce(), /unavailable/);
  fail = false;
  await worker.syncOnce();
  await worker.syncOnce();
  row.BALANCE_TL = "150.50";
  await worker.syncOnce();
  row.BALANCE_TL = "130.50";
  await worker.syncOnce();
  assert.deepEqual(writes.map(([value]) => (value as { balanceKurus: number }).balanceKurus), [10050, 15050, 13050]);
  assert.deepEqual(writes[0][0], {
    memberId: 12, username: "demo", firstName: "Deneme", lastName: null,
    gsm: "05000000000", email: "demo@example.test", nationalId: "00000000000",
    address: "Örnek adres", active: true, balanceKurus: 10050, bonusKurus: 525, currency: "TRY",
  });
});

test("Firebase reads all pages and accepts an empty final page", async () => {
  const cursors: number[] = [];
  const sizes: number[] = [];
  const worker = new PanCafeFirebaseSync(async (after) => {
    cursors.push(after);
    return after ? [] : Array.from({ length: 100 }, (_, index) => ({ ...member, ID: String(index + 1) }));
  }, async (page) => { sizes.push(page.length); });
  await worker.syncOnce();
  assert.deepEqual(cursors, [0, 100]);
  assert.deepEqual(sizes, [100]);
});

test("PanCafe bridge response validation rejects passwords on Firebase pages", async () => {
  const client = new PanCafeBridgeClient({ installationId: "test", displayName: "Test", apiKey: "x".repeat(40) },
    undefined, async () => Response.json([{ ...member, PASSWORD: "test-only" }]));
  await assert.rejects(client.request("/firebase/members?after=0"), /doğrulanamadı/);
});

const confirmed: MemberSnapshot = {
  memberId: 12, username: "demo", firstName: "Deneme", lastName: null,
  gsm: null, email: null, nationalId: null, address: null, active: true,
  balanceKurus: 10050, bonusKurus: 525, currency: "TRY",
};
const cloudEdit = {
  ...confirmed, balanceKurus: 1000,
  balanceSync: { balanceKurus: confirmed.balanceKurus, bonusKurus: confirmed.bonusKurus, status: "synced" },
};

test("Firestore computes a delta from the confirmed baseline and validates it against the current PanCafe balance", () => {
  assert.deepEqual(planFirebaseBalance(confirmed, { ...cloudEdit, balanceSync: undefined }), { kind: "publish", status: "synced" });
  assert.deepEqual(planFirebaseBalance({ ...confirmed, balanceKurus: 8050 }, cloudEdit), { kind: "publish", status: "invalid" });
  assert.deepEqual(planFirebaseBalance(confirmed, { ...cloudEdit, balanceKurus: 500 }), { kind: "publish", status: "invalid" });
  assert.equal(planFirebaseBalance(confirmed, cloudEdit).kind, "claim");
});

test("a pending edit from before the upgrade can still be replayed", () => {
  const edit = { operationId: "4ae59bc4-d0e0-4fd5-9961-7cd7679f3544", target: 1000, expectedBalance: 10050, expectedBonus: 525 };
  const plan = planFirebaseBalance(confirmed, { ...cloudEdit, balanceSync: { ...cloudEdit.balanceSync, pending: edit } });
  assert.equal(plan.kind, "resume");
  assert.deepEqual(plan.edit, { ...edit, delta: -9050 });
});

function testDocument(initial: DocumentData) {
  let data = initial;
  let version = new Timestamp(1, 0);
  const ref = {
    async update(next: DocumentData, condition: { lastUpdateTime: Timestamp }) {
      assert.equal(condition.lastUpdateTime, version);
      data = { ...data, ...next };
      version = new Timestamp(version.seconds + 1, 0);
    },
    async get() { return currentDoc(); },
  };
  function currentDoc() {
    const observed = data;
    return { ref, updateTime: version, data: () => observed, get: (key: string) =>
      key === "balanceSync.pending.operationId" ? observed.balanceSync.pending?.operationId : observed[key] } as unknown as DocumentSnapshot;
  }
  return { currentDoc, get data() { return data; } };
}

test("Firestore retries the same PanCafe adjustment after losing the first receipt", async () => {
  const document = testDocument({ ...cloudEdit });
  const operationIds: string[] = [];
  const bridge = new PanCafeBridgeClient({ installationId: "test", displayName: "Test", apiKey: "x".repeat(40) },
    undefined, async (url, init) => {
      if (String(url).endsWith("/firebase/adjust")) {
        const edit = JSON.parse(String(init?.body));
        assert.equal(edit.delta, -9050);
        assert.equal(edit.expectedBalance, 10050);
        operationIds.push(edit.operationId);
        return operationIds.length === 1 ? new Response(null, { status: 503 }) : Response.json([{ RESULT_CODE: "ok" }]);
      }
      return Response.json([{ ...member, BALANCE_TL: "10.00" }]);
    });
  await assert.rejects(reconcileFirebaseBalance(document.currentDoc(), confirmed, bridge));
  assert.equal(document.data.balanceSync.status, "pending");
  await reconcileFirebaseBalance(document.currentDoc(), { ...confirmed, balanceKurus: 1000 }, bridge);
  assert.equal(operationIds.length, 2);
  assert.equal(operationIds[0], operationIds[1]);
  assert.equal(document.data.balanceSync.status, "applied");
  assert.equal(document.data.balanceKurus, 1000);
});

test("Firestore adds a 50 TL load to PanCafe's 99 TL after a 1 TL spend", async () => {
  const source = { ...confirmed, balanceKurus: 9900, bonusKurus: 0 };
  const document = testDocument({ ...source, balanceKurus: 15000, balanceSync: { balanceKurus: 10000, bonusKurus: 0 } });
  const bridge = new PanCafeBridgeClient({ installationId: "test", displayName: "Test", apiKey: "x".repeat(40) },
    undefined, async (url, init) => {
      if (String(url).endsWith("/firebase/adjust")) {
        const edit = JSON.parse(String(init?.body));
        assert.equal(edit.delta, 5000);
        assert.equal(edit.expectedBalance, 9900);
        return Response.json([{ RESULT_CODE: "ok" }]);
      }
      return Response.json([{ ...member, BALANCE_TL: "149.00", BONUS_TL: "0.00" }]);
    });
  await reconcileFirebaseBalance(document.currentDoc(), source, bridge);
  assert.equal(document.data.balanceKurus, 14900);
  assert.equal(document.data.balanceSync.status, "applied");
});

test("a PanCafe spend after the claim retries the original delta against the fresh balance", async () => {
  const source = { ...confirmed, balanceKurus: 10000, bonusKurus: 0 };
  const document = testDocument({ ...source, balanceKurus: 15000, balanceSync: { balanceKurus: 10000, bonusKurus: 0 } });
  const operations: string[] = [];
  const bridge = new PanCafeBridgeClient({ installationId: "test", displayName: "Test", apiKey: "x".repeat(40) },
    undefined, async (url, init) => {
      if (String(url).endsWith("/firebase/adjust")) {
        const edit = JSON.parse(String(init?.body));
        assert.equal(edit.delta, 5000);
        assert.equal(edit.expectedBalance, operations.length === 0 ? 10000 : 9900);
        operations.push(edit.operationId);
        return Response.json([{ RESULT_CODE: operations.length === 1 ? "stale" : "ok" }]);
      }
      return Response.json([{ ...member, BALANCE_TL: operations.length === 1 ? "99.00" : "149.00", BONUS_TL: "0.00" }]);
    });
  await reconcileFirebaseBalance(document.currentDoc(), source, bridge);
  assert.equal(document.data.balanceSync.status, "pending");
  assert.equal(document.data.balanceSync.pending.expectedBalance, 9900);
  await reconcileFirebaseBalance(document.currentDoc(), { ...source, balanceKurus: 9900 }, bridge);
  assert.equal(operations.length, 2);
  assert.equal(operations[0], operations[1]);
  assert.equal(document.data.balanceKurus, 14900);
  assert.equal(document.data.balanceSync.status, "applied");
});
