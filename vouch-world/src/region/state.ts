// Layer 2 Region — the region read-model slice + its reducer + selectors.
//
// Region owns ONLY its slice of world state and the rules that fold region
// events into it. World-state OWNERSHIP and the write path live one layer up, in
// environment/ (audit G2). So region imports only foundation (event/reducer
// types) — never the composite WorldState, never the write engine.

import { type Reducer, SYSTEM_ACTOR } from "../foundation";
import {
  EVENT_GOV_PROPOSAL_OPENED,
  EVENT_GOV_VOTE_CAST,
  EVENT_REGION_FOUNDED,
  EVENT_REGION_INSTITUTION_CHANGED,
  EVENT_REGION_LIFECYCLE_CHANGED,
  EVENT_REGION_LISTED,
  EVENT_REGION_OWNERSHIP_TRANSFERRED,
  EVENT_REGION_RECOGNIZED,
  EVENT_RESOURCE_DRAWN,
  EVENT_RESOURCE_REGENERATED,
  type GovProposalOpenedPayload,
  type GovRollEntry,
  type GovVoteCastPayload,
  type InstitutionChange,
  type InstitutionChangedPayload,
  type Institutions,
  type RegionFoundedPayload,
  type RegionLifecycleChangedPayload,
  type RegionListedPayload,
  type RegionOwnershipTransferredPayload,
  type RegionRecognizedPayload,
  type RegionState,
  type ResourceDrawnPayload,
  type ResourceRegeneratedPayload,
} from "./types";

/** The region read-model slice of world state. The environment composes this in. */
export type RegionSlice = { readonly regions: Readonly<Record<string, RegionState>> };

function applyInstitutionChange(institutions: Institutions, change: InstitutionChange): Institutions {
  switch (change.policy) {
    case "verification":
      return { ...institutions, verificationPolicy: change.value };
    case "diplomacy":
      return { ...institutions, diplomacyPolicy: change.value };
    case "schemaLedger":
      return { ...institutions, schemaLedger: change.value };
    case "governance":
      return { ...institutions, governance: change.value };
    case "economy":
      return { ...institutions, economyPolicy: change.value };
    case "resource":
      return { ...institutions, resourcePolicy: change.value };
  }
}

/**
 * Resolve a region's open council proposal: if its approving WEIGHT has reached the
 * council's `threshold` AND (when a quorum is set) enough BALLOTS were cast, APPLY the
 * (already-validated-at-propose-time) change and clear the proposal. Otherwise leave it
 * open. A no-op when there is no proposal.
 *
 * RFC 0001 §5: resolution reads ONLY the snapshot roll taken when the proposal opened —
 * weights were evaluated at open and the roll never changes afterwards, so admission /
 * migration / transfer timing cannot game an in-flight vote. A ballot from an ID that is
 * not on the roll (e.g. a proposer outside a "citizens" electorate) carries no weight and
 * does not count toward quorum. With the defaults (equal weight, no quorum) this is
 * numerically identical to the historic `votes.length >= threshold`.
 */
function resolveIfPassed(region: RegionState): RegionState {
  const p = region.openProposal;
  if (!p) return region;
  const g = region.institutions.governance;
  const threshold = g.kind === "council" ? g.threshold : 1;
  const quorum = g.kind === "council" ? g.quorum : undefined;
  let weight = 0;
  let ballots = 0;
  for (const vote of p.votes) {
    const entry = p.roll.find((e) => e.voter === vote);
    if (!entry) continue; // off-roll ballot: weightless, quorum-invisible
    weight += entry.weight;
    ballots += 1;
  }
  if (weight < threshold) return region;
  if (quorum !== undefined && ballots < quorum) return region;
  return { ...region, institutions: applyInstitutionChange(region.institutions, p.change), openProposal: null };
}

/** Folds region-level events into the region slice. Ignores everything else. */
export const regionReducer: Reducer<RegionSlice> = (state, event) => {
  // Defence in depth (audit G8, matching the economy reducer): every region event is
  // env-authored (SYSTEM_ACTOR via commitSystem). A forged non-system event — e.g. a
  // self-asserted region.institution.changed that would walk around the write-time
  // canGovern gate — is ignored here, on both live fold and replay.
  if (event.actor !== SYSTEM_ACTOR) return state;
  switch (event.type) {
    case EVENT_REGION_FOUNDED: {
      const p = event.payload as RegionFoundedPayload;
      const region: RegionState = {
        id: p.region.id,
        displayName: p.region.displayName,
        institutions: p.region.institutions,
        status: p.status,
        proposer: p.proposer,
        // ordered by the log's seq, NOT by the sim engine's tick (audit G5).
        foundedAtSeq: event.seq,
        owner: p.owner,
        lifecycle: "active", // born active; the owner may hibernate it later (P3)
        salePrice: null,
        openProposal: null,
        resourceLevel: 0, // the pool starts empty and is produced into per tick (P3)
      };
      return { ...state, regions: { ...state.regions, [region.id]: region } };
    }
    case EVENT_REGION_INSTITUTION_CHANGED: {
      const p = event.payload as InstitutionChangedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      const updated: RegionState = { ...existing, institutions: applyInstitutionChange(existing.institutions, p.change) };
      return { ...state, regions: { ...state.regions, [p.regionId]: updated } };
    }
    case EVENT_REGION_RECOGNIZED: {
      const p = event.payload as RegionRecognizedPayload;
      const existing = state.regions[p.regionId];
      if (!existing || existing.status === "recognized") return state;
      return { ...state, regions: { ...state.regions, [p.regionId]: { ...existing, status: "recognized" } } };
    }
    case EVENT_REGION_LIFECYCLE_CHANGED: {
      const p = event.payload as RegionLifecycleChangedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      return { ...state, regions: { ...state.regions, [p.regionId]: { ...existing, lifecycle: p.lifecycle } } };
    }
    case EVENT_REGION_LISTED: {
      const p = event.payload as RegionListedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      return { ...state, regions: { ...state.regions, [p.regionId]: { ...existing, salePrice: p.salePrice } } };
    }
    case EVENT_REGION_OWNERSHIP_TRANSFERRED: {
      // The region is PRESERVED (never deleted): institutions/residents/treasury survive; only
      // owner changes, it reactivates, and the listing clears. Governance RESETS to a dictatorship
      // under the NEW owner — otherwise a seller's stale council membership would keep amend rights
      // over a region they sold (the buyer can re-open a council). (audit: ownership-transfer review)
      const p = event.payload as RegionOwnershipTransferredPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      const transferred: RegionState = {
        ...existing,
        owner: p.to,
        lifecycle: "active",
        salePrice: null,
        openProposal: null, // any in-flight council vote is void once the asset changes hands
        institutions: { ...existing.institutions, governance: { kind: "dictatorship" } },
      };
      return { ...state, regions: { ...state.regions, [p.regionId]: transferred } };
    }
    case EVENT_GOV_PROPOSAL_OPENED: {
      const p = event.payload as GovProposalOpenedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      const g = existing.institutions.governance;
      if (g.kind !== "council") return state; // only councils vote
      if (existing.openProposal) return state; // one open proposal at a time
      // RFC 0001 §5 — THE SNAPSHOT. The env evaluated electorate x tenure + per-voter
      // weight at open (it knows the open seq pre-commit via CommitSink.nextSeq; this
      // reducer may never read the agent slice — layering) and shipped the FINAL roll in
      // the payload; it folds verbatim. openedAtSeq is stamped from event.seq (the
      // foundedAtSeq idiom, audit G5) and the roll closes for this proposal's lifetime
      // (§5 voter-roll cutoff). Forged rolls cannot reach here: this reducer folds only
      // SYSTEM_ACTOR-authored events, and commitSystem is env-only.
      const roll: readonly GovRollEntry[] = p.roll
        ? p.roll.map((c) => ({ voter: c.voter, weight: c.weight }))
        : // Legacy events predate the snapshot field: derive the historic electorate — the
          // listed members, weight 1 each — so old logs fold to exactly the old semantics.
          g.members.map((m) => ({ voter: m, weight: 1 }));
      // the proposer's open counts as their vote; resolve immediately if threshold is met
      const opened: RegionState = {
        ...existing,
        openProposal: { change: p.change, votes: [p.by], proposedBy: p.by, openedAtSeq: event.seq, roll },
      };
      return { ...state, regions: { ...state.regions, [p.regionId]: resolveIfPassed(opened) } };
    }
    case EVENT_GOV_VOTE_CAST: {
      const p = event.payload as GovVoteCastPayload;
      const existing = state.regions[p.regionId];
      if (!existing?.openProposal) return state;
      if (existing.openProposal.votes.includes(p.by)) return state; // no double vote
      const voted: RegionState = {
        ...existing,
        openProposal: { ...existing.openProposal, votes: [...existing.openProposal.votes, p.by] },
      };
      return { ...state, regions: { ...state.regions, [p.regionId]: resolveIfPassed(voted) } };
    }
    case EVENT_RESOURCE_REGENERATED: {
      const p = event.payload as ResourceRegeneratedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      // never overfill: the env already caps the amount, but clamp here as defence in depth.
      const level = Math.min(existing.institutions.resourcePolicy.capacity, existing.resourceLevel + p.amount);
      return { ...state, regions: { ...state.regions, [p.regionId]: { ...existing, resourceLevel: level } } };
    }
    case EVENT_RESOURCE_DRAWN: {
      const p = event.payload as ResourceDrawnPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      // pool -> agent is conserved; the env guarantees amount <= level, clamp at 0 in case.
      return {
        ...state,
        regions: { ...state.regions, [p.regionId]: { ...existing, resourceLevel: Math.max(0, existing.resourceLevel - p.amount) } },
      };
    }
    default:
      return state;
  }
};

// --- selectors (read-only; the observation layer will lean on these, §2-6) ---

export function listRegions(state: RegionSlice): RegionState[] {
  return Object.values(state.regions);
}

export function getRegion(state: RegionSlice, id: string): RegionState | undefined {
  return state.regions[id];
}

export function regionsByStatus(state: RegionSlice, status: RegionState["status"]): RegionState[] {
  return listRegions(state).filter((r) => r.status === status);
}

/** The account that governs a region, or null (system/unowned); undefined if no such region. */
export function ownerOf(state: RegionSlice, id: string): string | null | undefined {
  return state.regions[id]?.owner;
}

/** Regions governed by a given account/ID (an ID may govern 0..N regions). */
export function ownedRegionsOf(state: RegionSlice, account: string): RegionState[] {
  return listRegions(state).filter((r) => r.owner === account);
}

// --- governance predicates (operate on a single RegionState, not the slice) ---

/**
 * Does `principal` satisfy a region's governance rule — may it amend the institutions?
 * dictatorship → the principal IS the owner; council → the principal is a member.
 * (§8 owner-scoped gate. P2: a single member suffices; quorum/vote is P3.)
 */
export function canGovern(region: RegionState, principal: string): boolean {
  const g = region.institutions.governance;
  if (g.kind === "dictatorship") return region.owner !== null && principal === region.owner;
  return g.members.includes(principal);
}

/**
 * Is `principal` the region's OWNER? The owner controls the instance as an ASSET (lifecycle,
 * listing, ownership transfer) — distinct from `canGovern`, which controls its RULES (amends)
 * and may include a council. A system/unowned region (owner null) has no owner-actions.
 */
export function isOwner(region: RegionState, principal: string): boolean {
  return region.owner !== null && principal === region.owner;
}

/** Regions currently listed for sale on the market (salePrice set). */
export function regionsForSale(state: RegionSlice): RegionState[] {
  return listRegions(state).filter((r) => r.salePrice !== null);
}
