import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Payment, Quote } from "@stech/contracts";
import type { Database, SqlExecutor } from "../database/database";
import type { CafeSystemAdapter } from "../cafe/adapter";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import { calculateQuote } from "./service";
import type { SCoinService } from "../cafe/s-coin";
import { OdealCheckoutRejected } from "./odeal";

interface PaymentRow {
  payment_provider: "mock" | "odeal";
  pos_device_code: string | null;
  checkout_started: boolean;
  pos_cancelled_at: Date | null;
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
    simulation: row.transfer_target === "mock" || row.payment_provider === "mock",
    creditedToCafe: row.transfer_target === "pancafe",
    id: row.id,
    amount: row.amount,
    bonus: row.bonus,
    status: row.status,
    ...(row.payment_provider === "odeal" && row.status === "pending"
      ? { awaitingTerminal: row.provider_reference !== null }
      : {}),
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
    private sCoin?: Pick<SCoinService, "enqueue">,
    private posDevice?: string,
  ) {}
  private get providerName() {
    return this.posDevice ? "odeal" : "mock";
  }
  async quote(userId: string, amount: number) {
    return calculateQuote(
      amount,
      await this.cafe.getAvailablePromotions(userId),
    );
  }
  async create(userId: string, amount: number, key: string, kioskQuote?: Quote): Promise<Payment> {
    const quote = kioskQuote ?? await this.quote(userId, amount);
    const id = randomUUID();
    const row = await this.db.transaction(async (tx) => {
      const inserted = await tx.query<PaymentRow>(
        `INSERT INTO payment_orders(id,user_id,idempotency_key,amount,bonus,promotion_id,status,transfer_target,payment_provider,pos_device_code)
        VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
        [id, userId, key, amount, quote.bonus, quote.promotionId ?? null, this.target, this.providerName, this.posDevice ?? null],
      );
      const p =
        inserted.rows[0] ??
        (
          await tx.query<PaymentRow>(
            "SELECT * FROM payment_orders WHERE user_id=$1 AND idempotency_key=$2",
            [userId, key],
          )
        ).rows[0];
      if (!p) throw new ConflictException("POS'ta önceki işlem sürüyor. Önce o işlemi tamamla veya yetkiliye başvur.");
      if (p.amount !== amount || p.transfer_target !== this.target || p.payment_provider !== this.providerName ||
          p.pos_device_code !== (this.posDevice ?? null))
        throw new ConflictException(
          "Bu işlem anahtarı farklı bir tutarla kullanılmış.",
        );
      if (inserted.rows.length) await audit(tx, p.id, "pending");
      return p;
    });
    let dispatch = row.status === "pending" && !row.provider_reference;
    if (dispatch && this.posDevice) {
      const claim = await this.db.query(
        "UPDATE payment_orders SET checkout_started=true WHERE id=$1 AND status='pending' AND NOT checkout_started RETURNING id",
        [row.id],
      );
      dispatch = claim.rows.length > 0;
    }
    if (dispatch) {
      // PaymentProvider must make repeated calls with this payment ID idempotent.
      try {
        const checkout = await this.provider.createCheckout(row.id, row.amount, userId);
        await this.db.query(
          "UPDATE payment_orders SET provider_reference=$2 WHERE id=$1 AND provider_reference IS NULL",
          [row.id, checkout.reference],
        );
      } catch (error) {
        if (!(error instanceof OdealCheckoutRejected || (this.posDevice && error instanceof BadRequestException))) {
          if (!this.posDevice) throw error;
          return this.get(userId, row.id);
        }
        await this.db.transaction(async (tx) => {
          const rejected = await tx.query(
            "UPDATE payment_orders SET status='failed' WHERE id=$1 AND status='pending' RETURNING id",
            [row.id],
          );
          if (rejected.rows.length) await audit(tx, row.id, "failed");
        });
      }
    }
    return this.get(userId, row.id);
  }
  async get(userId: string, id: string): Promise<Payment> {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      throw new NotFoundException("İşlem bulunamadı.");
    const row = (
      await this.db.query<PaymentRow>(
        "SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2 AND transfer_target=$3 AND payment_provider=$4",
        [id, userId, this.target, this.providerName],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("İşlem bulunamadı.");
    return publicPayment(row);
  }
  async pending(userId: string): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT * FROM payment_orders WHERE user_id=$1 AND transfer_target=$2 AND payment_provider=$3
        AND (status='transferring' OR (status='pending' AND (payment_provider='odeal' OR created_at>now()-interval '24 hours')))
        ORDER BY created_at DESC LIMIT 5`,
      [userId, this.target, this.providerName],
    );
    return result.rows.map(publicPayment);
  }
  async deleteOdealUnpaidBasket(
    id: string,
    deleteBasket: (id: string) => Promise<boolean>,
    expected: { userId: string } | { amount: number },
  ): Promise<void> {
    if (!this.posDevice || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      throw new NotFoundException("İşlem bulunamadı.");
    const { rows: [row] } = await this.db.query<PaymentRow>(
      "SELECT * FROM payment_orders WHERE id=$1 AND payment_provider='odeal' AND transfer_target=$2 AND pos_device_code=$3",
      [id, this.target, this.posDevice],
    );
    if (!row || ("userId" in expected && row.user_id !== expected.userId))
      throw new NotFoundException("İşlem bulunamadı.");
    if ("amount" in expected && row.amount !== expected.amount)
      throw new BadRequestException("Payment mismatch");
    if (row.status !== "pending") return;
    if (!row.provider_reference || !await deleteBasket(id)) {
      const current = await this.get(row.user_id, id);
      if (current.status === "pending")
        throw new ConflictException("Ödeal iptali henüz doğrulamadı. POS ekranını kontrol edip tekrar dene.");
      return;
    }
    await this.cancelOdealBasket(id, row.amount, false);
  }
  async accept(event: VerifiedPaymentEvent, deferTransfer = false): Promise<Payment> {
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
      if (!row || row.transfer_target !== this.target || row.payment_provider !== this.providerName ||
          (this.posDevice && (row.pos_device_code !== this.posDevice || !row.checkout_started)))
        throw new NotFoundException("İşlem bulunamadı.");
      if (row.amount !== event.amount || event.currency !== "TRY")
        throw new BadRequestException("Payment mismatch");
      await tx.query(
        `INSERT INTO payment_events(provider,event_id,fingerprint,payment_id) VALUES($4,$1,$2,$3) ON CONFLICT DO NOTHING`,
        [event.eventId, fingerprint, row.id, this.providerName],
      );
      const previous = (
        await tx.query<{ fingerprint: string }>(
          `SELECT fingerprint FROM payment_events WHERE provider=$2 AND event_id=$1`,
          [event.eventId, this.providerName],
        )
      ).rows[0];
      if (previous.fingerprint !== fingerprint)
        throw new ConflictException("Event conflict");
      if (row.status === "completed" || row.status === "failed" || row.pos_cancelled_at)
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
    if (event.status === "succeeded" && !deferTransfer)
      await this.processPayment(event.paymentId);
    return this.get(owner, event.paymentId);
  }
  async cancelOdealBasket(id: string, amount: number, paidCancellation: boolean) {
    if (!this.posDevice || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return;
    await this.db.transaction(async (tx) => {
      const row = (await tx.query<PaymentRow>(
        "SELECT * FROM payment_orders WHERE id=$1 AND payment_provider='odeal' AND transfer_target=$2 AND pos_device_code=$3 FOR UPDATE",
        [id, this.target, this.posDevice],
      )).rows[0];
      if (!row || row.pos_cancelled_at || !row.checkout_started) return;
      if (row.amount !== amount) throw new BadRequestException("Payment mismatch");
      if (!paidCancellation && row.status !== "pending") return;
      await tx.query(
        "UPDATE payment_orders SET pos_cancelled_at=now(), status=CASE WHEN status='pending' THEN 'failed' ELSE status END WHERE id=$1",
        [id],
      );
      await audit(tx, id, paidCancellation ? "odeal.cancelled_review" : "odeal.basket_cancelled");
      await tx.query(
        "UPDATE transfer_jobs SET status='reconciliation' WHERE payment_id=$1 AND status IN ('queued','retry')",
        [id],
      );
    });
  }
  async processPayment(paymentId: string): Promise<void> {
    const leaseToken = randomUUID();
    const claimed = await this.db.query<{ attempts: number }>(
      `UPDATE transfer_jobs SET status='processing',lease_token=$2,
      lease_until=now()+interval '30 seconds', attempts=attempts+1 WHERE payment_id=$1 AND
      ((status IN ('queued','retry') AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now()))
      AND EXISTS(SELECT 1 FROM payment_orders p WHERE p.id=transfer_jobs.payment_id AND p.transfer_target=$3 AND p.payment_provider=$4 AND p.status='transferring' AND p.pos_cancelled_at IS NULL) RETURNING attempts`,
      [paymentId, leaseToken, this.target, this.providerName],
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
        if (this.target === "pancafe") await this.sCoin?.enqueue(tx, row);
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
        `SELECT j.payment_id FROM transfer_jobs j JOIN payment_orders p ON p.id=j.payment_id WHERE p.transfer_target=$1 AND p.payment_provider=$2 AND p.status='transferring' AND p.pos_cancelled_at IS NULL AND ((j.status IN ('queued','retry') AND j.next_attempt_at<=now()) OR (j.status='processing' AND j.lease_until<now())) ORDER BY j.next_attempt_at LIMIT 25`,
        [this.target, this.providerName],
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
