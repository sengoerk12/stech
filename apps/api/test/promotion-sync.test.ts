import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/database/database";
import { AdminService, type Admin } from "../src/admin/service";
import { PromotionSync, activePromotions, type Campaign, type CampaignCloud } from "../src/cafe/promotion-sync";
import type { PersistentPaymentService } from "../src/payments/persistent-service";

const actor: Admin = { id: "test-admin", username: "owner", role: "owner" };
const campaign: Campaign = {
  id: "weekend", title: "Hafta sonu bonusu", description: "Yüklemene yüzde on beş bonus.",
  terms: "Tek yüklemede en az 400 TL. Diğer kampanyalarla birleştirilemez.",
  minimumAmount: 40000, bonusPercent: 15, maxBonus: 20000,
  startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-01-01T00:00:00.000Z", accent: "blue", active: true,
};

test("admin campaigns survive cloud outage, reach another kiosk API intact, update and deactivate", async () => {
  const author = await openDatabase();
  const receiver = await openDatabase();
  const docs = new Map<string, Campaign>();
  const receipts = new Set<string>();
  let offline = true;
  let loseReceipt = false;
  const cloud: CampaignCloud = {
    async publish(id, payload) {
      if (offline) throw new Error("offline");
      if (!receipts.has(id)) { docs.set(payload.id, structuredClone(payload)); receipts.add(id); }
      if (loseReceipt) { loseReceipt = false; throw new Error("lost response"); }
    },
    async read() { return [...docs.values()]; },
  };
  const admin = new AdminService(author, null, {} as PersistentPaymentService, { FIREBASE_SYNC_ENABLED: "true" });
  const sender = new PromotionSync(author, cloud);
  const kiosk = new PromotionSync(receiver, cloud);
  try {
    await admin.savePromotion(actor, { ...campaign, revision: 0 });
    await assert.rejects(sender.syncOnce(), /offline/);
    assert.equal((await admin.promotions())[0].cloudSync, "pending");
    offline = false;
    loseReceipt = true;
    await assert.rejects(sender.syncOnce(), /lost response/);
    await new PromotionSync(author, cloud).syncOnce(); // restart, same operation
    assert.equal(receipts.size, 1);
    assert.equal((await admin.promotions())[0].cloudSync, "synced");
    await kiosk.syncOnce();
    const { active: _, ...expected } = campaign;
    assert.deepEqual(await activePromotions(receiver), [expected]);
    let saved = (await admin.promotions())[0];
    await admin.savePromotion(actor, { ...saved, title: "Güncel kampanya", bonusPercent: 20, accent: "orange" });
    await sender.syncOnce(); await kiosk.syncOnce();
    assert.equal((await activePromotions(receiver))[0].bonusPercent, 20);
    assert.equal((await activePromotions(receiver))[0].accent, "orange");
    saved = (await admin.promotions())[0];
    await admin.savePromotion(actor, { ...saved, active: false });
    await sender.syncOnce(); await kiosk.syncOnce();
    assert.deepEqual(await activePromotions(receiver), []);
    assert.equal(docs.get(campaign.id)?.active, false);
    saved = (await admin.promotions())[0];
    await admin.savePromotion(actor, { ...saved, active: true, endsAt: "2021-01-01T00:00:00.000Z" });
    await sender.syncOnce(); await kiosk.syncOnce();
    assert.deepEqual(await activePromotions(receiver), []);
    await assert.rejects(admin.savePromotion(actor, { ...saved, title: "Eski düzenleme" }));
    assert.equal((await author.query("SELECT id FROM promotion_sync_outbox")).rows.length, 0);
  } finally { await author.close(); await receiver.close(); }
});

test("a second edit during upload is kept; stale cloud imports cannot overwrite pending edits", async () => {
  const db = await openDatabase();
  const admin = new AdminService(db, null, {} as PersistentPaymentService, { FIREBASE_SYNC_ENABLED: "true" });
  try {
    await admin.savePromotion(actor, { ...campaign, revision: 0 });
    let editDuringUpload = true;
    const worker = new PromotionSync(db, {
      async publish() {
        if (editDuringUpload) {
          editDuringUpload = false;
          await admin.savePromotion(actor, { ...campaign, title: "Yeni başlık", revision: 1 });
        }
      },
      async read() { return [campaign]; },
    });
    await worker.syncOnce();
    assert.equal((await admin.promotions())[0].title, "Yeni başlık");
    assert.equal((await admin.promotions())[0].cloudSync, "pending");
    assert.equal(worker.status, "pending");
  } finally { await db.close(); }
});
