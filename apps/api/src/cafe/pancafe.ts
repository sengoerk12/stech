import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Member, RegistrationInput, Wallet, TransactionPage, CafeSessionHistoryPage } from "@stech/contracts";
import type { Database } from "../database/database";
import type { CafeSystemAdapter } from "./adapter";
import { panCafeMoney, type PanCafeRow } from "./pancafe-reader";
import { mapPanCafeHistory, panCafeTimestamp } from "./pancafe-history";

export interface PanCafeBridgeConfig {
  installationId: string;
  displayName: string;
  apiKey: string;
  port?: number;
  allowBalanceCredit?: boolean;
}
export class PanCafeBridgeClient {
  constructor(
    private config: PanCafeBridgeConfig,
    private baseUrl = `http://127.0.0.1:${config.port ?? 3002}`,
    private fetcher: typeof fetch = fetch,
  ) {
    if (
      !["http://127.0.0.1:3002", "http://127.0.0.1:3003"].includes(baseUrl) ||
      config.apiKey.length < 40 ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(config.installationId)
    )
      throw new Error("Invalid local PanCafe bridge configuration");
  }
  async request(path: string, body?: unknown): Promise<PanCafeRow[] | null> {
    let response: Response;
    try {
      response = await this.fetcher(this.baseUrl + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "PanCafe bağlantısı hazır değil. Bağlantı aracını kontrol edip tekrar dene.",
      );
    }
    if (response.status === 401 && path === "/authenticate") return null;
    if (response.status === 409)
      throw new ConflictException(
        "Bu kullanıcı adı PanCafe'de kullanılıyor. Mevcut şifrenle giriş yapabilirsin.",
      );
    if (response.status === 400)
      throw new BadRequestException(
        "PanCafe için şifre en fazla 32, e-posta 50; ad ve soyad ayrı ayrı 32 karakter olmalı. Bilgilerini kontrol et.",
      );
    if (!response.ok)
      throw new ServiceUnavailableException(
        "PanCafe işlemi tamamlanamadı. Bağlantını kontrol edip tekrar dene.",
      );
    const result: unknown = await response.json();
    const history = path.startsWith("/transactions?") || path.startsWith("/session-history?");
    if (
      !Array.isArray(result) ||
      (history ? result.length > 101 : result.length !== 1) ||
      !result.every(row => row && typeof row === "object" && !Array.isArray(row) &&
        !Object.hasOwn(row, "PASSWORD") && Object.values(row).every(value => value === null || typeof value === "string"))
    )
      throw new ServiceUnavailableException(
        "PanCafe üye bilgileri doğrulanamadı.",
      );
    return result as PanCafeRow[];
  }
}

export class PanCafeSystemAdapter implements CafeSystemAdapter {
  readonly integration: { provider: "pancafe"; name: string };
  constructor(
    private db: Database,
    private client: PanCafeBridgeClient,
    private config: PanCafeBridgeConfig,
  ) {
    this.integration = { provider: "pancafe", name: config.displayName };
  }
  async initialize() {}
  private validate(row: PanCafeRow) {
    if (
      !row.USERNAME ||
      !/^[a-zA-Z0-9_.]{1,32}$/.test(row.USERNAME) ||
      !row.ID ||
      !/^[1-9]\d{0,9}$/.test(row.ID) ||
      row.ACCSTATUS !== "1"
    )
      throw new ServiceUnavailableException("PanCafe üyeliği doğrulanamadı.");
    // Validate monetary values before issuing a mobile session.
    panCafeMoney(row.BALANCE_TL);
    return row;
  }
  private member(row: PanCafeRow, userId: string): Member {
    const joined = row.JOINED_AT;
    if (
      !joined ||
      !/^\d{4}-\d{2}-\d{2}$/.test(joined) ||
      Number.isNaN(Date.parse(joined))
    )
      throw new ServiceUnavailableException(
        "PanCafe üyelik tarihi doğrulanamadı.",
      );
    return {
      id: userId,
      username: row.USERNAME!,
      name:
        [row.NAME, row.LASTNAME].filter(Boolean).join(" ").trim() ||
        row.USERNAME!,
      phone: row.GSM || row.PHONE || "",
      email: row.EMAIL || "",
      joinedAt: joined,
      level: "",
    };
  }
  private async ensureIdentity(row: PanCafeRow): Promise<Member> {
    this.validate(row);
    const member = await this.db.transaction(async (tx) => {
      const existing = (
        await tx.query<{ user_id: string; member_id: string }>(
          "SELECT user_id,member_id FROM cafe_member_links WHERE installation_id=$1 AND member_username=$2 FOR UPDATE",
          [this.config.installationId, row.USERNAME],
        )
      ).rows[0];
      if (existing) {
        if (String(existing.member_id) !== row.ID)
          throw new ConflictException(
            "PanCafe üyeliğin değişmiş. Hesap eşleştirmesi için destek al.",
          );
        return this.member(row, existing.user_id);
      }
      const externalId = `pancafe:${this.config.installationId}:${row.USERNAME}`;
      const userId = (
        await tx.query<{ id: string }>(
          "INSERT INTO app_users(id,cafe_member_id) VALUES($1,$2) ON CONFLICT(cafe_member_id) DO UPDATE SET cafe_member_id=EXCLUDED.cafe_member_id RETURNING id",
          [randomUUID(), externalId],
        )
      ).rows[0].id;
      const link = (
        await tx.query<{ user_id: string; member_id: string }>(
          "INSERT INTO cafe_member_links(user_id,installation_id,member_id,member_username) VALUES($1,$2,$3,$4) ON CONFLICT(installation_id,member_username) DO UPDATE SET member_username=EXCLUDED.member_username RETURNING user_id,member_id",
          [userId, this.config.installationId, row.ID, row.USERNAME],
        )
      ).rows[0];
      if (String(link.member_id) !== row.ID)
        throw new ConflictException("PanCafe üye eşleştirmesi değişmiş.");
      return this.member(row, link.user_id);
    });
    return member;
  }
  async authenticate(
    identifier: string,
    password: string,
  ): Promise<Member | null> {
    const rows = await this.client.request("/authenticate", {
      identifier: identifier.trim(),
      password,
    });
    return rows ? this.ensureIdentity(rows[0]) : null;
  }
  async register(input: RegistrationInput): Promise<Member> {
    const rows = await this.client.request("/register", input);
    if (!rows)
      throw new ServiceUnavailableException("PanCafe hesabı oluşturulamadı.");
    return this.ensureIdentity(rows[0]);
  }
  private async row(userId: string) {
    const link = (
      await this.db.query<{ member_id: string; member_username: string }>(
        "SELECT member_id,member_username FROM cafe_member_links WHERE user_id=$1 AND installation_id=$2",
        [userId, this.config.installationId],
      )
    ).rows[0];
    if (!link)
      throw new ServiceUnavailableException(
        "Bu hesabın PanCafe üyeliği doğrulanmamış. PanCafe kullanıcı adın ve şifrenle tekrar giriş yap.",
      );
    const rows = await this.client.request(
      `/member?id=${encodeURIComponent(link.member_id)}&username=${encodeURIComponent(link.member_username)}`,
    );
    if (
      !rows ||
      rows[0].ID !== String(link.member_id) ||
      rows[0].USERNAME !== link.member_username
    )
      throw new ServiceUnavailableException(
        "PanCafe üye eşleştirmesi doğrulanamadı.",
      );
    return this.validate(rows[0]);
  }
  async getUser(userId: string) {
    return this.member(await this.row(userId), userId);
  }
  async getBalance(userId: string): Promise<Wallet> {
    return {
      balance: panCafeMoney((await this.row(userId)).BALANCE_TL),
      currency: "TRY",
      updatedAt: new Date().toISOString(),
    };
  }
  async getTransactions(userId: string) {
    return (await this.getTransactionPage(userId)).items;
  }
  async getTransactionPage(userId: string, cursor?: string): Promise<TransactionPage> {
    if (cursor && (!/^[1-9]\d{0,9}$/.test(cursor) || Number(cursor) > 2147483647))
      throw new BadRequestException("Geçersiz geçmiş sayfası.");
    const member = await this.row(userId);
    const rows = await this.client.request(`/transactions?id=${encodeURIComponent(member.ID!)}&username=${encodeURIComponent(member.USERNAME!)}${cursor ? `&before=${cursor}` : ""}`);
    if (!rows) throw new ServiceUnavailableException("İşlem geçmişi alınamadı.");
    try {
      let previousId = cursor ? Number(cursor) : Infinity;
      for (const row of rows) {
        const id = Number(row.HISTORY_ID);
        if (!Number.isSafeInteger(id) || id < 1 || id >= previousId || row.USERNAME !== member.USERNAME)
          throw new Error("Invalid history ordering or identity");
        previousId = id;
      }
      const page = rows.slice(0, 100);
      return { items: page.flatMap(row => mapPanCafeHistory(row, member.USERNAME!, this.config.installationId)),
        ...(rows.length > 100 ? { nextCursor: page.at(-1)!.HISTORY_ID! } : {}) };
    } catch {
      throw new ServiceUnavailableException("PanCafe işlem kayıtları doğrulanamadı. Lütfen tekrar dene.");
    }
  }
  async getAvailablePromotions(userId: string) {
    await this.row(userId);
    return [];
  }
  async getSessionHistory(userId: string, cursor?: string): Promise<CafeSessionHistoryPage> {
    if (cursor && (!/^[1-9]\d{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n))
      throw new BadRequestException("Geçersiz oturum geçmişi sayfası.");
    const member = await this.row(userId);
    const rows = await this.client.request(`/session-history?id=${member.ID}&username=${encodeURIComponent(member.USERNAME!)}${cursor ? `&before=${cursor}` : ""}`);
    if (!rows) throw new ServiceUnavailableException("Oturum geçmişi alınamadı.");
    try {
      let previous = cursor ? BigInt(cursor) : 9223372036854775808n;
      for (const row of rows) {
        if (!/^[1-9]\d{0,18}$/.test(row.SESSION_ID ?? "") || BigInt(row.SESSION_ID!) >= previous ||
            row.USERNAME !== member.USERNAME || row.MEMBER_ID !== member.ID) throw new Error("Session identity mismatch");
        previous = BigInt(row.SESSION_ID!);
      }
      return { items: rows.slice(0, 100).map(row => {
        const time = (text: string | null) => {
          const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,4})?)$/.exec(text ?? "");
          if (!match) throw new Error("Invalid session time");
          return panCafeTimestamp(match[1], match[2]);
        };
        const startedAt = time(row.STARTED_AT), endedAt = time(row.ENDED_AT);
        const duration = Number(row.DURATION_MINUTES), usageAmount = panCafeMoney(row.USAGE_AMOUNT_TL);
        if (!/^\d+$/.test(row.DURATION_MINUTES ?? "") || !Number.isSafeInteger(duration) || usageAmount < 0 || endedAt < startedAt)
          throw new Error("Invalid session usage");
        return { id: `pancafe:${this.config.installationId}:session:${row.SESSION_ID}`, terminal: row.TERMINALNAME || "Bilgisayar",
          startedAt, endedAt, durationMinutes: duration, usageAmount };
      }), ...(rows.length > 100 ? { nextCursor: rows[99].SESSION_ID! } : {}) };
    } catch { throw new ServiceUnavailableException("PanCafe oturum kayıtları doğrulanamadı."); }
  }
  async getActiveSession(userId: string): Promise<null> {
    await this.row(userId);
    return null;
  }
  async getMembershipLevel(userId: string) {
    await this.row(userId);
    return "";
  }
  async addBalance(userId: string, amount: number, bonus: number, operationId: string): Promise<Wallet> {
    if (!this.config.allowBalanceCredit)
      throw new ServiceUnavailableException("PanCafe bakiye yükleme entegrasyonu henüz etkin değil.");
    if (!Number.isSafeInteger(amount) || amount < 5000 || amount > 1000000 ||
        !Number.isSafeInteger(bonus) || bonus < 0 || bonus > 100000 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))
      throw new BadRequestException("Geçersiz bakiye yükleme bilgisi.");
    const member = await this.row(userId);
    const rows = await this.client.request("/credit", {
      memberId: Number(member.ID), username: member.USERNAME, amount, bonus, operationId,
    });
    if (!rows || rows[0].RESULT_CODE !== "ok")
      throw new ServiceUnavailableException("PanCafe bakiye aktarımı doğrulanamadı.");
    return { balance: panCafeMoney(rows[0].BALANCE_TL), currency: "TRY", updatedAt: new Date().toISOString() };
  }
  delayTransfer(): never {
    throw new ServiceUnavailableException(
      "PanCafe bağlantısında ödeme simülasyonu kullanılamaz.",
    );
  }
}
