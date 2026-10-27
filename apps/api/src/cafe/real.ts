import type { CafeSystemAdapter } from "./adapter";

/** Deliberately unimplemented: fill only after the cafe's API contract is supplied. */
export class RealCafeSystemAdapter implements CafeSystemAdapter {
  private unavailable(): never {
    throw new Error("Cafe integration is not configured");
  }
  async authenticate(): Promise<never> {
    return this.unavailable();
  }
  async getUser(): Promise<never> {
    return this.unavailable();
  }
  async getBalance(): Promise<never> {
    return this.unavailable();
  }
  async addBalance(): Promise<never> {
    return this.unavailable();
  }
  async getTransactions(): Promise<never> {
    return this.unavailable();
  }
  async getAvailablePromotions(): Promise<never> {
    return this.unavailable();
  }
  async getActiveSession(): Promise<never> {
    return this.unavailable();
  }
  async getMembershipLevel(): Promise<never> {
    return this.unavailable();
  }
}
