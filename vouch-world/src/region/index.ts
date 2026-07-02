// Layer 2 Region — public surface.
//
// Villages as data-defined governance subjects (§2-1): the institution
// vocabulary (types), the slice reducer that folds region events, and read-only
// selectors. The WRITE path (founding/amend) and world-state composition live in
// environment/ (layer 4). Region imports only foundation (slice/event types).

export {
  canGovern,
  getRegion,
  isOwner,
  listRegions,
  ownedRegionsOf,
  ownerOf,
  type RegionSlice,
  regionReducer,
  regionsByStatus,
  regionsForSale,
} from "./state";
export * from "./types";
