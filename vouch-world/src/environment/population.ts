// Layer 4 Environment — admission + immigration (write path for the agent slice).
//
// All of these go through the engine (§2-5): they validate, then emit one
// env-authored event the reducer folds. Agents never appear or move except here.

import { isValidIdentifier } from "vouch-core";
import {
  type AgentRole,
  type AgentState,
  EVENT_AGENT_ADMITTED,
  EVENT_AGENT_MIGRATED,
  getAgent,
  treasuryId,
  type ValueProfile,
} from "../agent";
import { getRegion } from "../region";
import { commit, readBackOrThrow, type WorldCommit } from "./state";

export interface AdmitSpec {
  id: string; // name@region
  region: string;
  role: AgentRole;
  valueProfile: ValueProfile;
  publicKey: string;
  currency?: number;
  credit?: number;
  sponsors?: readonly string[]; // RFC 0007 §10.1: agents that co-vouched at admission
}

export function admitAgent(env: WorldCommit, spec: AdmitSpec): AgentState {
  if (!isValidIdentifier(spec.id)) throw new Error(`admitAgent: invalid agent id "${spec.id}"`);
  if (!spec.id.endsWith(`@${spec.region}`)) {
    throw new Error(`admitAgent: agent id "${spec.id}" must be born in region "${spec.region}"`);
  }
  if (!getRegion(env.getState(), spec.region)) throw new Error(`admitAgent: region "${spec.region}" does not exist`);
  if (getAgent(env.getState(), spec.id)) throw new Error(`admitAgent: agent "${spec.id}" already exists`);

  // admittedAtSeq is NOT part of the payload: it derives from the event's own log
  // position, so the reducer stamps it at fold (RFC 0001 §4) and the log never carries
  // a placeholder that could mislead a raw-payload consumer.
  const agent: Omit<AgentState, "admittedAtSeq"> = {
    id: spec.id,
    region: spec.region,
    role: spec.role,
    publicKey: spec.publicKey,
    balances: { credit: spec.credit ?? 0, currency: spec.currency ?? 0 },
    reputation: 0,
    trust: 0,
    resources: 0,
    valueProfile: spec.valueProfile,
    suspension: null,
    sponsors: spec.sponsors ?? [],
  };
  commit(env, EVENT_AGENT_ADMITTED, { agent });

  return readBackOrThrow("admitAgent", getAgent(env.getState(), spec.id));
}

/** Admit the per-region treasury account (collects trust-cost fees so currency is conserved). */
export function admitTreasury(env: WorldCommit, region: string, initialCurrency = 0): AgentState {
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
export function immigrate(env: WorldCommit, agentId: string, toRegion: string): AgentState {
  if (!getAgent(env.getState(), agentId)) throw new Error(`immigrate: agent "${agentId}" does not exist`);
  if (!getRegion(env.getState(), toRegion)) throw new Error(`immigrate: region "${toRegion}" does not exist`);
  commit(env, EVENT_AGENT_MIGRATED, { agentId, toRegion });
  return readBackOrThrow("immigrate", getAgent(env.getState(), agentId));
}
