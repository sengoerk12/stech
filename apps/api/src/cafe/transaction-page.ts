import { BadRequestException } from "@nestjs/common";
import type { Transaction, TransactionPage } from "@stech/contracts";

export function pageTransactions(items: Transaction[], cursor?: string): TransactionPage {
  if (cursor && !/^offset:\d{1,9}$/.test(cursor)) throw new BadRequestException("Geçersiz geçmiş sayfası.");
  const offset = cursor ? Number(cursor.slice(7)) : 0;
  return { items: items.slice(offset, offset + 100),
    ...(items.length > offset + 100 ? { nextCursor: `offset:${offset + 100}` } : {}) };
}
