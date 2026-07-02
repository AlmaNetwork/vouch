// Layer 5 Observation (§5) — read-only metrics + the HTTP connection point.
//
// External clients connect here to WATCH the world; this layer only READS (§2-6).
// It imports downward (environment/region/agent/foundation) and never the write path.

export { gini, type Metrics, metrics } from "./metrics";
export { createObservationApp, type ObservationServer, serveObservation } from "./server";
