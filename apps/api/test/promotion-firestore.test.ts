import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applicationDefault, initializeApp, deleteApp } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import { openDatabase } from "../src/database/database";
import { AdminService } from "../src/admin/service";
import type { PersistentPaymentService } from "../src/payments/persistent-service";
import { activePromotions, firestoreCampaigns, PromotionSync } from "../src/cafe/promotion-sync";

test("real Firestore: isolated admin campaign reaches a second API and preserves edits", {
  skip: !process.env.STECH_FIREBASE_SMOKE_PROJECT,
}, async () => {
  const id = `campaign-smoke-${randomUUID()}`;
  const app = initializeApp({ credential: applicationDefault(), projectId: process.env.STECH_FIREBASE_SMOKE_PROJECT }, id);
  const firestore = initializeFirestore(app, { preferRest: true });
  const author = await openDatabase(), receiver = await openDatabase();
  const actor = { id: "test", username: "test", role: "owner" as const };
  const admin = new AdminService(author, null, {} as PersistentPaymentService, { FIREBASE_SYNC_ENABLED: "true" });
  const sender = new PromotionSync(author, firestoreCampaigns(firestore, id));
  const kiosk = new PromotionSync(receiver, firestoreCampaigns(firestore, id));
  try {
    await admin.savePromotion(actor, { id: "campaign", revision: 0, title: "Eşitleme testi", description: "İzole test açıklaması",
      terms: "İzole test koşulları", minimumAmount: 20000, bonusPercent: 10, maxBonus: 5000,
      startsAt: "2020-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", active: true, accent: "blue" });
    await sender.syncOnce(); await kiosk.syncOnce();
    assert.deepEqual(await activePromotions(receiver), await activePromotions(author));
    assert.equal((await activePromotions(receiver)).length, 1);
    const saved = (await admin.promotions())[0];
    await admin.savePromotion(actor, { ...saved, title: "Güncel test", active: false });
    await sender.syncOnce(); await kiosk.syncOnce();
    assert.deepEqual(await activePromotions(receiver), []);
    const doc = await firestore.doc(`pancafeInstallations/${id}/promotions/campaign`).get();
    assert.equal(doc.get("title"), "Güncel test");
    assert.equal(doc.get("active"), false);
  } finally {
    // Only this randomly named test installation's documents are removed.
    for (const name of ["promotions", "promotionSyncReceipts"]) {
      const docs = await firestore.collection(`pancafeInstallations/${id}/${name}`).get();
      const batch = firestore.batch(); docs.forEach(doc => batch.delete(doc.ref)); await batch.commit();
    }
    await author.close(); await receiver.close(); await deleteApp(app);
  }
});
