// Layer 3 Agent (residents) — types.
//
// An agent's identity/balance/reputation is DERIVED by folding the event log into
// this slice (audit 3-A) — never a parallel mutable store. Agents USE the core as
// a tool and belong to a region, but never DEFINE institutions (§2-1).

import type { Certificate } from "vouch-core";

export type AgentRole = "artisan" | "merchant" | "broker" | "treasury";

/** A coarse value-leaning, used by the §3-D emergence (mismatch with the home region). */
export type ValueProfile = "strict" | "lenient";

export interface Balances {
  readonly credit: number; // non-transferable, slow trust accrual (§3-B)
  readonly currency: number; // transferable medium of exchange (§3-B)
}

/**
 * RFC 0007 §9 / §3.4 — active suspension on an agent. null = not suspended.
 * A suspended agent cannot transact (economy.settled) until `untilTick` has passed
 * or `agent.reinstated` is folded. Suspension never blocks emigration (Tier K-5).
 */
export interface AgentSuspension {
  readonly untilTick: number;
}

export interface AgentState {
  readonly id: string; // name@region (identity; stable across migration)
  readonly region: string; // current residence (changes on migration)
  readonly role: AgentRole;
  readonly publicKey: string; // base64 Ed25519 public key
  readonly balances: Balances;
  readonly reputation: number; // economy-derived standing (accrues on settled trades)
  readonly trust: number; // accumulated social capital from being VOUCHED for (§ the brand verb)
  readonly resources: number; // amount DRAWN from region resource pools (P3 scarcity)
  readonly valueProfile: ValueProfile;
  // The log seq at which this agent was ADMITTED (RFC 0001 §4: voter tenure is measured in
  // log seq, never wall-clock — audit G5). Stamped by the agent reducer from event.seq when
  // it folds agent.admitted, so it is identical live and on replay. Citizenship itself is
  // NOT stored: it is the home region encoded in the id (name@region); migration changes
  // `region` (residence) but never citizenship nor this seq.
  readonly admittedAtSeq: number;
  // RFC 0007 §9 / §3.4: null = not suspended; non-null = suspended until untilTick.
  readonly suspension: AgentSuspension | null;
  // RFC 0007 §10.1: IDs that co-vouched at admission (voucher-liability chain).
  readonly sponsors: readonly string[];
}

/** The agent read-model slice of world state; the environment composes it in. */
export type AgentSlice = { readonly agents: Readonly<Record<string, AgentState>> };

/** What a brain returns. The environment EXECUTES it; the agent only requests (§2-4/§2-5). */
export type Intent =
  | { readonly kind: "idle" }
  | { readonly kind: "transfer"; readonly to: string; readonly amount: number } // currency only
  | { readonly kind: "emigrate"; readonly to: string };

export const EVENT_AGENT_ADMITTED = "agent.admitted";
export const EVENT_AGENT_MIGRATED = "agent.migrated";
export const EVENT_AGENT_DECIDED = "agent.decided"; // the JOURNALED brain decision (audit G6)
export const EVENT_ECONOMY_SETTLED = "economy.settled"; // env-authored value move (audit G7/G8)
export const EVENT_ECONOMY_MINTED = "economy.minted"; // env-authored EXPLICIT currency origin (conservation baseline)
export const EVENT_AGENT_VOUCHED = "agent.vouched"; // one agent VOUCHES for another -> trust (the brand verb)
// RFC 0007 §9 / §3.4 sanctions — env-authored, SYSTEM_ACTOR only (Tier K guard).
export const EVENT_AGENT_SUSPENDED = "agent.suspended"; // suspendId: block economy until untilTick
export const EVENT_AGENT_REINSTATED = "agent.reinstated"; // reinstateId: lift suspension early

/** One agent's signed balance delta within a settlement. */
export type SettlementEntry = {
  readonly agentId: string;
  readonly currencyDelta: number;
  readonly creditDelta: number;
  readonly reputationDelta: number;
};

export type SettlementPayload = {
  readonly entries: readonly SettlementEntry[];
  readonly receipt: Certificate; // byproduct cert (§2-8 seed) — accumulates in the log
  readonly memo: { readonly from: string; readonly to: string; readonly amount: number; readonly fee: number };
};

/**
 * The wire form of an admission — the "birth certificate" fields the environment sets when
 * an agent joins. Deliberately DECOUPLED from AgentState (not an `Omit<>`): the reducer
 * MATERIALIZES the full AgentState from this, defaulting the derived fields
 * (reputation/trust/resources) and the lifecycle field (suspension), and stamping
 * admittedAtSeq from the event's own seq (RFC 0001 §4). Consequence — a schema-evolution
 * invariant: adding a DERIVED field to AgentState never changes this payload (the reducer
 * supplies its default); adding an ADMISSION field is a deliberate edit HERE. This is what
 * keeps a persisted log (Track B) replayable across AgentState growth.
 */
export interface AgentAdmission {
  readonly id: string; // name@region
  readonly region: string;
  readonly role: AgentRole;
  readonly publicKey: string;
  readonly credit: number;
  readonly currency: number;
  readonly valueProfile: ValueProfile;
  readonly sponsors: readonly string[]; // §10.1 co-vouchers at admission
}
export type AgentAdmittedPayload = { readonly admission: AgentAdmission };
export type AgentMigratedPayload = { readonly agentId: string; readonly toRegion: string };
export type AgentDecidedPayload = { readonly agentId: string; readonly intent: Intent };
/** An explicit currency mint — the ONLY sanctioned way new currency enters after genesis. */
export type MintPayload = { readonly agentId: string; readonly amount: number; readonly reason: string };
/** One agent vouches for another (weight 1..5), raising the subject's trust. */
export type VouchedPayload = { readonly from: string; readonly to: string; readonly weight: number };
/** RFC 0007 §9 suspendId: block the agent's economy participation until untilTick (inclusive). */
export type AgentSuspendedPayload = { readonly agentId: string; readonly untilTick: number };
/** RFC 0007 §9 reinstateId: lift an active suspension early (no-op if not suspended). */
export type AgentReinstatedPayload = { readonly agentId: string };

/** Maps each agent-slice event type to its payload — the typed `commit` helper keys off this. */
export interface AgentEventMap {
  [EVENT_AGENT_ADMITTED]: AgentAdmittedPayload;
  [EVENT_AGENT_MIGRATED]: AgentMigratedPayload;
  [EVENT_AGENT_DECIDED]: AgentDecidedPayload;
  [EVENT_ECONOMY_SETTLED]: SettlementPayload;
  [EVENT_ECONOMY_MINTED]: MintPayload;
  [EVENT_AGENT_VOUCHED]: VouchedPayload;
  [EVENT_AGENT_SUSPENDED]: AgentSuspendedPayload;
  [EVENT_AGENT_REINSTATED]: AgentReinstatedPayload;
}
