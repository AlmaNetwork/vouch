// Governance intents (A2/C2): residents move their OWN institutions through the same
// request -> authority-check -> execute split as the economy. A brain returns a
// `propose` / `vote` intent; the driver journals it (agent.decided) and routes it
// through openProposal / castVote, whose canGovern gate decides whether the voice is
// binding. Politics becomes agent BEHAVIOR — observable, journaled, replayable.

import { describe, expect, test } from "bun:test";
import { keyPairFromSeed } from "vouch-core";
import { type Brain, currencySupply, EVENT_AGENT_DECIDED, voterBrain } from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  INITIAL_WORLD_STATE,
  immigrate,
  rootReducer,
  runEconomy,
  seedGenesis,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import {
  defineRegion,
  EVENT_GOV_PROPOSAL_OPENED,
  EVENT_GOV_VOTE_CAST,
  getRegion,
  type InstitutionChange,
  makeInstitutions,
} from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));

// The amendment the proposer campaigns for: a friendlier credit accrual.
const REFORM: InstitutionChange = {
  policy: "economy",
  value: { baseCostRate: 0.2, minCostRate: 0.05, repDiscount: 0.02, creditPerTx: 2 },
};

/** Proposes REFORM once (when the council floor is empty and the reform not yet law), else idles. */
const reformerBrain: Brain = (view) => {
  const region = view.homeRegion;
  if (region?.institutions.governance.kind === "council" && !region.openProposal && region.institutions.economyPolicy.creditPerTx !== 2) {
    return { kind: "propose", change: REFORM };
  }
  return { kind: "idle" };
};

// A council village: alice (artisan) proposes, bob (merchant) votes. Residents hold
// currency so the voterBrain's trading fallback makes the history roll-sensitive.
function councilWorld(seed: string, members: readonly string[] = ["alice@umi", "bob@umi", "carol@umi"], threshold = 2) {
  const w = createAlmaWorld(seed);
  const institutions = makeInstitutions({ governance: { kind: "council", members, threshold } });
  seedGenesis(w, [defineRegion("umi", "Umi", institutions)]);
  admitTreasury(w, "umi");
  for (const [name, role] of [
    ["alice", "artisan"],
    ["bob", "merchant"],
    ["carol", "broker"],
  ] as const) {
    admitAgent(w, { id: `${name}@umi`, region: "umi", role, valueProfile: "lenient", publicKey: "", currency: 100 });
  }
  return w;
}

describe("governance intents — politics as journaled agent behavior (A2/C2)", () => {
  test("a council amendment passes end-to-end through propose/vote intents", () => {
    const w = councilWorld("civics");
    expect(getRegion(w.getState(), "umi")?.institutions.economyPolicy.creditPerTx).toBe(1);
    const supplyBefore = currencySupply(w.getState());

    runEconomy(w, 2, { notary: NOTARY, brains: { artisan: reformerBrain, merchant: voterBrain, broker: voterBrain } });

    // politics moves no value: total currency (incl. treasury) is conserved across the run.
    expect(currencySupply(w.getState())).toBe(supplyBefore);

    // the reform is law: alice opened (vote 1), bob's vote hit the threshold in the reducer.
    expect(getRegion(w.getState(), "umi")?.institutions.economyPolicy.creditPerTx).toBe(2);
    expect(getRegion(w.getState(), "umi")?.openProposal).toBeNull();

    // every step of the politics is on the record: decisions journaled, gov events logged.
    const types = w.log.all().map((e) => e.type);
    expect(types).toContain(EVENT_AGENT_DECIDED);
    expect(types).toContain(EVENT_GOV_PROPOSAL_OPENED);
    expect(types).toContain(EVENT_GOV_VOTE_CAST);
    const journaled = w.log
      .all()
      .filter((e) => e.type === EVENT_AGENT_DECIDED)
      .map((e) => (e.payload as { intent: { kind: string } }).intent.kind);
    expect(journaled).toContain("propose");
    expect(journaled).toContain("vote");
  });

  test("a NON-member's governance intents are journaled but change nothing (authority gate)", () => {
    // only alice sits on the council; bob's propose and carol's vote have no standing.
    const w = councilWorld("civics-gate", ["alice@umi"], 1);
    runEconomy(w, 2, { notary: NOTARY, brains: { merchant: reformerBrain, broker: voterBrain } }); // alice idles (no artisan brain)

    const umi = getRegion(w.getState(), "umi");
    expect(umi?.institutions.economyPolicy.creditPerTx).toBe(1); // no reform
    expect(umi?.openProposal).toBeNull(); // bob's propose was refused at the gate
    // ...yet the ATTEMPT is on the record (the request was journaled before dispatch).
    const journaled = w.log
      .all()
      .filter((e) => e.type === EVENT_AGENT_DECIDED)
      .map((e) => (e.payload as { intent: { kind: string } }).intent.kind);
    expect(journaled).toContain("propose");
    expect(w.log.all().some((e) => e.type === EVENT_GOV_PROPOSAL_OPENED)).toBe(false);
  });

  test("an EMIGRATED council member still votes (seat is id-bound, not residency-bound)", () => {
    // bob keeps his umi seat but moves to yama; without cross-region voting the open
    // proposal could never reach threshold 2 and would wedge umi's floor forever.
    const w = councilWorld("civics-emigrant", ["alice@umi", "bob@umi"]);
    seedGenesis(w, [defineRegion("yama", "Yama")]);
    immigrate(w, "bob@umi", "yama");

    runEconomy(w, 2, { notary: NOTARY, brains: { artisan: reformerBrain, merchant: voterBrain } });

    expect(getRegion(w.getState(), "umi")?.institutions.economyPolicy.creditPerTx).toBe(2); // reform passed
    expect(getRegion(w.getState(), "umi")?.openProposal).toBeNull(); // the floor is not wedged
    expect(replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(w.getState());
  });

  test("determinism: same seed + same brains => byte-identical history", () => {
    const run = (seed: string) => {
      const w = councilWorld(seed);
      runEconomy(w, 3, { notary: NOTARY, brains: { artisan: reformerBrain, merchant: voterBrain, broker: voterBrain } });
      return w.log.digest();
    };
    expect(run("same")).toBe(run("same"));
    expect(run("same")).not.toBe(run("other"));
  });

  test("replay rebuilds the exact state from the log alone (brains never re-invoked)", () => {
    const w = councilWorld("civics-replay");
    runEconomy(w, 3, { notary: NOTARY, brains: { artisan: reformerBrain, merchant: voterBrain, broker: voterBrain } });
    expect(replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(w.getState());
  });
});
