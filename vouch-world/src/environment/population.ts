// Layer 4 Environment — admission + immigration (write path for the agent slice).
//
// All of these go through the engine (§2-5): they validate, then emit one
// env-authored event the reducer folds. Agents never appear or move except here.

import { isValidIdentifier } from "vouch-core";
import {
  EVENT_AGENT_ADMITTED,
  EVENT_AGENT_MIGRATED,
  type AgentRole,
  type AgentState,
  type ValueProfile,
  getAgent,
  treasuryId,
} from "../agent";
import { type CommitSink } from "../foundation";
import { getRegion } from "../region";
import type { WorldState } from "./state";

export interface AdmitSpec {
  id: string; // name@region
  region: string;
  role: AgentRole;
  valueProfile: ValueProfile;
  publicKey: string;
  currency?: number;
  credit?: number;
}

export function admitAgent(env: CommitSink<WorldState>, spec: AdmitSpec): AgentState {
  if (!isValidIdentifier(spec.id)) throw new Error(`admitAgent: invalid agent id "${spec.id}"`);
  if (!spec.id.endsWith(`@${spec.region}`)) {
    throw new Error(`admitAgent: agent id "${spec.id}" must be born in region "${spec.region}"`);
  }
  if (!getRegion(env.getState(), spec.region)) throw new Error(`admitAgent: region "${spec.region}" does not exist`);
  if (getAgent(env.getState(), spec.id)) throw new Error(`admitAgent: agent "${spec.id}" already exists`);

  const agent: AgentState = {
    id: spec.id,
    region: spec.region,
    role: spec.role,
    publicKey: spec.publicKey,
    balances: { credit: spec.credit ?? 0, currency: spec.currency ?? 0 },
    reputation: 0,
    trust: 0,
    valueProfile: spec.valueProfile,
  };
  env.commitSystem(EVENT_AGENT_ADMITTED, { agent });

  const admitted = getAgent(env.getState(), spec.id);
  if (!admitted) throw new Error("admitAgent: invariant violated");
  return admitted;
}

/** Admit the per-region treasury account (collects trust-cost fees so currency is conserved). */
export function admitTreasury(env: CommitSink<WorldState>, region: string, initialCurrency = 0): AgentState {
  return admitAgent(env, {
    id: treasuryId(region),
    region,
    role: "treasury",
    valueProfile: "lenient",
    publicKey: "",
    currency: initialCurrency,
  });
}

/** Move an agent to another region (§3-C). Founded (unrecognized) regions are valid targets. */
export function immigrate(env: CommitSink<WorldState>, agentId: string, toRegion: string): AgentState {
  if (!getAgent(env.getState(), agentId)) throw new Error(`immigrate: agent "${agentId}" does not exist`);
  if (!getRegion(env.getState(), toRegion)) throw new Error(`immigrate: region "${toRegion}" does not exist`);
  env.commitSystem(EVENT_AGENT_MIGRATED, { agentId, toRegion });
  const moved = getAgent(env.getState(), agentId);
  if (!moved) throw new Error("immigrate: invariant violated");
  return moved;
}
