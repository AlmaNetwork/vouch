// Layer 4 Environment — the governance write path: amend institutions + council voting (§8).
//
// Split out of founding.ts: founding CREATES a region; governance CHANGES its rules
// afterward, gated by canGovern (dictatorship → the owner; council → a member, via a
// proposal that resolves at threshold in the region reducer, so it replays
// deterministically). Both write paths validate the change the same way
// (validateInstitutionChange).

import {
  canGovern,
  EVENT_GOV_PROPOSAL_OPENED,
  EVENT_GOV_VOTE_CAST,
  EVENT_REGION_INSTITUTION_CHANGED,
  getRegion,
  type InstitutionChange,
  type RegionState,
  validateEconomyPolicy,
  validateGovernance,
  validateResourcePolicy,
} from "../region";
import { commit, readBackOrThrow, type WorldCommit } from "./state";

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
// A council-governed region amends through a PROPOSAL that APPLIES once `threshold`
// members have voted (the proposer's open counts as the first vote, so a threshold-1
// council resolves at once). Resolution happens in the region reducer when the vote
// count crosses threshold, so it replays deterministically. The change is validated
// here, at propose time.

export function openProposal(env: WorldCommit, regionId: string, change: InstitutionChange, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`openProposal: region "${regionId}" does not exist`);
  if (region.institutions.governance.kind !== "council") throw new Error(`openProposal: region "${regionId}" is not council-governed`);
  if (!canGovern(region, by)) throw new Error(`openProposal: "${by}" is not a council member of region "${regionId}"`);
  if (region.openProposal) throw new Error(`openProposal: region "${regionId}" already has an open proposal`);
  validateInstitutionChange(change, region, "openProposal");
  commit(env, EVENT_GOV_PROPOSAL_OPENED, { regionId, change, by });
  return readBackOrThrow("openProposal", getRegion(env.getState(), regionId));
}

export function castVote(env: WorldCommit, regionId: string, by: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`castVote: region "${regionId}" does not exist`);
  if (!region.openProposal) throw new Error(`castVote: region "${regionId}" has no open proposal`);
  if (!canGovern(region, by)) throw new Error(`castVote: "${by}" is not a council member of region "${regionId}"`);
  if (region.openProposal.votes.includes(by)) throw new Error(`castVote: "${by}" already voted`);
  commit(env, EVENT_GOV_VOTE_CAST, { regionId, by });
  return readBackOrThrow("castVote", getRegion(env.getState(), regionId));
}
