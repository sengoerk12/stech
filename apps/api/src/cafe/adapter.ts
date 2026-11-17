import type { Member, Wallet, Transaction, TransactionPage, Promotion } from "@stech/contracts";
import type { CafeSessionHistoryPage } from "@stech/contracts";

export class ActiveCafeSessionError extends Error {
  constructor() {
    super("PanCafe üye oturumu açık. Ödeme kaydedildi ve bakiye aktarımı bekliyor.");
  }
}

export class PanCafeCreditReviewError extends Error {
  constructor() {
    super("PanCafe bakiye ekranı doğrulanamadı. Ödenen işlem inceleme bekliyor.");
  }
}

/** The cafe remains authoritative. A retry MUST reuse operationId. */
export interface CafeSystemAdapter {
  getProfile?(userId: string): Promise<import('@stech/contracts').MemberProfile>;
  updateProfile?(userId: string, input: import('@stech/contracts').ProfileUpdateInput, requestHash: string): Promise<void>;
  authenticateCard?(cardUid: string): Promise<Member | null>;
  authenticate(identifier: string, password: string): Promise<Member | null>;
  getUser(userId: string): Promise<Member>;
  getBalance(userId: string): Promise<Wallet>;
  addBalance(
    userId: string,
    amount: number,
    bonus: number,
    operationId: string,
  ): Promise<Wallet>;
  getTransactions(userId: string): Promise<Transaction[]>;
  getTransactionPage?(userId: string, cursor?: string): Promise<TransactionPage>;
  getSessionHistory?(userId: string, cursor?: string): Promise<CafeSessionHistoryPage>;
  getAvailablePromotions(userId: string): Promise<Promotion[]>;
  getActiveSession(userId: string): Promise<null>;
  getMembershipLevel(userId: string): Promise<string>;
}
