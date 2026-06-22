// Layer 4 Environment (engine) — public surface.
//
// Owns world-state composition (root reducer / world factory) and the sanctioned
// WRITE path: founding, admission/immigration, and the value chokepoint
// (executeTransfer). Plus the M3 simulation driver (brains -> journal -> execute)
// and the §3-D emergence trigger. Imports downward only: agent, region,
// foundation, alma-core.

export { type WorldState, INITIAL_WORLD_STATE, rootReducer, createAlmaWorld } from "./state";
export {
  proposeFounding,
  experimenterProposal,
  emergenceProposal,
  seedGenesis,
  amendInstitution,
} from "./founding";
export {
  type TransferMove,
  type TransferResult,
  executeTransfer,
  isCurrencyConserving,
  isTransferable,
} from "./economy";
export { type AdmitSpec, admitAgent, admitTreasury, immigrate } from "./population";
export { type EconomyConfig, economyStep, runEconomy, detectEmergence, regionStance } from "./driver";
export { type CertAssessment, stanceToward, assessCertificate, canTransactAcross, recognizeRegion } from "./diplomacy";
