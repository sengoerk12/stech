import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { Timestamp } from "./wallet-store";
import type { WalletCollection, WalletData, WalletDocument, WalletPrecondition, WalletSnapshot, WalletTransaction } from "./wallet-store";

type Reader = Pool | PoolConnection;
type Row = RowDataPacket & { document_id: string; payload: WalletData | string; revision: number | string };
export type WalletImport = { collection: string; id: string; data: WalletData };

const table = "stech_wallet_documents";
const lockTable = "stech_wallet_state";
const conditions = (code: string) => Object.assign(new Error(code), { code });

function assertSegment(segment: string) {
  if (!segment || segment.length > 191 || segment.includes("/")) throw new Error("Invalid wallet document path");
}

function stamp(revision: string | number) {
  const value = BigInt(revision);
  return { seconds: Number(value / 1_000_000_000n), nanoseconds: Number(value % 1_000_000_000n) };
}

function revision(timestamp: Timestamp) {
  return String(BigInt(timestamp.seconds) * 1_000_000_000n + BigInt(timestamp.nanoseconds));
}

export class MysqlWallet {
  private constructor(private pool: Pool) {}

  static async open(url: string, ca: string | undefined, initialize = false) {
    const address = new URL(url);
    if (address.protocol !== "mysql:" || address.pathname !== "/stechespor_wallet")
      throw new Error("WALLET_MYSQL_URL must point to the stechespor_wallet MySQL database");
    if (address.search || address.hash || !address.hostname || !address.username || !address.password)
      throw new Error("Invalid wallet database connection settings");
    const pool = createPool({
      host: address.hostname, port: Number(address.port || 3306), database: "stechespor_wallet",
      user: decodeURIComponent(address.username), password: decodeURIComponent(address.password),
      ssl: { ca, rejectUnauthorized: true, verifyIdentity: true },
      connectTimeout: 5000, connectionLimit: 8, charset: "utf8mb4",
      supportBigNumbers: true, bigNumberStrings: true,
    });
    const store = new MysqlWallet(pool);
    try {
      if (initialize) await store.initialize();
      else {
        const [rows] = await pool.query<RowDataPacket[]>(`SELECT imported FROM ${lockTable} WHERE id=1`);
        if (Number(rows[0]?.imported) !== 1) throw new Error("Wallet data import has not been completed");
      }
      return store;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${lockTable} (
      id TINYINT NOT NULL PRIMARY KEY, revision BIGINT UNSIGNED NOT NULL, imported TINYINT NOT NULL
    ) ENGINE=InnoDB`);
    await this.pool.query(`INSERT IGNORE INTO ${lockTable}(id,revision,imported) VALUES(1,0,0)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      collection_path VARCHAR(512) NOT NULL, document_id VARCHAR(191) NOT NULL,
      payload JSON NOT NULL, revision BIGINT UNSIGNED NOT NULL, next_attempt_at BIGINT,
      PRIMARY KEY(collection_path,document_id),
      INDEX stech_wallet_due(collection_path,next_attempt_at,document_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }

  private async write<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`SELECT id FROM ${lockTable} WHERE id=1 FOR UPDATE`);
      const result = await run(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async persist(connection: PoolConnection, collection: string, id: string, data: WalletData) {
    const due = Number.isSafeInteger(data.nextAttemptAt) ? data.nextAttemptAt : null;
    await connection.query(`UPDATE ${lockTable} SET revision=revision+1 WHERE id=1`);
    await connection.execute(`INSERT INTO ${table}(collection_path,document_id,payload,revision,next_attempt_at)
      SELECT ?,?,?,revision,? FROM ${lockTable} WHERE id=1
      ON DUPLICATE KEY UPDATE payload=VALUES(payload),revision=VALUES(revision),next_attempt_at=VALUES(next_attempt_at)`,
    [collection, id, JSON.stringify(data), due]);
  }

  async importOnce(documents: WalletImport[]) {
    await this.write(async connection => {
      const [state] = await connection.query<RowDataPacket[]>(`SELECT imported FROM ${lockTable} WHERE id=1`);
      if (Number(state[0]?.imported)) throw new Error("Wallet database already imported");
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT 1 FROM ${table} LIMIT 1`);
      if (rows.length) throw new Error("Wallet document table must be empty before import");
      for (const document of documents) {
        this.collection(document.collection).doc(document.id);
        await this.persist(connection, document.collection, document.id, document.data);
      }
      const [counts] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
      if (Number(counts[0].total) !== documents.length) throw new Error("Wallet import count mismatch");
      await connection.query(`UPDATE ${lockTable} SET imported=1 WHERE id=1`);
    });
  }

  private snapshot(collection: string, id: string, row?: Row): WalletSnapshot {
    const payload = typeof row?.payload === "string" ? JSON.parse(row.payload) as WalletData : row?.payload;
    return {
      id, ref: this.document(collection, id), exists: !!row, updateTime: row ? stamp(row.revision) : undefined,
      data: () => payload,
      get: field => field.split(".").reduce((value, key) => value?.[key], payload),
    };
  }

  private async read(db: Reader, collection: string, id: string) {
    const [rows] = await db.execute<Row[]>(`SELECT document_id,payload,revision FROM ${table} WHERE collection_path=? AND document_id=?`, [collection, id]);
    return this.snapshot(collection, id, rows[0]);
  }

  private async list(collection: string, due?: number, limit = 25) {
    const [rows] = due === undefined
      ? await this.pool.execute<Row[]>(`SELECT document_id,payload,revision FROM ${table} WHERE collection_path=? ORDER BY document_id`, [collection])
      : await this.pool.execute<Row[]>(`SELECT document_id,payload,revision FROM ${table}
          WHERE collection_path=? AND next_attempt_at<=? ORDER BY next_attempt_at,document_id LIMIT ?`, [collection, due, limit]);
    return { docs: rows.map(row => this.snapshot(collection, row.document_id, row)) };
  }

  private document(collection: string, id: string): WalletDocument {
    assertSegment(id);
    return {
      id, path: `${collection}/${id}`,
      collection: name => { assertSegment(name); return this.collection(`${collection}/${id}/${name}`); },
      get: () => this.read(this.pool, collection, id),
      create: data => this.write(async connection => {
        if ((await this.read(connection, collection, id)).exists) throw conditions("ALREADY_EXISTS");
        await this.persist(connection, collection, id, data);
      }),
      update: (data: WalletData, precondition?: WalletPrecondition) => this.write(async connection => {
        const previous = await this.read(connection, collection, id);
        if (!previous.updateTime) throw conditions("NOT_FOUND");
        if (precondition?.lastUpdateTime && revision(previous.updateTime) !== revision(precondition.lastUpdateTime))
          throw conditions("FAILED_PRECONDITION");
        await this.persist(connection, collection, id, { ...previous.data(), ...data });
      }),
      delete: () => this.write(async connection => {
        await connection.execute(`DELETE FROM ${table} WHERE collection_path=? AND document_id=?`, [collection, id]);
      }),
    };
  }

  collection(path: string): WalletCollection {
    if (path.length > 512) throw new Error("Wallet collection path too long");
    const segments = path.split("/");
    if (segments.length % 2 !== 1) throw new Error("Invalid wallet collection path");
    segments.forEach(assertSegment);
    return {
      doc: id => this.document(path, id),
      get: () => this.list(path),
      where: (_field, _operator, due) => ({ orderBy: () => ({ limit: max => ({ get: () => this.list(path, due, max) }) }) }),
      firestore: { runTransaction: work => this.transaction(work) },
    };
  }

  private transaction<T>(work: (transaction: WalletTransaction) => Promise<T>) {
    return this.write(async connection => {
      const pending: Array<() => Promise<void>> = [];
      function split(document: WalletDocument) {
        const suffix = "/" + document.id;
        if (!document.path.endsWith(suffix)) throw new Error("Invalid wallet document reference");
        return document.path.slice(0, -suffix.length);
      }
      const result = await work({
        get: document => this.read(connection, split(document), document.id),
        set: (document, data, options) => {
          pending.push(async () => {
            const collection = split(document);
            const previous = options?.merge ? (await this.read(connection, collection, document.id)).data() : undefined;
            await this.persist(connection, collection, document.id, { ...previous, ...data });
          });
        },
        create: (document, data) => {
          pending.push(async () => {
            const collection = split(document);
            if ((await this.read(connection, collection, document.id)).exists) throw conditions("ALREADY_EXISTS");
            await this.persist(connection, collection, document.id, data);
          });
        },
      });
      for (const mutation of pending) await mutation();
      return result;
    });
  }

  close() { return this.pool.end(); }
}
