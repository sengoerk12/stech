import { createHash, randomBytes, randomUUID } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import type { AuthTokens } from "@stech/contracts";
import type { CafeSystemAdapter } from "../cafe/adapter";
type Session = {
  userId: string;
  family: string;
  expiresAt: number;
  revoked: boolean;
};
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
/** Opaque, short-lived access tokens. Only token hashes are retained server-side. */
export class AuthService {
  private access = new Map<string, Session>();
  private refreshTokens = new Map<string, Session>();
  constructor(private cafe: CafeSystemAdapter) {}
  async login(identifier: string, password: string) {
    const user = await this.cafe.authenticate(identifier, password);
    if (!user)
      throw new UnauthorizedException("Kullanıcı adı veya şifre hatalı.");
    return this.issue(user.id, randomUUID());
  }
  private issue(userId: string, family: string): AuthTokens {
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(48).toString("base64url");
    this.access.set(hash(accessToken), {
      userId,
      family,
      expiresAt: Date.now() + 900000,
      revoked: false,
    });
    this.refreshTokens.set(hash(refreshToken), {
      userId,
      family,
      expiresAt: Date.now() + 30 * 86400000,
      revoked: false,
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }
  refresh(token: string) {
    const session = this.refreshTokens.get(hash(token));
    if (!session)
      throw new UnauthorizedException("Oturumun sona erdi. Tekrar giriş yap.");
    if (session.revoked) {
      this.revokeFamily(session.family);
      throw new UnauthorizedException("Tekrar giriş yap.");
    }
    if (session.expiresAt < Date.now())
      throw new UnauthorizedException("Oturumun sona erdi.");
    session.revoked = true;
    return this.issue(session.userId, session.family);
  }
  user(token: string) {
    const session = this.access.get(hash(token));
    if (!session || session.revoked || session.expiresAt < Date.now())
      throw new UnauthorizedException("Oturumun sona erdi. Tekrar giriş yap.");
    return session.userId;
  }
  logout(token: string) {
    const session = this.access.get(hash(token));
    if (session) this.revokeFamily(session.family);
  }
  private revokeFamily(family: string) {
    for (const s of [...this.access.values(), ...this.refreshTokens.values()])
      if (s.family === family) s.revoked = true;
  }
}
