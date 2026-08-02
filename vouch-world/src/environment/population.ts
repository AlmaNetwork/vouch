// Layer 4 Environment — admission + immigration (write path for the agent slice).
//
// All of these go through the engine (§2-5): they validate, then emit one
// env-authored event the reducer folds. Agents never appear or move except here.

import { isValidIdentifier } from "vouch-core";
import {
  type AgentAdmission,
  type AgentRole,
  type AgentState,
  EVENT_AGENT_ADMITTED,
  EVENT_AGENT_MIGRATED,
  getAgent,
  treasuryId,
  type ValueProfile,
} from "../agent";
import { getRegion } from "../region";
import { MAX_BALANCE } from "./economy";
import { commit, readBackOrThrow, type WorldCommit } from "./state";

/** Longest `publicKey` accepted at admission — a base64 Ed25519 key is 44 characters. */
const MAX_PUBLIC_KEY_LENGTH = 64;
/** Most sponsors an admission may carry (RFC 0007 §10.1). */
const MAX_SPONSORS = 32;

/** An opening balance must be a non-negative integer no larger than `MAX_BALANCE`. */
function isValidOpeningBalance(v: number | undefined): boolean {
  return v === undefined || (Number.isInteger(v) && v >= 0 && v <= MAX_BALANCE);
}

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
  // These messages deliberately do NOT interpolate the offending value. The id arrives
  // from a request body, and echoing it back builds an error string as large as the
  // input we are in the middle of refusing.
  if (!isValidIdentifier(spec.id)) throw new Error("admitAgent: invalid agent id (must be a bounded name@region identifier)");
  if (!spec.id.endsWith(`@${spec.region}`)) {
    throw new Error(`admitAgent: agent id "${spec.id}" must be born in region "${spec.region}"`);
  }
  // Admission is the only path that MINTS currency into the world; a transfer merely
  // moves it. So this is the check that keeps the reported total supply meaningful.
  if (!isValidOpeningBalance(spec.currency)) throw new Error(`admitAgent: currency must be an integer in [0, ${MAX_BALANCE}]`);
  if (!isValidOpeningBalance(spec.credit)) throw new Error(`admitAgent: credit must be an integer in [0, ${MAX_BALANCE}]`);
  if (typeof spec.publicKey !== "string" || spec.publicKey.length > MAX_PUBLIC_KEY_LENGTH) {
    throw new Error(`admitAgent: publicKey must be a string of at most ${MAX_PUBLIC_KEY_LENGTH} characters`);
  }
  if (spec.sponsors && spec.sponsors.length > MAX_SPONSORS) throw new Error(`admitAgent: at most ${MAX_SPONSORS} sponsors`);
  if (!getRegion(env.getState(), spec.region)) throw new Error(`admitAgent: region "${spec.region}" does not exist`);
  if (getAgent(env.getState(), spec.id)) throw new Error(`admitAgent: agent "${spec.id}" already exists`);

  // The wire payload carries ONLY the admission ("birth certificate") fields; the reducer
  // materializes the full AgentState, defaulting derived/lifecycle fields and stamping
  // admittedAtSeq from the event's own seq (RFC 0001 §4) — so the log never carries a
  // placeholder that could mislead a raw-payload consumer, and AgentState can grow derived
  // fields without changing this wire shape (see AgentAdmission).
  const admission: AgentAdmission = {
    id: spec.id,
    region: spec.region,
    role: spec.role,
    publicKey: spec.publicKey,
    credit: spec.credit ?? 0,
    currency: spec.currency ?? 0,
    valueProfile: spec.valueProfile,
    sponsors: spec.sponsors ?? [],
  };
  commit(env, EVENT_AGENT_ADMITTED, { admission });

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
