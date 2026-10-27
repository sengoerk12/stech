import { randomUUID, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ConflictException } from "@nestjs/common";
import type {
  Wallet,
  Transaction,
  Promotion,
  Member,
  RegistrationInput,
} from "@stech/contracts";
import { MockCafeSystemAdapter } from "./mock";
import type { Database } from "../database/database";
const derive = promisify(scrypt);
interface MemberRow {
  user_id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
  password_hash: string;
  salt: string;
  joined_at: Date;
}
function memberFromRow(row: MemberRow): Member {
  return {
    id: row.user_id,
    username: row.username,
    name: row.name,
    phone: row.phone,
    email: row.email,
    joinedAt: new Date(row.joined_at).toISOString(),
    level: "",
  };
}

/** Persistent simulation of the EXTERNAL cafe. Never enabled in production. */
export class PersistentMockCafeAdapter extends MockCafeSystemAdapter {
  async register(input: RegistrationInput): Promise<Member> {
    const username = input.username.trim().toLowerCase();
    if (username === "demo")
      throw new ConflictException(
        "Bu kullanıcı adı kullanılıyor. Başka bir ad seç.",
      );
    const salt = randomBytes(32).toString("hex");
    const passwordHash = (
      (await derive(input.password, salt, 64)) as Buffer
    ).toString("hex");
    try {
      return await this.db.transaction(async (tx) => {
        const id = randomUUID();
        await tx.query("INSERT INTO app_users(id,cafe_member_id) VALUES($1,$1)", [id]);
        const { rows } = await tx.query<MemberRow>(
          "INSERT INTO demo_members(user_id,username,name,phone,email,password_hash,salt) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            id,
            username,
            input.name.trim(),
            input.phone?.trim() ?? "",
            input.email?.trim() ?? "",
            passwordHash,
            salt,
          ],
        );
        await tx.query(
          "INSERT INTO demo_wallets(user_id,balance) VALUES($1,0)",
          [id],
        );
        return memberFromRow(rows[0]);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictException(
          "Bu kullanıcı adı kullanılıyor. Başka bir ad seç.",
        );
      throw error;
    }
  }
  override async authenticate(
    identifier: string,
    password: string,
  ): Promise<Member | null> {
    const username = identifier.trim().toLowerCase();
    if (username === "demo") return super.authenticate(username, password);
    const row = (
      await this.db.query<MemberRow>(
        "SELECT * FROM demo_members WHERE username=$1",
        [username],
      )
    ).rows[0];
    const candidate = (await derive(
      password,
      row?.salt ?? "stech-unknown-member",
      64,
    )) as Buffer;
    if (
      !row ||
      !timingSafeEqual(candidate, Buffer.from(row.password_hash, "hex"))
    )
      return null;
    return memberFromRow(row);
  }
  override async getUser(userId: string): Promise<Member> {
    if (userId === "demo-member") return super.getUser(userId);
    const row = (
      await this.db.query<MemberRow>(
        "SELECT * FROM demo_members WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    if (!row) throw new Error("Member not found");
    return memberFromRow(row);
  }
  override async getMembershipLevel(userId: string) {
    return (await this.getUser(userId)).level;
  }
  override async getActiveSession(userId: string) {
    await this.getUser(userId);
    return null;
  }
  private delayed = new Map<string, number>();
  delayTransfer(operationId: string, milliseconds: number) {
    this.delayed.set(operationId, Date.now() + milliseconds);
  }
  constructor(
    private db: Database,
    password: string,
  ) {
    super(password);
  }
  async initialize() {
    const member = await super.getUser("demo-member");
    const transactions = await super.getTransactions(member.id);
    const promotions = await super.getAvailablePromotions(member.id);
    await this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO app_users(id, cafe_member_id) VALUES($1,$1) ON CONFLICT DO NOTHING",
        [member.id],
      );
      const created = await tx.query(
        "INSERT INTO demo_wallets(user_id,balance) VALUES($1,74250) ON CONFLICT DO NOTHING RETURNING user_id",
        [member.id],
      );
      if (created.rows.length)
        for (const item of transactions)
          await tx.query(
            "INSERT INTO demo_wallet_transactions(id,user_id,kind,amount,title,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              item.id,
              member.id,
              item.kind,
              item.amount,
              item.title,
              item.balanceAfter,
              item.createdAt,
            ],
          );
      for (const promotion of promotions)
        await tx.query(
          "INSERT INTO app_promotions(id,definition) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [promotion.id, JSON.stringify(promotion)],
        );
    });
  }
  override async getBalance(userId: string): Promise<Wallet> {
    await this.getUser(userId);
    const { rows } = await this.db.query<{
      balance: string | number;
      updated_at: Date;
    }>("SELECT balance, updated_at FROM demo_wallets WHERE user_id=$1", [
      userId,
    ]);
    if (!rows[0]) throw new Error("Wallet not found");
    return {
      balance: Number(rows[0].balance),
      currency: "TRY",
      updatedAt: new Date(rows[0].updated_at).toISOString(),
    };
  }
  override async getTransactions(userId: string): Promise<Transaction[]> {
    await this.getUser(userId);
    const { rows } = await this.db.query<{
      id: string;
      kind: Transaction["kind"];
      amount: number;
      title: string;
      balance_after: string | number;
      created_at: Date;
    }>(
      "SELECT * FROM demo_wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC, balance_after DESC",
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      title: row.title,
      balanceAfter: Number(row.balance_after),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  override async getAvailablePromotions(userId: string): Promise<Promotion[]> {
    await this.getUser(userId);
    return (
      await this.db.query<{ definition: Promotion }>(
        "SELECT definition FROM app_promotions ORDER BY id",
      )
    ).rows.map((row) => row.definition);
  }
  override async addBalance(
    userId: string,
    amount: number,
    bonus: number,
    operationId: string,
  ): Promise<Wallet> {
    await this.getUser(userId);
    const delayUntil = this.delayed.get(operationId);
    if (delayUntil && delayUntil > Date.now())
      throw new Error("Simulated cafe connection delay");
    this.delayed.delete(operationId);
    if (
      ![amount, bonus].every(Number.isSafeInteger) ||
      amount <= 0 ||
      bonus < 0
    )
      throw new Error("Invalid money");
    return this.db.transaction(async (tx) => {
      const wallet = (
        await tx.query<{ balance: string | number }>(
          "SELECT balance FROM demo_wallets WHERE user_id=$1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!wallet) throw new Error("Wallet not found");
      const previous = (
        await tx.query<{
          user_id: string;
          amount: number;
          bonus: number;
          balance_after: string | number;
          created_at: Date;
        }>("SELECT * FROM demo_wallet_operations WHERE operation_id=$1", [
          operationId,
        ])
      ).rows[0];
      if (previous) {
        if (
          previous.user_id !== userId ||
          previous.amount !== amount ||
          previous.bonus !== bonus
        )
          throw new Error("Operation conflict");
        return {
          balance: Number(previous.balance_after),
          currency: "TRY",
          updatedAt: new Date(previous.created_at).toISOString(),
        };
      }
      const before = Number(wallet.balance);
      const balance = before + amount + bonus;
      if (!Number.isSafeInteger(balance)) throw new Error("Balance overflow");
      const now = new Date().toISOString();
      await tx.query(
        "INSERT INTO demo_wallet_operations(operation_id,user_id,amount,bonus,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [operationId, userId, amount, bonus, balance, now],
      );
      await tx.query(
        "INSERT INTO demo_wallet_transactions(id,user_id,kind,amount,title,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          userId,
          "topup",
          amount,
          "Online bakiye yükleme",
          before + amount,
          now,
        ],
      );
      if (bonus)
        await tx.query(
          "INSERT INTO demo_wallet_transactions(id,user_id,kind,amount,title,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            userId,
            "bonus",
            bonus,
            "Yükleme bonusu",
            balance,
            now,
          ],
        );
      await tx.query(
        "UPDATE demo_wallets SET balance=$2,updated_at=$3 WHERE user_id=$1",
        [userId, balance, now],
      );
      return { balance, currency: "TRY", updatedAt: now };
    });
  }
}
