import { createHash } from "node:crypto";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, initializeFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { PanCafeBridgeClient } from "./pancafe";
import { panCafeMoney, type PanCafeRow } from "./pancafe-reader";
import { reconcileFirebaseBalance } from "./firebase-balance";

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
        this.status = "synced";
      }, () => {
        if (this.status !== "error") console.warn("PanCafe Firebase sync failed. Check the local bridge and Firestore access.");
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

export function createFirebaseSync(projectId: string, installationId: string, bridge: PanCafeBridgeClient, balanceWrite: boolean) {
  const app = initializeApp({ credential: applicationDefault(), projectId }, `pancafe-sync-${installationId}`);
  const firestore = initializeFirestore(app, { preferRest: true });
  const members = firestore.collection("pancafeInstallations").doc(installationId).collection("members");
  let liveDocuments: Promise<Map<string, QueryDocumentSnapshot>> | undefined;
  let unsubscribe: (() => void) | undefined;
  function watchMembers() {
    if (liveDocuments) return liveDocuments;
    const pending = new Promise<Map<string, QueryDocumentSnapshot>>((resolve, reject) => {
      const documents = new Map<string, QueryDocumentSnapshot>();
      let active = true;
      const disconnect = (error: Error) => {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
        unsubscribe?.();
        unsubscribe = undefined;
        liveDocuments = undefined;
        reject(error);
      };
      const timeout = setTimeout(() => disconnect(new Error("Firestore listener timed out")), 15_000).unref();
      try {
        const stop = members.onSnapshot(snapshot => {
          if (!active) return;
          clearTimeout(timeout);
          for (const change of snapshot.docChanges()) {
            if (change.type === "removed") documents.delete(change.doc.id);
            else documents.set(change.doc.id, change.doc);
          }
          resolve(documents);
        }, disconnect);
        unsubscribe = () => { active = false; clearTimeout(timeout); stop(); };
      } catch (error) {
        disconnect(error as Error);
      }
    });
    liveDocuments = pending.catch(error => {
      liveDocuments = undefined;
      throw error;
    });
    return liveDocuments;
  }
  const worker = new PanCafeFirebaseSync(async (after) => {
    const rows = await bridge.request(`/firebase/members?after=${after}`);
    if (!rows) throw new Error("PanCafe member page unavailable");
    return rows;
  }, async (page) => {
    if (balanceWrite) {
      const docs = await watchMembers();
      for (const member of page) {
        const id = String(member.memberId);
        const doc = docs.get(id) ?? await members.doc(id).get();
        await reconcileFirebaseBalance(doc, member, bridge);
      }
      return;
    }
    const batch = firestore.batch();
    for (const member of page)
      batch.set(members.doc(String(member.memberId)), { ...member, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }, balanceWrite);
  return {
    firestore,
    worker,
    async stop() {
      await worker.stop();
      unsubscribe?.();
      await deleteApp(app);
    },
  };
}
