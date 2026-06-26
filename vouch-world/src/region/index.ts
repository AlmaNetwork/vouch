// Layer 2 Region — public surface.
//
// Villages as data-defined governance subjects (§2-1): the institution
// vocabulary (types), the slice reducer that folds region events, and read-only
// selectors. The WRITE path (founding/amend) and world-state composition live in
// environment/ (layer 4). Region imports only foundation (slice/event types).

export * from "./types";
export {
  type RegionSlice,
  regionReducer,
  listRegions,
  getRegion,
  regionsByStatus,
  ownerOf,
  ownedRegionsOf,
  canGovern,
  isOwner,
  regionsForSale,
} from "./state";
