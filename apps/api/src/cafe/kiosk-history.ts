import type { Transaction, TransactionPage } from "@stech/contracts";
import type { Database } from "../database/database";

type CreditRow = Transaction & { creditId?: string };
type KioskCredit = Omit<Transaction, "kind" | "balanceAfter"> & {
  kind: "topup" | "bonus" | "game_reward" | "s_coin";
  balanceAfter?: number;
};

const limit = 10;

export async function kioskHistory(
  db: Database,
  readPage: (cursor?: string) => Promise<TransactionPage>,
  readCoins: () => Promise<KioskCredit[]>,
) {
  const groups = { topup: [] as KioskCredit[], bonus: [] as KioskCredit[], game_reward: [] as KioskCredit[] };
  const gatherMoney = async () => {
    let cursor: string | undefined;
    do {
      const page = await readPage(cursor);
      const rows = page.items as CreditRow[];
      const candidateIds = rows.filter(row => row.creditId && row.kind === "topup" && [500, 1000, 2500].includes(row.amount))
        .map(row => row.creditId!);
      const payments = candidateIds.length ? await db.query<{ id: string }>(
        "SELECT id::text FROM payment_orders WHERE id = ANY($1::uuid[])", [candidateIds],
      ) : { rows: [] };
      const orderIds = new Set(payments.rows.map(row => row.id));
      const candidates = new Set(candidateIds);
      const bonusIds = new Set(rows.filter(row => row.kind === "bonus").map(row => row.creditId));
      for (const row of rows) {
        if (row.amount <= 0 || (row.kind !== "topup" && row.kind !== "bonus")) continue;
        // Native S TECH credits with these denominations and no payment order are wheel awards.
        // Native cashier deposits lack a S TECH receipt, so they are never classified this way.
        const gameReward = row.creditId && candidates.has(row.creditId) && !orderIds.has(row.creditId) && !bonusIds.has(row.creditId);
        const kind = gameReward ? "game_reward" : row.kind;
        if (groups[kind].length >= limit) continue;
        const { id, amount, balanceAfter, createdAt } = row;
        groups[kind].push({ id, kind, amount, balanceAfter, createdAt, title: gameReward ? "Şans çarkı ödülü" : row.title });
      }
      cursor = page.nextCursor;
    } while (cursor && Object.values(groups).some(items => items.length < limit));
  };
  const [, coins] = await Promise.all([gatherMoney(), readCoins()]);
  return { items: [...Object.values(groups).flat(), ...coins.slice(0, limit)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
