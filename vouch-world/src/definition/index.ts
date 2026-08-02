// The definition store (RFC 0007 §4) — public surface.
//
// vouch-world holds definitions as OPAQUE, versioned envelopes in the log (form); the
// command interpreter (vouch-node) reads the body and gives it meaning. Imports only
// foundation.

export { definitionReducer } from "./reducer";
export { getDefinition, listDefinitions } from "./selectors";
export * from "./types";
