import type { Database } from "../database/database";
import type { PersistentPaymentService } from "../payments/persistent-service";
import type { OdealPaymentProvider } from "../payments/odeal";

type Delivery = { id: string; kind: string; basket_ref: string; provider_ref: string; device: string; amount_kurus: number };

export class HostedAdminSync {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private nextSnapshot = 0;
  private errored = false;

  constructor(
    private url: URL,
    private key: string,
    private db: Database,
    private overview: () => Promise<unknown>,
    private relay?: { payments: PersistentPaymentService; provider: OdealPaymentProvider; device: string },
  ) {}

  private async request(op: string, body: unknown) {
    const endpoint = new URL("bridge.php", this.url);
    endpoint.searchParams.set("op", op);
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(7_000),
      headers: { "Content-Type": "application/json", "X-STech-Cloud-Bridge": this.key },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Hosted admin HTTP ${response.status}`);
    return response.json();
  }

  private async deliver(event: Delivery) {
    const relay = this.relay!;
    const amount = Number(event.amount_kurus);
    if (event.device !== relay.device || !Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid hosted payment");
    if (event.kind === "payment-succeeded") {
      await relay.payments.accept({ paymentId: event.basket_ref, eventId: event.provider_ref, amount, currency: "TRY", status: "succeeded" }, true);
    } else if (event.kind === "payment-failed") {
      await relay.payments.deleteOdealUnpaidBasket(event.basket_ref, id => relay.provider.deleteUnpaidBasket(id), { amount });
    } else if (event.kind === "basket-cancelled" || event.kind === "payment-cancelled") {
      await relay.payments.cancelOdealBasket(event.basket_ref, amount, event.kind === "payment-cancelled");
    } else throw new Error("Unknown hosted payment event");
  }

  async syncOnce() {
    if (this.relay) {
      const { events } = await this.request("pull", {}) as { events: Delivery[] };
      for (const event of events) {
        let delivered = false;
        try { await this.deliver(event); delivered = true; }
        catch { /* The server retains the event and delays its next attempt. */ }
        await this.request("ack", { id: event.id, delivered });
      }
    }
    if (Date.now() < this.nextSnapshot) return;
    const data = await this.db.query(`
      SELECT p.id,p.user_id,p.amount,p.bonus,p.status,p.transfer_target,p.payment_provider,p.pos_device_code,
        to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
        p.pos_cancelled_at,m.member_username AS username,p.balance_after,
        j.status AS transfer_status,j.attempts,j.last_failure_code,j.last_failure_at,
        (SELECT min(a.created_at) FROM audit_logs a WHERE a.resource_id=p.id::text AND a.event='payment.status'
          AND a.metadata->>'status'='transferring') AS captured_at,
        l.created_at AS credited_at,b.created_at AS bonus_at,
        EXISTS(SELECT 1 FROM audit_logs a WHERE a.resource_id=p.id::text AND a.event='admin.payment.manual_transfer') AS completed_manually
      FROM payment_orders p LEFT JOIN cafe_member_links m ON m.user_id=p.user_id
      LEFT JOIN transfer_jobs j ON j.payment_id=p.id
      LEFT JOIN transfer_ledger l ON l.payment_id=p.id AND l.kind='topup'
      LEFT JOIN transfer_ledger b ON b.payment_id=p.id AND b.kind='bonus'
      WHERE p.transfer_target='pancafe' AND p.payment_provider='odeal'
      ORDER BY p.created_at DESC,p.id DESC`);
    const overview = await this.overview() as Record<string, unknown>;
    await this.request("push", { ...overview, version: 1, payments: data.rows });
    this.nextSnapshot = Date.now() + 30_000;
  }

  start() {
    if (this.timer) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.syncOnce().then(() => { this.errored = false; }, () => {
        if (!this.errored) console.warn("Hosted admin synchronization unavailable.");
        this.errored = true;
      }).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(tick, 5000).unref();
    tick();
  }

  async stop() { clearInterval(this.timer); this.timer = undefined; await this.running; }
}
