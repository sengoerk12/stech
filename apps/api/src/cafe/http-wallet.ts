import { createHash, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import type { Timestamp } from "./wallet-store";
import type { WalletImport } from "./mysql-wallet";
import type { WalletCollection, WalletData, WalletDocument, WalletSnapshot, WalletTransaction } from "./wallet-store";

type DocumentKey = { collection: string; id: string };
type SavedDocument = { id: string; revision: string; data: WalletData };
type Read = DocumentKey & { revision: string | null };
type Write = DocumentKey & { kind: "replace" | "merge" | "create" | "update" | "delete"; data?: WalletData; revision?: string };
type Action =
  | { action: "status" }
  | (DocumentKey & { action: "get" })
  | { action: "list"; collection: string; due?: number; limit?: number }
  | { action: "commit"; reads: Read[]; writes: Write[] }
  | { action: "import"; documents: WalletImport[] };

function timestampVersion(timestamp: Timestamp) {
  return String(BigInt(timestamp.seconds) * 1_000_000_000n + BigInt(timestamp.nanoseconds));
}

class WalletHttpError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class HttpWallet {
  private constructor(private address: URL, private key: KeyObject) {}

  static async open(url: string, privateKey: string, forImport = false) {
    const address = new URL(url);
    if (address.protocol !== "https:" || address.username || address.password || address.search || address.hash)
      throw new Error("Wallet requires an HTTPS endpoint URL");
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
      throw new Error("Wallet signing key must use P-256");
    const store = new HttpWallet(address, key);
    const { imported } = await store.request<{ imported: boolean }>({ action: "status" });
    if (typeof imported !== "boolean") throw new Error("Invalid wallet status");
    if (!forImport && !imported) throw new Error("Wallet data import has not been completed");
    return store;
  }

  private async request<T>(input: Action): Promise<T> {
    const body = JSON.stringify(input);
    const time = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const hash = createHash("sha256").update(body).digest("hex");
    const signature = sign("sha256", Buffer.from(`stech-wallet-v1\n${time}\n${nonce}\n${hash}`), this.key).toString("base64");
    const response = await fetch(this.address, {
      method: "POST", body, redirect: "error", signal: AbortSignal.timeout(input.action === "import" ? 60_000 : 10_000),
      headers: { "content-type": "application/json", "x-stech-wallet-time": time,
        "x-stech-wallet-nonce": nonce, "x-stech-wallet-signature": signature },
    }).catch(() => { throw new WalletHttpError("WALLET_UNAVAILABLE"); });
    if (response.status === 404) throw new WalletHttpError("WALLET_ACCESS_DENIED");
    const result = await response.json().catch(() => { throw new WalletHttpError("WALLET_UNAVAILABLE"); });
    if (!response.ok) throw new WalletHttpError(typeof result?.code === "string" ? result.code : "WALLET_UNAVAILABLE");
    return result as T;
  }

  async importOnce(documents: WalletImport[]) {
    await this.request({ action: "import", documents });
  }

  private snapshot(collection: string, id: string, document: SavedDocument | null): WalletSnapshot {
    const revision = document ? BigInt(document.revision) : undefined;
    const payload = document?.data;
    return { id, ref: this.document(collection, id), exists: document !== null,
      updateTime: revision === undefined ? undefined :
        { seconds: Number(revision / 1_000_000_000n), nanoseconds: Number(revision % 1_000_000_000n) },
      data: () => payload, get: field => field.split(".").reduce((value, key) => value?.[key], payload) };
  }

  private async get(key: DocumentKey) {
    const { document } = await this.request<{ document: SavedDocument | null }>({ action: "get", ...key });
    return document;
  }

  private async list(collection: string, due?: number, limit?: number) {
    const { documents } = await this.request<{ documents: SavedDocument[] }>({ action: "list", collection, due, limit });
    return { docs: documents.map(item => this.snapshot(collection, item.id, item)) };
  }

  private document(collection: string, id: string): WalletDocument {
    return {
      id, path: `${collection}/${id}`,
      collection: name => this.collection(`${collection}/${id}/${name}`),
      get: async () => this.snapshot(collection, id, await this.get({ collection, id })),
      create: data => this.request({ action: "commit", reads: [], writes: [{ kind: "create", collection, id, data }] }),
      update: (data, precondition) => this.request({ action: "commit", reads: [],
        writes: [{ kind: "update", collection, id, data,
          revision: precondition?.lastUpdateTime ? timestampVersion(precondition.lastUpdateTime) : undefined }] }),
      delete: () => this.request({ action: "commit", reads: [], writes: [{ kind: "delete", collection, id }] }),
    };
  }

  collection(collection: string): WalletCollection {
    return {
      doc: id => this.document(collection, id),
      get: () => this.list(collection),
      where: (_field, _operator, due) => ({ orderBy: () => ({ limit: limit => ({ get: () => this.list(collection, due, limit) }) }) }),
      firestore: { runTransaction: work => this.transaction(work) },
    };
  }

  private async transaction<T>(work: (tx: WalletTransaction) => Promise<T>) {
    function key(doc: WalletDocument) {
      return { collection: doc.path.slice(0, -(doc.id.length + 1)), id: doc.id };
    }
    for (let attempt = 0; ; attempt++) {
      const reads = new Map<string, Promise<SavedDocument | null>>();
      const writes: Write[] = [];
      const result = await work({
        get: async doc => {
          const documentKey = key(doc);
          const pending = reads.get(doc.path) ?? this.get(documentKey);
          reads.set(doc.path, pending);
          return this.snapshot(documentKey.collection, doc.id, await pending);
        },
        set: (doc, data, options) => { writes.push({ ...key(doc), kind: options?.merge ? "merge" : "replace", data }); },
        create: (doc, data) => { writes.push({ ...key(doc), kind: "create", data }); },
      });
      const expected = await Promise.all(Array.from(reads, async ([path, value]) => {
        const split = path.lastIndexOf("/");
        return { collection: path.slice(0, split), id: path.slice(split + 1), revision: (await value)?.revision ?? null };
      }));
      try {
        await this.request({ action: "commit", reads: expected, writes });
        return result;
      } catch (error) {
        if (!(error instanceof WalletHttpError) || error.code !== "RETRY_TRANSACTION" || attempt >= 4) throw error;
      }
    }
  }

  async close() { /* The HTTPS client has no dedicated pool to release. */ }
}
