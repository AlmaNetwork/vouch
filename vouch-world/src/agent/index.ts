// Layer 3 Agent (residents) — public surface.
//
// Identity/balance/reputation derived by folding the log (audit 3-A). Brains read
// a frozen view and return intents; the environment journals + executes them.
// Imports only foundation, region (types), and alma-core — never environment.

export { type Brain, defaultBrains, idleBrain, type ReadOnlyView, tradingBrain } from "./brain";
export { agentReducer } from "./reducer";
export { agentsInRegion, currencySupply, getAgent, listAgents, treasuryId } from "./selectors";
export * from "./types";
