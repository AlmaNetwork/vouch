// Layer 4 Environment — the value chokepoint (audit G7).
//
// `executeTransfer` is the SOLE producer of value events. It validates, applies a
// PURE conservation predicate, issues a byproduct receipt certificate (alma-core),
// then emits ONE env-authored economy.settled event. Agents only REQUEST; the
// environment alone changes value (§2-4). The conservation RULE is a pure function
// of the entries — no World/tick/rng — so it could later be lifted onto a
// distributed executor (real ALMA) without touching this signature.

import { type Certificate, type KeyPair, issueCertificate } from "vouch-core";
import {
  EVENT_ECONOMY_SETTLED,
  type SettlementEntry,
  type SettlementPayload,
  getAgent,
  treasuryId,
} from "../agent";
import { type CommitSink, SYSTEM_ACTOR } from "../foundation";
import type { WorldState } from "./state";

const BASE_COST_RATE = 0.2;
const MIN_COST_RATE = 0.05;
const REP_DISCOUNT = 0.02;
const CREDIT_PER_TX = 1; // credit accrues slowly (§3-B)

/** M3: currency is transferable, credit is not (§3-B). A later milestone may let the village decide. */
export function isTransferable(kind: "credit" | "currency"): boolean {
  return kind === "currency";
}

function trustCostRate(reputation: number): number {
  return Math.min(BASE_COST_RATE, Math.max(MIN_COST_RATE, BASE_COST_RATE - reputation * REP_DISCOUNT));
}

/** PURE conservation law: the currency moved sums to zero (nothing minted/burned). */
export function isCurrencyConserving(entries: readonly SettlementEntry[]): boolean {
  return entries.reduce((sum, e) => sum + e.currencyDelta, 0) === 0;
}

const EPOCH = Date.UTC(2026, 0, 1);
/** Deterministic timestamp from the tick (no wall clock, §2-7). */
function tickToIso(tick: number): string {
  return new Date(EPOCH + tick * 86_400_000).toISOString();
}

export interface TransferMove {
  from: string;
  to: string;
  amount: number; // currency
}

export type TransferResult = { ok: true; fee: number; receipt: Certificate } | { ok: false; reason: string };

export function executeTransfer(env: CommitSink<WorldState>, move: TransferMove, opts: { tick: number; notary: KeyPair }): TransferResult {
  const state = env.getState();
  const from = getAgent(state, move.from);
  const to = getAgent(state, move.to);
  if (!from || !to) return { ok: false, reason: "unknown-agent" };
  if (from.id === to.id) return { ok: false, reason: "self-transfer" };
  if (!isTransferable("currency")) return { ok: false, reason: "not-transferable" };
  if (!Number.isInteger(move.amount) || move.amount <= 0) return { ok: false, reason: "bad-amount" };
  if (from.region !== to.region) {
    // §audit G9: cross-region value flow is the M4 diplomacy boundary — a LOUD refusal.
    throw new Error(`executeTransfer: cross-region transfer (${from.region} -> ${to.region}) is M4 (diplomacy), refused`);
  }
  if (from.balances.currency < move.amount) return { ok: false, reason: "insufficient-funds" };
  // the fee sink MUST exist, else the reducer would drop it and currency would leak.
  if (!getAgent(state, treasuryId(from.region))) return { ok: false, reason: "no-treasury" };

  const fee = Math.floor(move.amount * trustCostRate(from.reputation));
  const entries: SettlementEntry[] = [
    { agentId: from.id, currencyDelta: -move.amount, creditDelta: CREDIT_PER_TX, reputationDelta: 1 },
    { agentId: to.id, currencyDelta: move.amount - fee, creditDelta: CREDIT_PER_TX, reputationDelta: 1 },
    { agentId: treasuryId(from.region), currencyDelta: fee, creditDelta: 0, reputationDelta: 0 },
  ];
  if (!isCurrencyConserving(entries)) {
    throw new Error("executeTransfer: conservation violated (internal bug)");
  }

  // byproduct certificate (§2-8 seed) — "this transaction completed", signed by the
  // region notary. It accumulates in the log; replay folds it as data (never re-signs).
  const receipt = issueCertificate(
    {
      issuer: `notary@${from.region}`,
      subject: to.id,
      schemaId: "alma.tx/receipt/v1",
      claims: { from: from.id, to: to.id, amount: move.amount, fee, kind: "currency" },
      issuedAt: tickToIso(opts.tick),
    },
    opts.notary.privateKey,
  );

  const payload: SettlementPayload = { entries, receipt, memo: { from: from.id, to: to.id, amount: move.amount, fee } };
  env.emit(EVENT_ECONOMY_SETTLED, SYSTEM_ACTOR, payload);
  return { ok: true, fee, receipt };
}
