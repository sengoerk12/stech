import type { Promotion } from "@stech/contracts";
import type { Database } from "../database/database";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type Campaign = Promotion & { active: boolean };
type Pending = { id: string; operation_id: string; payload: Campaign };
export interface CampaignCloud {
  publish(operationId: string, campaign: Campaign): Promise<void>;
  read(): Promise<Campaign[]>;
}

// Admin is the author; Firestore distributes committed versions between API instances.
// The SQL outbox survives restarts and is committed atomically with the admin edit.
export class PromotionSync {
  status: "pending" | "synced" | "error" = "pending";
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;
  constructor(private db: Database, private cloud: CampaignCloud) {}

  async syncOnce() {
    const pending = (await this.db.query<Pending>(
      "SELECT id,operation_id,payload FROM promotion_sync_outbox ORDER BY id LIMIT 100",
    )).rows;
    for (const item of pending) {
      await this.cloud.publish(item.operation_id, item.payload);
      // An admin can edit again while the request is in flight. Never drop that edit.
      await this.db.query("DELETE FROM promotion_sync_outbox WHERE id=$1 AND operation_id=$2", [item.id, item.operation_id]);
    }
    const campaigns = await this.cloud.read();
    for (const campaign of campaigns) {
      if (!validCampaign(campaign)) throw new Error("Invalid cloud campaign");
      const { active, ...definition } = campaign;
      await this.db.transaction(async tx => {
        // Same advisory lock as admin save, including when a row does not yet exist.
        await tx.query("SELECT pg_advisory_xact_lock(72389413)");
        if ((await tx.query("SELECT id FROM promotion_sync_outbox WHERE id=$1", [campaign.id])).rows.length) return;
        await tx.query(`INSERT INTO app_promotions(id,definition,active) VALUES($1,$2,$3)
          ON CONFLICT(id) DO UPDATE SET definition=EXCLUDED.definition,active=EXCLUDED.active,revision=app_promotions.revision+1
          WHERE app_promotions.definition IS DISTINCT FROM EXCLUDED.definition OR app_promotions.active IS DISTINCT FROM EXCLUDED.active`,
        [campaign.id, JSON.stringify(definition), active]);
      });
    }
    this.status = (await this.db.query("SELECT id FROM promotion_sync_outbox LIMIT 1")).rows.length ? "pending" : "synced";
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      this.running = this.syncOnce().catch(() => {
        if (this.status !== "error") console.warn("Campaign sync unavailable; saved changes remain queued.");
        this.status = "error";
      }).finally(() => {
        this.running = undefined;
        if (!this.stopped) this.timer = setTimeout(tick, 5000).unref();
      });
    };
    tick();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}

function validCampaign(p: Campaign) {
  return p && /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) && typeof p.active === "boolean"
    && typeof p.title === "string" && p.title.length >= 3 && p.title.length <= 100
    && typeof p.description === "string" && p.description.length >= 5 && p.description.length <= 500
    && typeof p.terms === "string" && p.terms.length >= 5 && p.terms.length <= 1000
    && Number.isSafeInteger(p.minimumAmount) && p.minimumAmount >= 5000 && p.minimumAmount <= 1000000
    && Number.isSafeInteger(p.bonusPercent) && p.bonusPercent >= 0 && p.bonusPercent <= 100
    && Number.isSafeInteger(p.maxBonus) && p.maxBonus >= 0 && p.maxBonus <= 100000
    && ["blue", "orange"].includes(p.accent) && Number.isFinite(Date.parse(p.startsAt))
    && Date.parse(p.endsAt) > Date.parse(p.startsAt);
}

export function firestoreCampaigns(firestore: Firestore, installationId: string): CampaignCloud {
  const installation = firestore.collection("pancafeInstallations").doc(installationId);
  const campaigns = installation.collection("promotions");
  const receipts = installation.collection("promotionSyncReceipts");
  return {
    async publish(operationId, campaign) {
      // Receipt and document are atomic. A lost response cannot replay an older
      // campaign over a newer edit made on another connected admin server.
      await firestore.runTransaction(async tx => {
        const receipt = receipts.doc(operationId);
        if ((await tx.get(receipt)).exists) return;
        tx.set(campaigns.doc(campaign.id), { ...campaign, updatedAt: FieldValue.serverTimestamp() });
        tx.create(receipt, { campaignId: campaign.id, appliedAt: FieldValue.serverTimestamp() });
      });
    },
    async read() {
      return (await campaigns.get()).docs.map(doc => {
        const { updatedAt: _updatedAt, ...campaign } = doc.data();
        if (campaign.id !== doc.id) throw new Error("Invalid cloud campaign identity");
        return campaign as Campaign;
      });
    },
  };
}

export async function activePromotions(db: Database): Promise<Promotion[]> {
  return (await db.query<{ definition: Promotion }>(
    "SELECT definition FROM app_promotions WHERE active=true AND (definition->>'startsAt')::timestamptz<=now() AND (definition->>'endsAt')::timestamptz>now() ORDER BY id",
  )).rows.map(row => row.definition);
}
