// RFC 0007 §3.8/§4 — the data-defined command interpreter.
//
// The headline proof (E1): a command run FROM DATA (`core.transfer`, a log-stored definition)
// produces byte-identical events to the hardcoded `dispatch` switch. Same authority check,
// same effect — the difference is only WHERE the command lives (data vs code).

import { describe, expect, test } from "bun:test";
import { encodeBase64, keyPairFromSeed } from "vouch-core";
import { getAgent } from "vouch-world/agent";
import { admitAgent, admitTreasury, createAlmaWorld, putDefinition, seedGenesis } from "vouch-world/environment";
import { defineRegion, makeInstitutions } from "vouch-world/region";
import { dispatch } from "../src/commands";
import { CORE_TRANSFER, executeCommand, seedCoreDefinitions } from "../src/lib";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));
const pub = (n: number) => encodeBase64(keyPairFromSeed(new Uint8Array(32).fill(n)).publicKey);

const lenient = () =>
  makeInstitutions({
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  });

function world(seed = "interp") {
  const w = createAlmaWorld(seed);
  seedGenesis(w, [defineRegion("umi", "Umi", lenient())]);
  admitTreasury(w, "umi");
  admitAgent(w, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: pub(1), currency: 100 });
  admitAgent(w, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: pub(2), currency: 0 });
  seedCoreDefinitions(w);
  return w;
}

describe("RFC 0007 — data-defined command interpreter", () => {
  // E1 — the equivalence proof --------------------------------------------------
  test("data-defined core.transfer emits byte-identical events to hardcoded dispatch (E1)", () => {
    const dataWorld = world();
    const codeWorld = world();

    const dataRes = executeCommand(
      dataWorld,
      { definitionId: "core.transfer", actor: "alice@umi", payload: { from: "alice@umi", to: "bob@umi", amount: 40 } },
      { notary: NOTARY },
    );
    const codeRes = dispatch(
      codeWorld,
      "alice@umi",
      { kind: "transfer", from: "alice@umi", to: "bob@umi", amount: 40 },
      { notary: NOTARY },
    );

    expect(dataRes).toEqual({ ok: true, effects: 1 });
    expect(codeRes.ok).toBe(true);
    // identical histories: the data path and the code path are indistinguishable in the log.
    expect(dataWorld.log.digest()).toBe(codeWorld.log.digest());
    expect(getAgent(dataWorld.getState(), "bob@umi")?.balances.currency).toBe(32); // 40 - fee 8
  });

  // E2 — data-defined core.vouch ------------------------------------------------
  test("data-defined core.vouch raises the subject's trust (E2)", () => {
    const w = world();
    const res = executeCommand(
      w,
      { definitionId: "core.vouch", actor: "alice@umi", payload: { from: "alice@umi", to: "bob@umi", weight: 3 } },
      { notary: NOTARY },
    );
    expect(res).toEqual({ ok: true, effects: 1 });
    expect(getAgent(w.getState(), "bob@umi")?.trust).toBe(3);
  });

  // preconditions ---------------------------------------------------------------
  test("isSelf precondition fails when the actor is not `from`, and NO effect runs", () => {
    const w = world();
    const digestBefore = w.log.digest();
    const res = executeCommand(
      w,
      { definitionId: "core.transfer", actor: "bob@umi", payload: { from: "alice@umi", to: "bob@umi", amount: 40 } },
      { notary: NOTARY },
    );
    expect(res).toEqual({ ok: false, reason: "precondition-failed:isSelf" });
    expect(w.log.digest()).toBe(digestBefore); // rejected before any effect emitted
  });

  // effect-level reasons pass through -------------------------------------------
  test("a primitive-level failure (insufficient-funds) surfaces as the effect's reason", () => {
    const w = world();
    const res = executeCommand(
      w,
      { definitionId: "core.transfer", actor: "alice@umi", payload: { from: "alice@umi", to: "bob@umi", amount: 999 } },
      { notary: NOTARY },
    );
    expect(res).toEqual({ ok: false, reason: "insufficient-funds" });
  });

  // definition lifecycle --------------------------------------------------------
  test("unknown definition is rejected", () => {
    const w = world();
    const res = executeCommand(w, { definitionId: "core.nope", actor: "alice@umi", payload: {} }, { notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "unknown-definition" });
  });

  test("a retired definition is not runnable", () => {
    const w = world();
    // bump core.transfer to v2 with status retired
    putDefinition(w, { ...CORE_TRANSFER, version: 2, status: "retired" });
    const res = executeCommand(
      w,
      { definitionId: "core.transfer", actor: "alice@umi", payload: { from: "alice@umi", to: "bob@umi", amount: 10 } },
      { notary: NOTARY },
    );
    expect(res).toEqual({ ok: false, reason: "definition-retired" });
  });

  test("a malformed body (unknown op) is rejected as malformed-definition", () => {
    const w = createAlmaWorld("bad");
    seedGenesis(w, [defineRegion("umi", "Umi", lenient())]);
    putDefinition(w, { kind: "command", id: "core.weird", version: 1, status: "active", body: { effects: [{ op: "teleport" }] } });
    const res = executeCommand(w, { definitionId: "core.weird", actor: "alice@umi", payload: {} }, { notary: NOTARY });
    expect(res).toEqual({ ok: false, reason: "malformed-definition" });
  });
});
