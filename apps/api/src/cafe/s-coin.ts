import type { CollectionReference } from "firebase-admin/firestore";
import type { Database, SqlExecutor } from "../database/database";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { randomInt } from "node:crypto";

export const S_COIN_UNITS = 10000;
export const sCoinsForTopup = (paidKurus: number) => Math.floor(paidKurus / S_COIN_UNITS);
const testWheel = [
  null, { kind: "product", title: "1 Red Bull" },
  null, { kind: "playtime", title: "1 saat oyun süresi" },
  null, null, { kind: "balance", title: "10 TL oyun bakiyesi" },
  null, null, null,
] as const;

export class SCoinService {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private db: Database,
    private wallets: CollectionReference,
    private installationId: string,
    private testOnly: boolean,
    private legacyWallets?: CollectionReference,
  ) {}

  private get unitsField() { return this.testOnly ? "units" : "sCoinUnits"; }

  private validateUnits(units: unknown): number {
    if (typeof units !== "number" || !Number.isSafeInteger(units) || units < 0)
      throw new ServiceUnavailableException("S Coin bakiyesi doğrulanamadı.");
    return units;
  }

  async enqueue(tx: SqlExecutor, payment: { id: string; user_id: string; amount: number }) {
    const units = sCoinsForTopup(payment.amount) * S_COIN_UNITS;
    if (units === 0) return;
    await tx.query(
      `INSERT INTO s_coin_awards(payment_id,installation_id,member_id,units,test_only)
       SELECT $1,installation_id,member_id,$4,$5 FROM cafe_member_links WHERE user_id=$2 AND installation_id=$3
       ON CONFLICT(payment_id) DO NOTHING`,
      [payment.id, payment.user_id, this.installationId, units, this.testOnly],
    );
  }

  private async wallet(userId: string) {
    const [member] = (await this.db.query<{ member_id: string }>(
      "SELECT member_id FROM cafe_member_links WHERE user_id=$1 AND installation_id=$2",
      [userId, this.installationId],
    )).rows;
    if (!member) throw new ServiceUnavailableException("S Coin üyeliği doğrulanamadı.");
    return this.wallets.doc(String(member.member_id));
  }

  async balance(userId: string) {
    const wallet = await this.wallet(userId);
    const current = (await wallet.get()).get(this.unitsField);
    const legacy = this.legacyWallets?.doc(wallet.id);
    const units = current !== undefined || !legacy
      ? this.validateUnits(current === undefined ? 0 : current)
      : await this.wallets.firestore.runTransaction(async tx => {
        const existing = (await tx.get(wallet)).get(this.unitsField);
        if (existing !== undefined) return this.validateUnits(existing);
        const previous = await tx.get(legacy);
        const migrated = this.validateUnits(previous.exists ? previous.get("units") : 0);
        if (previous.exists) tx.set(wallet, { [this.unitsField]: migrated }, { merge: true });
        return migrated;
      });
    return { units, unitsPerCoin: S_COIN_UNITS, playableCoins: Math.floor(units / S_COIN_UNITS), testOnly: this.testOnly };
  }

  async playTestGame(userId: string, operationId: string, game = "wheel") {
    if (!this.testOnly) throw new ServiceUnavailableException("Hediye çarkı henüz hazır değil.");
    const wallet = await this.wallet(userId);
    const play = wallet.collection("wheelPlays").doc(operationId);
    const sector = randomInt(testWheel.length);
    const result = { game, sector, prize: testWheel[sector], testOnly: true };
    return this.wallets.firestore.runTransaction(async tx => {
      const previous = await tx.get(play);
      if (previous.exists) {
        const saved = previous.data() as typeof result;
        if ((saved.game ?? "wheel") !== game) throw new ConflictException("Bu işlem başka bir oyuna ait.");
        return saved;
      }
      const current = await tx.get(wallet);
      const units = current.exists ? current.get("units") : 0;
      if (!Number.isSafeInteger(units) || units < S_COIN_UNITS)
        throw new ConflictException("Oyunu başlatmak için 1 S Coin gerekiyor.");
      tx.set(wallet, { units: units - S_COIN_UNITS }, { merge: true });
      tx.create(play, result);
      return result;
    });
  }

  async drain() {
    const jobs = (await this.db.query<{ payment_id: string; member_id: string; units: string }>(
      "SELECT payment_id,member_id,units FROM s_coin_awards WHERE installation_id=$1 AND test_only=$2 AND synced_at IS NULL ORDER BY created_at LIMIT 25",
      [this.installationId, this.testOnly],
    )).rows;
    for (const job of jobs) {
      const wallet = this.wallets.doc(String(job.member_id));
      const receipt = wallet.collection(this.testOnly ? "topups" : "sCoinTopups").doc(job.payment_id);
      const legacy = this.legacyWallets?.doc(wallet.id);
      const earned = Number(job.units);
      await this.wallets.firestore.runTransaction(async tx => {
        if ((await tx.get(receipt)).exists) return;
        if (legacy && (await tx.get(legacy.collection("topups").doc(job.payment_id))).exists) return;
        const current = (await tx.get(wallet)).get(this.unitsField);
        const previous = current === undefined && legacy ? await tx.get(legacy) : undefined;
        const units = this.validateUnits(current === undefined ? (previous?.exists ? previous.get("units") : 0) : current);
        if (!Number.isSafeInteger(earned) || earned <= 0 || !Number.isSafeInteger(units + earned))
          throw new Error("Invalid S Coin balance");
        tx.set(wallet, { [this.unitsField]: units + earned }, { merge: true });
        tx.create(receipt, { units: earned });
      });
      await this.db.query("UPDATE s_coin_awards SET synced_at=now() WHERE payment_id=$1", [job.payment_id]);
    }
  }

  start() {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.drain().catch(() => {
        console.warn("S Coin sync unavailable; top-up awards remain queued.");
      }).finally(() => { this.running = undefined; });
    }, 5000).unref();
  }

  async stop() {
    clearInterval(this.timer);
    await this.running;
  }
}
