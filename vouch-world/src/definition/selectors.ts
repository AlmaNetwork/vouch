// Read-only selectors over the definition slice.

import type { DefinitionRecord, DefinitionSlice } from "./types";

/** The CURRENT (latest) version of a definition, or undefined if the id was never defined. */
export function getDefinition(state: DefinitionSlice, id: string): DefinitionRecord | undefined {
  return state.definitions[id];
}

/** All current definition records, id-sorted for determinism (DET-1). */
export function listDefinitions(state: DefinitionSlice): DefinitionRecord[] {
  return Object.values(state.definitions).sort((a, b) => (a.id < b.id ? -1 : 1));
}
