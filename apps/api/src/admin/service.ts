import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Database, SqlExecutor } from "../database/database";
import { PanCafeBridgeClient } from "../cafe/pancafe";
import { panCafeMoney, type PanCafeRow } from "../cafe/pancafe-reader";
import type { PersistentPaymentService } from "../payments/persistent-service";
import type { Promotion } from "@stech/contracts";
const derive = promisify(scrypt);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Role = "owner" | "operator" | "viewer";
export type Admin = { id: string; username: string; role: Role };
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new BadRequestException("Geçersiz bilgiler.");
  return input as Record<string, unknown>;
}
function text(input: unknown, min: number, max: number): string {
  if (
    typeof input !== "string" ||
    input.trim().length < min ||
    input.length > max
  )
    throw new BadRequestException(`Metin ${min}–${max} karakter olmalı.`);
  return input.trim();
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new BadRequestException("Tutar veya sayı sınırlar dışında.");
  return value;
}
function uuid(value: unknown): string {
  const result = text(value, 36, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result))
    throw new BadRequestException("Geçersiz işlem kimliği.");
  return result;
}
function date(value: unknown): string {
  const result = text(value, 10, 40);
  if (!Number.isFinite(Date.parse(result)))
    throw new BadRequestException("Geçersiz tarih.");
  return new Date(result).toISOString();
}
export async function adminAudit(
  tx: SqlExecutor,
  actor: Admin,
  event: string,
  resource: string,
  detail: unknown,
) {
  await tx.query(
    "INSERT INTO audit_logs(id,event,resource_id,metadata) VALUES($1,$2,$3,$4)",
    [
      randomUUID(),
      `admin.${event}`,
      resource,
      JSON.stringify({ actor: actor.id, username: actor.username, detail }),
    ],
  );
}
export class AdminService {
  constructor(
    private db: Database,
    private bridge: PanCafeBridgeClient | null,
    private payments: PersistentPaymentService,
    private env: NodeJS.ProcessEnv,
  ) {}
  async status() {
    return {
      setupRequired: !(
        await this.db.query("SELECT id FROM admin_accounts LIMIT 1")
      ).rows.length,
    };
  }
  async setup(input: unknown, token: string, remote: string) {
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) ||
      !this.env.ADMIN_SETUP_TOKEN ||
      !timingSafeEqual(
        Buffer.from(hash(token)),
        Buffer.from(hash(this.env.ADMIN_SETUP_TOKEN)),
      )
    )
      throw new ForbiddenException(
        "Kurulum anahtarı geçersiz veya bu bilgisayardan açılmadı.",
      );
    const data = this.credentials(input);
    const salt = randomBytes(32).toString("hex");
    const password = (
      (await derive(data.password, salt, 64)) as Buffer
    ).toString("hex");
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(72389413)");
      if ((await tx.query("SELECT id FROM admin_accounts LIMIT 1")).rows.length)
        throw new ConflictException("Yönetici zaten oluşturuldu.");
      const admin: Admin = {
        id: randomUUID(),
        username: data.username,
        role: "owner",
      };
      await tx.query(
        "INSERT INTO admin_accounts(id,username,password_hash,salt,role) VALUES($1,$2,$3,$4,'owner')",
        [admin.id, admin.username, password, salt],
      );
      await adminAudit(tx, admin, "setup", admin.id, { role: "owner" });
      return { ok: true };
    });
  }
  private credentials(input: unknown) {
    const data = object(input),
      username = text(data.username, 3, 40).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(username))
      throw new BadRequestException(
        "Kullanıcı adında harf, rakam, nokta ve alt çizgi kullan.",
      );
    if (
      typeof data.password !== "string" ||
      data.password.length < 12 ||
      data.password.length > 128
    )
      throw new BadRequestException(
        "Yönetici şifresi en az 12 karakter olmalı.",
      );
    return { username, password: data.password };
  }
  async login(input: unknown) {
    const data = object(input),
      username = text(data.username, 1, 40).toLowerCase();
    if (
      typeof data.password !== "string" ||
      data.password.length < 1 ||
      data.password.length > 128
    )
      throw new UnauthorizedException("Yönetici adı veya şifre hatalı.");
    const password = data.password;
    const row = (
      await this.db.query<
        Admin & { salt: string; password_hash: string; active: boolean }
      >("SELECT * FROM admin_accounts WHERE username=$1", [username])
    ).rows[0];
    const candidate = (await derive(
      password,
      row?.salt ?? "missing-admin-salt",
      64,
    )) as Buffer;
    if (
      !row ||
      !row.active ||
      !timingSafeEqual(candidate, Buffer.from(row.password_hash, "hex"))
    )
      throw new UnauthorizedException("Yönetici adı veya şifre hatalı.");
    const token = randomBytes(48).toString("base64url");
    await this.db.query(
      "INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [hash(token), row.id],
    );
    await adminAudit(this.db, row, "login", row.id, {});
    return {
      token,
      admin: { id: row.id, username: row.username, role: row.role },
    };
  }
  async authorize(
    header: string | undefined,
    write = false,
    owner = false,
  ): Promise<Admin> {
    if (!header?.startsWith("Bearer "))
      throw new UnauthorizedException("Yönetici girişi gerekli.");
    const row = (
      await this.db.query<Admin>(
        "SELECT a.id,a.username,a.role FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=true",
        [hash(header.slice(7))],
      )
    ).rows[0];
    if (!row) throw new UnauthorizedException("Yönetici oturumu sona erdi.");
    if ((write && row.role === "viewer") || (owner && row.role !== "owner"))
      throw new ForbiddenException("Bu işlem için yetkin yok.");
    return row;
  }
  async logout(header: string) {
    await this.db.query("DELETE FROM admin_sessions WHERE token_hash=$1", [
      hash(header.slice(7)),
    ]);
    return { ok: true };
  }
  async changePassword(actor: Admin, input: unknown) {
    const d = object(input),
      password = typeof d.password === "string" ? d.password : "";
    if (
      password.length < 12 ||
      password.length > 128 ||
      typeof d.currentPassword !== "string" ||
      d.currentPassword.length > 128
    )
      throw new BadRequestException("Yeni şifre en az 12 karakter olmalı.");
    const row = (
      await this.db.query<{ password_hash: string; salt: string }>(
        "SELECT password_hash,salt FROM admin_accounts WHERE id=$1",
        [actor.id],
      )
    ).rows[0];
    const candidate = (await derive(d.currentPassword, row.salt, 64)) as Buffer;
    if (!timingSafeEqual(candidate, Buffer.from(row.password_hash, "hex")))
      throw new BadRequestException("Mevcut şifre yanlış.");
    const salt = randomBytes(32).toString("hex"),
      encoded = ((await derive(password, salt, 64)) as Buffer).toString("hex");
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE admin_accounts SET password_hash=$2,salt=$3 WHERE id=$1",
        [actor.id, encoded, salt],
      );
      await tx.query("DELETE FROM admin_sessions WHERE admin_id=$1", [
        actor.id,
      ]);
      await adminAudit(tx, actor, "password.changed", actor.id, {});
    });
    return { ok: true };
  }
  async accounts() {
    return (
      await this.db.query(
        "SELECT id,username,role,active,created_at FROM admin_accounts ORDER BY created_at",
      )
    ).rows;
  }
  async createAccount(actor: Admin, input: unknown) {
    const data = this.credentials(input),
      role = object(input).role;
    if (!["operator", "viewer"].includes(String(role)))
      throw new BadRequestException("Operatör veya izleyici rolü seç.");
    const salt = randomBytes(32).toString("hex"),
      password = ((await derive(data.password, salt, 64)) as Buffer).toString(
        "hex",
      ),
      id = randomUUID();
    return this.db.transaction(async (tx) => {
      const created = await tx.query(
        "INSERT INTO admin_accounts(id,username,password_hash,salt,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO NOTHING RETURNING id",
        [id, data.username, password, salt, role],
      );
      if (!created.rows.length)
        throw new ConflictException("Bu yönetici adı kullanılıyor.");
      await adminAudit(tx, actor, "account.create", id, {
        username: data.username,
        role,
      });
      return { ok: true };
    });
  }
  async toggleAccount(actor: Admin, id: string, input: unknown) {
    uuid(id);
    const active = object(input).active;
    if (typeof active !== "boolean")
      throw new BadRequestException("Geçersiz durum.");
    return this.db.transaction(async (tx) => {
      const result = await tx.query(
        "UPDATE admin_accounts SET active=$2 WHERE id=$1 AND role<>'owner' RETURNING id",
        [id, active],
      );
      if (!result.rows.length)
        throw new BadRequestException(
          "Kurucu hesap kapatılamaz veya hesap bulunamadı.",
        );
      await tx.query("DELETE FROM admin_sessions WHERE admin_id=$1", [id]);
      await adminAudit(tx, actor, "account.status", id, { active });
      return { ok: true };
    });
  }
  async overview() {
    const summary = (
      await this.db.query(
        "SELECT count(*)::int AS payments, count(*) FILTER(WHERE status='completed')::int AS completed, count(*) FILTER(WHERE status='transferring')::int AS waiting, count(*) FILTER(WHERE status='failed')::int AS failed, COALESCE(sum(amount) FILTER(WHERE status='completed'),0)::text AS amount, COALESCE(sum(bonus) FILTER(WHERE status='completed'),0)::text AS bonus FROM payment_orders WHERE transfer_target=$1",
        [this.bridge ? "pancafe" : "mock"],
      )
    ).rows[0];
    let connected = false,
      balanceAdjustment = false;
    try {
      if (this.bridge) {
        const caps = await this.bridge.request("/capabilities");
        await this.bridge.request("/admin/members?after=0&search=");
        connected = true;
        balanceAdjustment = caps?.[0]?.ADMIN_ADJUSTMENTS === "true";
      }
    } catch {}
    return {
      summary,
      connected,
      cafe: this.bridge ? "PanCafe" : "Mock",
      paymentProvider: "simulation",
      pushDelivery: false,
      refunds: false,
      activeSessions: false,
      balanceAdjustment,
      timeZone: "Europe/Istanbul",
    };
  }
  private source() {
    if (!this.bridge)
      throw new ServiceUnavailableException(
        "Bu işlem için PanCafe bağlantısı gerekli.",
      );
    return this.bridge;
  }
  private member(row: PanCafeRow) {
    return {
      id: Number(row.ID),
      username: row.USERNAME,
      name: [row.NAME, row.LASTNAME].filter(Boolean).join(" "),
      phone: row.GSM || row.PHONE || "",
      email: row.EMAIL || "",
      balance: panCafeMoney(row.BALANCE_TL),
      bonus: panCafeMoney(row.BONUS_TL),
      active: row.ACCSTATUS === "1",
      joinedAt: row.JOINED_AT,
    };
  }
  async members(search = "", after = "0") {
    if (
      !/^[a-zA-Z0-9_.]{0,32}$/.test(search) ||
      !/^\d{1,10}$/.test(after) ||
      Number(after) > 2147483647
    )
      throw new BadRequestException("Kullanıcı adıyla ara.");
    const rows =
      (await this.source().request(
        `/admin/members?search=${encodeURIComponent(search)}&after=${after}`,
      )) ?? [];
    return {
      items: rows.slice(0, 100).map((row) => this.member(row)),
      nextCursor: rows.length > 100 ? rows[99].ID : null,
    };
  }
  async memberDetail(id: string, username: string) {
    if (!/^[1-9]\d{0,9}$/.test(id) || !/^[a-zA-Z0-9_.]{1,32}$/.test(username))
      throw new BadRequestException("Geçersiz üye.");
    const rows = await this.source().request(
      `/member?id=${id}&username=${encodeURIComponent(username)}`,
    );
    if (!rows?.[0] || rows[0].ID !== id || rows[0].USERNAME !== username)
      throw new NotFoundException("Üye bulunamadı.");
    const history = await this.source().request(
      `/transactions?id=${id}&username=${encodeURIComponent(username)}`,
    );
    return { member: this.member(rows[0]), history: history ?? [] };
  }
  async adjust(actor: Admin, input: unknown) {
    const d = object(input),
      id = uuid(d.operationId),
      memberId = integer(d.memberId, 1, 2147483647),
      username = text(d.username, 1, 32);
    if (!/^[a-zA-Z0-9_.]+$/.test(username))
      throw new BadRequestException("Geçersiz kullanıcı adı.");
    const delta = integer(d.delta, -1000000, 1000000),
      bonusDelta = integer(d.bonusDelta, -1000000, 1000000),
      expectedBalance = integer(d.expectedBalance, 0, 100000000),
      expectedBonus = integer(d.expectedBonus, 0, 100000000),
      reason = text(d.reason, 5, 160);
    if (
      !delta ||
      (bonusDelta !== 0 && bonusDelta !== delta) ||
      expectedBalance + delta < 0 ||
      expectedBonus + bonusDelta < 0 ||
      expectedBalance + delta < expectedBonus + bonusDelta
    )
      throw new BadRequestException(
        "Yetersiz bakiye veya bonus. Para ve bonus düzenlemelerini ayrı yap.",
      );
    if (expectedBalance + delta > 100000000 || expectedBonus > expectedBalance)
      throw new BadRequestException("Geçersiz bakiye sınırı.");
    const request = {
      memberId,
      username,
      delta,
      bonusDelta,
      expectedBalance,
      expectedBonus,
      reason,
      operationId: id,
    };
    const row = await this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO admin_adjustments(id,admin_id,member_id,username,delta,bonus_delta,expected_balance,expected_bonus,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') ON CONFLICT DO NOTHING",
        [
          id,
          actor.id,
          memberId,
          username,
          delta,
          bonusDelta,
          expectedBalance,
          expectedBonus,
          reason,
        ],
      );
      const old = (
        await tx.query<Record<string, unknown>>(
          "SELECT * FROM admin_adjustments WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        old.admin_id !== actor.id ||
        old.member_id !== memberId ||
        old.username !== username ||
        Number(old.delta) !== delta ||
        Number(old.bonus_delta) !== bonusDelta ||
        Number(old.expected_balance) !== expectedBalance ||
        Number(old.expected_bonus) !== expectedBonus ||
        old.reason !== reason
      )
        throw new ConflictException(
          "Bu işlem kimliği farklı bir düzenlemeye ait.",
        );
      return old;
    });
    if (row.status === "completed")
      return { status: "completed", balance: Number(row.balance_after) };
    if (row.status === "rejected")
      throw new ConflictException(
        "Bu düzenleme reddedildi. Bakiyeyi yenileyip yeni işlem oluştur.",
      );
    const result = (await this.source().request("/admin/adjust", request))?.[0];
    if (!result)
      throw new ServiceUnavailableException(
        "Sonuç doğrulanamadı. Aynı işlemi yeniden kontrol et.",
      );
    if (result.RESULT_CODE !== "ok") {
      await this.db.transaction(async (tx) => {
        const changed = await tx.query(
          "UPDATE admin_adjustments SET status='rejected' WHERE id=$1 AND status='pending' RETURNING id",
          [id],
        );
        if (changed.rows.length)
          await adminAudit(tx, actor, "balance.rejected", id, {
            ...request,
            result: result.RESULT_CODE,
          });
      });
      throw new ConflictException(
        "PanCafe bakiyesi değişti veya işlem uygulanamadı. Üyeyi yeniden açıp güncel bakiye ile dene.",
      );
    }
    const balance = panCafeMoney(result.BALANCE_TL);
    await this.db.transaction(async (tx) => {
      const changed = await tx.query(
        "UPDATE admin_adjustments SET status='completed',balance_after=$2 WHERE id=$1 AND status='pending' RETURNING id",
        [id, balance],
      );
      if (changed.rows.length)
        await adminAudit(tx, actor, "balance.completed", id, {
          ...request,
          balanceAfter: balance,
        });
    });
    return { status: "completed", balance };
  }
  async adjustments() {
    return (
      await this.db.query(
        "SELECT j.*,a.username AS administrator FROM admin_adjustments j JOIN admin_accounts a ON a.id=j.admin_id ORDER BY j.created_at DESC LIMIT 100",
      )
    ).rows;
  }
  async promotions() {
    return (
      await this.db.query<{
        definition: Promotion;
        active: boolean;
        revision: number;
      }>("SELECT definition,active,revision FROM app_promotions ORDER BY id")
    ).rows.map((r) => ({
      ...r.definition,
      active: r.active,
      revision: r.revision,
    }));
  }
  async savePromotion(actor: Admin, input: unknown) {
    const d = object(input),
      id = text(d.id, 1, 80);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      typeof d.active !== "boolean" ||
      !["blue", "orange"].includes(String(d.accent))
    )
      throw new BadRequestException("Kampanya bilgileri geçersiz.");
    const revision = integer(d.revision, 0, 1000000);
    const definition: Promotion = {
      id,
      title: text(d.title, 3, 100),
      description: text(d.description, 5, 500),
      terms: text(d.terms, 5, 1000),
      minimumAmount: integer(d.minimumAmount, 5000, 1000000),
      bonusPercent: integer(d.bonusPercent, 0, 100),
      maxBonus: integer(d.maxBonus, 0, 100000),
      startsAt: date(d.startsAt),
      endsAt: date(d.endsAt),
      accent: d.accent as "blue" | "orange",
    };
    if (definition.endsAt <= definition.startsAt)
      throw new BadRequestException("Bitiş tarihi başlangıçtan sonra olmalı.");
    return this.db.transaction(async (tx) => {
      const result =
        revision === 0
          ? await tx.query(
              "INSERT INTO app_promotions(id,definition,active) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
              [id, JSON.stringify(definition), d.active],
            )
          : await tx.query(
              "UPDATE app_promotions SET definition=$2,active=$3,revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING id",
              [id, JSON.stringify(definition), d.active, revision],
            );
      if (!result.rows.length)
        throw new ConflictException(
          "Kampanya başka bir işlemde değişti. Listeyi yenile.",
        );
      await adminAudit(tx, actor, "promotion.save", id, {
        ...definition,
        active: d.active,
        revision: revision + 1,
      });
      return { ok: true };
    });
  }
  async paymentList(status = "", before = "") {
    if (
      status &&
      !["pending", "transferring", "completed", "failed"].includes(status)
    )
      throw new BadRequestException("Geçersiz durum.");
    const until = before ? date(before) : "2100-01-01T00:00:00Z";
    return (
      await this.db.query(
        "SELECT p.id,p.user_id,p.amount,p.bonus,p.status,p.transfer_target,p.created_at,p.balance_after,l.member_username AS username,j.status AS transfer_status,j.attempts FROM payment_orders p LEFT JOIN cafe_member_links l ON l.user_id=p.user_id LEFT JOIN transfer_jobs j ON j.payment_id=p.id WHERE ($1='' OR p.status=$1) AND p.created_at<$2 AND p.transfer_target=$3 ORDER BY p.created_at DESC LIMIT 100",
        [status, until, this.bridge ? "pancafe" : "mock"],
      )
    ).rows;
  }
  async retryPayment(actor: Admin, id: string) {
    uuid(id);
    const result = await this.db.transaction(async (tx) => {
      const claimed = await tx.query(
        "UPDATE transfer_jobs SET status='retry',next_attempt_at=now() WHERE payment_id=$1 AND status IN ('retry','reconciliation') AND EXISTS(SELECT 1 FROM payment_orders p WHERE p.id=$1 AND p.status='transferring' AND p.transfer_target=$2) RETURNING payment_id",
        [id, this.bridge ? "pancafe" : "mock"],
      );
      if (!claimed.rows.length)
        throw new ConflictException("Bu ödeme yeniden aktarıma uygun değil.");
      await adminAudit(tx, actor, "payment.retry", id, {});
      return { ok: true };
    });
    await this.payments.processPayment(id);
    return result;
  }
  async audit(before = "") {
    return (
      await this.db.query(
        "SELECT id,event,resource_id,metadata,created_at FROM audit_logs WHERE created_at<$1 ORDER BY created_at DESC LIMIT 100",
        [before ? date(before) : "2100-01-01T00:00:00Z"],
      )
    ).rows;
  }
  async content(
    kind: string,
  ): Promise<(Record<string, unknown> & { id: string; updatedAt: Date })[]> {
    this.contentKind(kind);
    return (
      await this.db.query<{
        id: string;
        definition: Record<string, unknown>;
        updated_at: Date;
      }>(
        "SELECT id,definition,updated_at FROM admin_content WHERE kind=$1 ORDER BY updated_at DESC",
        [kind],
      )
    ).rows.map((r) => ({ ...r.definition, id: r.id, updatedAt: r.updated_at }));
  }
  private contentKind(kind: string) {
    if (
      ![
        "announcements",
        "notification-plans",
        "membership-levels",
        "settings",
        "refund-requests",
      ].includes(kind)
    )
      throw new NotFoundException("Bölüm bulunamadı.");
  }
  async saveContent(actor: Admin, kind: string, input: unknown) {
    this.contentKind(kind);
    const d = object(input),
      id = uuid(d.id);
    let definition: Record<string, unknown>;
    if (kind === "announcements") {
      if (typeof d.active !== "boolean")
        throw new BadRequestException("Durum seç.");
      definition = {
        title: text(d.title, 3, 100),
        body: text(d.body, 5, 1000),
        startsAt: date(d.startsAt),
        endsAt: date(d.endsAt),
        active: d.active,
      };
      if (String(definition.endsAt) <= String(definition.startsAt))
        throw new BadRequestException("Tarih aralığı geçersiz.");
    } else if (kind === "notification-plans") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.time)))
        throw new BadRequestException("Saat geçersiz.");
      definition = {
        title: text(d.title, 3, 100),
        body: text(d.body, 5, 500),
        time: d.time,
        timeZone: "Europe/Istanbul",
        status: "draft",
        delivery: "not_configured",
        audience: "marketing_opt_in",
      };
    } else if (kind === "membership-levels") {
      definition = {
        name: text(d.name, 2, 40),
        benefits: text(d.benefits, 5, 1000),
        status: "draft",
        integration: "not_configured",
      };
    } else if (kind === "settings") {
      if (actor.role !== "owner")
        throw new ForbiddenException("Bu ayar için kurucu yetkisi gerekli.");
      if (typeof d.topupEnabled !== "boolean")
        throw new BadRequestException("Durum seç.");
      definition = {
        topupEnabled: d.topupEnabled,
        supportText: text(d.supportText, 5, 500),
      };
    } else {
      const paymentId = uuid(d.paymentId),
        reason = text(d.reason, 5, 500);
      if (
        !(
          await this.db.query(
            "SELECT id FROM payment_orders WHERE id=$1 AND status='completed' AND transfer_target=$2",
            [paymentId, this.bridge ? "pancafe" : "mock"],
          )
        ).rows.length
      )
        throw new BadRequestException("Tamamlanmış ödeme seç.");
      definition = {
        paymentId,
        reason,
        status: "pending_provider",
        note: "İade gerçekleştirilmedi. Gerçek ödeme sağlayıcısı henüz bağlı değil.",
      };
    }
    return this.db.transaction(async (tx) => {
      if (kind === "settings")
        await tx.query("DELETE FROM admin_content WHERE kind='settings'");
      await tx.query(
        "INSERT INTO admin_content(kind,id,definition) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET definition=$3,updated_at=now()",
        [kind, id, JSON.stringify(definition)],
      );
      await adminAudit(tx, actor, `${kind}.save`, id, definition);
      return { ok: true };
    });
  }
  async topupEnabled() {
    const row = (await this.content("settings"))[0];
    return row?.topupEnabled !== false;
  }
  async publicSettings() {
    const row = (await this.content("settings"))[0];
    return {
      supportText: String(
        row?.supportText ??
          "Hesap ve şifre işlemleri için S TECH yetkilisiyle görüşebilirsin.",
      ),
    };
  }
  async announcements() {
    const now = new Date().toISOString();
    return (await this.content("announcements"))
      .filter(
        (r) =>
          r.active === true &&
          String(r.startsAt) <= now &&
          String(r.endsAt) > now,
      )
      .map((r) => ({ id: r.id, title: String(r.title), body: String(r.body) }));
  }
}
