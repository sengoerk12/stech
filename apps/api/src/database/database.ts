import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { schema } from "./schema";

export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends SqlExecutor {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(
  options: { url?: string; directory?: string } = {},
): Promise<Database> {
  let db: Database;
  if (options.url) {
    const pool = new Pool({
      connectionString: options.url,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    db = {
      async query<T>(sql: string, params?: unknown[]) {
        const result = await pool.query(sql, params);
        return { rows: result.rows as T[] };
      },
      async transaction<T>(callback: (tx: SqlExecutor) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await callback({
            async query<R>(sql: string, params?: unknown[]) {
              const result = await client.query(sql, params);
              return { rows: result.rows as R[] };
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
    // Versioned, additive migration. Run under an advisory lock across API processes.
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(72389412)");
      for (const statement of schema) await tx.query(statement);
    });
  } else {
    if (options.directory)
      await mkdir(resolve(options.directory), { recursive: true });
    const pg = await PGlite.create(
      options.directory ? resolve(options.directory) : "memory://",
    );
    db = {
      async query<T>(sql: string, params?: unknown[]) {
        const result = await pg.query<T>(sql, params);
        return { rows: result.rows };
      },
      transaction: (callback) =>
        pg.transaction((tx) =>
          callback({
            async query<T>(sql: string, params?: unknown[]) {
              return { rows: (await tx.query<T>(sql, params)).rows };
            },
          }),
        ),
      close: () => pg.close(),
    };
    await db.transaction(async (tx) => {
      for (const statement of schema) await tx.query(statement);
    });
  }
  return db;
}
