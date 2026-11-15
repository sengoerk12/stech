export type Timestamp = { seconds: number; nanoseconds: number };

export type WalletData = Record<string, any>;
export type WalletPrecondition = { lastUpdateTime?: Timestamp };

export interface WalletSnapshot {
  id: string;
  ref: WalletDocument;
  exists: boolean;
  updateTime?: Timestamp;
  data(): WalletData | undefined;
  get(field: string): any;
}

export interface WalletDocument {
  id: string;
  path: string;
  collection(name: string): WalletCollection;
  get(): Promise<WalletSnapshot>;
  create(data: WalletData): Promise<unknown>;
  update(data: WalletData, precondition?: WalletPrecondition): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface WalletTransaction {
  get(document: WalletDocument): Promise<WalletSnapshot>;
  set(document: WalletDocument, data: WalletData, options?: { merge: boolean }): unknown;
  create(document: WalletDocument, data: WalletData): unknown;
}

export interface WalletCollection {
  doc(id: string): WalletDocument;
  get(): Promise<{ docs: WalletSnapshot[] }>;
  where(field: "nextAttemptAt", operator: "<=", value: number): {
    orderBy(field: "nextAttemptAt"): {
      limit(max: number): { get(): Promise<{ docs: WalletSnapshot[] }> };
    };
  };
  firestore: {
    runTransaction<T>(work: (transaction: WalletTransaction) => Promise<T>): Promise<T>;
  };
}
