import { describe, expect, test } from "bun:test";
import {
  INITIAL_WORLD_STATE,
  admitAgent,
  createAlmaWorld,
  mintItem,
  rootReducer,
  seedGenesis,
  transferItem,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import { EVENT_ITEM_MINTED, getItem, itemsOwnedBy } from "../../src/item";
import { defineRegion, makeInstitutions } from "../../src/region";

function world() {
  const w = createAlmaWorld("items");
  seedGenesis(w, [defineRegion("umi", "Umi", makeInstitutions({ verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false }, diplomacyPolicy: { defaultStance: "absorb", overrides: {} } }))]);
  admitAgent(w, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 0 });
  admitAgent(w, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: "", currency: 0 });
  return w;
}

describe("Track A P3 — digital items (event-sourced ownership ledger)", () => {
  test("mint + transfer; holder-gated; forge ignored; replays exactly", () => {
    const w = world();

    // mint a unique item to alice
    expect(mintItem(w, "deed-1", "deed", "alice@umi").ok).toBe(true);
    expect(getItem(w.getState(), "deed-1")?.owner).toBe("alice@umi");
    expect(itemsOwnedBy(w.getState(), "alice@umi").map((i) => i.id)).toEqual(["deed-1"]);

    // can't mint a duplicate id, or to an unknown agent
    expect(mintItem(w, "deed-1", "deed", "alice@umi").ok).toBe(false); // item-exists
    expect(mintItem(w, "deed-2", "deed", "ghost@umi").ok).toBe(false); // unknown-agent

    // only the current HOLDER may transfer
    expect(transferItem(w, "deed-1", "bob@umi", "bob@umi").ok).toBe(false); // bob isn't the owner
    expect(transferItem(w, "deed-1", "bob@umi", "alice@umi").ok).toBe(true);
    expect(getItem(w.getState(), "deed-1")?.owner).toBe("bob@umi");
    expect(itemsOwnedBy(w.getState(), "alice@umi")).toEqual([]);

    // a forged (non-system) item event is ignored by the reducer's actor-gate
    w.emit(EVENT_ITEM_MINTED, "alice@umi", { itemId: "fake", kind: "x", owner: "alice@umi" });
    expect(getItem(w.getState(), "fake")).toBeUndefined();

    // the ledger is event-sourced and replays exactly
    expect(replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(w.getState());
  });
});
