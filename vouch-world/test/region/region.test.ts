import { describe, expect, test } from "bun:test";
import {
  INITIAL_WORLD_STATE,
  amendInstitution,
  createAlmaWorld,
  emergenceProposal,
  experimenterProposal,
  proposeFounding,
  rootReducer,
  seedGenesis,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import {
  EVENT_REGION_FOUNDED,
  type RegionDefinition,
  defineRegion,
  getRegion,
  listRegions,
  makeInstitutions,
  regionsByStatus,
} from "../../src/region";

// Two villages with DIFFERENT institutions, defined purely as data.
const STRICT: RegionDefinition = defineRegion(
  "yama",
  "Yama (strict)",
  makeInstitutions({
    schemaLedger: [{ schemaId: "alma.trust/artisan/v1", label: "artisan" }],
    verificationPolicy: { acceptedSchemaIds: ["alma.trust/artisan/v1"], rejectUnknownSchemas: true },
    diplomacyPolicy: { defaultStance: "reexamine", overrides: {} },
  }),
);

const LENIENT: RegionDefinition = defineRegion(
  "umi",
  "Umi (lenient)",
  makeInstitutions({
    schemaLedger: [{ schemaId: "alma.trust/artisan/v1" }, { schemaId: "alma.value/currency/v1" }],
    verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false },
    diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
  }),
);

describe("M2 — regions with institutions", () => {
  test("multiple villages with different institutions exist independently", () => {
    const world = createAlmaWorld("m2");
    seedGenesis(world, [STRICT, LENIENT]);

    const regions = listRegions(world.getState());
    expect(regions.map((r) => r.id).sort()).toEqual(["umi", "yama"]);

    // Institutions are independent.
    expect(getRegion(world.getState(), "yama")?.institutions.verificationPolicy.rejectUnknownSchemas).toBe(true);
    expect(getRegion(world.getState(), "umi")?.institutions.verificationPolicy.rejectUnknownSchemas).toBe(false);
    expect(getRegion(world.getState(), "yama")?.institutions.diplomacyPolicy.defaultStance).toBe("reexamine");
    expect(getRegion(world.getState(), "umi")?.institutions.diplomacyPolicy.defaultStance).toBe("absorb");

    // Genesis villages are born recognized.
    for (const r of regions) {
      expect(r.status).toBe("recognized");
    }
  });

  test("villages are data — region definitions carry their own institutions", () => {
    expect(STRICT.institutions.schemaLedger.length).toBe(1);
    expect(LENIENT.institutions.schemaLedger.length).toBe(2);
  });
});

describe("M2 — founding (propose/execute split)", () => {
  test("(a) the experimenter founds a village mid-run; it is logged with the proposer", () => {
    const world = createAlmaWorld("found");
    seedGenesis(world, [STRICT, LENIENT]);

    world.run(3); // world is running...
    const newland = defineRegion("nova", "Nova");
    const founded = proposeFounding(world, experimenterProposal(newland, "spun up by hand"));

    expect(founded.id).toBe("nova");
    // founded after 2 genesis events (seq 0,1) + 3 system.tick events (seq 2,3,4) => seq 5.
    expect(founded.foundedAtSeq).toBe(5); // ordered by log seq, not sim tick (audit G5)

    const event = world.log.all().find((e) => e.type === EVENT_REGION_FOUNDED && (e.payload as { region: RegionDefinition }).region.id === "nova");
    expect(event).toBeDefined();
    expect((event!.payload as { proposer: { kind: string; note?: string } }).proposer).toEqual({ kind: "experimenter", note: "spun up by hand" });
    expect(event!.tick).toBe(3);
  });

  test("a founded village is born UNRECOGNIZED", () => {
    const world = createAlmaWorld("unrec");
    seedGenesis(world, [STRICT]);
    const founded = proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova")));

    expect(founded.status).toBe("unrecognized");
    expect(regionsByStatus(world.getState(), "unrecognized").map((r) => r.id)).toEqual(["nova"]);
    expect(regionsByStatus(world.getState(), "recognized").map((r) => r.id)).toEqual(["yama"]);
  });

  test("the founding interface accepts BOTH external injection and (future) emergence", () => {
    const world = createAlmaWorld("both");
    seedGenesis(world, [STRICT]);

    // (a) experimenter
    const a = proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova")));
    // (b) emergence — same engine, same entry point; only the proposer differs.
    const b = proposeFounding(
      world,
      emergenceProposal(defineRegion("rift", "Rift"), "yama", "too strict", ["alice@yama", "bob@yama"]),
    );

    expect(a.proposer.kind).toBe("experimenter");
    expect(b.proposer.kind).toBe("emergence");
    expect(a.status).toBe("unrecognized");
    expect(b.status).toBe("unrecognized");
    // Both recorded with their proposer in the log.
    const founders = world.log
      .all()
      .filter((e) => e.type === EVENT_REGION_FOUNDED)
      .map((e) => (e.payload as { proposer: { kind: string } }).proposer.kind);
    expect(founders).toEqual(["genesis", "experimenter", "emergence"]);
  });

  test("invalid or duplicate region ids are rejected before any event is written", () => {
    const world = createAlmaWorld("reject");
    seedGenesis(world, [STRICT]);
    const before = world.log.length;

    expect(() => proposeFounding(world, experimenterProposal(defineRegion("Yama", "bad id")))).toThrow();
    expect(() => proposeFounding(world, experimenterProposal(defineRegion("yama", "dup")))).toThrow();

    expect(world.log.length).toBe(before); // nothing was logged
  });
});

describe("M2 — determinism still holds (replay reconstructs the regions)", () => {
  test("folding the log rebuilds the exact world state", () => {
    const world = createAlmaWorld("replay-m2");
    seedGenesis(world, [STRICT, LENIENT]);
    world.run(2);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova")));
    world.run(2);

    const rebuilt = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(world.getState());
    expect(rebuilt.tick).toBe(world.tick);
  });

  test("same seed + same founding script => identical history", () => {
    const build = () => {
      const w = createAlmaWorld("seed-x");
      seedGenesis(w, [STRICT, LENIENT]);
      w.run(3);
      proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova")));
      return w;
    };
    expect(build().log.digest()).toBe(build().log.digest());
  });
});

describe("M2 — legislator plumbing (§8): institution changes are swappable + logged", () => {
  test("an amendment replaces the policy as data and is recorded in the log", () => {
    const world = createAlmaWorld("amend");
    seedGenesis(world, [LENIENT]);

    const updated = amendInstitution(
      world,
      "umi",
      { policy: "verification", value: { acceptedSchemaIds: ["alma.trust/artisan/v1"], rejectUnknownSchemas: true } },
      { kind: "experimenter", note: "tightened by hand" },
    );

    expect(updated.institutions.verificationPolicy.rejectUnknownSchemas).toBe(true);

    const change = world.log.all().find((e) => e.type === "region.institution.changed");
    expect(change).toBeDefined();
    expect((change!.payload as { proposer: { kind: string } }).proposer.kind).toBe("experimenter");

    // and it replays deterministically
    const rebuilt = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(world.getState());
  });
});
