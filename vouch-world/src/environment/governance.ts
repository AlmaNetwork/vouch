// Layer 4 Environment — the governance write path: amend institutions + council voting (§8).
//
// Split out of founding.ts: founding CREATES a region; governance CHANGES its rules
// afterward, gated by canGovern (dictatorship → the owner; council → a member, via a
// proposal that resolves at threshold in the region reducer, so it replays
// deterministically). Both write paths validate the change the same way
// (validateInstitutionChange).

import { parseIdentifier } from "vouch-core";
import { type AgentState, getAgent, listAgents } from "../agent";
import {
  canGovern,
  EVENT_GOV_PROPOSAL_OPENED,
  EVENT_GOV_VOTE_CAST,
  EVENT_REGION_INSTITUTION_CHANGED,
  type Governance,
  type GovRollEntry,
  getRegion,
  type InstitutionChange,
  type RegionState,
  validateEconomyPolicy,
  validateGovernance,
  validateResourcePolicy,
} from "../region";
import { commit, readBackOrThrow, type WorldCommit, type WorldState } from "./state";

/**
 * Validate a proposed institution change against its region: a constitutional change
 * must leave the region governable (no empty council — checked in validateGovernance —
 * and no owner-null dictatorship), and economy/resource changes must stay within
 * bounds. Shared by the dictator amend path and the council proposal path.
 */
export function validateInstitutionChange(change: InstitutionChange, region: RegionState, op: string): void {
  if (change.policy === "governance") {
    validateGovernance(change.value);
    if (change.value.kind === "dictatorship" && region.owner === null) {
      throw new Error(`${op}: a system-owned (owner-null) region cannot become a dictatorship — it would be ungovernable`);
    }
  }
  if (change.policy === "economy") validateEconomyPolicy(change.value);
  if (change.policy === "resource") validateResourcePolicy(change.value);
}

/**
 * The owner-scoped governance gate (audit G8). An amendment to region R is honored ONLY
 * if `by` satisfies R's governance (dictatorship → the owner). Council-governed regions
 * decide collectively — a single member may NOT amend directly (use openProposal/castVote).
 * A dictator may open a council (governance itself is amendable).
 */
export function amendInstitution(env: WorldCommit, regionId: string, change: InstitutionChange, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`amendInstitution: region "${regionId}" does not exist`);
  if (region.institutions.governance.kind === "council") {
    throw new Error(`amendInstitution: region "${regionId}" is council-governed — use openProposal/castVote`);
  }
  if (!canGovern(region, by)) {
    throw new Error(
      `amendInstitution: "${by}" may not amend region "${regionId}" under its ${region.institutions.governance.kind} governance`,
    );
  }
  validateInstitutionChange(change, region, "amendInstitution");
  commit(env, EVENT_REGION_INSTITUTION_CHANGED, { regionId, change, by });
  return readBackOrThrow("amendInstitution", getRegion(env.getState(), regionId));
}

// --- council voting (§8, P3): collective amendments via proposal + votes -------------
//
// A council-governed region amends through a PROPOSAL that APPLIES once its approving
// WEIGHT reaches `threshold` (and, if set, `quorum` ballots were cast — RFC 0001 §4).
// The proposer's open counts as the first ballot, so a threshold-1 council resolves at
// once. Resolution happens in the region reducer over the §5 snapshot roll, so it
// replays deterministically. The change is validated here, at propose time.

type Council = Extract<Governance, { kind: "council" }>;

/**
 * A voter's ballot weight, evaluated at proposal OPEN (RFC 0001 §4/§5 weighting axis).
 * The +1 floor is deliberate: a fresh region where every citizen still has zero
 * reputation / currency must not brick (an all-zero-weight roll could never reach any
 * threshold), so every eligible voter counts at least 1 — the "every citizen counts"
 * baseline. A voter with no agent record (e.g. an "acct:" style council member) weighs
 * exactly that floor.
 */
function voteWeight(weighting: Council["weighting"], agent: AgentState | undefined): number {
  switch (weighting ?? "equal") {
    case "equal":
      return 1;
    case "reputation":
      return 1 + (agent?.reputation ?? 0);
    case "stake":
      return 1 + (agent?.balances.currency ?? 0);
  }
}

/** A roll candidate before the §5 tenure cut — internal to the open path. */
type RollCandidate = { readonly voter: string; readonly weight: number; readonly admittedAtSeq: number };

/**
 * Build the voter-roll CANDIDATES at proposal open (RFC 0001 §5). Electorate + per-voter
 * weight are evaluated HERE, against the agent slice — a computation only the environment
 * may perform (region/ never imports agent/, layering audit G2). Each candidate carries
 * its admittedAtSeq so openProposal can apply the seq-based tenure cut against the open
 * event's own seq (known pre-commit via CommitSink.nextSeq). Citizenship = the home
 * region encoded in the id (name@region), NOT current residence; the treasury account is
 * bookkeeping, not a citizen. Id-sorted for a deterministic roll order (DET-1).
 */
function buildRollCandidates(state: WorldState, regionId: string, g: Council): readonly RollCandidate[] {
  const voters =
    (g.electorate ?? "members") === "members"
      ? [...g.members].sort()
      : listAgents(state)
          .filter((a) => a.role !== "treasury" && parseIdentifier(a.id)?.region === regionId)
          .map((a) => a.id)
          .sort();
  return voters.map((voter) => {
    const agent = getAgent(state, voter);
    // A voter without an agent record has no admission event: treat it as admitted at the
    // dawn of the log (0), the legacy/edge default — it always satisfies tenure.
    return { voter, weight: voteWeight(g.weighting, agent), admittedAtSeq: agent?.admittedAtSeq ?? 0 };
  });
}

export function openProposal(env: WorldCommit, regionId: string, change: InstitutionChange, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`openProposal: region "${regionId}" does not exist`);
  if (region.institutions.governance.kind !== "council") throw new Error(`openProposal: region "${regionId}" is not council-governed`);
  if (!canGovern(region, by)) throw new Error(`openProposal: "${by}" is not a council member of region "${regionId}"`);
  if (region.openProposal) throw new Error(`openProposal: region "${regionId}" already has an open proposal`);
  validateInstitutionChange(change, region, "openProposal");
  const g = region.institutions.governance; // council — guarded above
  const candidates = buildRollCandidates(env.getState(), regionId, g);
  // RFC 0001 §5 — the tenure cut, applied HERE with the exact seq this open will carry
  // (CommitSink.nextSeq; single-writer, so nothing can interleave between it and the
  // commit below). The payload then carries the FINAL roll, and every gate below judges
  // the true franchise — a pre-/post-tenure mismatch can never commit an unresolvable
  // proposal.
  const openSeq = env.nextSeq();
  const tenureSeq = g.tenureSeq ?? 0;
  const roll: readonly GovRollEntry[] = candidates
    .filter((c) => openSeq - c.admittedAtSeq >= tenureSeq)
    .map(({ voter, weight }) => ({ voter, weight }));
  // RFC 0001 §4 founding-maturity gate: a governance-kind (constitutional) change may not
  // even be PROPOSED until the region holds >= maturity ELIGIBLE voters. Eligibility is
  // citizenship x tenure (§4), so this counts the post-tenure roll, as the RFC reads.
  if (change.policy === "governance" && g.maturity !== undefined && roll.length < g.maturity) {
    throw new Error(
      `openProposal: region "${regionId}" is not mature enough for a constitutional change (${roll.length} eligible < maturity ${g.maturity})`,
    );
  }
  // Brick guards in the validateGovernance spirit, now EXACT (the roll above is final): a
  // proposal whose roll can never muster `threshold` weight or `quorum` ballots would sit
  // unresolvable forever, permanently blocking the council's single proposal slot
  // (councils cannot amendInstitution directly) — so it is refused BEFORE commit.
  const totalWeight = roll.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight < g.threshold) {
    throw new Error(`openProposal: region "${regionId}" roll weight ${totalWeight} cannot reach threshold ${g.threshold} — unresolvable`);
  }
  if (g.quorum !== undefined && roll.length < g.quorum) {
    throw new Error(`openProposal: region "${regionId}" has ${roll.length} eligible voters, below quorum ${g.quorum} — unresolvable`);
  }
  const opened = commit(env, EVENT_GOV_PROPOSAL_OPENED, { regionId, change, by, roll });
  // The §5 cut above assumed exactly this seq; drift would silently shift the roll's
  // meaning, so treat it as an internal invariant break.
  if (opened.seq !== openSeq) throw new Error(`openProposal: invariant violated — open seq drifted (${openSeq} -> ${opened.seq})`);
  return readBackOrThrow("openProposal", getRegion(env.getState(), regionId));
}

export function castVote(env: WorldCommit, regionId: string, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`castVote: region "${regionId}" does not exist`);
  if (!region.openProposal) throw new Error(`castVote: region "${regionId}" has no open proposal`);
  // RFC 0001 §5: the snapshot roll IS the franchise. A voter not on it — ineligible at
  // open, or admitted/migrated after the cutoff — is rejected regardless of council
  // membership; under a "citizens" electorate, citizens vote without being listed members.
  if (!region.openProposal.roll.some((entry) => entry.voter === by)) {
    throw new Error(`castVote: "${by}" is not on the voter roll of the open proposal in region "${regionId}"`);
  }
  if (region.openProposal.votes.includes(by)) throw new Error(`castVote: "${by}" already voted`);
  commit(env, EVENT_GOV_VOTE_CAST, { regionId, by });
  return readBackOrThrow("castVote", getRegion(env.getState(), regionId));
}
