// 第3層 Agent (住人) — types.
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

export interface AgentState {
  readonly id: string; // name@region (identity; stable across migration)
  readonly region: string; // current residence (changes on migration)
  readonly role: AgentRole;
  readonly publicKey: string; // base64 Ed25519 public key
  readonly balances: Balances;
  readonly reputation: number;
  readonly valueProfile: ValueProfile;
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

/** One agent's signed balance delta within a settlement. */
export type SettlementEntry = {
  agentId: string;
  currencyDelta: number;
  creditDelta: number;
  reputationDelta: number;
};

export type SettlementPayload = {
  entries: SettlementEntry[];
  receipt: Certificate; // byproduct cert (§2-8 seed) — accumulates in the log
  memo: { from: string; to: string; amount: number; fee: number };
};

export type AgentAdmittedPayload = { agent: AgentState };
export type AgentMigratedPayload = { agentId: string; toRegion: string };
export type AgentDecidedPayload = { agentId: string; intent: Intent };
