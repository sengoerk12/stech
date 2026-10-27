import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export type PanCafeRow = Record<string, string | null>;
export type PanCafeQuery = (sql: string) => Promise<PanCafeRow[]>;

export function createPanCafeQuery(config: {
  readerPath: string;
  databasePath: string;
  clientDirectory: string;
}): PanCafeQuery {
  return async (sql) => {
    const { stdout } = await run(
      config.readerPath,
      [
        config.databasePath,
        config.clientDirectory,
        Buffer.from(sql, "utf8").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      },
    );
    const result: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    if (
      !Array.isArray(result) ||
      !result.every(
        (row) =>
          row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          Object.values(row).every(
            (value) => value === null || typeof value === "string",
          ),
      )
    )
      throw new Error("Invalid PanCafe reader response");
    return result as PanCafeRow[];
  };
}

// Parse Firebird DECIMAL text directly into integer kurus; never use floating point.
export function panCafeMoney(value: string | null | undefined): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!match) throw new Error("Invalid PanCafe money value");
  const cents =
    (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"))) *
    (match[1] ? -1n : 1n);
  if (
    cents > BigInt(Number.MAX_SAFE_INTEGER) ||
    cents < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new Error("PanCafe money exceeds safe range");
  return Number(cents);
}

/** No auth/password reading, registration, SQL updates or demo fallback. */
export class PanCafeReadOnlyClient {
  constructor(private query: PanCafeQuery) {}

  async readMember(memberId: number, expectedUsername: string) {
    if (
      !Number.isSafeInteger(memberId) ||
      memberId < 1 ||
      memberId > 2147483647 ||
      !expectedUsername.trim()
    )
      throw new Error("A verified PanCafe member binding is required");
    const rows = await this
      .query(`SELECT ID, USERNAME, NAME, LASTNAME, GSM, PHONE, EMAIL,
      CAST(RECDATE AS VARCHAR(30)) AS JOINED_AT,
      CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE_TL,
      CAST(AVAILBONUS AS DECIMAL(18,2)) AS BONUS_TL, ACCTYPE, ACCSTATUS
      FROM MEMBERS WHERE ID=${memberId}`);
    if (rows.length !== 1 || rows[0].ID !== String(memberId))
      throw new Error(
        "PanCafe member was not found in the configured database",
      );
    const row = rows[0];
    if (
      !row.USERNAME ||
      row.USERNAME.trim().toLowerCase() !==
        expectedUsername.trim().toLowerCase()
    )
      throw new Error("PanCafe member number and username do not match");
    return {
      memberId,
      username: row.USERNAME.trim(),
      name: [row.NAME, row.LASTNAME].filter(Boolean).join(" ").trim(),
      phone: row.GSM || row.PHONE || "",
      email: row.EMAIL || "",
      joinedAt: row.JOINED_AT,
      // These are intentionally separate until PanCafe's bonus spending rules are verified.
      balance: panCafeMoney(row.BALANCE_TL),
      availableBonus: panCafeMoney(row.BONUS_TL),
      accountType: row.ACCTYPE,
      accountStatus: row.ACCSTATUS,
    };
  }
}
