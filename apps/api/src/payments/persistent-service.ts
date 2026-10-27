import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Payment } from "@stech/contracts";
import type { Database, SqlExecutor } from "../database/database";
import type { CafeSystemAdapter } from "../cafe/adapter";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import { calculateQuote } from "./service";

interface PaymentRow {
  transfer_target: "mock" | "pancafe";
  id: string;
  user_id: string;
  amount: number;
  bonus: number;
  status: Payment["status"];
  created_at: Date;
  balance_after: string | number | null;
  provider_reference: string | null;
}
function publicPayment(row: PaymentRow): Payment {
  return {
    simulation: true,
    creditedToCafe: row.transfer_target === "pancafe",
    id: row.id,
    amount: row.amount,
    bonus: row.bonus,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.balance_after === null
      ? {}
      : { balanceAfter: Number(row.balance_after) }),
  };
}
async function audit(tx: SqlExecutor, id: string, status: string) {
  await tx.query(
    "INSERT INTO audit_logs(id,event,resource_id,metadata) VALUES($1,$2,$3,$4)",
    [randomUUID(), "payment.status", id, JSON.stringify({ status })],
  );
}

export class PersistentPaymentService {
  private timer?: ReturnType<typeof setInterval>;
  private draining: Promise<void> | null = null;
  constructor(
    private db: Database,
    private cafe: CafeSystemAdapter,
    private provider: PaymentProvider,
    private target: "mock" | "pancafe" = "mock",
  ) {}
  async quote(userId: string, amount: number) {
    return calculateQuote(
      amount,
      await this.cafe.getAvailablePromotions(userId),
    );
  }
  async create(userId: string, amount: number, key: string): Promise<Payment> {
    const quote = await this.quote(userId, amount);
    const id = randomUUID();
    const row = await this.db.transaction(async (tx) => {
      const inserted = await tx.query<PaymentRow>(
        `INSERT INTO payment_orders(id,user_id,idempotency_key,amount,bonus,promotion_id,status,transfer_target)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING *`,
        [id, userId, key, amount, quote.bonus, quote.promotionId ?? null, this.target],
      );
      const p =
        inserted.rows[0] ??
        (
          await tx.query<PaymentRow>(
            "SELECT * FROM payment_orders WHERE user_id=$1 AND idempotency_key=$2",
            [userId, key],
          )
        ).rows[0];
      if (p.amount !== amount || p.transfer_target !== this.target)
        throw new ConflictException(
          "Bu işlem anahtarı farklı bir tutarla kullanılmış.",
        );
      if (inserted.rows.length) await audit(tx, p.id, "pending");
      return p;
    });
    if (!row.provider_reference) {
      // PaymentProvider must make repeated calls with this payment ID idempotent.
      const checkout = await this.provider.createCheckout(row.id, row.amount);
      await this.db.query(
        "UPDATE payment_orders SET provider_reference=$2 WHERE id=$1 AND provider_reference IS NULL",
        [row.id, checkout.reference],
      );
    }
    return this.get(userId, row.id);
  }
  async get(userId: string, id: string): Promise<Payment> {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new NotFoundException("İşlem bulunamadı.");
    const row = (
      await this.db.query<PaymentRow>(
        "SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2 AND transfer_target=$3",
        [id, userId, this.target],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("İşlem bulunamadı.");
    return publicPayment(row);
  }
  async pending(userId: string): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT * FROM payment_orders WHERE user_id=$1 AND transfer_target=$2 AND (status='transferring' OR (status='pending' AND created_at>now()-interval '24 hours')) ORDER BY created_at DESC LIMIT 5`,
      [userId, this.target],
    );
    return result.rows.map(publicPayment);
  }
  async accept(event: VerifiedPaymentEvent): Promise<Payment> {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          event.paymentId,
          event.amount,
          event.currency,
          event.status,
        ]),
      )
      .digest("hex");
    const owner = await this.db.transaction(async (tx) => {
      const row = (
        await tx.query<PaymentRow>(
          "SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE",
          [event.paymentId],
        )
      ).rows[0];
      if (!row || row.transfer_target !== this.target) throw new NotFoundException("İşlem bulunamadı.");
      if (row.amount !== event.amount || event.currency !== "TRY")
        throw new BadRequestException("Payment mismatch");
      await tx.query(
        `INSERT INTO payment_events(provider,event_id,fingerprint,payment_id) VALUES('mock',$1,$2,$3) ON CONFLICT DO NOTHING`,
        [event.eventId, fingerprint, row.id],
      );
      const previous = (
        await tx.query<{ fingerprint: string }>(
          `SELECT fingerprint FROM payment_events WHERE provider='mock' AND event_id=$1`,
          [event.eventId],
        )
      ).rows[0];
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException("Event conflict");
      if (row.status === "completed" || row.status === "failed")
        return row.user_id;
      if (event.status === "failed") {
        if (row.status === "transferring")
          throw new ConflictException("Payment already captured");
        await tx.query(
          `UPDATE payment_orders SET status='failed' WHERE id=$1`,
          [row.id],
        );
        await audit(tx, row.id, "failed");
      } else {
        await tx.query(
          `UPDATE payment_orders SET status='transferring' WHERE id=$1`,
          [row.id],
        );
        await tx.query(
          "INSERT INTO transfer_jobs(payment_id) VALUES($1) ON CONFLICT DO NOTHING",
          [row.id],
        );
        if (row.status !== "transferring")
          await audit(tx, row.id, "transferring");
      }
      return row.user_id;
    });
    // The event and outbox are durable BEFORE attempting the external system.
    // A timeout never turns a paid order into a failed charge.
    if (event.status === "succeeded")
      await this.processPayment(event.paymentId);
    return this.get(owner, event.paymentId);
  }
  async processPayment(paymentId: string): Promise<void> {
    const leaseToken = randomUUID();
    const claimed = await this.db.query<{ attempts: number }>(
      `UPDATE transfer_jobs SET status='processing',lease_token=$2,
      lease_until=now()+interval '30 seconds', attempts=attempts+1 WHERE payment_id=$1 AND
      ((status IN ('queued','retry') AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now()))
      AND EXISTS(SELECT 1 FROM payment_orders p WHERE p.id=transfer_jobs.payment_id AND p.transfer_target=$3) RETURNING attempts`,
      [paymentId, leaseToken, this.target],
    );
    if (!claimed.rows.length) return;
    const attempts = claimed.rows[0].attempts;
    try {
      const row = (
        await this.db.query<PaymentRow>(
          "SELECT * FROM payment_orders WHERE id=$1",
          [paymentId],
        )
      ).rows[0];
      const wallet = await this.cafe.addBalance(
        row.user_id,
        row.amount,
        row.bonus,
        row.id,
      );
      await this.db.transaction(async (tx) => {
        const job = await tx.query(
          `UPDATE transfer_jobs SET status='completed',lease_until=NULL WHERE payment_id=$1 AND lease_token=$2 AND status='processing' RETURNING payment_id`,
          [paymentId, leaseToken],
        );
        if (!job.rows.length) return; // A newer lease owns completion.
        await tx.query(
          `INSERT INTO transfer_ledger(payment_id,kind,amount,remote_reference) VALUES($1::uuid,'topup',$2,$1::text) ON CONFLICT DO NOTHING`,
          [paymentId, row.amount],
        );
        if (row.bonus)
          await tx.query(
            `INSERT INTO transfer_ledger(payment_id,kind,amount,remote_reference) VALUES($1::uuid,'bonus',$2,$1::text) ON CONFLICT DO NOTHING`,
            [paymentId, row.bonus],
          );
        await tx.query(
          `UPDATE payment_orders SET status='completed',balance_after=$2 WHERE id=$1`,
          [paymentId, wallet.balance],
        );
        await audit(tx, paymentId, "completed");
      });
    } catch {
      const delay = Math.min(300000, 1000 * 2 ** Math.min(attempts - 1, 8));
      await this.db.query(
        `UPDATE transfer_jobs SET status=$3,lease_until=NULL,next_attempt_at=$4 WHERE payment_id=$1 AND lease_token=$2 AND status='processing'`,
        [
          paymentId,
          leaseToken,
          attempts >= 10 ? "reconciliation" : "retry",
          new Date(Date.now() + delay),
        ],
      );
      console.warn(
        JSON.stringify({
          event: "payment.transfer_retry",
          paymentId,
          attempts,
        }),
      );
    }
  }
  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      const jobs = await this.db.query<{ payment_id: string }>(
        `SELECT j.payment_id FROM transfer_jobs j JOIN payment_orders p ON p.id=j.payment_id WHERE p.transfer_target=$1 AND ((j.status IN ('queued','retry') AND j.next_attempt_at<=now()) OR (j.status='processing' AND j.lease_until<now())) ORDER BY j.next_attempt_at LIMIT 25`,
        [this.target],
      );
      for (const job of jobs.rows) await this.processPayment(job.payment_id);
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
  startWorker() {
    this.timer = setInterval(() => {
      void this.drain().catch(() =>
        console.error(JSON.stringify({ event: "transfer.worker_unavailable" })),
      );
    }, 2000);
    this.timer.unref();
  }
  async stopWorker() {
    if (this.timer) clearInterval(this.timer);
    if (this.draining) await this.draining;
  }
}
