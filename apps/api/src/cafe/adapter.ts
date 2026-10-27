import type { Member, Wallet, Transaction, TransactionPage, Promotion } from "@stech/contracts";
import type { CafeSessionHistoryPage } from "@stech/contracts";

/** The cafe remains authoritative. A retry MUST reuse operationId. */
export interface CafeSystemAdapter {
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
