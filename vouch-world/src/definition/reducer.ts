// The definition-slice reducer (pure fold; runs live AND on replay).
//
// Like every state-changing slice, it gates at the top on SYSTEM_ACTOR (audit G8): a forged
// definition.put (authored by a non-system principal) is ignored on live fold and replay, so
// the definition store can be changed only through the env write path (putDefinition).

import { type Reducer, SYSTEM_ACTOR } from "../foundation";
import { type DefinitionPutPayload, type DefinitionSlice, EVENT_DEFINITION_PUT } from "./types";

export const definitionReducer: Reducer<DefinitionSlice> = (state, event) => {
  if (event.actor !== SYSTEM_ACTOR) return state;
  if (event.type === EVENT_DEFINITION_PUT) {
    // A put of an id sets its CURRENT version (a later put with version+1 replaces it, §4.3).
    // Monotonicity is enforced at the write path; the reducer stays a dumb last-writer fold.
    const { record } = event.payload as DefinitionPutPayload;
    return { definitions: { ...state.definitions, [record.id]: record } };
  }
  return state;
};
