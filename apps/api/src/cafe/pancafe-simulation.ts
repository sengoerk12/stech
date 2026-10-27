import { randomUUID } from "node:crypto";
import type { Member, RegistrationInput, Transaction } from "@stech/contracts";
import type { Database } from "../database/database";
import type { CafeSystemAdapter } from "./adapter";
import { PersistentMockCafeAdapter } from "./persistent-mock";
import { MockCafeSystemAdapter } from "./mock";
import { pageTransactions } from "./transaction-page";

/** Mock checkout; destination is explicit and old test credit is never migrated. */
export class PanCafeSimulationAdapter extends PersistentMockCafeAdapter {
  private nativeDelays = new Map<string, number>();
  constructor(private store: Database, private source: CafeSystemAdapter, readonly nativeCredit = false) {
    super(store, randomUUID());
  }
  override async initialize() {
    const fixtures = new MockCafeSystemAdapter(randomUUID());
    for (const promotion of await fixtures.getAvailablePromotions("demo-member")) {
      await this.store.query(
        "INSERT INTO app_promotions(id,definition) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [promotion.id, JSON.stringify(promotion)],
      );
    }
  }
  override authenticate(identifier: string, password: string) {
    return this.source.authenticate(identifier, password);
  }
  override async register(_input: RegistrationInput): Promise<Member> {
    throw new Error("Simulation adapter cannot create identities");
  }
  override async getUser(userId: string) {
    const member = await this.source.getUser(userId);
    if (!this.nativeCredit) await this.store.query(
      "INSERT INTO demo_wallets(user_id,balance) VALUES($1,0) ON CONFLICT DO NOTHING",
      [userId],
    );
    return member;
  }
  override getBalance(userId: string) {
    return this.nativeCredit ? this.source.getBalance(userId) : super.getBalance(userId);
  }
  override delayTransfer(operationId: string, milliseconds: number) {
    if (this.nativeCredit) this.nativeDelays.set(operationId, Date.now() + milliseconds);
    else super.delayTransfer(operationId, milliseconds);
  }
  override async addBalance(userId: string, amount: number, bonus: number, operationId: string) {
    if (!this.nativeCredit) return super.addBalance(userId, amount, bonus, operationId);
    if ((this.nativeDelays.get(operationId) ?? 0) > Date.now()) throw new Error("Simulated transfer delay");
    this.nativeDelays.delete(operationId);
    return this.source.addBalance(userId, amount, bonus, operationId);
  }
  override async getTransactions(userId: string) {
    if (this.nativeCredit) {
      return this.source.getTransactions(userId);
    }
    return (await super.getTransactions(userId)).map((item) => ({
      ...item,
      title: item.kind === "bonus" ? "Temsili yükleme bonusu" : "Temsili bakiye yükleme",
    }));
  }
  async getTransactionPage(userId: string, cursor?: string) {
    return this.nativeCredit && this.source.getTransactionPage
      ? this.source.getTransactionPage(userId, cursor)
      : pageTransactions(await this.getTransactions(userId), cursor);
  }
}
