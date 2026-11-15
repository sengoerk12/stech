import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MysqlWallet } from "../src/cafe/mysql-wallet";

const url = process.env.STECH_MYSQL_TEST_URL;
test("MySQL wallet imports legacy paths and preserves transactional updates", { skip: !url }, async () => {
  assert.ok(url);
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Use an empty loopback test database");
  const caFile = process.env.STECH_MYSQL_TEST_CA_FILE;
  const ca = caFile ? await readFile(caFile, "utf8") : undefined;
  const wallet = await MysqlWallet.open(url, ca, true);
  const membersPath = "pancafeInstallations/test/members";
  const awardsPath = "pancafeInstallations/test/wheelBalanceAwards";
  try {
    await assert.rejects(MysqlWallet.open(url, ca), /not been completed/);
    await wallet.importOnce([
      { collection: membersPath, id: "1", data: { username: "üye", sCoinUnits: 30_000 } },
      { collection: membersPath + "/1/sCoinPlays", id: "legacy", data: { sector: 3 } },
      { collection: awardsPath, id: "due", data: { amount: 500, nextAttemptAt: 1 } },
      { collection: awardsPath, id: "future", data: { amount: 1000, nextAttemptAt: 9999 } },
    ]);
    await assert.rejects(wallet.importOnce([]), /already imported/);
    const reopened = await MysqlWallet.open(url, ca);
    try {
      const members = reopened.collection(membersPath);
      const doc = members.doc("1");
      const before = await doc.get();
      assert.equal(before.get("username"), "üye");
      assert.equal((await doc.collection("sCoinPlays").doc("legacy").get()).get("sector"), 3);
      await assert.rejects(members.firestore.runTransaction(async tx => {
        tx.set(doc, { sCoinUnits: 1 }, { merge: true });
        tx.create(doc, { sCoinUnits: 2 });
      }), /ALREADY_EXISTS/);
      assert.equal((await doc.get()).get("sCoinUnits"), 30_000);
      await Promise.all(Array.from({ length: 2 }, () => members.firestore.runTransaction(async tx => {
        const current = await tx.get(doc);
        tx.set(doc, { sCoinUnits: current.get("sCoinUnits") - 10_000 }, { merge: true });
      })));
      assert.equal((await doc.get()).get("sCoinUnits"), 10_000);
      await assert.rejects(doc.update({ sCoinUnits: 0 }, { lastUpdateTime: before.updateTime }), /FAILED_PRECONDITION/);
      const due = await reopened.collection(awardsPath).where("nextAttemptAt", "<=", 1000).orderBy("nextAttemptAt").limit(25).get();
      assert.deepEqual(due.docs.map(row => row.id), ["due"]);
      await due.docs[0].ref.delete();
      assert.equal((await due.docs[0].ref.get()).exists, false);
    } finally { await reopened.close(); }
  } finally { await wallet.close(); }
});
