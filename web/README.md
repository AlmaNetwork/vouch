# vouch-web

A one-page homepage for vouch + a **typed client for the read-only observation API**.
Vite + React + PWA. Read-only: it only talks to the observation endpoints.

## Develop

```bash
bun install
bun run dev        # http://localhost:5173
```

In another shell, run a node so the page has something to watch:

```bash
cd ../vouch-world && bun examples/observe.ts   # serves :8787
```

The dev server proxies `/api` → `http://localhost:8787` (see `vite.config.ts`), because the
observation server sets **no CORS headers**. The "Watch a node" panel defaults to `/api`.

## Build / check

```bash
bun run build      # production build (dist/)
bun run typecheck  # tsc --noEmit
bun run lint       # biome (uses ../biome.json)
```

## Types are generated from the OpenAPI spec

`src/api/schema.d.ts` is **generated** from [`../openapi/read.yaml`](../openapi/read.yaml)
so the client can never drift from the contract:

```bash
bun run gen:api    # regenerate after the spec changes (uses ../redocly.yaml)
```

`src/api/observation.ts` is the typed client built on those types.

## Production

Set `VITE_NODE_URL` to a node whose deployment edge sets CORS (Track C `CORS_ORIGINS`
config), e.g. `VITE_NODE_URL=https://node.example bun run build`. The single call-to-action
links to the flagship [Skill](../skills/SKILL.md). The write surface is Track B's and is
not yet HTTP — this app is read-only by design.
