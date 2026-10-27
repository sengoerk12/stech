import { createHash, randomBytes, randomUUID } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import type { AuthTokens } from "@stech/contracts";
import type { Database, SqlExecutor } from "../database/database";
import type { CafeSystemAdapter } from "../cafe/adapter";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
interface SessionRow {
  user_id: string;
  family_id: string;
  revoked: boolean;
  expires_at: Date;
}
export class PersistentAuthService {
  constructor(
    private db: Database,
    private cafe: CafeSystemAdapter,
  ) {}
  async login(identifier: string, password: string) {
    const member = await this.cafe.authenticate(identifier, password);
    if (!member)
      throw new UnauthorizedException("Kullanıcı adı veya şifre hatalı.");
    return this.db.transaction((tx) => this.issue(tx, member.id, randomUUID()));
  }
  private async issue(
    tx: SqlExecutor,
    userId: string,
    family: string,
  ): Promise<AuthTokens> {
    await tx.query(
      "INSERT INTO auth_families(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [family, userId],
    );
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(48).toString("base64url");
    await tx.query(
      `INSERT INTO auth_sessions(token_hash,user_id,family_id,kind,expires_at) VALUES($1,$2,$3,'access',$4),($5,$2,$3,'refresh',$6)`,
      [
        hash(accessToken),
        userId,
        family,
        new Date(Date.now() + 900000),
        hash(refreshToken),
        new Date(Date.now() + 30 * 86400000),
      ],
    );
    return { accessToken, refreshToken, expiresIn: 900 };
  }
  async refresh(token: string): Promise<AuthTokens> {
    const result = await this.db.transaction(async (tx) => {
      const initial = (
        await tx.query<SessionRow>(
          `SELECT * FROM auth_sessions WHERE token_hash=$1 AND kind='refresh'`,
          [hash(token)],
        )
      ).rows[0];
      if (!initial) return null;
      const family = (
        await tx.query<{ revoked: boolean }>(
          "SELECT revoked FROM auth_families WHERE id=$1 FOR UPDATE",
          [initial.family_id],
        )
      ).rows[0];
      if (!family || family.revoked) return null;
      const session = (
        await tx.query<SessionRow>(
          `SELECT * FROM auth_sessions WHERE token_hash=$1 AND kind='refresh' FOR UPDATE`,
          [hash(token)],
        )
      ).rows[0];
      if (!session || new Date(session.expires_at).getTime() <= Date.now())
        return null;
      if (session.revoked) {
        await tx.query("UPDATE auth_families SET revoked=true WHERE id=$1", [
          session.family_id,
        ]);
        await tx.query(
          "UPDATE auth_sessions SET revoked=true WHERE family_id=$1",
          [session.family_id],
        );
        // Return, rather than throw: revocation must COMMIT before reporting 401.
        return null;
      }
      await tx.query(
        "UPDATE auth_sessions SET revoked=true WHERE token_hash=$1",
        [hash(token)],
      );
      return this.issue(tx, session.user_id, session.family_id);
    });
    if (!result)
      throw new UnauthorizedException("Oturumun sona erdi. Tekrar giriş yap.");
    return result;
  }
  async user(token: string): Promise<string> {
    const session = (
      await this.db.query<SessionRow>(
        `SELECT s.* FROM auth_sessions s JOIN auth_families f ON f.id=s.family_id WHERE s.token_hash=$1 AND s.kind='access' AND NOT s.revoked AND NOT f.revoked AND s.expires_at>now()`,
        [hash(token)],
      )
    ).rows[0];
    if (!session)
      throw new UnauthorizedException("Oturumun sona erdi. Tekrar giriş yap.");
    return session.user_id;
  }
  async logout(token: string) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE auth_families SET revoked=true WHERE id IN (SELECT family_id FROM auth_sessions WHERE token_hash=$1)",
        [hash(token)],
      );
      await tx.query(
        "UPDATE auth_sessions SET revoked=true WHERE family_id IN (SELECT family_id FROM auth_sessions WHERE token_hash=$1)",
        [hash(token)],
      );
    });
  }
}
