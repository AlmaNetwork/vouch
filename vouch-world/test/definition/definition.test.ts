// RFC 0007 §4 — the definition store (log-stored, opaque-body, version-checked).

import { describe, expect, test } from "bun:test";
import { type DefinitionRecord, EVENT_DEFINITION_PUT, getDefinition, listDefinitions } from "../../src/definition";
import { createAlmaWorld, INITIAL_WORLD_STATE, putDefinition, rootReducer } from "../../src/environment";
import { replayState } from "../../src/foundation";

/** Narrow a Result to its failure reason (or undefined on success) — keeps assertions terse. */
const reason = (r: { ok: true } | { ok: false; reason: string }): string | undefined => (r.ok ? undefined : r.reason);

const rec = (over: Partial<DefinitionRecord> = {}): DefinitionRecord => ({
  kind: "command",
  id: "core.transfer",
  version: 1,
  status: "active",
  body: { effects: [{ op: "transfer" }] },
  ...over,
});

describe("RFC 0007 §4 — definition store", () => {
  test("putDefinition commits and getDefinition reads back", () => {
    const w = createAlmaWorld("def");
    const res = putDefinition(w, rec());
    expect(res).toEqual({ ok: true, id: "core.transfer", version: 1 });
    expect(getDefinition(w.getState(), "core.transfer")?.body).toEqual({ effects: [{ op: "transfer" }] });
  });

  test("versions are monotonic: v1 then v2 ok; a repeated v1 is rejected", () => {
    const w = createAlmaWorld("def");
    expect(putDefinition(w, rec({ version: 1 })).ok).toBe(true);
    expect(putDefinition(w, rec({ version: 2, body: { effects: [{ op: "transfer" }], note: "v2" } })).ok).toBe(true);
    expect(getDefinition(w.getState(), "core.transfer")?.version).toBe(2);
    // a gap or repeat is rejected
    expect(putDefinition(w, rec({ version: 2 }))).toEqual({ ok: false, reason: "non-monotonic-version" });
    expect(putDefinition(w, rec({ version: 4 }))).toEqual({ ok: false, reason: "non-monotonic-version" });
  });

  test("a brand-new id must arrive at version 1", () => {
    const w = createAlmaWorld("def");
    expect(putDefinition(w, rec({ id: "core.vouch", version: 2 }))).toEqual({ ok: false, reason: "non-monotonic-version" });
  });

  test("envelope validation reasons", () => {
    const w = createAlmaWorld("def");
    expect(reason(putDefinition(w, rec({ id: "nodot" })))).toBe("bad-definition-id");
    expect(reason(putDefinition(w, rec({ id: "kernel.mint" })))).toBe("reserved-namespace");
    expect(reason(putDefinition(w, rec({ status: "weird" as never })))).toBe("bad-status");
    expect(reason(putDefinition(w, rec({ kind: "" })))).toBe("bad-kind");
    expect(reason(putDefinition(w, rec({ version: 0 })))).toBe("bad-version");
    expect(reason(putDefinition(w, rec({ body: null as never })))).toBe("bad-body");
    expect(reason(putDefinition(w, rec({ body: [] as never })))).toBe("bad-body");
  });

  test("forged definition.put (non-SYSTEM_ACTOR) is ignored by the reducer", () => {
    const w = createAlmaWorld("def");
    // emit directly as a principal — the actor-gate must drop it
    w.emit(EVENT_DEFINITION_PUT, "mallory@umi", { record: rec() });
    expect(getDefinition(w.getState(), "core.transfer")).toBeUndefined();
  });

  test("the stored body is opaque and deep-frozen (form vs meaning)", () => {
    const w = createAlmaWorld("def");
    putDefinition(w, rec());
    const stored = getDefinition(w.getState(), "core.transfer");
    expect(Object.isFrozen(stored?.body)).toBe(true);
  });

  test("listDefinitions is id-sorted", () => {
    const w = createAlmaWorld("def");
    putDefinition(w, rec({ id: "core.vouch" }));
    putDefinition(w, rec({ id: "core.transfer" }));
    expect(listDefinitions(w.getState()).map((d) => d.id)).toEqual(["core.transfer", "core.vouch"]);
  });

  test("definitions replay from the log exactly", () => {
    const w = createAlmaWorld("def");
    putDefinition(w, rec({ id: "core.transfer", version: 1 }));
    putDefinition(w, rec({ id: "core.transfer", version: 2 }));
    putDefinition(w, rec({ id: "core.vouch", version: 1 }));

    const rebuilt = replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(w.getState());
  });
});
