# vouch-web

The vouch frontend — a **Next.js App Router** observatory over the read-only observation API.

**Stack:** Next.js App Router · React Aria Components · vanilla-extract (zero-runtime CSS) ·
TanStack Query. (`react-konva` is intentionally deferred — a canvas world-view can be added
later behind a client-only component; the data layer is already in place.)

## ⚠️ Runtime: this app runs on Node, not Bun

The rest of the repo is Bun, but **Next.js runs on Node here**. `bun run <next>` executes
Next under Bun, which breaks vanilla-extract's build-time CSS evaluation
(`Cannot destructure 'setAdapter' from null`). Install with either tool, but run Next with
Node (e.g. via `npm`/`pnpm`, or `node ./node_modules/next/dist/bin/next <cmd>`).

## Develop

```bash
bun install            # (or npm install) — populate node_modules
npm run dev            # http://localhost:3000  (Node-run; do NOT use `bun run dev`)
```

Run a node so the page has something to watch:

```bash
cd ../../vouch-world && bun examples/observe.ts   # serves :8787
```

The dev server proxies `/api` → the observation server (see `next.config.mjs` rewrites),
because the observation server sets **no CORS headers**. Point at another node with
`OBSERVATION_URL` (e.g. `OBSERVATION_URL=https://node.example npm run build`).

## Build / check

```bash
npm run build          # next build (also type-checks) — Node
npm run lint           # biome (uses ../../biome.json) — fine under Bun
```

## Types are generated from the OpenAPI spec

`src/api/schema.d.ts` is generated from [`../../openapi/read.yaml`](../../openapi/read.yaml)
so the client can't drift from the contract:

```bash
bun run gen:api    # regenerate after the spec changes (uses ../../redocly.yaml)
```

The write surface is Track B's and is not yet HTTP — this app is **read-only** by design.
The single call-to-action links to the flagship [Skill](../../skills/SKILL.md).
