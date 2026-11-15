import type { Promotion } from "@stech/contracts";
import type { Database } from "../database/database";
import type { WalletCollection, WalletSnapshot } from "./wallet-store";

export type Campaign = Promotion & { active: boolean };
type Pending = { id: string; operation_id: string; payload: Campaign };
export interface CampaignCloud {
  publish(operationId: string, campaign: Campaign): Promise<void>;
  read(): Promise<Campaign[]>;
  watch?(next: (campaigns: Campaign[]) => void, error: (error: unknown) => void): () => void;
}

// Admin is the author; Firestore distributes committed versions between API instances.
// The SQL outbox survives restarts and is committed atomically with the admin edit.
export class PromotionSync {
  status: "pending" | "synced" | "error" = "pending";
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private importing = Promise.resolve();
  private unsubscribe?: () => void;
  private reconnect?: ReturnType<typeof setTimeout>;
  private receivedSnapshot = false;
  private listenerGeneration = 0;
  private stopped = true;
  constructor(private db: Database, private cloud: CampaignCloud) {}

  async syncOnce() {
    await this.publishPending();
    await this.importCampaigns(await this.cloud.read());
    await this.updateStatus();
  }

  private async publishPending() {
    const pending = (await this.db.query<Pending>(
      "SELECT id,operation_id,payload FROM promotion_sync_outbox ORDER BY id LIMIT 100",
    )).rows;
    for (const item of pending) {
      await this.cloud.publish(item.operation_id, item.payload);
      // An admin can edit again while the request is in flight. Never drop that edit.
      await this.db.query("DELETE FROM promotion_sync_outbox WHERE id=$1 AND operation_id=$2", [item.id, item.operation_id]);
    }
  }

  private async importCampaigns(campaigns: Campaign[]) {
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
  }

  private async updateStatus() {
    const pending = (await this.db.query("SELECT id FROM promotion_sync_outbox LIMIT 1")).rows.length;
    this.status = pending ? "pending" : "synced";
  }

  private reportError() {
    if (this.status !== "error") console.warn("Campaign sync unavailable; saved changes remain queued.");
    this.status = "error";
  }

  private listen() {
    const generation = ++this.listenerGeneration;
    const failed = () => {
      if (this.stopped || generation !== this.listenerGeneration) return;
      this.listenerGeneration++;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.receivedSnapshot = false;
      this.reportError();
      this.reconnect = setTimeout(() => this.listen(), 60_000).unref();
    };
    try {
      if (!this.cloud.watch) throw new Error("Campaign listener unavailable");
      const unsubscribe = this.cloud.watch(campaigns => {
        if (this.stopped || generation !== this.listenerGeneration) return;
        this.importing = this.importing.then(async () => {
          if (this.stopped || generation !== this.listenerGeneration) return;
          await this.importCampaigns(campaigns);
          if (this.stopped || generation !== this.listenerGeneration) return;
          this.receivedSnapshot = true;
          await this.updateStatus();
        }).catch(failed);
      }, failed);
      if (generation === this.listenerGeneration) this.unsubscribe = unsubscribe;
      else unsubscribe();
    } catch {
      failed();
    }
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.receivedSnapshot = false;
    this.status = "pending";
    this.listen();
    const tick = () => {
      this.running = this.publishPending().then(async () => {
        if (this.receivedSnapshot) await this.updateStatus();
      }).catch(() => {
        this.reportError();
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
    clearTimeout(this.reconnect);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await Promise.all([this.running, this.importing]);
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

export function walletCampaigns(campaigns: WalletCollection, receipts: WalletCollection,
  timestamp: () => unknown = () => new Date().toISOString(),
  subscribe?: (next: (docs: WalletSnapshot[]) => void, error: (error: unknown) => void) => () => void): CampaignCloud {
  function readCampaign(doc: WalletSnapshot) {
    const { updatedAt: _updatedAt, ...campaign } = doc.data() ?? {};
    if (campaign.id !== doc.id) throw new Error("Invalid cloud campaign identity");
    return campaign as Campaign;
  }
  return {
    async publish(operationId, campaign) {
      // Receipt and document are atomic. A lost response cannot replay an older
      // campaign over a newer edit made on another connected admin server.
      await campaigns.firestore.runTransaction(async tx => {
        const receipt = receipts.doc(operationId);
        if ((await tx.get(receipt)).exists) return;
        tx.set(campaigns.doc(campaign.id), { ...campaign, updatedAt: timestamp() });
        tx.create(receipt, { campaignId: campaign.id, appliedAt: timestamp() });
      });
    },
    async read() {
      return (await campaigns.get()).docs.map(readCampaign);
    },
    watch(next, error) {
      const deliver = (docs: WalletSnapshot[]) => {
        try { next(docs.map(readCampaign)); }
        catch (failure) { error(failure); }
      };
      if (subscribe) return subscribe(deliver, error);
      // MySQL has no Firestore-style listener. Read changes from the private database.
      let stopped = false;
      let last: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        try {
          const { docs } = await campaigns.get();
          if (stopped) return;
          const snapshot = docs.map(doc => [doc.id, doc.updateTime?.seconds, doc.updateTime?.nanoseconds]);
          const current = JSON.stringify(snapshot);
          if (current !== last) { last = current; deliver(docs); }
          if (!stopped) timer = setTimeout(poll, 15_000).unref();
        } catch (failure) {
          if (!stopped) error(failure);
        }
      };
      void poll();
      return () => { stopped = true; clearTimeout(timer); };
    },
  };
}

export async function activePromotions(db: Database): Promise<Promotion[]> {
  return (await db.query<{ definition: Promotion }>(
    "SELECT definition FROM app_promotions WHERE active=true AND (definition->>'startsAt')::timestamptz<=now() AND (definition->>'endsAt')::timestamptz>now() ORDER BY id",
  )).rows.map(row => row.definition);
}
