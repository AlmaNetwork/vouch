// Layer 4 Environment — social: the "vouch" verb (the brand's namesake action).
//
// One agent VOUCHES for another, raising the subject's trust — accumulated social capital,
// kept DISTINCT from economy-derived reputation (so a vouch does not directly buy a cheaper
// fee). Env-authored via commitSystem and reducer-gated like every other state change.
// Sybil-resistance of the vouch graph (cap reciprocal / low-cost vouches, weight by the
// voucher's own standing, one-account-one-ID) is a later milestone (P3).

import { EVENT_AGENT_VOUCHED, getAgent } from "../agent";
import type { Result } from "../foundation";
import type { WorldCommit } from "./state";

export type VouchResult = Result;

const MIN_WEIGHT = 1;
const MAX_WEIGHT = 5; // matches the EndorsementCredential weight range

/** `from` vouches for `to` with `weight` (1..5), raising `to`'s trust. User-level failures return a reason. */
export function vouchFor(env: WorldCommit, from: string, to: string, weight: number): VouchResult {
  if (from === to) return { ok: false, reason: "self-vouch" };
  if (!Number.isInteger(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) return { ok: false, reason: "bad-weight" };
  const state = env.getState();
  if (!getAgent(state, from) || !getAgent(state, to)) return { ok: false, reason: "unknown-agent" };
  env.commitSystem(EVENT_AGENT_VOUCHED, { from, to, weight });
  return { ok: true };
}
