// Track C — the READ side of the node: composed with the REAL engine + observation layer
// (task C8). This wraps actual vouch-world code (createAlmaWorld → seed → admit → serve);
// only the CORS shim and the Bun.serve wiring are Track C's. The world is finite on this
// build (seed + run N ticks, then serve a static snapshot) — see deploy/B-CONTRACT.md for
// the "static vs live-advancing" question that is Track B's to settle.

import { type KeyPair, keyPairFromSeed } from "../vouch-core/src/index";
import {
  type WorldState,
  admitAgent,
  admitTreasury,
  createAlmaWorld,
  runEconomy,
  seedGenesis,
} from "../vouch-world/src/environment";
import type { WorldView } from "../vouch-world/src/foundation";
import { createObservationApp } from "../vouch-world/src/observation";
import { defineRegion, makeInstitutions } from "../vouch-world/src/region";
import type { NodeConfig } from "./config";

export interface ServerHandle {
  readonly port: number;
  stop(): void;
}

/** Build the 32-byte ed25519 seed from a NOTARY_KEY_SOURCE value. */
function toSeed(material: string): Uint8Array {
  // A 64-char hex string decodes to exactly 32 bytes; anything else is filled deterministically.
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = Number.parseInt(material.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const out = new Uint8Array(32);
  const src = new TextEncoder().encode(material || "0");
  for (let i = 0; i < 32; i++) out[i] = ((src[i % src.length] ?? 0) ^ (i * 31)) & 0xff;
  return out;
}

/**
 * Resolve the region notary key pair from the configured source. NOTE (B-CONTRACT.md §4):
 * real key custody — raw private keys, secure storage, rotation — is a Track A/B concern.
 * This skeleton only orchestrates the existing `keyPairFromSeed` primitive; it never invents
 * custody and never accepts a client-supplied key.
 */
function resolveNotary(source: string): KeyPair {
  const [scheme, rest] = source.split("://");
  if (scheme === "seed") return keyPairFromSeed(toSeed(rest ?? ""));
  if (scheme === "env") return keyPairFromSeed(toSeed(process.env[rest ?? ""] ?? ""));
  if (scheme === "file") {
    // Bun.file is sync-readable via .text()? keep it deterministic + simple: read as text seed.
    throw new Error(`notary: file:// source is reserved for Track B custody (got "${source}")`);
  }
  throw new Error(`notary: unknown key source scheme "${scheme}"`);
}

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Compose the read world from config: genesis regions + treasury + demo residents, then run. */
export function composeReadWorld(config: NodeConfig) {
  const world = createAlmaWorld(config.seed);
  for (const region of config.seedRegions) {
    seedGenesis(world, [
      defineRegion(
        region,
        capitalize(region),
        makeInstitutions({ verificationPolicy: { acceptedSchemaIds: [], rejectUnknownSchemas: false } }),
      ),
    ]);
    admitTreasury(world, region);
    for (const name of ["alice", "bob", "carol"]) {
      admitAgent(world, { id: `${name}@${region}`, region, role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
    }
  }
  if (config.simTicks > 0) {
    runEconomy(world, config.simTicks, { notary: resolveNotary(config.notaryKeySource), criticalMass: 99 });
  }
  return world;
}

/** CORS headers for an allowed origin, or null when CORS is off / the origin isn't allowed. */
function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> | null {
  if (allowed.length === 0) return null;
  const allow = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : null;
  if (!allow) return null;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "*",
    vary: "Origin",
  };
}

/** Serve the REAL read-only observation app, with optional CORS, over Bun.serve. */
export function serveRead(view: WorldView<WorldState>, config: NodeConfig): ServerHandle {
  const app = createObservationApp(view); // the real Layer-5 app (GET-only by construction)
  const server = Bun.serve({
    port: config.readPort,
    fetch: async (req) => {
      const ch = corsHeaders(req.headers.get("origin"), config.corsOrigins);
      if (req.method === "OPTIONS" && ch) return new Response(null, { status: 204, headers: ch });
      const res = await app.fetch(req);
      if (!ch) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(ch)) out.headers.set(k, v);
      return out;
    },
  });
  return { port: config.readPort, stop: () => server.stop() };
}
