import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Member, Wallet, Transaction, Promotion } from "@stech/contracts";
import type { CafeSystemAdapter } from "./adapter";

/** Development fixture only. Never registered outside development/test. */
export class MockCafeSystemAdapter implements CafeSystemAdapter {
  private member: Member = {
    id: "demo-member",
    username: "demo",
    name: "Kaan",
    phone: "0555 000 00 00",
    email: "demo@example.com",
    joinedAt: "2023-06-12",
    level: "S TECH Üye",
  };
  private balance = 74250;
  private updatedAt = new Date().toISOString();
  private applied = new Map<
    string,
    { amount: number; bonus: number; wallet: Wallet }
  >();
  private passwordHash: Buffer;
  private transactions: Transaction[] = [
    {
      id: "t1",
      kind: "usage",
      amount: -8250,
      title: "PC kullanımı · PC 27",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      balanceAfter: 74250,
    },
    {
      id: "t2",
      kind: "bonus",
      amount: 5000,
      title: "Yükleme bonusu",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      balanceAfter: 82500,
    },
    {
      id: "t3",
      kind: "topup",
      amount: 50000,
      title: "Bakiye yükleme",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      balanceAfter: 77500,
    },
  ];
  constructor(password: string) {
    this.passwordHash = scryptSync(password, "stech-development-fixture", 64);
  }
  private authorize(userId: string) {
    if (userId !== this.member.id) throw new Error("Member not found");
  }
  async authenticate(identifier: string, password: string) {
    const valid = timingSafeEqual(
      scryptSync(password, "stech-development-fixture", 64),
      this.passwordHash,
    );
    return identifier === this.member.username && valid
      ? { ...this.member }
      : null;
  }
  async getUser(id: string) {
    this.authorize(id);
    return { ...this.member };
  }
  async getBalance(id: string): Promise<Wallet> {
    this.authorize(id);
    return {
      balance: this.balance,
      currency: "TRY",
      updatedAt: this.updatedAt,
    };
  }
  async addBalance(
    id: string,
    amount: number,
    bonus: number,
    operationId: string,
  ) {
    this.authorize(id);
    if (
      ![amount, bonus].every(Number.isSafeInteger) ||
      amount <= 0 ||
      bonus < 0
    )
      throw new Error("Invalid money");
    const previous = this.applied.get(operationId);
    if (previous) {
      if (previous.amount !== amount || previous.bonus !== bonus)
        throw new Error("Operation conflict");
      return previous.wallet;
    }
    // Synchronous mutation is atomic ONLY in this single-process development adapter.
    const createdAt = new Date().toISOString();
    this.balance += amount;
    this.transactions.unshift({
      id: randomUUID(),
      kind: "topup",
      amount,
      title: "Online bakiye yükleme",
      createdAt,
      balanceAfter: this.balance,
    });
    if (bonus) {
      this.balance += bonus;
      this.transactions.unshift({
        id: randomUUID(),
        kind: "bonus",
        amount: bonus,
        title: "Yükleme bonusu",
        createdAt,
        balanceAfter: this.balance,
      });
    }
    this.updatedAt = createdAt;
    const wallet: Wallet = {
      balance: this.balance,
      currency: "TRY",
      updatedAt: createdAt,
    };
    this.applied.set(operationId, { amount, bonus, wallet });
    return wallet;
  }
  async getTransactions(id: string) {
    this.authorize(id);
    return this.transactions.map((t) => ({ ...t }));
  }
  async getAvailablePromotions(id: string): Promise<Promotion[]> {
    this.authorize(id);
    return [
      {
        id: "welcome-bonus",
        title: "OYUNUN DAHA UZUN SÜRSÜN.",
        description: "200 TL ve üzeri yüklemelerde %10 bonus hesabında.",
        minimumAmount: 20000,
        bonusPercent: 10,
        maxBonus: 100000,
        startsAt: "2026-01-01T00:00:00Z",
        endsAt: "2027-01-01T00:00:00Z",
        terms:
          "Tek yüklemede en az 200 TL. Yükleme tutarının %10'u bonus olarak eklenir. Diğer kampanyalarla birleştirilemez. Demo kampanyasıdır.",
        accent: "orange",
      },
    ];
  }
  async getActiveSession(id: string): Promise<null> {
    this.authorize(id);
    return null;
  }
  async getMembershipLevel(id: string) {
    this.authorize(id);
    return this.member.level;
  }
}
