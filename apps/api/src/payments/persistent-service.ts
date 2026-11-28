import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Payment, Quote } from "@stech/contracts";
import type { Database, SqlExecutor } from "../database/database";
import { ActiveCafeSessionError, PanCafeCreditReviewError, type CafeSystemAdapter } from "../cafe/adapter";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import { calculateQuote } from "./service";
import type { SCoinService } from "../cafe/s-coin";
import { OdealCheckoutRejected, type OdealPaymentProvider } from "./odeal";

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
  transfer_needs_review?: boolean;
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
    ...(row.status === "transferring" && row.transfer_needs_review ? { transferNeedsReview: true } : {}),
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

// All POS services in one API process share the PanCafe transfer lane and its durable outbox.
const transferLanes = new WeakMap<Database, Promise<void>>();

export class PersistentPaymentService {
  private timer?: ReturnType<typeof setInterval>;
  private reportTimer?: ReturnType<typeof setInterval>;
  private draining: Promise<void> | null = null;
  private reconciling?: Promise<void>;
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
        `SELECT p.*, (j.status='reconciliation') AS transfer_needs_review
         FROM payment_orders p LEFT JOIN transfer_jobs j ON j.payment_id=p.id
         WHERE p.id=$1 AND p.user_id=$2 AND p.transfer_target=$3 AND p.payment_provider=$4 AND p.pos_device_code IS NOT DISTINCT FROM $5`,
        [id, userId, this.target, this.providerName, this.posDevice ?? null],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("İşlem bulunamadı.");
    return publicPayment(row);
  }
  async pending(userId: string): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT p.*, (j.status='reconciliation') AS transfer_needs_review
        FROM payment_orders p LEFT JOIN transfer_jobs j ON j.payment_id=p.id
        WHERE p.user_id=$1 AND p.transfer_target=$2 AND p.payment_provider=$3 AND p.pos_device_code IS NOT DISTINCT FROM $4
        AND (p.status='transferring' OR (p.status='pending' AND (p.payment_provider='odeal' OR p.created_at>now()-interval '24 hours')))
        ORDER BY p.created_at DESC LIMIT 5`,
      [userId, this.target, this.providerName, this.posDevice ?? null],
    );
    return result.rows.map(publicPayment);
  }
  async retryTransfer(userId: string, paymentId: string): Promise<Payment> {
    const payment = await this.get(userId, paymentId);
    if (payment.transferNeedsReview && this.posDevice) {
      await this.processPayment(paymentId, userId);
      return this.get(userId, paymentId);
    }
    return payment;
  }
  async completeManualTransfer(paymentId: string, recordOperator: (tx: SqlExecutor) => Promise<void>) {
    if (!this.posDevice || this.target !== "pancafe") {
      throw new ConflictException("Manuel aktarım yalnızca onaylanmış PanCafe POS ödemelerinde kullanılabilir.");
    }
    const eligible = `p.id=$1 AND p.transfer_target='pancafe' AND p.payment_provider='odeal'
      AND p.status='transferring' AND p.pos_cancelled_at IS NULL
      AND EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id AND e.provider='odeal')`;
    const readyStatuses = "('queued','retry','reconciliation')";
    const conflict = () => new ConflictException("Ödeme aktarım için uygun değil veya şu anda işleniyor. Durumu yenile.");
    const { rows: [payment] } = await this.db.query<PaymentRow>(
      `SELECT p.* FROM payment_orders p WHERE ${eligible}
        AND EXISTS(SELECT 1 FROM transfer_jobs j WHERE j.payment_id=p.id AND j.status IN ${readyStatuses})`, [paymentId],
    );
    if (!payment) throw conflict();
    const { balance } = await this.cafe.getBalance(payment.user_id);
    await this.db.transaction(async tx => {
      const updated = await tx.query(
        `UPDATE transfer_jobs SET status='completed',lease_token=NULL,lease_until=NULL
          WHERE payment_id=$1 AND status IN ${readyStatuses}
          AND EXISTS(SELECT 1 FROM payment_orders p WHERE ${eligible}) RETURNING payment_id`, [paymentId],
      );
      if (!updated.rows.length) throw conflict();
      await this.finishTransfer(tx, payment, balance);
      await recordOperator(tx);
    });
    return { ok: true };
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
  async processPayment(paymentId: string, retryForUser?: string): Promise<void> {
    if (!this.posDevice) return this.runTransfer(paymentId, retryForUser);
    const previous = transferLanes.get(this.db) ?? Promise.resolve();
    const transfer = previous.then(() => this.runTransfer(paymentId, retryForUser));
    transferLanes.set(this.db, transfer.catch(() => {}));
    return transfer;
  }
  private async runTransfer(paymentId: string, retryForUser?: string): Promise<void> {
    const leaseToken = randomUUID();
    const claimed = await this.db.query<{ attempts: number }>(
      `UPDATE transfer_jobs SET status='processing',lease_token=$2,
      lease_until=now()+interval '30 seconds', attempts=attempts+1 WHERE payment_id=$1 AND
      (($5::text IS NULL AND ((status IN ('queued','retry') AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now())))
        OR ($5::text IS NOT NULL AND status='reconciliation'))
      AND EXISTS(SELECT 1 FROM payment_orders p WHERE p.id=transfer_jobs.payment_id AND p.transfer_target=$3 AND p.payment_provider=$4
        AND p.status='transferring' AND p.pos_cancelled_at IS NULL
        AND ($5::text IS NULL OR (p.user_id=$5 AND EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id AND e.provider=p.payment_provider))))
      RETURNING attempts`,
      [paymentId, leaseToken, this.target, this.providerName, retryForUser ?? null],
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
        retryForUser !== undefined,
      );
      await this.db.transaction(async (tx) => {
        const job = await tx.query(
          `UPDATE transfer_jobs SET status='completed',lease_until=NULL WHERE payment_id=$1 AND lease_token=$2 AND status='processing' RETURNING payment_id`,
          [paymentId, leaseToken],
        );
        if (!job.rows.length) return; // A newer lease owns completion.
        await this.finishTransfer(tx, row, wallet.balance);
      });
    } catch (error) {
      if (!retryForUser && error instanceof ActiveCafeSessionError) {
        await this.db.query(
          `UPDATE transfer_jobs SET status='retry',lease_until=NULL,next_attempt_at=now()+interval '5 seconds',
           attempts=GREATEST(attempts-1,0),last_failure_code='active_session',last_failure_at=now()
           WHERE payment_id=$1 AND lease_token=$2 AND status='processing'`,
          [paymentId, leaseToken],
        );
        return;
      }
      const needsReview = retryForUser !== undefined || error instanceof PanCafeCreditReviewError;
      const delay = Math.min(300000, 1000 * 2 ** Math.min(attempts - 1, 8));
      await this.db.query(
        `UPDATE transfer_jobs SET status=$3,lease_until=NULL,next_attempt_at=$4,last_failure_code=$5,last_failure_at=now()
         WHERE payment_id=$1 AND lease_token=$2 AND status='processing'`,
        [
          paymentId,
          leaseToken,
          needsReview || attempts >= 10 ? "reconciliation" : "retry",
          new Date(Date.now() + delay),
          needsReview ? "manual_review" : "transfer_unavailable",
        ],
      );
      console.warn(
        JSON.stringify({
          event: needsReview ? "payment.transfer_ui_review" : "payment.transfer_retry",
          paymentId,
          attempts,
        }),
      );
    }
  }
  private async finishTransfer(tx: SqlExecutor, payment: PaymentRow, balance: number) {
    await tx.query(
      `INSERT INTO transfer_ledger(payment_id,kind,amount,remote_reference)
        VALUES($1::uuid,'topup',$2,$1::text) ON CONFLICT DO NOTHING`,
      [payment.id, payment.amount],
    );
    if (payment.bonus) {
      await tx.query(
        `INSERT INTO transfer_ledger(payment_id,kind,amount,remote_reference)
          VALUES($1::uuid,'bonus',$2,$1::text) ON CONFLICT DO NOTHING`,
        [payment.id, payment.bonus],
      );
    }
    await tx.query("UPDATE payment_orders SET status='completed',balance_after=$2 WHERE id=$1", [payment.id, balance]);
    await audit(tx, payment.id, "completed");
    if (this.target === "pancafe") await this.sCoin?.enqueue(tx, payment);
  }
  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      const jobs = await this.db.query<{ payment_id: string }>(
        `SELECT j.payment_id FROM transfer_jobs j JOIN payment_orders p ON p.id=j.payment_id WHERE p.transfer_target=$1 AND p.payment_provider=$2 AND p.status='transferring' AND p.pos_cancelled_at IS NULL AND ((j.status IN ('queued','retry') AND j.next_attempt_at<=now()) OR (j.status='processing' AND j.lease_until<now())) ORDER BY j.next_attempt_at, p.created_at, p.id LIMIT 25`,
        [this.target, this.providerName],
      );
      for (const job of jobs.rows) await this.processPayment(job.payment_id);
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
  async reconcileOdeal(lookup: OdealPaymentProvider["findCapturedPayment"]): Promise<void> {
    if (!this.posDevice) return;
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const { rows: [order] } = await this.db.query<PaymentRow>(
        `SELECT id,amount,created_at FROM payment_orders
          WHERE payment_provider='odeal' AND transfer_target=$1 AND pos_device_code=$2
          AND status='pending' AND checkout_started AND pos_cancelled_at IS NULL
          AND created_at<=now()-interval '45 seconds'`,
        [this.target, this.posDevice],
      );
      if (!order) return;
      const paid = await lookup(order.id, order.amount, order.created_at);
      if (paid) await this.accept(paid, true);
    })().finally(() => { this.reconciling = undefined; });
    return this.reconciling;
  }
  startWorker(lookup?: OdealPaymentProvider["findCapturedPayment"], drainTransfers = true) {
    if (drainTransfers) this.timer = setInterval(() => {
      void this.drain().catch(() =>
        console.error(JSON.stringify({ event: "transfer.worker_unavailable" })),
      );
    }, 2000);
    this.timer?.unref();
    if (lookup) {
      const check = () => void this.reconcileOdeal(lookup).catch(error =>
        console.warn(JSON.stringify({ event: "odeal.report_reconciliation_failed", reason: error instanceof Error ? error.name : "unknown" })),
      );
      this.reportTimer = setInterval(check, 30_000);
      this.reportTimer.unref();
      check();
    }
  }
  async stopWorker() {
    if (this.timer) clearInterval(this.timer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    if (this.reconciling) await this.reconciling.catch(() => {});
    if (this.draining) await this.draining;
  }
}
