// Layer 4 Environment — the value chokepoint (audit G7).
//
// `executeTransfer` is the SOLE producer of value events. It validates, applies a
// PURE conservation predicate, issues a byproduct receipt certificate (alma-core),
// then emits ONE env-authored economy.settled event. Agents only REQUEST; the
// environment alone changes value (§2-4). The conservation RULE is a pure function
// of the entries — no World/tick/rng — so it could later be lifted onto a
// distributed executor (real ALMA) without touching this signature.

import { type Certificate, encodeBase64, issueCertificate, type KeyPair } from "vouch-core";
import {
  type AgentAdmittedPayload,
  currencySupply,
  EVENT_AGENT_ADMITTED,
  EVENT_ECONOMY_MINTED,
  EVENT_ECONOMY_SETTLED,
  getAgent,
  type MintPayload,
  type SettlementEntry,
  type SettlementPayload,
  treasuryId,
} from "../agent";
import { type AlmaEvent, type Result, SYSTEM_ACTOR, tickToIso, type WorldView } from "../foundation";
import { type EconomyPolicy, getRegion } from "../region";
import { canTransactAcross } from "./diplomacy";
import type { WorldCommit, WorldState } from "./state";

/** M3: currency is transferable, credit is not (§3-B). A later milestone may let the village decide. */
export function isTransferable(kind: "credit" | "currency"): boolean {
  return kind === "currency";
}

/** Fee rate under a region's economy policy: BASE at reputation 0, falling to MIN as reputation rises. */
function trustCostRate(reputation: number, policy: EconomyPolicy): number {
  return Math.min(policy.baseCostRate, Math.max(policy.minCostRate, policy.baseCostRate - reputation * policy.repDiscount));
}

/** PURE conservation law: the currency moved sums to zero (nothing minted/burned). */
export function isCurrencyConserving(entries: readonly SettlementEntry[]): boolean {
  return entries.reduce((sum, e) => sum + e.currencyDelta, 0) === 0;
}

export interface TransferMove {
  from: string;
  to: string;
  amount: number; // currency
}

export type TransferResult = Result<{ fee: number; receipt: Certificate }>;

export function executeTransfer(env: WorldCommit, move: TransferMove, opts: { tick: number; notary: KeyPair }): TransferResult {
  const state = env.getState();
  const from = getAgent(state, move.from);
  const to = getAgent(state, move.to);
  if (!from || !to) return { ok: false, reason: "unknown-agent" };
  if (from.id === to.id) return { ok: false, reason: "self-transfer" };
  if (!isTransferable("currency")) return { ok: false, reason: "not-transferable" };
  if (!Number.isInteger(move.amount) || move.amount <= 0) return { ok: false, reason: "bad-amount" };
  if (from.region !== to.region) {
    // M4: cross-region value flows are gated by diplomacy (mutual recognition + stance).
    const gate = canTransactAcross(state, from.region, to.region);
    if (!gate.ok) return { ok: false, reason: gate.reason };
  }
  if (from.balances.currency < move.amount) return { ok: false, reason: "insufficient-funds" };
  // the fee sink MUST exist, else the reducer would drop it and currency would leak.
  if (!getAgent(state, treasuryId(from.region))) return { ok: false, reason: "no-treasury" };

  // the SENDER's region sets its own fee/credit policy (sovereignty over its economy).
  const region = getRegion(state, from.region);
  if (!region) return { ok: false, reason: "unknown-region" };
  // a hibernated (dormant / listed / mid-sale) region is shut down — its residents can't transact.
  if (region.lifecycle !== "active") return { ok: false, reason: "region-dormant" };
  const policy = region.institutions.economyPolicy;

  const fee = Math.floor(move.amount * trustCostRate(from.reputation, policy));
  // Defence in depth: a validated policy keeps the rate in [0,1], so the fee is in [0, amount]
  // and no leg can drive a balance negative. If a bad policy ever slipped past validation,
  // refuse here rather than emit a conserved-but-harmful settlement.
  if (fee < 0 || fee > move.amount) throw new Error("executeTransfer: fee out of range (internal bug — invalid economy policy)");
  const entries: SettlementEntry[] = [
    { agentId: from.id, currencyDelta: -move.amount, creditDelta: policy.creditPerTx, reputationDelta: 1 },
    { agentId: to.id, currencyDelta: move.amount - fee, creditDelta: policy.creditPerTx, reputationDelta: 1 },
    { agentId: treasuryId(from.region), currencyDelta: fee, creditDelta: 0, reputationDelta: 0 },
  ];
  if (!isCurrencyConserving(entries)) {
    throw new Error("executeTransfer: conservation violated (internal bug)");
  }

  // byproduct certificate (§2-8 seed) — "this transaction completed", signed by the
  // region notary. It accumulates in the log; replay folds it as data (never re-signs).
  // `notaryKeyId` records WHICH key signed it, so a verifier on another node can pick
  // the right key without a global key directory (multi-operator / replay safety). Ed25519
  // signing is deterministic and issuedAt comes from the tick, so the receipt is bit-stable.
  const receipt = issueCertificate(
    {
      issuer: `notary@${from.region}`,
      subject: to.id,
      schemaId: "alma.tx/receipt/v1",
      claims: { from: from.id, to: to.id, amount: move.amount, fee, kind: "currency", notaryKeyId: encodeBase64(opts.notary.publicKey) },
      issuedAt: tickToIso(opts.tick),
    },
    opts.notary.privateKey,
  );

  const payload: SettlementPayload = { entries, receipt, memo: { from: from.id, to: to.id, amount: move.amount, fee } };
  env.commitSystem(EVENT_ECONOMY_SETTLED, payload);
  return { ok: true, fee, receipt };
}

export type MintResult = Result;

/**
 * Mint NEW currency to an agent — the EXPLICIT, logged, env-authored origin of money,
 * distinct from transfers (which conserve, summing to zero). This is the conservation
 * BASELINE: the supply (`currencySupply`) only ever grows via admission endowments and
 * this event, so total supply is auditable from t0. Env-only (commitSystem); a forged
 * mint is rejected at write time and again by the reducer's actor-gate.
 */
export function mintCurrency(env: WorldCommit, agentId: string, amount: number, reason: string): MintResult {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad-amount" };
  if (!getAgent(env.getState(), agentId)) return { ok: false, reason: "unknown-agent" };
  env.commitSystem(EVENT_ECONOMY_MINTED, { agentId, amount, reason } satisfies MintPayload);
  return { ok: true };
}

/**
 * Total currency ORIGIN recorded in the log: admission endowments + explicit mints. Only
 * env-authored (SYSTEM_ACTOR) events count — a forged non-system admit/mint never changed
 * state (reducer actor-gate), so it must not count toward the baseline.
 */
export function currencyOriginTotal(events: readonly AlmaEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.actor !== SYSTEM_ACTOR) continue;
    if (e.type === EVENT_AGENT_ADMITTED) total += (e.payload as AgentAdmittedPayload).agent.balances.currency;
    else if (e.type === EVENT_ECONOMY_MINTED) total += (e.payload as MintPayload).amount;
  }
  return total;
}

/**
 * Runtime conservation invariant: the live supply MUST equal its logged origin (no leak, no
 * unaccounted mint). Transfers are zero-sum, so supply only ever moves via admission + mint.
 * Throws on violation — an operator/ops can call this periodically against a WorldView.
 */
export function assertCurrencyConserved(view: WorldView<WorldState>): void {
  const supply = currencySupply(view.getState());
  const origin = currencyOriginTotal(view.log.all());
  if (supply !== origin) {
    throw new Error(`assertCurrencyConserved: supply ${supply} != logged origin (admitted+minted) ${origin}`);
  }
}
