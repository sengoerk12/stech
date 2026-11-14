import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";

export function odealSettings(env: NodeJS.ProcessEnv) {
  const mode = env.ODEAL_POS_ENV;
  if (!mode) return null;
  const { ODEAL_MERCHANT_KEY: merchantKey, ODEAL_SECRET_KEY: secretKey,
    ODEAL_REQUEST_KEY: requestKey, ODEAL_DEVICE_CODE: deviceCode,
    ODEAL_CITY: city, ODEAL_TOWN: town, ODEAL_BASKET_TYPE: basketType,
    ODEAL_VAT_RATE: vatRate, ODEAL_WEBHOOK_BASE_URL: webhookBaseUrl } = env;
  const webhookUrl = URL.canParse(webhookBaseUrl ?? "") ? new URL(webhookBaseUrl!) : null;
  if ((mode !== "stage" && mode !== "live") || !merchantKey || !secretKey ||
      !requestKey || requestKey.length < 32 || requestKey === secretKey || requestKey === merchantKey ||
      !deviceCode || !/^[\w-]{1,100}$/.test(deviceCode) || !city?.trim() || !town?.trim() ||
      !webhookUrl || webhookUrl.protocol !== "https:" || webhookUrl.username || webhookUrl.password ||
      webhookUrl.search || webhookUrl.hash ||
      (basketType !== "ADVANCE" && basketType !== "SIMPLE") ||
      (basketType === "SIMPLE" && (!/^\d{1,2}$/.test(vatRate ?? "") || Number(vatRate) > 99))) {
    throw new Error("Ödeal POS ayarları eksik veya geçersiz.");
  }
  return {
    mode, merchantKey, secretKey, requestKey, deviceCode, city, town, basketType,
    webhookBaseUrl: webhookUrl.href.replace(/\/$/, ""),
    vatRate: Number(vatRate),
    baseUrl: mode === "stage"
      ? "https://api.sandbox.odeal.com/integration/api/v1"
      : "https://api.odeal.com/api/v1",
  };
}

type Settings = NonNullable<ReturnType<typeof odealSettings>>;
type Customer = { name: string; firstName?: string; lastName?: string; phone?: string; email?: string; address?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest();

export class OdealPaymentProvider implements PaymentProvider {
  constructor(private settings: Settings, private customer: (userId: string) => Promise<Customer>) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      "X-ODEAL-MERCHANT-KEY": this.settings.merchantKey,
      "X-ODEAL-SECRET-KEY": this.settings.secretKey,
    };
  }

  async checkConfiguration() {
    const response = await fetch(this.settings.baseUrl + "/configuration", {
      headers: this.headers(),
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    }).catch(() => null);
    const config = response?.ok ? await response.json().catch(() => null) : null;
    const url = this.settings.webhookBaseUrl;
    if (config?.paymentSucceededUrl !== url + "/payment-succeeded" ||
        config?.paymentCancelledUrl !== url + "/payment-cancelled" ||
        config?.paymentFailedUrl !== url + "/payment-failed" ||
        config?.basketCancelledUrl !== url + "/basket-cancelled" ||
        config?.basketType !== this.settings.basketType ||
        config?.authorizationType === "BASIC" ||
        typeof config?.odealRequestKey !== "string" ||
        !timingSafeEqual(digest(config.odealRequestKey), digest(this.settings.requestKey))) {
      throw new ServiceUnavailableException("Ödeal ödeme bildirimleri henüz doğrulanamadı. Şube yetkilisine başvur.");
    }
  }

  async deleteUnpaidBasket(paymentId: string): Promise<boolean> {
    const response = await fetch(this.settings.baseUrl + "/basket/delete", {
      method: "DELETE",
      headers: { ...this.headers(), referenceCode: paymentId },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    if (!response?.ok || result?.result === false || result?.success === false ||
        (result?.code != null && Number(result.code) >= 400)) return false;
    return true;
  }

  private async prepareCheckout(userId: string) {
    if (this.settings.basketType === "SIMPLE") {
      // Ödeal's documented retail customer profile keeps PanCafe identity data out of the receipt.
      return {
        referenceCode: "NIHAI-TUKETICI",
        type: "INDIVIDUAL",
        name: "NİHAİ",
        surname: "TÜKETİCİ",
        identityNumber: "11111111111",
        city: this.settings.city,
        town: this.settings.town,
      };
    }
    const customer = await this.customer(userId);
    const parts = customer.name.trim().split(/\s+/);
    const name = customer.firstName?.trim() || parts.slice(0, -1).join(" ");
    const surname = customer.lastName?.trim() || (parts.length > 1 ? parts.at(-1) : "");
    if (!name || !surname || !/\p{L}/u.test(surname))
      throw new BadRequestException("Ödeme için üyelikte ad ve soyad bulunmalı.");
    return {
      referenceCode: userId,
      type: "INDIVIDUAL",
      name,
      surname,
      city: this.settings.city,
      town: this.settings.town,
      ...(customer.phone ? { gsmNumber: customer.phone.replace(/^\+90/, "") } : {}),
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.address ? { address: customer.address } : {}),
    };
  }

  async createCheckout(paymentId: string, amount: number, userId?: string) {
    if (!userId) throw new Error("Ödeal requires a member.");
    const customer = await this.prepareCheckout(userId);
    const total = amount / 100;
    const advance = this.settings.basketType === "ADVANCE";
    const body = {
      referenceCode: paymentId,
      externalDeviceKey: this.settings.deviceCode,
      basketType: this.settings.basketType,
      customer,
      price: { grossPrice: total },
      paymentOptions: [{ type: "CREDITCARD", amount: total }],
      ...(advance ? {} : {
        items: [{
          quantity: 1,
          product: {
            referenceCode: "STECHTOPUP",
            name: "S TECH oyun bakiyesi",
            unitCode: "C62",
            price: { grossPrice: total, vatRatio: this.settings.vatRate },
          },
        }],
      }),
    };
    const response = await fetch(this.settings.baseUrl + (advance ? "/basket/advance" : "/basket"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) : null;
    if (!response?.ok || !result || result.result === false || result.success === false) {
      const code = String(result?.code ?? "");
      console.warn("Ödeal sepet gönderimi doğrulanamadı.", {
        paymentId,
        status: response?.status,
        code: /^\d{4,5}$/.test(code) ? code : undefined,
      });
      if (response && [400, 401, 403, 422].includes(response.status) &&
          !/^(60016|60026)$/.test(code) &&
          (response.status === 401 || response.status === 403 ||
            /^(1334|2044|2092|59999|60001|60002|60003|60004|60008|60010|60017|60046)$/.test(code))) {
        throw new OdealCheckoutRejected(code);
      }
      throw new ServiceUnavailableException("POS'a gönderim doğrulanamadı. Aynı işlem yetkili tarafından kontrol edilmeli.");
    }
    return { reference: paymentId };
  }

  checkRequestKey(key: string | undefined) {
    if (!key || !timingSafeEqual(digest(key), digest(this.settings.requestKey)))
      throw new UnauthorizedException("Geçersiz Ödeal bildirimi.");
  }

  verifyWebhook(rawBody: Buffer, key: string): VerifiedPaymentEvent {
    this.checkRequestKey(key);
    let body;
    try {
      body = JSON.parse(rawBody.toString());
    } catch {
      throw new BadRequestException("Geçersiz Ödeal bildirimi.");
    }
    const paymentId = body?.BasketDetail?.BasketRefCode;
    const eventId = body?.PaymentRefCode;
    const payment = body?.PaymentDetail;
    const cents = typeof payment?.Amount === "number" ? Math.round(payment.Amount * 100) : NaN;
    if (typeof paymentId !== "string" || !uuid.test(paymentId) ||
        typeof eventId !== "string" || !eventId.trim() || eventId.length > 100 ||
        !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(payment.Amount * 100 - cents) > 0.000001 ||
        !payment.AuthCode || payment.FailReason || payment.CancelledDate ||
        !["Kredi Kartı / Banka Kartı", "Kredi Kartı", "Banka Kartı", "CREDITCARD", "TERMINAL"].includes(payment.PaymentMethod) ||
        (body.BasketDetail.ExternalDeviceKey != null && body.BasketDetail.ExternalDeviceKey !== this.settings.deviceCode)) {
      throw new BadRequestException("Ödeal ödeme bilgisi doğrulanamadı.");
    }
    return { paymentId, eventId, amount: cents, currency: "TRY", status: "succeeded" };
  }
}

export class OdealCheckoutRejected extends ServiceUnavailableException {
  constructor(code: string) {
    super("Ödeal sepeti kabul etmedi." + (/^\d{4,5}$/.test(code) ? " Hata kodu: " + code : ""));
  }
}
