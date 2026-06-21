// Layer 3 Agent — the agent-slice reducer (pure fold; runs live AND on replay).
//
// Audit G8: value/balance changes are honored ONLY when the event is env-authored
// (actor === SYSTEM_ACTOR). Because World.emit is public, this fold point is the
// real §2-4 conservation chokepoint — a self-asserted balance event is ignored.

import { SYSTEM_ACTOR, type Reducer } from "../foundation";
import {
  EVENT_AGENT_ADMITTED,
  EVENT_AGENT_MIGRATED,
  EVENT_ECONOMY_SETTLED,
  type AgentAdmittedPayload,
  type AgentMigratedPayload,
  type AgentSlice,
  type AgentState,
  type SettlementPayload,
} from "./types";

export const agentReducer: Reducer<AgentSlice> = (state, event) => {
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
      // §2-4 / audit G8: only the environment can change value.
      if (event.actor !== SYSTEM_ACTOR) return state;
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
    // agent.decided is a journaled record only — it changes no protected state.
    default:
      return state;
  }
};
