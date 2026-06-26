// Track C — write-API integration gate (task C11).
//
// Boots the node (node/main.ts) and exercises the WRITE surface end-to-end. Today that
// surface is the STUB (node/write-stub.ts), so the asserts are about CONTRACT SHAPE, not
// real semantics: routes exist, statuses are right, the request envelope round-trips, and
// transact names the receipt schema it will mint.
//
// The REAL-semantics asserts (a real transact returns a signed receipt; currency is
// conserved; durable replay-on-boot) are gated behind REAL_WRITE=1 and stay skipped until
// Track B's node replaces the stub. See deploy/B-CONTRACT.md.
//
// Run: `bun scripts/write-integration-gate.ts`. Exits non-zero on any failure.

import { loadConfig } from "../node/config";
import { main } from "../node/main";
import { V1_ROUTES } from "../node/write-stub";

const config = loadConfig({ READ_PORT: "8821", WRITE_PORT: "8822", SEED_REGIONS: "umi", SIM_TICKS: "4" });
const node = main(config);
const write = `http://localhost:${config.writePort}`;
const read = `http://localhost:${config.readPort}`;

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

// biome-ignore lint/suspicious/noExplicitAny: the gate inspects arbitrary JSON response shapes
async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

console.log("write-API integration gate (against the stub — contract shape only)\n");

try {
  // The read side must co-boot from the same main(config).
  const rh = await (await fetch(`${read}/health`)).json();
  check("read side co-boots (read /health ok=true)", rh.ok === true);

  // The write stub advertises itself + the 5 routes.
  const wh = await (await fetch(`${write}/health`)).json();
  check("write /health ok=true", wh.ok === true);
  check("write /health lists exactly the 5 /v1 routes", Array.isArray(wh.routes) && wh.routes.length === V1_ROUTES.length);

  // Every /v1 route: 501 + not-implemented + the posted envelope echoes back.
  for (const route of V1_ROUTES) {
    const body = { probe: route, nonce: 7 };
    const { status, json } = await postJson(`${write}${route}`, body);
    check(`${route} → 501`, status === 501);
    check(`${route} error="not-implemented"`, json.error === "not-implemented");
    check(`${route} echoes the request envelope`, JSON.stringify(json.received) === JSON.stringify(body));
  }

  // transact names the receipt schema the real route will mint.
  const tx = await postJson(`${write}/v1/transact`, { from: "alice@umi", to: "bob@umi", amount: 10 });
  check("transact echoes receipt schemaId alma.tx/receipt/v1", tx.json.expected?.receiptSchemaId === "alma.tx/receipt/v1");

  // Unknown route → 404 (not a blanket 501).
  const nf = await fetch(`${write}/v1/does-not-exist`);
  check("unknown /v1 route → 404", nf.status === 404);

  // REAL-semantics asserts — enabled when Track B's node is wired in.
  if (process.env.REAL_WRITE === "1") {
    const real = await postJson(`${write}/v1/transact`, { from: "alice@umi", to: "bob@umi", amount: 10 });
    check("REAL transact → 200", real.status === 200);
    check("REAL transact returns a receipt (alma.tx/receipt/v1)", real.json?.receipt?.schemaId === "alma.tx/receipt/v1");
  } else {
    console.log("  · real-semantics asserts skipped (set REAL_WRITE=1 once Track B's node replaces the stub)");
  }
} finally {
  node.stop();
}

if (failures > 0) {
  console.error(`\n✗ ${failures} write-integration check(s) FAILED`);
  process.exit(1);
}
console.log("\n✓ write-integration (stub contract) checks passed");
