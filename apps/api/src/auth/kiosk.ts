import { createHash, timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import type { CafeSystemAdapter } from "../cafe/adapter";
import type { PersistentAuthService } from "./persistent-service";

export interface KioskCardMap { cards: { cardHash: string; userId: string }[] }

/** Provisioned by an operator, never by a customer-facing endpoint. */
export class KioskCardAuth {
  constructor(
    deviceKey: string,
    private map: KioskCardMap,
    private cafe: CafeSystemAdapter,
    private auth: PersistentAuthService,
    secondDeviceKey?: string,
  ) {
    if (deviceKey.length < 40 || !Array.isArray(map.cards) || map.cards.some(c =>
      !/^[a-f0-9]{64}$/.test(c.cardHash) || typeof c.userId !== "string" || !c.userId.length))
      throw new Error("Invalid kiosk card provisioning");
    if (new Set(map.cards.map(c => c.cardHash)).size !== map.cards.length)
      throw new Error("Duplicate kiosk card mapping");
    this.devices = new Map([["kiosk-1", this.digest(deviceKey)]]);
    if (secondDeviceKey) this.devices.set("kiosk-2", this.digest(secondDeviceKey));
  }
  private devices: Map<string, Buffer>;
  private digest(key: string) { return createHash("sha256").update(key).digest(); }
  deviceId(key: string | string[] | undefined) {
    if (typeof key !== "string") return undefined;
    const actual = this.digest(key);
    for (const [id, expected] of this.devices) if (timingSafeEqual(actual, expected)) return id;
    return undefined;
  }
  isDevice(key: string | string[] | undefined) {
    return this.deviceId(key) !== undefined;
  }
  verifyDevice(key: string | undefined) {
    const id = this.deviceId(key);
    if (!id) throw new UnauthorizedException("Kiosk cihazı doğrulanamadı.");
    return id;
  }

  async loginWithPassword(key: string | undefined, username: string, password: string) {
    this.verifyDevice(key);
    const member = await this.cafe.authenticate(username, password);
    if (!member) throw new UnauthorizedException("Kullanıcı adı veya şifre hatalı.");
    return this.auth.kioskAccess(member.id);
  }

  async login(key: string | undefined, uid: string) {
    this.verifyDevice(key);
    const normalized = uid.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,64}$/.test(normalized)) throw new UnauthorizedException("Kart doğrulanamadı.");
    if (this.cafe.authenticateCard) {
      const member = await this.cafe.authenticateCard(normalized);
      if (!member) throw new UnauthorizedException("Kart bulunamadı veya birden fazla üyede tanımlı. Yetkiliden yardım iste.");
      return this.auth.kioskAccess(member.id);
    }
    const hash = createHash("sha256").update(normalized).digest("hex");
    const card = this.map.cards.find(c => c.cardHash === hash);
    if (!card) throw new UnauthorizedException("Bu kart tanımlı değil. S TECH yetkilisine başvur.");
    // getUser revalidates the source PanCafe installation, member ID, username and status.
    const member = await this.cafe.getUser(card.userId);
    if (member.id !== card.userId) throw new UnauthorizedException("Kart doğrulanamadı.");
    return this.auth.kioskAccess(member.id);
  }
}
