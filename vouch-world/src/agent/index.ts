// Layer 3 Agent (residents) — public surface.
//
// Identity/balance/reputation derived by folding the log (audit 3-A). Brains read
// a frozen view and return intents; the environment journals + executes them.
// Imports only foundation, region (types), and alma-core — never environment.

export * from "./types";
export { agentReducer } from "./reducer";
export { type Brain, type ReadOnlyView, idleBrain, tradingBrain, defaultBrains } from "./brain";
export { listAgents, getAgent, agentsInRegion, treasuryId } from "./selectors";
