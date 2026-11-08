import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { MemberProfile, ProfileUpdateInput } from "@stech/contracts";
import type { CafeSystemAdapter } from "../cafe/adapter";
import type { Database } from "../database/database";

export function normalizePhone(value: string): string {
  const digits = value.replace(/[ ()+-]/g, "");
  const local =
    digits.startsWith("90") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0") && digits.length === 11
        ? digits.slice(1)
        : digits;
  if (!/^5\d{9}$/.test(local))
    throw new BadRequestException("Geçerli bir cep telefonu numarası gir.");
  return "+90" + local;
}
export function validNationalId(s: string) {
  if (s === "") return true;
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const n = Array.from(s, Number);
  return (
    ((n[0] + n[2] + n[4] + n[6] + n[8]) * 7 - n[1] - n[3] - n[5] - n[7] + 100) %
      10 ===
      n[9] && n.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === n[10]
  );
}
export class MemberProfileService {
  private key: Buffer | null;
  constructor(
    private db: Database,
    private cafe: CafeSystemAdapter,
    key?: string,
  ) {
    this.key =
      key && /^[a-f0-9]{64}$/i.test(key) ? Buffer.from(key, "hex") : null;
  }
  private requireKey() {
    if (!this.key)
      throw new ServiceUnavailableException(
        "Profil güvenlik ayarı henüz hazır değil.",
      );
    return this.key;
  }
  private encrypt(value: unknown) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.requireKey(), iv);
    const data = Buffer.concat([
      c.update(JSON.stringify(value), "utf8"),
      c.final(),
    ]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  }
  private decrypt(value: string): MemberProfile {
    const b = Buffer.from(value, "base64"),
      d = createDecipheriv("aes-256-gcm", this.requireKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"),
    );
  }
  async get(userId: string): Promise<MemberProfile> {
    this.requireKey();
    if (!this.cafe.getProfile)
      throw new ServiceUnavailableException(
        "Profil bağlantısı henüz desteklenmiyor.",
      );
    const source = await this.cafe.getProfile(userId);
    const row = (
      await this.db.query<{ encrypted_after: string }>(
        "SELECT encrypted_after FROM member_profile_changes WHERE user_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1",
        [userId],
      )
    ).rows[0];
    return {
      ...source,
      nationalId: row ? this.decrypt(row.encrypted_after).nationalId : "",
    };
  }
  async update(userId: string, input: ProfileUpdateInput) {
    this.requireKey();
    if (!this.cafe.updateProfile)
      throw new ServiceUnavailableException(
        "Profil güncelleme bağlantısı hazır değil.",
      );
    const next = {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: normalizePhone(input.phone),
      address: input.address.trim(),
      nationalId: input.nationalId.trim(),
      cardUid: input.cardUid?.trim().toUpperCase(),
    };
    if (!!next.currentPassword === !!next.cardUid)
      throw new BadRequestException(
        "Her değişiklik için mevcut şifreni gir veya üyelik kartını okut.",
      );
    if (!next.firstName || !next.lastName)
      throw new BadRequestException("Adını ve soyadını ayrı ayrı gir.");
    if (!validNationalId(next.nationalId))
      throw new BadRequestException("T.C. kimlik numarasını kontrol et.");
    const requestHash = createHmac("sha256", this.requireKey())
      .update(
        JSON.stringify([
          userId,
          next.revision,
          next.firstName,
          next.lastName,
          next.phone,
          next.address,
          next.nationalId,
          next.currentPassword ?? "",
          next.newPassword ?? "",
          ...(next.cardUid ? ["card", next.cardUid] : []),
        ]),
      )
      .digest("hex");
    let record = (
      await this.db.query<{
        request_hash: string;
        status: string;
        password_changed: boolean;
      }>(
        "SELECT request_hash,status,password_changed FROM member_profile_changes WHERE id=$1 AND user_id=$2",
        [next.operationId, userId],
      )
    ).rows[0];
    if (record && record.request_hash !== requestHash)
      throw new ConflictException(
        "Bu işlem kimliği farklı bilgiler için kullanılmış.",
      );
    if (record?.status === "completed")
      return { ok: true, passwordChanged: record.password_changed };
    if (record?.status === "rejected")
      throw new ConflictException(
        "Üye bilgilerini yenileyerek yeni bir işlem başlat.",
      );
    if (!record) {
      const before = await this.get(userId);
      if (before.revision !== next.revision)
        throw new ConflictException("Üye bilgilerin değişti. Sayfayı yenile.");
      const after = {
        ...before,
        firstName: next.firstName,
        lastName: next.lastName,
        phone: next.phone,
        address: next.address,
        nationalId: next.nationalId,
      };
      const fields: string[] = (
        ["firstName", "lastName", "phone", "address", "nationalId"] as const
      ).filter((k) => before[k] !== after[k]);
      if (next.newPassword) fields.push("password");
      await this.db.query(
        "INSERT INTO member_profile_changes(id,user_id,request_hash,encrypted_before,encrypted_after,changed_fields,status,password_changed) VALUES($1,$2,$3,$4,$5,$6,'pending',$7) ON CONFLICT DO NOTHING",
        [
          next.operationId,
          userId,
          requestHash,
          this.encrypt(before),
          this.encrypt(after),
          JSON.stringify(fields),
          !!next.newPassword,
        ],
      );
      record = (
        await this.db.query<{
          request_hash: string;
          status: string;
          password_changed: boolean;
        }>(
          "SELECT request_hash,status,password_changed FROM member_profile_changes WHERE id=$1 AND user_id=$2",
          [next.operationId, userId],
        )
      ).rows[0];
      if (!record || record.request_hash !== requestHash)
        throw new ConflictException("Profil işlem kimliği kullanılıyor.");
    }
    try {
      await this.cafe.updateProfile(userId, next, requestHash);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      )
        await this.db.query(
          "UPDATE member_profile_changes SET status='rejected' WHERE id=$1 AND status='pending'",
          [next.operationId],
        );
      throw error;
    }
    await this.db.transaction(async (tx) => {
      const done = await tx.query<{ changed_fields: string[] }>(
        "UPDATE member_profile_changes SET status='completed',completed_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING changed_fields",
        [next.operationId, userId],
      );
      if (!done.rows.length) return;
      await tx.query(
        "INSERT INTO audit_logs(id,event,resource_id,metadata) VALUES($1,'member.profile.changed',$2,$3)",
        [
          randomUUID(),
          userId,
          JSON.stringify({
            actor: userId,
            changedFields: done.rows[0].changed_fields,
            passwordChanged: !!next.newPassword,
            verificationMethod: next.cardUid ? "card" : "password",
            profileChangeId: next.operationId,
          }),
        ],
      );
      if (next.newPassword) {
        await tx.query(
          "UPDATE auth_families SET revoked=true WHERE user_id=$1",
          [userId],
        );
        await tx.query(
          "UPDATE auth_sessions SET revoked=true WHERE user_id=$1",
          [userId],
        );
      }
    });
    return { ok: true, passwordChanged: !!next.newPassword };
  }
  async history(userId: string) {
    return (
      await this.db.query(
        "SELECT id,changed_fields,password_changed,created_at,completed_at,status FROM member_profile_changes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        [userId],
      )
    ).rows;
  }
}
