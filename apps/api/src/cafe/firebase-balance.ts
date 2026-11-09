import { randomUUID } from "node:crypto";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import type { MemberSnapshot } from "./firebase-sync";
import type { PanCafeBridgeClient } from "./pancafe";
import { panCafeMoney } from "./pancafe-reader";

type Baseline = { balanceKurus: number; bonusKurus: number };
type Edit = { operationId: string; target: number; delta: number; expectedBalance: number; expectedBonus: number };
type Status = "synced" | "applied" | "conflict" | "invalid";

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
}

function requestedDelta(target: unknown, baseline: number) {
  if (!validAmount(target) || !validAmount(baseline)) return null;
  const delta = target - baseline;
  return delta !== 0 && Math.abs(delta) <= 1_000_000 ? delta : null;
}

function canApplyDelta(balance: unknown, bonus: unknown, delta: number) {
  return validAmount(balance) && validAmount(bonus) && bonus <= balance &&
    validAmount(balance + delta) && balance + delta >= bonus;
}

export function planFirebaseBalance(member: MemberSnapshot, data?: DocumentData) {
  const state = data?.balanceSync;
  if (data?.memberId !== member.memberId || data.username !== member.username ||
      !Number.isSafeInteger(state?.balanceKurus) || !Number.isSafeInteger(state?.bonusKurus))
    return { kind: "publish", status: "synced" } as const;

  const balance = state.balanceKurus, bonus = state.bonusKurus;
  const baseline: Baseline = { balanceKurus: balance, bonusKurus: bonus };
  if (state.pending) {
    const pending = state.pending as Edit;
    const delta = requestedDelta(pending.target, balance);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pending.operationId) ||
        delta === null || (pending.delta !== undefined && pending.delta !== delta) ||
        !canApplyDelta(pending.expectedBalance, pending.expectedBonus, delta))
      return { kind: "publish", status: "invalid" } as const;
    return { kind: "resume", baseline, edit: { ...pending, delta } } as const;
  }

  if (data.balanceKurus !== balance) {
    const delta = requestedDelta(data.balanceKurus, balance);
    if (!member.active || delta === null || !canApplyDelta(member.balanceKurus, member.bonusKurus, delta))
      return { kind: "publish", status: "invalid" } as const;
    return { kind: "claim", baseline, edit: {
      target: data.balanceKurus as number, delta, expectedBalance: member.balanceKurus, expectedBonus: member.bonusKurus,
    } } as const;
  }
  return Object.entries(member).every(([key, value]) => data[key] === value)
    ? { kind: "skip" } as const
    : { kind: "publish", status: "synced" } as const;
}

async function writeIfCurrent(doc: DocumentSnapshot, data: DocumentData) {
  try {
    if (doc.updateTime) await doc.ref.update(data, { lastUpdateTime: doc.updateTime });
    else await doc.ref.create(data);
    return true;
  } catch (error) {
    // A newer console edit is handled on the next pass.
    const code = (error as { code?: unknown }).code;
    if ([5, 6, 9, "NOT_FOUND", "ALREADY_EXISTS", "FAILED_PRECONDITION"].includes(code as number | string)) return false;
    throw error;
  }
}

async function publish(doc: DocumentSnapshot, member: MemberSnapshot, status: Status) {
  await writeIfCurrent(doc, {
    ...member,
    updatedAt: FieldValue.serverTimestamp(),
    balanceSync: { balanceKurus: member.balanceKurus, bonusKurus: member.bonusKurus, status },
  });
}

function savePending(doc: DocumentSnapshot, baseline: Baseline, edit: Edit) {
  return writeIfCurrent(doc, { balanceSync: { ...baseline, status: "pending", pending: edit } });
}

export async function reconcileFirebaseBalance(doc: DocumentSnapshot, member: MemberSnapshot, bridge: PanCafeBridgeClient) {
  const plan = planFirebaseBalance(member, doc.data());
  if (plan.kind === "skip") return;
  if (plan.kind === "publish") return publish(doc, member, plan.status);

  const edit = plan.kind === "resume" ? plan.edit : { ...plan.edit, operationId: randomUUID() };
  if (plan.kind === "claim" && !await savePending(doc, plan.baseline, edit)) return;

  // The Firebird receipt and the balance update share one transaction. Reuse the claim on retries.
  const result = (await bridge.request("/firebase/adjust", {
    memberId: member.memberId, username: member.username, operationId: edit.operationId,
    delta: edit.delta, expectedBalance: edit.expectedBalance, expectedBonus: edit.expectedBonus,
  }))?.[0]?.RESULT_CODE;
  if (result !== "ok" && result !== "stale" && result !== "conflict" && result !== "invalid")
    throw new Error("PanCafe balance edit result unavailable");

  const current = (await bridge.request(`/member?id=${member.memberId}&username=${encodeURIComponent(member.username)}`))?.[0];
  if (current?.ID !== String(member.memberId) || current.USERNAME !== member.username)
    throw new Error("PanCafe member changed during balance edit");
  const latest = await doc.ref.get();
  if (latest.get("balanceSync.pending.operationId") !== edit.operationId) return;
  const actual = {
    ...member, balanceKurus: panCafeMoney(current.BALANCE_TL), bonusKurus: panCafeMoney(current.BONUS_TL),
    active: current.ACCSTATUS === "1",
  };
  if (latest.get("balanceKurus") !== edit.target) return publish(latest, actual, "conflict");
  if (result === "stale" && actual.active && canApplyDelta(actual.balanceKurus, actual.bonusKurus, edit.delta)) {
    await savePending(latest, plan.baseline, { ...edit, expectedBalance: actual.balanceKurus, expectedBonus: actual.bonusKurus });
    return;
  }
  await publish(latest, actual, result === "ok" ? "applied" : result === "conflict" ? "conflict" : "invalid");
}
