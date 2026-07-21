import { describe, expect, test } from "bun:test";
import { keyPairFromSeed } from "vouch-core";
import { EVENT_AGENT_MIGRATED, EVENT_AGENT_VOUCHED } from "../../src/agent";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  immigrate,
  proposeFounding,
  seedGenesis,
  vouchFor,
} from "../../src/environment";
import { createObservationApp, gini, metrics, type ObservationServer } from "../../src/observation";
import { defineRegion } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));

// Response.json() is typed `unknown`; the world is the source of truth, not the wire.
type App = ReturnType<typeof createObservationApp>;
async function getJson(app: App, path: string): Promise<any> {
  return (await app.request(path)).json();
}

function world() {
  const w = createAlmaWorld("obs");
  seedGenesis(w, [defineRegion("umi", "Umi")]); // genesis -> recognized
  proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"))); // unrecognized
  admitTreasury(w, "umi");
  admitAgent(w, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
  admitAgent(w, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: "", currency: 0 });
  executeTransfer(w, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
  return w;
}

describe("observation — read-only metrics (§5)", () => {
  test("metrics summarize regions, agents, currency, and the log", () => {
    const m = metrics(world());
    expect(m.regions).toMatchObject({ total: 2, recognized: 1, unrecognized: 1 });
    expect(m.agents.residents).toBe(2);
    expect(m.agents.treasuries).toBe(1);
    expect(m.agents.totalCurrency).toBe(100); // conserved across the transfer
    expect(m.log.eventTypes["economy.settled"]).toBe(1);
  });

  test("RFC 0002 dependent variables: lifecycle, per-region, mobility, trust", () => {
    const m = metrics(world());

    // lifecycle (orthogonal to recognition): both regions are born active.
    expect(m.regions.active).toBe(2);
    expect(m.regions.dormant).toBe(0);

    // per-region breakdown: residency is derived from the agent slice.
    const umi = m.perRegion.find((r) => r.id === "umi");
    const nova = m.perRegion.find((r) => r.id === "nova");
    expect(umi?.residents).toBe(2);
    expect(umi?.lifecycle).toBe("active");
    expect(umi?.currencyGini).toBeGreaterThan(0); // 60 vs 40 after the transfer
    expect(nova?.residents).toBe(0);
    expect(nova?.currencyGini).toBe(0); // no residents

    // mobility: nothing migrated, seceded, or changed hands in this fixture.
    expect(m.mobility).toEqual({ migrations: 0, secessions: 0, ownershipTransfers: 0 });

    // reputation + trust aggregates exist and are numeric.
    expect(typeof m.agents.avgReputation).toBe("number");
    expect(typeof m.trust.vouches).toBe("number");
  });

  test("mobility + trust count system-authored behavior (migration, vouch)", () => {
    const w = world();
    immigrate(w, "alice@umi", "nova"); // residence umi -> nova (citizenship stays umi)
    vouchFor(w, "alice@umi", "bob@umi", 3);
    const m = metrics(w);
    expect(m.mobility.migrations).toBe(1);
    expect(m.trust.vouches).toBe(1);
    // residency follows the move: nova gains alice, umi is down to bob
    expect(m.perRegion.find((r) => r.id === "nova")?.residents).toBe(1);
    expect(m.perRegion.find((r) => r.id === "umi")?.residents).toBe(1);
  });

  test("forged (non-world) events show in the raw log but never in behavioral counters", () => {
    const w = world();
    // principal-authored events (actor != SYSTEM_ACTOR) — the reducers ignore them, but they sit in the log
    w.emit(EVENT_AGENT_VOUCHED, "acct:mallory", { from: "acct:mallory", to: "bob@umi", weight: 5 });
    w.emit(EVENT_AGENT_MIGRATED, "acct:mallory", { agentId: "bob@umi", toRegion: "nova" });
    const m = metrics(w);
    expect(m.log.eventTypes["agent.vouched"]).toBe(1); // raw distribution includes the forgery
    expect(m.log.eventTypes["agent.migrated"]).toBe(1);
    expect(m.trust.vouches).toBe(0); // behavioral counters ignore non-world actors
    expect(m.mobility.migrations).toBe(0);
    expect(m.perRegion.find((r) => r.id === "umi")?.residents).toBe(2); // bob did not actually move
  });

  test("gini is 0 when equal and rises with concentration", () => {
    expect(gini([10, 10, 10])).toBe(0);
    expect(gini([])).toBe(0);
    expect(gini([0, 0, 100])).toBeGreaterThan(0.5);
  });
});

describe("observation — the read-only HTTP connection point", () => {
  test("GET endpoints serve the world as JSON", async () => {
    const app = createObservationApp(world());

    expect((await getJson(app, "/health")).ok).toBe(true);
    expect((await getJson(app, "/metrics")).regions.total).toBe(2);

    const state = await getJson(app, "/state");
    expect(Object.keys(state.regions).sort()).toEqual(["nova", "umi"]);

    expect(Array.isArray(await getJson(app, "/regions"))).toBe(true);
    expect((await getJson(app, "/agents/alice@umi")).balances.currency).toBe(60);

    expect((await app.request("/regions/ghost")).status).toBe(404);

    const log = await getJson(app, "/log");
    expect(Array.isArray(log)).toBe(true);
    const tail = await getJson(app, "/log?since=3");
    expect(tail.length).toBeLessThan(log.length);
  });

  test("it is read-only: no write route, and watching never changes the world (§2-6)", async () => {
    const w = world();
    const app = createObservationApp(w);
    const before = w.log.digest();

    // there is no POST/PUT/DELETE route — writes 404
    expect((await app.request("/state", { method: "POST" })).status).toBe(404);
    expect((await app.request("/agents", { method: "DELETE" })).status).toBe(404);

    // reading every endpoint leaves the world byte-identical
    for (const path of ["/health", "/tick", "/metrics", "/state", "/regions", "/agents", "/log", "/log/digest"]) {
      await app.request(path);
    }
    expect(w.log.digest()).toBe(before);
  });

  test("the server type omits all mutators (read-only by construction)", () => {
    const noop: ObservationServer = { port: 0, stop: () => {} };
    expect(noop.port).toBe(0);
  });
});
