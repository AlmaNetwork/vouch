// Layer 4 Environment (engine) — public surface.
//
// Owns world-state composition (root reducer / world factory) and the sanctioned
// WRITE path: founding, admission/immigration, and the value chokepoint
// (executeTransfer). Plus the M3 simulation driver (brains -> journal -> execute)
// and the §3-D emergence trigger. Imports downward only: agent, region,
// foundation, alma-core.

export { type PutDefinitionResult, putDefinition } from "./definitions";
export { assessCertificate, type CertAssessment, canTransactAcross, recognizeRegion, stanceToward } from "./diplomacy";
export { type EconomyConfig, economyStep, runEconomy } from "./driver";
export {
  assertCurrencyConserved,
  currencyOriginTotal,
  executeTransfer,
  isCurrencyConserving,
  isTransferable,
  type MintResult,
  mintCurrency,
  type TransferMove,
  type TransferResult,
} from "./economy";
export { detectEmergence, regionStance } from "./emergence";
export { emergenceProposal, experimenterProposal, proposeFounding, seedGenesis } from "./founding";
export { amendInstitution, castVote, openProposal, validateInstitutionChange } from "./governance";
export { type ItemResult, mintItem, transferItem } from "./items";
export { listRegion, type MarketResult, setRegionLifecycle, transferRegionOwnership } from "./market";
export { type AdmitSpec, admitAgent, admitTreasury, immigrate } from "./population";
export { drawResource, type ResourceResult, regenerateResources } from "./resource";
export { type ReinstateResult, reinstateAgent, type SuspendResult, suspendAgent } from "./sanctions";
export { type VouchResult, vouchFor } from "./social";
export {
  createAlmaWorld,
  INITIAL_WORLD_STATE,
  rehydrateAlmaWorld,
  rootReducer,
  type WorldCommit,
  type WorldState,
  type WorldViewOf,
} from "./state";
