import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export interface VerifiedPaymentEvent {
  eventId: string;
  paymentId: string;
  amount: number;
  currency: "TRY";
  status: "succeeded" | "failed";
}
export interface PaymentProvider {
  createCheckout(
    paymentId: string,
    amount: number,
  ): Promise<{ reference: string; checkoutUrl?: string }>;
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
    timestamp: string,
  ): VerifiedPaymentEvent;
}
export class MockPaymentProvider implements PaymentProvider {
  private secret = randomBytes(32);
  async createCheckout(paymentId: string, _amount: number) {
    return { reference: paymentId };
  }
  sign(rawBody: Buffer, timestamp: string) {
    return createHmac("sha256", this.secret)
      .update(timestamp + ".")
      .update(rawBody)
      .digest("hex");
  }
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
    timestamp: string,
  ): VerifiedPaymentEvent {
    if (
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300000
    )
      throw new Error("Expired event");
    const expected = Buffer.from(this.sign(rawBody, timestamp), "hex");
    const actual = Buffer.from(signature, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Invalid signature");
    const event = JSON.parse(rawBody.toString()) as VerifiedPaymentEvent;
    if (
      !event.eventId ||
      !event.paymentId ||
      !Number.isSafeInteger(event.amount) ||
      event.currency !== "TRY" ||
      !["succeeded", "failed"].includes(event.status)
    )
      throw new Error("Invalid event");
    return event;
  }
}
