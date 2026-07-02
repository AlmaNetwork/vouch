// Layer 3 Agent — the agent-slice reducer (pure fold; runs live AND on replay).
//
// Audit G8: value/balance changes are honored ONLY when the event is env-authored
// (actor === SYSTEM_ACTOR). Because World.emit is public, this fold point is the
// real §2-4 conservation chokepoint — a self-asserted balance event is ignored.

import { type Reducer, SYSTEM_ACTOR } from "../foundation";
import { EVENT_RESOURCE_DRAWN, type ResourceDrawnPayload } from "../region";
import {
  type AgentAdmittedPayload,
  type AgentMigratedPayload,
  type AgentSlice,
  type AgentState,
  EVENT_AGENT_ADMITTED,
  EVENT_AGENT_MIGRATED,
  EVENT_AGENT_VOUCHED,
  EVENT_ECONOMY_MINTED,
  EVENT_ECONOMY_SETTLED,
  type MintPayload,
  type SettlementPayload,
  type VouchedPayload,
} from "./types";

export const agentReducer: Reducer<AgentSlice> = (state, event) => {
  // §2-4 / audit G8 (defence in depth): every state-changing agent event is env-authored
  // (SYSTEM_ACTOR via commitSystem), so a forged non-system event is ignored at the fold
  // point on live + replay. agent.decided (actor = the agent) is principal-authored and a
  // no-op anyway. This is the real conservation chokepoint alongside the write-time guard.
  if (event.actor !== SYSTEM_ACTOR) return state;
  switch (event.type) {
    case EVENT_AGENT_ADMITTED: {
      const { agent } = event.payload as AgentAdmittedPayload;
      return { agents: { ...state.agents, [agent.id]: agent } };
    }
    case EVENT_AGENT_MIGRATED: {
      const { agentId, toRegion } = event.payload as AgentMigratedPayload;
      const a = state.agents[agentId];
      if (!a) return state;
      return { agents: { ...state.agents, [agentId]: { ...a, region: toRegion } } };
    }
    case EVENT_ECONOMY_SETTLED: {
      const { entries } = event.payload as SettlementPayload;
      // CC-1: apply ALL legs or NONE — match isCurrencyConserving (which sums over all
      // entries). Skipping a missing leg would strand currency; reject atomically instead.
      if (entries.some((e) => !state.agents[e.agentId])) return state;
      const agents: Record<string, AgentState> = { ...state.agents };
      for (const e of entries) {
        const a = agents[e.agentId];
        if (!a) continue; // unreachable after the precheck; keeps the index access total
        agents[e.agentId] = {
          ...a,
          balances: {
            credit: a.balances.credit + e.creditDelta,
            currency: a.balances.currency + e.currencyDelta,
          },
          reputation: a.reputation + e.reputationDelta,
        };
      }
      return { agents };
    }
    case EVENT_ECONOMY_MINTED: {
      // minting is env-only — the explicit, logged origin of currency (gated at the top).
      const { agentId, amount } = event.payload as MintPayload;
      const a = state.agents[agentId];
      if (!a) return state;
      return { agents: { ...state.agents, [agentId]: { ...a, balances: { ...a.balances, currency: a.balances.currency + amount } } } };
    }
    case EVENT_AGENT_VOUCHED: {
      // The brand verb: a vouch raises the SUBJECT's trust (social capital), distinct from
      // economy reputation. Sybil-resistance of the vouch graph is P3.
      const { to, weight } = event.payload as VouchedPayload;
      const a = state.agents[to];
      if (!a) return state;
      return { agents: { ...state.agents, [to]: { ...a, trust: a.trust + weight } } };
    }
    case EVENT_RESOURCE_DRAWN: {
      // P3 scarcity: a draw moves the amount from the region pool (region reducer) onto the
      // agent (here) — conserved between the two slices of the same env-authored event.
      const { agentId, amount } = event.payload as ResourceDrawnPayload;
      const a = state.agents[agentId];
      if (!a) return state;
      return { agents: { ...state.agents, [agentId]: { ...a, resources: a.resources + amount } } };
    }
    // agent.decided is a journaled record only — it changes no protected state.
    default:
      return state;
  }
};
