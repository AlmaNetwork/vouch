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
