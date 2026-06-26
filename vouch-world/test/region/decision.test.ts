import { describe, expect, test } from "bun:test";
import {
  INITIAL_WORLD_STATE,
  castBallot,
  createAlmaWorld,
  openDecision,
  rootReducer,
  seedGenesis,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import {
  type GovernanceAction,
  type RegionDefinition,
  councilMechanism,
  defineRegion,
  dictatorshipMechanism,
  getDecision,
  getRegion,
  makeInstitutions,
} from "../../src/region";

// A region starts STRICT (rejects unknown schemas); every test decides whether to
// flip it LENIENT. The decision is the same everywhere — only the FORM differs.
const FLIP_TO_LENIENT: GovernanceAction = {
  kind: "amendInstitution",
  change: { policy: "verification", value: { acceptedSchemaIds: [], rejectUnknownSchemas: false } },
};

function strictRegion(id: string, name: string, mechanism: RegionDefinition["institutions"]["decisionMechanism"]): RegionDefinition {
  return defineRegion(
    id,
    name,
    makeInstitutions({
      verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: true },
      decisionMechanism: mechanism,
    }),
  );
}

const isStrict = (state: ReturnType<ReturnType<typeof createAlmaWorld>["getState"]>, id: string) =>
  getRegion(state, id)!.institutions.verificationPolicy.rejectUnknownSchemas;

describe("T1 — decision mechanism as data", () => {
  test("dictatorship: the authority alone proposes and decides immediately", () => {
    const world = createAlmaWorld("t1-dictator");
    seedGenesis(world, [strictRegion("edo", "Edo (dictator)", dictatorshipMechanism("shogun@edo"))]);

    const d = openDecision(world, "edo", FLIP_TO_LENIENT, "shogun@edo");
    expect(d.outcome).toBe("open");

    // singleAuthority: one approving ballot from the authority resolves it.
    const resolved = castBallot(world, d.id, "shogun@edo", true);
    expect(resolved.outcome).toBe("approved");
    // ...and the action actually ran: the institution changed.
    expect(isStrict(world.getState(), "edo")).toBe(false);
  });

  test("dictatorship: a non-authority may neither propose nor vote", () => {
    const world = createAlmaWorld("t1-dictator-deny");
    seedGenesis(world, [strictRegion("edo", "Edo (dictator)", dictatorshipMechanism("shogun@edo"))]);

    expect(() => openDecision(world, "edo", FLIP_TO_LENIENT, "peasant@edo")).toThrow(/may not propose/);

    const d = openDecision(world, "edo", FLIP_TO_LENIENT, "shogun@edo");
    expect(() => castBallot(world, d.id, "peasant@edo", true)).toThrow(/not eligible/);
    // A blocked decision stays open; nothing changed.
    expect(getDecision(world.getState(), d.id)!.outcome).toBe("open");
    expect(isStrict(world.getState(), "edo")).toBe(true);
  });

  test("council (2-of-3): one approval is not enough; the second resolves and executes", () => {
    const world = createAlmaWorld("t1-council");
    seedGenesis(world, [strictRegion("kyo", "Kyo (council)", councilMechanism(["a@kyo", "b@kyo", "c@kyo"], 2))]);

    const d = openDecision(world, "kyo", FLIP_TO_LENIENT, "a@kyo");

    const after1 = castBallot(world, d.id, "a@kyo", true);
    expect(after1.outcome).toBe("open"); // 1 of 2 — still open
    expect(isStrict(world.getState(), "kyo")).toBe(true); // unchanged

    const after2 = castBallot(world, d.id, "b@kyo", true);
    expect(after2.outcome).toBe("approved"); // 2 of 2 — decided
    expect(isStrict(world.getState(), "kyo")).toBe(false); // executed

    // A late ballot on a resolved decision is refused.
    expect(() => castBallot(world, d.id, "c@kyo", true)).toThrow(/already approved/);
  });

  test("THE point: the SAME action + SAME single approval yields different results by FORM alone", () => {
    const world = createAlmaWorld("t1-contrast");
    seedGenesis(world, [
      strictRegion("edo", "Edo (dictator)", dictatorshipMechanism("a@edo")),
      strictRegion("kyo", "Kyo (council 2-of-3)", councilMechanism(["a@kyo", "b@kyo", "c@kyo"], 2)),
    ]);

    // One eligible member proposes and casts one approving ballot in EACH region.
    const dEdo = openDecision(world, "edo", FLIP_TO_LENIENT, "a@edo");
    const dKyo = openDecision(world, "kyo", FLIP_TO_LENIENT, "a@kyo");
    const rEdo = castBallot(world, dEdo.id, "a@edo", true);
    const rKyo = castBallot(world, dKyo.id, "a@kyo", true);

    // Same input, opposite outcome — the governance form is the independent variable.
    expect(rEdo.outcome).toBe("approved");
    expect(rKyo.outcome).toBe("open");
    expect(isStrict(world.getState(), "edo")).toBe(false); // dictator changed it
    expect(isStrict(world.getState(), "kyo")).toBe(true); // council has not yet
  });

  test("the whole decision is replayable: state rebuilds from the log alone", () => {
    const world = createAlmaWorld("t1-replay");
    seedGenesis(world, [strictRegion("kyo", "Kyo (council)", councilMechanism(["a@kyo", "b@kyo"], 2))]);
    const d = openDecision(world, "kyo", FLIP_TO_LENIENT, "a@kyo");
    castBallot(world, d.id, "a@kyo", true);
    castBallot(world, d.id, "b@kyo", true);

    const rebuilt = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(world.getState());
    // Sanity: the rebuilt decision carries the same resolved outcome.
    expect(getDecision(rebuilt.state, d.id)!.outcome).toBe("approved");
  });

  test("default form is the pre-T1 god hand: only SYSTEM_ACTOR may propose", () => {
    const world = createAlmaWorld("t1-default");
    // makeInstitutions() with no mechanism => systemFiatMechanism (status quo, as data).
    seedGenesis(world, [defineRegion("nova", "Nova (default)", makeInstitutions())]);

    expect(() => openDecision(world, "nova", FLIP_TO_LENIENT, "someone@nova")).toThrow(/may not propose/);
  });
});
