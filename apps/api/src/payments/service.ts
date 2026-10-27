import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Payment, Promotion, Quote } from "@stech/contracts";
import type { CafeSystemAdapter } from "../cafe/adapter";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";

export function calculateQuote(
  amount: number,
  promotions: Promotion[],
  now = Date.now(),
): Quote {
  if (!Number.isSafeInteger(amount) || amount < 5000 || amount > 1000000)
    throw new BadRequestException(
      "50 TL ile 10.000 TL arasında bir tutar gir.",
    );
  const eligible = promotions.filter(
    (p) =>
      now >= Date.parse(p.startsAt) &&
      now < Date.parse(p.endsAt) &&
      amount >= p.minimumAmount &&
      Number.isSafeInteger(p.bonusPercent) &&
      p.bonusPercent >= 0 &&
      p.bonusPercent <= 100 &&
      Number.isSafeInteger(p.maxBonus) &&
      p.maxBonus >= 0,
  );
  const best = eligible
    .map((p) => ({
      id: p.id,
      bonus: Math.min(Math.floor((amount * p.bonusPercent) / 100), p.maxBonus),
    }))
    .sort((a, b) => b.bonus - a.bonus)[0];
  const bonus = best?.bonus ?? 0;
  return { amount, bonus, total: amount + bonus, promotionId: best?.id };
}
type Record = Payment & { userId: string; key: string; promotionId?: string };
/** In-memory orchestration for development. Production must use durable SQL/outbox repository. */
export class PaymentService {
  private payments = new Map<string, Record>();
  private keys = new Map<string, string>();
  private events = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private cafe: CafeSystemAdapter,
    private provider: PaymentProvider,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async quote(userId: string, amount: number) {
    return calculateQuote(
      amount,
      await this.cafe.getAvailablePromotions(userId),
    );
  }
  create(userId: string, amount: number, key: string) {
    return this.serial(async () => {
      const scopedKey = `${userId}:${key}`;
      const existingId = this.keys.get(scopedKey);
      if (existingId) {
        const existing = this.payments.get(existingId)!;
        if (existing.amount !== amount)
          throw new ConflictException(
            "Bu işlem anahtarı farklı bir tutarla kullanılmış.",
          );
        return this.public(existing);
      }
      const quote = await this.quote(userId, amount);
      const id = randomUUID();
      await this.provider.createCheckout(id, amount);
      const payment: Record = {
        id,
        userId,
        key,
        amount,
        bonus: quote.bonus,
        promotionId: quote.promotionId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      this.payments.set(id, payment);
      this.keys.set(scopedKey, id);
      this.audit(id, "pending");
      return this.public(payment);
    });
  }
  private public(p: Record): Payment {
    const { userId: _user, key: _key, promotionId: _promotion, ...result } = p;
    return result;
  }
  get(userId: string, id: string) {
    const p = this.payments.get(id);
    if (!p || p.userId !== userId)
      throw new NotFoundException("İşlem bulunamadı.");
    return this.public(p);
  }
  accept(event: VerifiedPaymentEvent) {
    return this.serial(async () => {
      const p = this.payments.get(event.paymentId);
      if (!p) throw new NotFoundException("İşlem bulunamadı.");
      if (event.amount !== p.amount || event.currency !== "TRY")
        throw new BadRequestException("Payment mismatch");
      const fingerprint = JSON.stringify(event);
      const seen = this.events.get(event.eventId);
      if (seen && seen !== fingerprint)
        throw new ConflictException("Event conflict");
      if (p.status === "completed" || p.status === "failed")
        return this.public(p);
      if (event.status === "failed") {
        if (p.status === "transferring")
          throw new ConflictException("Payment already captured");
        p.status = "failed";
        this.events.set(event.eventId, fingerprint);
        this.audit(p.id, p.status);
        return this.public(p);
      }
      p.status = "transferring";
      this.audit(p.id, p.status);
      // If the cafe times out AFTER applying credit, retry with the SAME id.
      // A real adapter must support idempotency or reconciliation before retries.
      const wallet = await this.cafe.addBalance(
        p.userId,
        p.amount,
        p.bonus,
        p.id,
      );
      p.status = "completed";
      p.balanceAfter = wallet.balance;
      this.events.set(event.eventId, fingerprint);
      this.audit(p.id, p.status);
      return this.public(p);
    });
  }
  private audit(paymentId: string, status: string) {
    console.info(
      JSON.stringify({
        event: "payment.status",
        paymentId,
        status,
        at: new Date().toISOString(),
      }),
    );
  }
}
