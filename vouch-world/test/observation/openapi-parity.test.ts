import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { keyPairFromSeed } from "vouch-core";
import {
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  proposeFounding,
  seedGenesis,
} from "../../src/environment";
import { createObservationApp } from "../../src/observation";
import { defineRegion } from "../../src/region";

const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));

// openapi/read.yaml is the observation API's PUBLISHED CONTRACT. `redocly lint` (CI job
// `openapi`) proves the spec is valid; this test proves it MATCHES THE CODE, both ways:
// every spec path is served, and every served GET route is in the spec. Add a route or
// a path without the other and CI fails here.
const spec = Bun.YAML.parse(readFileSync(new URL("../../openapi/read.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};

function world() {
  const w = createAlmaWorld("openapi-parity");
  seedGenesis(w, [defineRegion("umi", "Umi")]);
  proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova")));
  admitTreasury(w, "umi");
  admitAgent(w, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
  admitAgent(w, { id: "bob@umi", region: "umi", role: "artisan", valueProfile: "lenient", publicKey: "", currency: 0 });
  executeTransfer(w, { from: "alice@umi", to: "bob@umi", amount: 40 }, { tick: 0, notary: NOTARY });
  return w;
}

// Substitute the spec's {id} templates with entities that exist in the world above.
function concretize(path: string): string {
  if (path.startsWith("/regions/")) return path.replace("{id}", "umi");
  if (path.startsWith("/agents/")) return path.replace("{id}", "alice@umi");
  return path;
}

describe("observation — OpenAPI spec ↔ code parity", () => {
  test("every spec path is GET-only and served with 200 by the real app", async () => {
    const w = world();
    const app = createObservationApp(w);
    const digestBefore = w.log.digest();

    for (const [path, operations] of Object.entries(spec.paths)) {
      expect(Object.keys(operations)).toEqual(["get"]); // the spec must never grow a write
      const res = await app.request(concretize(path));
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
    }

    expect(w.log.digest()).toBe(digestBefore); // reading every endpoint wrote nothing
  });

  test("every GET route the app serves is documented in the spec", () => {
    const app = createObservationApp(world());
    const served = new Set(app.routes.filter((r) => r.method === "GET").map((r) => r.path.replace(/:[A-Za-z]+/g, "{id}")));
    const documented = new Set(Object.keys(spec.paths));
    expect([...served].sort()).toEqual([...documented].sort());
  });
});
