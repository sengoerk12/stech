import { createHash } from "node:crypto";
import type { PanCafeBridgeClient } from "./pancafe";
import { panCafeMoney, type PanCafeRow } from "./pancafe-reader";
import { reconcileFirebaseBalance } from "./firebase-balance";
import type { WalletCollection, WalletSnapshot } from "./wallet-store";

function text(value: string | null | undefined) {
  return value?.trim() || null;
}

function snapshot(row: PanCafeRow) {
  const memberId = Number(row.ID);
  const username = text(row.USERNAME);
  if (!/^[1-9]\d{0,9}$/.test(row.ID ?? "") || memberId > 2147483647 || !username ||
      !Object.hasOwn(row, "NATIONAL_ID") || !Object.hasOwn(row, "POSTAL_ADDRESS"))
    throw new Error("Invalid PanCafe member snapshot");

  const lastName = text(row.LASTNAME);
  // PanCafe also uses this field for card UIDs at S TECH.
  const cardId = lastName && (/^(?=[0-9a-f]*\d)[0-9a-f]{4,64}$/i.test(lastName) || /^[0-9A-F]{8,64}$/.test(lastName));
  return {
    memberId,
    username,
    firstName: text(row.NAME),
    lastName: cardId ? null : lastName,
    gsm: text(row.GSM),
    email: text(row.EMAIL),
    nationalId: text(row.NATIONAL_ID),
    address: text(row.POSTAL_ADDRESS),
    active: row.ACCSTATUS === "1",
    balanceKurus: panCafeMoney(row.BALANCE_TL),
    bonusKurus: panCafeMoney(row.BONUS_TL),
    currency: "TRY",
  };
}

export type MemberSnapshot = ReturnType<typeof snapshot>;
const pageSize = 100;

export class PanCafeFirebaseSync {
  private fingerprints = new Map<number, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;
  status: "pending" | "synced" | "error" = "pending";
  lastSuccessfulSyncAt?: string;

  constructor(
    private readPage: (after: number) => Promise<PanCafeRow[]>,
    private writePage: (members: MemberSnapshot[]) => Promise<void>,
    private reconcileEveryMember = false,
  ) {}

  async syncOnce() {
    let after = 0;
    for (;;) {
      const page = await this.readPage(after);
      if (page.length > pageSize) throw new Error("Invalid PanCafe member page");
      const changes = new Map<number, { member: MemberSnapshot; hash: string }>();
      for (const row of page) {
        const member = snapshot(row);
        if (member.memberId <= after) throw new Error("Invalid PanCafe member ordering");
        after = member.memberId;
        const hash = createHash("sha256").update(JSON.stringify(member)).digest("hex");
        if (this.reconcileEveryMember || this.fingerprints.get(member.memberId) !== hash)
          changes.set(member.memberId, { member, hash });
      }
      if (changes.size) {
        await this.writePage(Array.from(changes.values(), ({ member }) => member));
        for (const [id, { hash }] of changes) this.fingerprints.set(id, hash);
      }
      if (page.length < pageSize || (this.running && this.stopped)) return;
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      const started = Date.now();
      this.running = this.syncOnce().then(() => {
        if (this.stopped) return;
        this.status = "synced";
        this.lastSuccessfulSyncAt = new Date().toISOString();
      }, () => {
        if (this.status !== "error") console.warn("PanCafe wallet sync failed. Check the local bridge and wallet store access.");
        this.status = "error";
      }).finally(() => {
        this.running = undefined;
        if (!this.stopped) this.timer = setTimeout(tick, Math.max(1_000, 5_000 - (Date.now() - started))).unref();
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

export function createWalletMemberSync(members: WalletCollection, bridge: PanCafeBridgeClient, balanceWrite: boolean) {
  let current = new Map<string, WalletSnapshot>();
  return new PanCafeFirebaseSync(async after => {
    if (balanceWrite && after === 0)
      current = new Map((await members.get()).docs.map(doc => [doc.id, doc]));
    const rows = await bridge.request(`/firebase/members?after=${after}`);
    if (!rows) throw new Error("PanCafe member page unavailable");
    return rows;
  }, async page => {
    if (balanceWrite) {
      for (const member of page) {
        const id = String(member.memberId);
        const doc = current.get(id) ?? await members.doc(id).get();
        await reconcileFirebaseBalance(doc, member, bridge, () => new Date().toISOString());
      }
      return;
    }
    await members.firestore.runTransaction(async tx => {
      const updatedAt = new Date().toISOString();
      for (const member of page) tx.set(members.doc(String(member.memberId)), { ...member, updatedAt }, { merge: true });
    });
  }, balanceWrite);
}
