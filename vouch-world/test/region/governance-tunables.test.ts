// RFC 0001 §4/§5 — governance tunables: electorate / quorum / tenure / maturity /
// weighting, and THE SNAPSHOT (the voter roll closes at proposal-open seq). Everything
// here is additive: with no tunables set, councils behave exactly as before.

import { describe, expect, test } from "bun:test";
import { keyPairFromSeed } from "vouch-core";
import { getAgent } from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  amendInstitution,
  castVote,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  immigrate,
  INITIAL_WORLD_STATE,
  mintCurrency,
  openProposal,
  proposeFounding,
  rootReducer,
  seedGenesis,
} from "../../src/environment";
import { replayState, type World } from "../../src/foundation";
import type { WorldState } from "../../src/environment";
import { defineRegion, getRegion, type Governance, type InstitutionChange, makeInstitutions, validateGovernance } from "../../src/region";

// A lenient genesis region so foreign-born citizens have a birthplace to come from.
const UMI = defineRegion("umi", "Umi", makeInstitutions({ diplomacyPolicy: { defaultStance: "absorb", overrides: {} } }));

// The stock non-constitutional change every test votes on (from absorb -> reject).
const DIPLO_REJECT: InstitutionChange = { policy: "diplomacy", value: { defaultStance: "reject", overrides: {} } };

// Deterministic notary for the settlements that earn reputation (the only sanctioned way).
const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(7));

/** Found a council-governed region "rep" (owner acct:gov) next to genesis umi. */
function councilWorld(seed: string, governance: Governance) {
  const world = createAlmaWorld(seed);
  seedGenesis(world, [UMI]);
  const institutions = makeInstitutions({ governance, diplomacyPolicy: { defaultStance: "absorb", overrides: {} } });
  proposeFounding(world, experimenterProposal(defineRegion("rep", "Rep", institutions), undefined, "acct:gov"));
  return world;
}

/** Admit `name@region` with an optional currency endowment (stake-weighting fuel). */
function admit(world: World<WorldState>, name: string, region: string, currency = 0) {
  return admitAgent(world, { id: `${name}@${region}`, region, role: "artisan", valueProfile: "lenient", publicKey: "", currency });
}

function stance(world: World<WorldState>) {
  return getRegion(world.getState(), "rep")?.institutions.diplomacyPolicy.defaultStance;
}

function proposal(world: World<WorldState>) {
  return getRegion(world.getState(), "rep")?.openProposal;
}

function expectReplays(world: World<WorldState>) {
  expect(replayState(world.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(world.getState());
}

describe("governance tunables (RFC 0001)", () => {
  test("defaults: a plain council behaves exactly as before (equal weight, no quorum), roll snapshot recorded", () => {
    const world = councilWorld("defaults", { kind: "council", members: ["acct:a", "acct:b"], threshold: 2 });
    openProposal(world, "rep", DIPLO_REJECT, "acct:a");
    // below threshold 2 nothing applies yet; the §5 snapshot is on the open proposal
    expect(stance(world)).toBe("absorb");
    const p = proposal(world);
    expect(p?.roll).toEqual([
      { voter: "acct:a", weight: 1 },
      { voter: "acct:b", weight: 1 },
    ]);
    const openedEvent = world.log.all().find((e) => e.type === "gov.proposal.opened");
    expect(p?.openedAtSeq).toBe(openedEvent!.seq);
    // historic numerics: 2 equal-weight ballots == the old votes.length >= threshold
    castVote(world, "rep", "acct:b");
    expect(stance(world)).toBe("reject");
    expect(proposal(world)).toBeNull();
    expectReplays(world);
  });

  test("admittedAtSeq: the agent reducer stamps the admission event's log seq (tenure substrate)", () => {
    const world = councilWorld("admseq", { kind: "council", members: ["acct:a"], threshold: 1 });
    admit(world, "alice", "rep");
    const admitted = world.log.all().find((e) => e.type === "agent.admitted");
    expect(getAgent(world.getState(), "alice@rep")?.admittedAtSeq).toBe(admitted!.seq);
    expectReplays(world);
  });

  test('electorate "citizens": the roll is citizenship (home region in the id), treasury excluded, residence irrelevant', () => {
    const world = councilWorld("citizens", { kind: "council", members: ["acct:gov"], threshold: 2, electorate: "citizens" });
    admitTreasury(world, "rep"); // bookkeeping account — never a citizen
    admit(world, "alice", "rep");
    admit(world, "bob", "rep");
    admit(world, "carol", "umi");
    immigrate(world, "carol@umi", "rep"); // resident of rep, but a CITIZEN of umi
    admit(world, "dave", "rep");
    immigrate(world, "dave@rep", "umi"); // living abroad, but still a CITIZEN of rep

    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    expect(proposal(world)?.roll.map((e) => e.voter)).toEqual(["alice@rep", "bob@rep", "dave@rep"]);
    // the proposer is a council member but NOT a citizen: its opening ballot weighs 0
    expect(stance(world)).toBe("absorb");
    // a resident non-citizen may not vote
    expect(() => castVote(world, "rep", "carol@umi")).toThrow(/not on the voter roll/);
    // two citizens' ballots reach the weight threshold — including the one living abroad
    castVote(world, "rep", "dave@rep");
    expect(stance(world)).toBe("absorb");
    castVote(world, "rep", "alice@rep");
    expect(stance(world)).toBe("reject");
    expect(proposal(world)).toBeNull();
    expectReplays(world);
  });

  test("tenureSeq: a too-fresh citizen is cut from the roll at open (seq-based tenure)", () => {
    const world = councilWorld("tenure", {
      kind: "council",
      members: ["acct:gov"],
      threshold: 1,
      electorate: "citizens",
      tenureSeq: 4,
    });
    admit(world, "alice", "rep"); // the incumbent
    // pad the log so alice's tenure matures (4+ seqs between her admission and the open)
    admit(world, "pad1", "umi");
    admit(world, "pad2", "umi");
    admit(world, "pad3", "umi");
    admit(world, "pad4", "umi");
    admit(world, "bob", "rep"); // the insurgent — admitted right before the open

    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    // openSeq - bob.admittedAtSeq == 1 < 4: bob is off the roll; alice is on it
    expect(proposal(world)?.roll.map((e) => e.voter)).toEqual(["alice@rep"]);
    expect(() => castVote(world, "rep", "bob@rep")).toThrow(/not on the voter roll/);
    castVote(world, "rep", "alice@rep"); // weight 1 >= threshold 1 -> applies
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("maturity: a constitutional (governance-kind) proposal is rejected until the electorate is large enough", () => {
    const world = councilWorld("maturity", {
      kind: "council",
      members: ["acct:gov"],
      threshold: 1,
      electorate: "citizens",
      maturity: 2,
    });
    admit(world, "alice", "rep");
    const constitutional: InstitutionChange = {
      policy: "governance",
      value: { kind: "council", members: ["acct:gov"], threshold: 2, electorate: "citizens" },
    };
    // one eligible citizen < maturity 2 — the gate rejects at open, nothing is logged
    expect(() => openProposal(world, "rep", constitutional, "acct:gov")).toThrow(/not mature/);
    expect(world.log.all().filter((e) => e.type === "gov.proposal.opened").length).toBe(0);
    // a second citizen matures the region; the same proposal now opens and passes
    admit(world, "bob", "rep");
    openProposal(world, "rep", constitutional, "acct:gov");
    castVote(world, "rep", "alice@rep"); // weight 1 >= current threshold 1 -> applies
    const g = getRegion(world.getState(), "rep")?.institutions.governance;
    expect(g?.kind === "council" && g.threshold).toBe(2);
    expectReplays(world);
  });

  test("quorum: a stake-weighted whale meets the weight threshold alone, but resolution waits for ballot count", () => {
    const world = councilWorld("quorum", {
      kind: "council",
      members: ["alice@rep", "bob@rep"],
      threshold: 5,
      weighting: "stake",
      quorum: 2,
    });
    admit(world, "alice", "rep", 10); // weight 1 + 10 = 11
    admit(world, "bob", "rep"); // weight 1 + 0 = 1

    openProposal(world, "rep", DIPLO_REJECT, "alice@rep");
    // weight 11 >= threshold 5, but only 1 ballot < quorum 2: the proposal stays open
    expect(stance(world)).toBe("absorb");
    expect(proposal(world)).not.toBeNull();
    castVote(world, "rep", "bob@rep"); // 2 ballots -> quorum met -> applies
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("§5 snapshot: mid-proposal admission changes neither the roll nor the outcome", () => {
    const world = councilWorld("snapshot", {
      kind: "council",
      members: ["alice@rep"],
      threshold: 2,
      electorate: "citizens",
    });
    admit(world, "alice", "rep");
    admit(world, "bob", "rep");
    openProposal(world, "rep", DIPLO_REJECT, "alice@rep"); // alice's ballot: weight 1 of 2
    expect(proposal(world)?.roll.map((e) => e.voter)).toEqual(["alice@rep", "bob@rep"]);

    // a citizen admitted AFTER the roll closed: invisible to this proposal
    admit(world, "carol", "rep");
    expect(proposal(world)?.roll.map((e) => e.voter)).toEqual(["alice@rep", "bob@rep"]);
    expect(() => castVote(world, "rep", "carol@rep")).toThrow(/not on the voter roll/);
    // and a mid-proposal emigration does not strip an on-roll voter either
    immigrate(world, "bob@rep", "umi");
    castVote(world, "rep", "bob@rep");
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("weighting: the same ballots resolve differently under equal vs stake weighting", () => {
    const make = (seed: string, weighting?: "equal" | "reputation" | "stake") => {
      const world = councilWorld(seed, {
        kind: "council",
        members: ["alice@rep", "bob@rep", "carol@rep"],
        threshold: 3,
        ...(weighting ? { weighting } : {}),
      });
      admit(world, "alice", "rep", 10);
      admit(world, "bob", "rep");
      admit(world, "carol", "rep");
      return world;
    };
    // equal weight: alice + bob == weight 2 < 3 — still open
    const equal = make("w-equal");
    openProposal(equal, "rep", DIPLO_REJECT, "alice@rep");
    castVote(equal, "rep", "bob@rep");
    expect(stance(equal)).toBe("absorb");
    expect(proposal(equal)).not.toBeNull();
    // stake weight: alice alone == 1 + 10 = 11 >= 3 — resolves on the opening ballot
    const stake = make("w-stake", "stake");
    openProposal(stake, "rep", DIPLO_REJECT, "alice@rep");
    expect(stance(stake)).toBe("reject");
    expect(proposal(stake)).toBeNull();
    expectReplays(equal);
    expectReplays(stake);
  });

  test("backward compat: a legacy proposal-opened event without a roll folds to the members / weight-1 roll", () => {
    const world = councilWorld("legacy", { kind: "council", members: ["acct:a", "acct:b"], threshold: 2 });
    // a pre-RFC log entry: env-authored, but no §5 snapshot in the payload
    world.commitSystem("gov.proposal.opened", { regionId: "rep", change: DIPLO_REJECT, by: "acct:a" });
    expect(proposal(world)?.roll).toEqual([
      { voter: "acct:a", weight: 1 },
      { voter: "acct:b", weight: 1 },
    ]);
    castVote(world, "rep", "acct:b"); // and the historic count semantics still resolve it
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("replay: a full tunables scenario rebuilds identically from the log alone", () => {
    const world = councilWorld("replay-all", {
      kind: "council",
      members: ["acct:gov"],
      threshold: 3,
      electorate: "citizens",
      weighting: "stake",
      quorum: 2,
      tenureSeq: 2,
    });
    admitTreasury(world, "rep");
    admit(world, "alice", "rep", 5);
    admit(world, "bob", "rep", 1);
    admit(world, "carol", "umi");
    immigrate(world, "carol@umi", "rep");
    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    admit(world, "dave", "rep", 100); // post-cutoff whale: irrelevant to the open proposal
    castVote(world, "rep", "alice@rep"); // weight 6 >= 3, ballots 1 < quorum 2
    expect(stance(world)).toBe("absorb");
    castVote(world, "rep", "bob@rep"); // ballots 2 -> binds
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("validateGovernance rejects each incoherent tunable at found/amend time", () => {
    const base = { kind: "council", members: ["acct:a", "acct:b"], threshold: 2 } as const;
    // each case pins the guard it must trip, so a mis-built case can't pass on the wrong throw
    const cases: readonly [Governance, RegExp][] = [
      [{ ...base, quorum: 0 }, /quorum must be an integer >= 1/],
      [{ ...base, quorum: 1.5 }, /quorum must be an integer >= 1/],
      [{ ...base, quorum: 3 }, /quorum must not exceed/], // members electorate: 3 ballots can never exist
      [{ ...base, tenureSeq: -1 }, /tenureSeq must be an integer >= 0/],
      [{ ...base, tenureSeq: 0.5 }, /tenureSeq must be an integer >= 0/],
      [{ ...base, maturity: -1 }, /maturity must be an integer >= 0/],
      [{ ...base, maturity: 2.5 }, /maturity must be an integer >= 0/],
      [{ ...base, electorate: "aliens" as unknown as "members" }, /electorate must be/],
      [{ ...base, weighting: "wealth" as unknown as "equal" }, /weighting must be/],
      [{ ...base, threshold: 3 }, /threshold must be an integer in \[1, 2\]/], // historic cap
    ];
    for (const [g, guard] of cases) expect(() => validateGovernance(g)).toThrow(guard);
    // coherent presets pass, including thresholds beyond members.length once weight is dynamic
    validateGovernance({ ...base, electorate: "citizens", quorum: 5, tenureSeq: 3, maturity: 4, weighting: "stake", threshold: 40 });
    validateGovernance({ ...base, weighting: "reputation", threshold: 10 });

    // and the amend path rejects them before anything is committed (same gate)
    const world = createAlmaWorld("val");
    seedGenesis(world, [UMI]);
    proposeFounding(world, experimenterProposal(defineRegion("rep", "Rep", makeInstitutions()), undefined, "acct:gov"));
    expect(() =>
      amendInstitution(world, "rep", { policy: "governance", value: { ...base, quorum: 0 } }, "acct:gov"),
    ).toThrow();
    expect(world.log.all().filter((e) => e.type === "region.institution.changed").length).toBe(0);
    expectReplays(world);
  });
});

// Hardening coverage from the adversarial review: boundary cuts, every weighting branch,
// the open-time attainability guards, and the frozen-weight half of the §5 snapshot.
describe("governance tunables — hardening (RFC 0001 review)", () => {
  test("tenureSeq boundary: exactly tenureSeq of standing qualifies; one seq less empties the roll", () => {
    // Measure the admission->open seq gap once (tenure 0), then rebuild the SAME op
    // script with tenureSeq == gap (alice exactly qualifies) and gap + 1 (she is cut).
    // Seq layout is op-determined, so the three worlds line up event-for-event.
    const script = (label: string, tenureSeq: number) => {
      const world = councilWorld(`tenure-edge-${label}`, {
        kind: "council",
        members: ["acct:gov"],
        threshold: 1,
        electorate: "citizens",
        tenureSeq,
      });
      admit(world, "alice", "rep");
      return { world, admittedAtSeq: getAgent(world.getState(), "alice@rep")!.admittedAtSeq };
    };
    const probe = script("probe", 0);
    const gap = probe.world.log.length - probe.admittedAtSeq; // the open will carry seq == log.length
    expect(gap).toBeGreaterThan(0);

    const exact = script("exact", gap);
    openProposal(exact.world, "rep", DIPLO_REJECT, "acct:gov");
    // openSeq - admittedAtSeq == tenureSeq exactly: >= keeps alice ON the roll
    expect(proposal(exact.world)?.roll.map((e) => e.voter)).toEqual(["alice@rep"]);

    const oneShort = script("short", gap + 1);
    // alice misses tenure by exactly one seq -> the roll empties -> weight 0 can never
    // reach threshold 1, so the open is REFUSED before commit (no stuck proposal).
    expect(() => openProposal(oneShort.world, "rep", DIPLO_REJECT, "acct:gov")).toThrow(/cannot reach threshold/);
    expect(oneShort.world.log.all().some((e) => e.type === "gov.proposal.opened")).toBe(false);
  });

  test("weighting 'reputation': earned reputation is the deciding weight (same ballots diverge from equal)", () => {
    const make = (seed: string, weighting: "equal" | "reputation") => {
      const world = councilWorld(seed, { kind: "council", members: ["acct:gov"], threshold: 2, electorate: "citizens", weighting });
      admitTreasury(world, "rep"); // fee sink for the settlement below
      admit(world, "alice", "rep", 50);
      admit(world, "bob", "rep");
      // reputation accrues only through a settled trade (+1 per leg) — earn it for real
      executeTransfer(world, { from: "alice@rep", to: "bob@rep", amount: 10 }, { tick: 0, notary: NOTARY });
      expect(getAgent(world.getState(), "alice@rep")!.reputation).toBeGreaterThanOrEqual(1);
      return world;
    };
    // reputation weighting: alice's single ballot weighs 1 + reputation >= 2 -> resolves alone
    const rep = make("w-rep", "reputation");
    openProposal(rep, "rep", DIPLO_REJECT, "acct:gov"); // off-roll opener: weight 0
    castVote(rep, "rep", "alice@rep");
    expect(stance(rep)).toBe("reject");
    // equal weighting, identical script + identical ballots: 1 < 2 stays open
    const eq = make("w-eq", "equal");
    openProposal(eq, "rep", DIPLO_REJECT, "acct:gov");
    castVote(eq, "rep", "alice@rep");
    expect(stance(eq)).toBe("absorb");
    expect(proposal(eq)).not.toBeNull();
    expectReplays(rep);
    expectReplays(eq);
  });

  test("the +1 weight floor: an all-zero-stake electorate still resolves (a fresh region cannot brick)", () => {
    const world = councilWorld("floor", { kind: "council", members: ["acct:gov"], threshold: 2, electorate: "citizens", weighting: "stake" });
    admit(world, "alice", "rep"); // currency 0 -> weight 1 + 0 = 1: the floor is all she has
    admit(world, "bob", "rep");
    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    castVote(world, "rep", "alice@rep");
    expect(stance(world)).toBe("absorb"); // 1 < 2
    castVote(world, "rep", "bob@rep");
    expect(stance(world)).toBe("reject"); // 1 + 1 == 2 — reachable ONLY because of the floor
    expectReplays(world);
  });

  test("open-time guards: an unresolvable proposal is refused BEFORE commit (threshold weight, quorum count)", () => {
    const a = councilWorld("guard-w", { kind: "council", members: ["acct:gov"], threshold: 99, electorate: "citizens" });
    admit(a, "alice", "rep");
    admit(a, "bob", "rep");
    expect(() => openProposal(a, "rep", DIPLO_REJECT, "acct:gov")).toThrow(/cannot reach threshold/);
    expect(a.log.all().some((e) => e.type === "gov.proposal.opened")).toBe(false);
    expect(proposal(a)).toBeNull();

    const b = councilWorld("guard-q", { kind: "council", members: ["acct:gov"], threshold: 1, electorate: "citizens", quorum: 3 });
    admit(b, "alice", "rep");
    admit(b, "bob", "rep");
    expect(() => openProposal(b, "rep", DIPLO_REJECT, "acct:gov")).toThrow(/below quorum/);
    expect(b.log.all().some((e) => e.type === "gov.proposal.opened")).toBe(false);
  });

  test("tenure x guards: a roll emptied by tenure refuses to open, then opens once tenure matures (no permanent brick)", () => {
    const world = councilWorld("guard-t", { kind: "council", members: ["acct:gov"], threshold: 1, electorate: "citizens", tenureSeq: 12 });
    admit(world, "alice", "rep");
    // every citizen is inside the tenure window: the §5 cut empties the roll, so the open
    // is refused pre-commit — before this guard was exact, it COMMITTED and permanently
    // bricked the council's single proposal slot (councils cannot amendInstitution).
    expect(() => openProposal(world, "rep", DIPLO_REJECT, "acct:gov")).toThrow(/cannot reach threshold/);
    expect(world.log.all().some((e) => e.type === "gov.proposal.opened")).toBe(false);
    // age the log past the tenure window; the SAME preset now opens and resolves
    for (let i = 0; i < 12; i++) admit(world, `pad${i}`, "umi");
    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    castVote(world, "rep", "alice@rep");
    expect(stance(world)).toBe("reject");
    expectReplays(world);
  });

  test("§5 snapshot: mid-proposal value movement never re-weights an open ballot", () => {
    // threshold 3 == the roll's frozen total (alice 1 + bob 2), so the open-time guard
    // passes — but bob ALONE stays short of it unless his weight were re-read live.
    const world = councilWorld("freeze", { kind: "council", members: ["acct:gov"], threshold: 3, electorate: "citizens", weighting: "stake" });
    admit(world, "alice", "rep"); // weight 1
    admit(world, "bob", "rep", 1); // weight 1 + 1 = 2
    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    const rollBefore = proposal(world)!.roll;
    mintCurrency(world, "bob@rep", 100, "post-open windfall"); // bob is now rich — too late
    castVote(world, "rep", "bob@rep");
    // a live re-read would give bob 1 + 101 = 102 >= 3 and resolve; the frozen roll
    // gives his ballot exactly 2 < 3, so the proposal stays open and the roll is intact
    expect(stance(world)).toBe("absorb");
    expect(proposal(world)).not.toBeNull();
    expect(proposal(world)!.roll).toEqual(rollBefore);
    expectReplays(world);
  });

  test("maturity gates only constitutional changes, and counts POST-tenure eligibility", () => {
    // below maturity, a NON-governance change still opens and resolves (§4 gates only
    // constitutional changes)
    const world = councilWorld("mat-scope", { kind: "council", members: ["acct:gov"], threshold: 1, electorate: "citizens", maturity: 2 });
    admit(world, "alice", "rep"); // 1 eligible < maturity 2
    openProposal(world, "rep", DIPLO_REJECT, "acct:gov");
    castVote(world, "rep", "alice@rep");
    expect(stance(world)).toBe("reject");
    // and maturity counts ELIGIBLE voters (citizenship x tenure), not raw citizens
    const fresh = councilWorld("mat-tenure", {
      kind: "council",
      members: ["acct:gov"],
      threshold: 1,
      electorate: "citizens",
      maturity: 1,
      tenureSeq: 50,
    });
    admit(fresh, "alice", "rep"); // a citizen, but inside the tenure window -> 0 eligible
    const constitutional: InstitutionChange = { policy: "governance", value: { kind: "council", members: ["acct:gov"], threshold: 1 } };
    expect(() => openProposal(fresh, "rep", constitutional, "acct:gov")).toThrow(/not mature/);
    expectReplays(world);
  });
});
