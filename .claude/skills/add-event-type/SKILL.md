---
name: add-event-type
description: Add a new event type to the vouch event-sourced world the safe way — event-type constant + payload type in the owning layer, a pure reducer case, a write helper in the environment that emits it as SYSTEM_ACTOR, and determinism + replay tests. Use when adding any new kind of fact to the world log (a new region/agent action, a new state transition).
---

# Add a new event type

Every state change in `vouch-world` is an event folded by a pure reducer. Adding a
new kind of state transition means adding an event type — never a direct mutation.
Follow these steps so the new event stays deterministic, replayable, and on the
right side of the layer boundaries.

## 0. Decide the owning layer

The event belongs to whichever **slice** it mutates:

- mutates region state → `region` (L2), folded by `regionReducer`
- mutates agent/economy state → `agent` (L3), folded by `agentReducer`

The **write helper that emits it always lives in `environment` (L4)** — the only
sanctioned write path. Lower layers define the event + reducer case; the environment
emits it.

## 1. Declare the constant + payload type

In the owning layer's `types.ts`, add a string constant and a payload type:

```ts
export const EVENT_REGION_RENAMED = "region.renamed";
export type RegionRenamedPayload = { regionId: string; displayName: string };
```

Conventions:
- The string is `dot.cased` and namespaced by area (`region.*`, `agent.*`,
  `economy.*`, `system.*`). It is a wire contract — tests match on it verbatim.
- Payload fields are plain JSON (no class instances, no `Date`).

## 2. Add a pure reducer case

In the owning layer's `state.ts` / `reducer.ts`, add a `case` to the reducer:

```ts
case EVENT_REGION_RENAMED: {
  const p = event.payload as RegionRenamedPayload;
  const existing = state.regions[p.regionId];
  if (!existing) return state;                       // no-op if absent
  return {
    ...state,
    regions: { ...state.regions, [p.regionId]: { ...existing, displayName: p.displayName } },
  };
}
```

Rules:
- **Pure.** `(state, event) => state`. No mutation, no clock, no RNG. Return a new
  object via spread.
- **No-op safely.** If the target doesn't exist (or the change is meaningless),
  return `state` unchanged — never insert a phantom entity.
- **Same reference when nothing changes.** The default branch returns `state`, and
  `rootReducer` already returns the same reference when no slice changed.
- If the event carries/affects **value (currency/credit)**, see step 4 — it must be
  gated to `SYSTEM_ACTOR` and conserve value.

## 3. Add the write helper in the environment

In `environment/`, add a function that takes a `CommitSink<WorldState>`, validates,
emits **one** event as `SYSTEM_ACTOR`, and reads the folded result back:

```ts
export function renameRegion(env: CommitSink<WorldState>, regionId: string, displayName: string): RegionState {
  const region = getRegion(env.getState(), regionId);
  if (!region) throw new Error(`renameRegion: unknown region "${regionId}"`);
  env.emit(EVENT_REGION_RENAMED, SYSTEM_ACTOR, { regionId, displayName });
  return getRegion(env.getState(), regionId)!;
}
```

- Take the narrowest capability: `CommitSink` (not the whole `World`).
- For ordinary failures prefer returning `{ok:false, reason}` (like
  `executeTransfer`); throw only for true internal bugs / programmer error.
- Export it from `environment/index.ts`.

## 4. If the event moves value — extra rules

- It may be emitted **only** from `executeTransfer` (the conservation monopoly). Do
  not add a second value-event producer.
- The reducer must honor it **only when `event.actor === SYSTEM_ACTOR`** (the
  actor-gate) and must apply settlements **atomically** (reject the whole event if
  any entry is unknown).
- Currency deltas across the settlement must sum to zero.

## 5. Tests (in `test/<layer>/`)

Add, at minimum:

- **Reducer behavior** — the happy path and the no-op/rejection path.
- **Determinism (forward):** same seed + same script ⇒ identical
  `world.log.digest()`.
- **Replay (reconstruction):** `replayState(w.log.all(), INITIAL_WORLD_STATE,
  rootReducer).state` `toEqual` `w.getState()`.
- For value events: **conservation** (sum currency before == after) and an
  **actor-gate** test (a forged event with a non-`"world"` actor is ignored).

## 6. Finish

- Run the `verify` skill (typecheck + tests, both packages).
- Update READMEs if a layer's surface or test count changed.
- Commit; open/extend the PR.
