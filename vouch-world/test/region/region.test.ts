import { describe, expect, test } from "bun:test";
import {
  amendInstitution,
  castVote,
  createAlmaWorld,
  emergenceProposal,
  experimenterProposal,
  INITIAL_WORLD_STATE,
  openProposal,
  proposeFounding,
  rootReducer,
  seedGenesis,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import {
  defineRegion,
  EVENT_REGION_FOUNDED,
  getRegion,
  listRegions,
  makeInstitutions,
  ownedRegionsOf,
  ownerOf,
  type RegionDefinition,
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

    const event = world.log
      .all()
      .find((e) => e.type === EVENT_REGION_FOUNDED && (e.payload as { region: RegionDefinition }).region.id === "nova");
    expect(event).toBeDefined();
    expect((event!.payload as { proposer: { kind: string; note?: string } }).proposer).toEqual({
      kind: "experimenter",
      note: "spun up by hand",
    });
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
    const b = proposeFounding(world, emergenceProposal(defineRegion("rift", "Rift"), "yama", "too strict", ["alice@yama", "bob@yama"]));

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

  test("founding validates institutions — a hand-built degenerate policy is rejected (no makeInstitutions bypass)", () => {
    const world = createAlmaWorld("foundval");
    seedGenesis(world, [STRICT]);
    const before = world.log.length;
    // hand-built Institutions that skip makeInstitutions' validation
    const badResource = { ...makeInstitutions(), resourcePolicy: { capacity: Number.NaN, regenPerTick: 5 } };
    const badEconomy = { ...makeInstitutions(), economyPolicy: { baseCostRate: 1.5, minCostRate: 1.5, repDiscount: 0, creditPerTx: 1 } };
    expect(() => proposeFounding(world, experimenterProposal(defineRegion("badr", "Bad", badResource), undefined, "acct:x"))).toThrow();
    expect(() => proposeFounding(world, experimenterProposal(defineRegion("bade", "Bad", badEconomy), undefined, "acct:x"))).toThrow();
    expect(world.log.length).toBe(before); // nothing founded
  });
});

describe("Track A — region ownership (governed by an account/ID; 1 person = 1 ID)", () => {
  test("genesis & emergence are system-owned (owner null); an ID can govern multiple regions", () => {
    const world = createAlmaWorld("owner");
    seedGenesis(world, [STRICT, LENIENT]);

    // Genesis villages are the established society — system/unowned.
    expect(getRegion(world.getState(), "yama")?.owner).toBeNull();
    expect(ownerOf(world.getState(), "umi")).toBeNull();

    // A human participant founds AND governs regions. Sybil rule is 1 person = 1 ID;
    // an ID may govern MULTIPLE regions (no one-region cap).
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova"), undefined, "acct:alice"));
    proposeFounding(world, experimenterProposal(defineRegion("harbor", "Harbor"), undefined, "acct:alice"));
    expect(ownerOf(world.getState(), "nova")).toBe("acct:alice");
    expect(
      ownedRegionsOf(world.getState(), "acct:alice")
        .map((r) => r.id)
        .sort(),
    ).toEqual(["harbor", "nova"]);
    expect(ownedRegionsOf(world.getState(), "acct:nobody")).toEqual([]);

    // A seceded region is system/unowned at birth (the market/claim assigns an owner later).
    proposeFounding(world, emergenceProposal(defineRegion("rift", "Rift"), "yama", "too strict", ["alice@yama"]));
    expect(ownerOf(world.getState(), "rift")).toBeNull();

    // owner is part of the derived state and survives replay.
    const rebuilt = replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer);
    expect(rebuilt.state).toEqual(world.getState());
  });
});

describe("Track A — regions are never deleted (append-only; sold, not destroyed)", () => {
  test("no event ever removes a region from the slice", () => {
    const world = createAlmaWorld("nodelete");
    seedGenesis(world, [STRICT, LENIENT]);
    world.run(2);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova"), undefined, "acct:alice"));
    amendInstitution(world, "nova", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:alice");
    world.run(2);

    // Fold the whole log event-by-event; the set of region ids must never shrink.
    let state = INITIAL_WORLD_STATE;
    let seen = 0;
    for (const event of world.log.all()) {
      state = rootReducer(state, event);
      const count = Object.keys(state.regions).length;
      expect(count).toBeGreaterThanOrEqual(seen); // append-only: regions are never removed
      seen = count;
    }
    expect(Object.keys(state.regions).sort()).toEqual(["nova", "umi", "yama"]);
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

describe("Track A — owner-scoped governance gate (§8 legislator, valve now OPEN+gated)", () => {
  test("dictatorship: only the owner may amend; a non-owner is rejected and writes nothing", () => {
    const world = createAlmaWorld("amend");
    seedGenesis(world, [LENIENT]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", makeInstitutions()), undefined, "acct:alice"));

    // the owner amends — allowed, recorded with the acting principal `by`
    const updated = amendInstitution(
      world,
      "nova",
      { policy: "verification", value: { acceptedSchemaIds: ["alma.trust/artisan/v1"], rejectUnknownSchemas: true } },
      "acct:alice",
    );
    expect(updated.institutions.verificationPolicy.rejectUnknownSchemas).toBe(true);
    const change = world.log.all().find((e) => e.type === "region.institution.changed");
    expect((change!.payload as { by: string }).by).toBe("acct:alice");

    // a non-owner may NOT amend — throws, and nothing is logged
    expect(() =>
      amendInstitution(
        world,
        "nova",
        { policy: "verification", value: { acceptedSchemaIds: [], rejectUnknownSchemas: false } },
        "acct:mallory",
      ),
    ).toThrow();
    expect(world.log.all().filter((e) => e.type === "region.institution.changed").length).toBe(1);

    // replays deterministically
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("council voting (P3): a member proposes, votes reach threshold, the amendment applies", () => {
    const world = createAlmaWorld("council");
    seedGenesis(world, [LENIENT]);
    const council = makeInstitutions({
      governance: { kind: "council", members: ["acct:a", "acct:b"], threshold: 2 },
      diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
    });
    proposeFounding(world, experimenterProposal(defineRegion("rep", "Rep", council), undefined, "acct:a"));

    // a single member may NOT amend directly — councils decide collectively
    expect(() =>
      amendInstitution(world, "rep", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:a"),
    ).toThrow();
    // a member proposes (counts as 1 vote); below threshold 2, nothing applies yet
    openProposal(world, "rep", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:a");
    expect(getRegion(world.getState(), "rep")?.institutions.diplomacyPolicy.defaultStance).toBe("absorb");
    // a non-member cannot vote
    expect(() => castVote(world, "rep", "acct:x")).toThrow();
    // the second member votes -> threshold reached -> the change APPLIES and the proposal clears
    castVote(world, "rep", "acct:b");
    expect(getRegion(world.getState(), "rep")?.institutions.diplomacyPolicy.defaultStance).toBe("reject");
    expect(getRegion(world.getState(), "rep")?.openProposal).toBeNull();

    // and the whole vote replays deterministically
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("an owner-null council cannot vote itself into an ungovernable dictatorship (brick)", () => {
    const world = createAlmaWorld("nullbrick");
    // a system-owned (owner null) council region — e.g. genesis seeded with council governance
    const council = makeInstitutions({
      governance: { kind: "council", members: ["acct:a", "acct:b"], threshold: 1 },
      diplomacyPolicy: { defaultStance: "absorb", overrides: {} },
    });
    seedGenesis(world, [defineRegion("umi", "Umi", council)]);
    // it IS governable by its members while a council...
    openProposal(world, "umi", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:a");
    expect(getRegion(world.getState(), "umi")?.institutions.diplomacyPolicy.defaultStance).toBe("reject");
    // ...but it may NOT vote itself to a dictatorship (owner null -> no one could ever govern it)
    expect(() => openProposal(world, "umi", { policy: "governance", value: { kind: "dictatorship" } }, "acct:a")).toThrow();
  });

  test("governance is amendable: a dictator opens a council, after which amendments require a vote", () => {
    const world = createAlmaWorld("constitution");
    seedGenesis(world, [LENIENT]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", makeInstitutions()), undefined, "acct:alice"));

    // the dictator (owner) opens a council (threshold 1) — a direct amend while still a dictatorship
    amendInstitution(
      world,
      "nova",
      { policy: "governance", value: { kind: "council", members: ["acct:alice", "acct:bob"], threshold: 1 } },
      "acct:alice",
    );
    expect(getRegion(world.getState(), "nova")?.institutions.governance.kind).toBe("council");

    // now a DIRECT amend is rejected; bob (a member) proposes — at threshold 1 it applies at once
    expect(() =>
      amendInstitution(world, "nova", { policy: "diplomacy", value: { defaultStance: "absorb", overrides: {} } }, "acct:bob"),
    ).toThrow();
    openProposal(world, "nova", { policy: "diplomacy", value: { defaultStance: "absorb", overrides: {} } }, "acct:bob");
    expect(getRegion(world.getState(), "nova")?.institutions.diplomacyPolicy.defaultStance).toBe("absorb");
    // a stranger can neither propose nor vote
    expect(() =>
      openProposal(world, "nova", { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } }, "acct:stranger"),
    ).toThrow();
  });

  test("a FORGED region.institution.changed (non-system actor) is ignored at the fold — can't seize governance (audit G8)", () => {
    const world = createAlmaWorld("forge");
    seedGenesis(world, [LENIENT]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", makeInstitutions()), undefined, "acct:alice"));
    const before = getRegion(world.getState(), "nova")?.institutions.governance.kind;

    // mallory (not the owner) forges an institution change with a self-asserted, non-system
    // actor — walking around the write-time canGovern gate. The reducer's actor-gate ignores it.
    world.emit("region.institution.changed", "acct:mallory", {
      regionId: "nova",
      change: { policy: "governance", value: { kind: "council", members: ["acct:mallory"], threshold: 1 } },
      by: "acct:mallory",
    });

    expect(getRegion(world.getState(), "nova")?.institutions.governance.kind).toBe(before); // no seizure
    expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
  });

  test("a governance change to an EMPTY council is rejected (no permanent brick)", () => {
    const world = createAlmaWorld("brick");
    seedGenesis(world, [LENIENT]);
    proposeFounding(world, experimenterProposal(defineRegion("nova", "Nova", makeInstitutions()), undefined, "acct:alice"));

    expect(() =>
      amendInstitution(world, "nova", { policy: "governance", value: { kind: "council", members: [], threshold: 1 } }, "acct:alice"),
    ).toThrow();
    // unchanged — still a governable dictatorship
    expect(getRegion(world.getState(), "nova")?.institutions.governance.kind).toBe("dictatorship");
  });
});
