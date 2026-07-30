// Layer 3 Agent — read-only selectors over the agent slice (§2-6).

import type { AgentSlice, AgentState } from "./types";

export function listAgents(state: AgentSlice): AgentState[] {
  return Object.values(state.agents);
}

export function getAgent(state: AgentSlice, id: string): AgentState | undefined {
  return state.agents[id];
}

/** Residents of a region (excludes the treasury account), id-sorted for determinism. */
export function agentsInRegion(state: AgentSlice, region: string): AgentState[] {
  return listAgents(state)
    .filter((a) => a.region === region && a.role !== "treasury")
    .sort((x, y) => (x.id < y.id ? -1 : 1)); // DET-1: don't feed behavior off insertion order
}

/** The reserved per-region treasury account id (an agent that holds collected fees). */
export function treasuryId(region: string): string {
  return `treasury@${region}`;
}

/**
 * The total currency in circulation — the auditable supply. Transfers conserve it
 * (sum to zero); only admission endowments and explicit `economy.minted` events
 * change it. The conservation invariant: supply == (sum of all mints/endowments).
 */
export function currencySupply(state: AgentSlice): number {
  return listAgents(state).reduce((sum, a) => sum + a.balances.currency, 0);
}

/**
 * RFC 0007 §9: true iff the agent is currently under an active suspension at `atTick`.
 * A suspension expires once the tick advances PAST `untilTick` (i.e. atTick > untilTick).
 * Suspension never prevents emigration (Tier K-5).
 */
export function isAgentSuspended(agent: AgentState, atTick: number): boolean {
  return agent.suspension !== null && atTick <= agent.suspension.untilTick;
}

/**
 * RFC 0007 §8.5 — standing for an agent in a given `context`.
 *
 * PLACEHOLDER, not the real fold — and deliberately labelled as such. This reads the
 * write-time-folded `trust` SCALAR (`reducer.ts` folds `trust: a.trust + weight` on every
 * `agent.vouched`), so `trust` is a stored, unbounded plain sum. It is NOT yet a derived
 * standing: the RFC form is a graph-fixpoint (source-weighted recursion, out-degree
 * normalization, per-source caps, dedup by `(from, to, kind, context)`, decay), and none of
 * that relation set lives in state — `AgentSlice` is only `{ agents: Record<id, AgentState> }`.
 * The upgrade is therefore a NEW STATE SLICE (the §10.5 incoming-edge read-model the fold ranges
 * over), not a new body for this function. `context` is threaded now (RFC 0007 §8.5 puts
 * contexts in the law parameters; RFC 0008 §4.4 keeps `context` in the signed edge core so an
 * edge can't be lifted into a scope it wasn't signed for) but is IGNORED by the placeholder —
 * a single global `trust` scalar has no per-context dimension yet.
 *
 * Tier K-7 (suffrage boundary): this is the NON-SUFFRAGE fold. It must NEVER feed `voteWeight`
 * or the RFC 0001 §5 roll — gating the vote on standing is weighting the vote by another name
 * (RFC 0007 §4.2 / RFC 0008 §15). `governance.ts` keeps `voteWeight` on `reputation`/`stake`,
 * never on `trust`/standing; see the K-7 test in `sanctions.test.ts`.
 */
export function computeStanding(state: AgentSlice, agentId: string, context: string): number {
  void context; // reserved for the per-context fold (see above); the placeholder is context-agnostic
  return getAgent(state, agentId)?.trust ?? 0;
}
