// Layer 2 Region — the region read-model slice + its reducer + selectors.
//
// Region owns ONLY its slice of world state and the rules that fold region
// events into it. World-state OWNERSHIP and the write path live one layer up, in
// environment/ (audit G2). So region imports only foundation (event/reducer
// types) — never the composite WorldState, never the write engine.

import type { Reducer } from "../foundation";
import {
  EVENT_REGION_FOUNDED,
  EVENT_REGION_INSTITUTION_CHANGED,
  type InstitutionChangedPayload,
  type Institutions,
  type RegionFoundedPayload,
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
  }
}

/** Folds region-level events into the region slice. Ignores everything else. */
export const regionReducer: Reducer<RegionSlice> = (state, event) => {
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
