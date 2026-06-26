// Layer 2 Region — the region read-model slice + its reducer + selectors.
//
// Region owns ONLY its slice of world state and the rules that fold region
// events into it. World-state OWNERSHIP and the write path live one layer up, in
// environment/ (audit G2). So region imports only foundation (event/reducer
// types) — never the composite WorldState, never the write engine.

import { SYSTEM_ACTOR, type Reducer } from "../foundation";
import {
  EVENT_REGION_FOUNDED,
  EVENT_REGION_INSTITUTION_CHANGED,
  EVENT_REGION_RECOGNIZED,
  type InstitutionChangedPayload,
  type Institutions,
  type RegionFoundedPayload,
  type RegionRecognizedPayload,
  type RegionState,
} from "./types";

/** The region read-model slice of world state. The environment composes this in. */
export type RegionSlice = { readonly regions: Readonly<Record<string, RegionState>> };

function applyInstitutionChange(institutions: Institutions, payload: InstitutionChangedPayload): Institutions {
  switch (payload.change.policy) {
    case "verification":
      return { ...institutions, verificationPolicy: payload.change.value };
    case "diplomacy":
      return { ...institutions, diplomacyPolicy: payload.change.value };
    case "schemaLedger":
      return { ...institutions, schemaLedger: payload.change.value };
    case "governance":
      return { ...institutions, governance: payload.change.value };
    case "economy":
      return { ...institutions, economyPolicy: payload.change.value };
  }
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
      };
      return { ...state, regions: { ...state.regions, [region.id]: region } };
    }
    case EVENT_REGION_INSTITUTION_CHANGED: {
      const p = event.payload as InstitutionChangedPayload;
      const existing = state.regions[p.regionId];
      if (!existing) return state;
      const updated: RegionState = { ...existing, institutions: applyInstitutionChange(existing.institutions, p) };
      return { ...state, regions: { ...state.regions, [p.regionId]: updated } };
    }
    case EVENT_REGION_RECOGNIZED: {
      const p = event.payload as RegionRecognizedPayload;
      const existing = state.regions[p.regionId];
      if (!existing || existing.status === "recognized") return state;
      return { ...state, regions: { ...state.regions, [p.regionId]: { ...existing, status: "recognized" } } };
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
