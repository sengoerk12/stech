import type { Transaction, TransactionKind } from "@stech/contracts";
import { panCafeMoney, type PanCafeRow } from "./pancafe-reader";

function normalized(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ı", "i");
}
export function panCafeTimestamp(date: string, timeText: string) {
  const time = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,4}))?$/.exec(timeText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || +time[1] > 23 || +time[2] > 59 || +time[3] > 59)
    throw new Error("Invalid PanCafe history timestamp");
  const result = new Date(`${date}T${time[1]}:${time[2]}:${time[3]}.${(time[4] ?? "").padEnd(3,"0").slice(0,3)}+03:00`);
  if (Number.isNaN(result.getTime()) || result.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) !== date)
    throw new Error("Invalid PanCafe history date");
  return result.toISOString();
}
export function mapPanCafeHistory(row: PanCafeRow, username: string, installationId: string): Transaction[] {
  if (row.USERNAME !== username || !/^[1-9]\d{0,9}$/.test(row.HISTORY_ID ?? ""))
    throw new Error("History identity mismatch");
  const amount = panCafeMoney(row.RAW_AMOUNT_TL);
  const balanceAfter = panCafeMoney(row.BALANCE_TL);
  if (!amount) return []; // Account creation and other non-monetary events.
  const id = `pancafe:${installationId}:${row.HISTORY_ID}`;
  const createdAt = panCafeTimestamp(row.OCCURRED_DATE ?? "", row.OCCURRED_TIME ?? "");
  const note = row.NOTE?.trim() ?? "";
  if (row.PAYMENT_ID) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.PAYMENT_ID) ||
        note !== `S TECH test payment ${row.PAYMENT_ID}` ||
        !/^\d+$/.test(row.PAID_KURUS ?? "") || !/^\d+$/.test(row.BONUS_KURUS ?? ""))
      throw new Error("Invalid mobile credit receipt");
    const paid = Number(row.PAID_KURUS), bonus = Number(row.BONUS_KURUS);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(bonus) || paid <= 0 || bonus < 0 ||
        paid + bonus !== amount || panCafeMoney(row.CREDIT_BALANCE_TL) !== balanceAfter)
      throw new Error("Mobile receipt and native history disagree");
    const topup: Transaction = { id: `${id}:topup`, kind: "topup", amount: paid,
      title: "Mobil bakiye yükleme", createdAt, balanceAfter: balanceAfter - bonus };
    return bonus ? [{ ...topup, id: `${id}:bonus`, kind: "bonus", amount: bonus,
      title: "Yükleme bonusu", balanceAfter }, topup] : [topup];
  }
  const text = normalized(note);
  const withdrawal = /hesaptan para cikar|hesaptan .*cikar|withdraw/.test(text);
  const deposit = /hesaba para yuklendi|hesabina para yuklendi|money (?:was )?added|account.*credited/.test(text);
  const bonus = /bonus aktar|bonus (?:added|transferred)/.test(text);
  let signed = amount;
  let kind: TransactionKind = "adjustment";
  let title = "Bakiye düzenlemesi";
  if (withdrawal) { signed = -Math.abs(amount); title = "Kasadan bakiye çıkarma"; }
  else if (deposit) { signed = Math.abs(amount); kind = "topup"; title = "Kasadan bakiye yükleme"; }
  else if (bonus) { signed = Math.abs(amount); kind = "bonus"; title = "PanCafe bonusu"; }
  else {
    // Some native records store a positive cost. Only reverse that sign when the
    // preceding native balance proves the exact same debit, never guess from text.
    if (amount > 0 && row.PREVIOUS_BALANCE_TL != null &&
        balanceAfter - panCafeMoney(row.PREVIOUS_BALANCE_TL) === -amount) signed = -amount;
    if (signed < 0) {
      kind = "usage";
      title = row.TERMINALNAME?.trim() ? `PC kullanımı · ${row.TERMINALNAME.trim()}` : "Harcama";
    }
  }
  return [{ id, kind, amount: signed, balanceAfter, createdAt, title,
    ...(note ? { description: note } : {}) }];
}
