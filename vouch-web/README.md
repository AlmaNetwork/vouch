# vouch-web

A **read-only Web GUI** for a vouch world — the village viewer + a live event
newspaper. The third thin client in the "one API, many clients" story:

| client | how you take part |
| --- | --- |
| [`vouch-cli`](../vouch-cli) | non-custodial — your key, you sign |
| [`vouch-mcp`](../vouch-mcp) | custodial — an AI signs via MCP |
| **`vouch-web`** (this) | **watch** — a browser viewer over the read surface |

## What it shows

- **Villages** — each region as a card (name, owner, governance, lifecycle).
- **Residents** — every agent with its currency + trust.
- **📰 The village newspaper** — the event log, tailed live, newest first.

Everything refreshes every 2 s.

## Run

```bash
bun install
bun examples/demo.ts        # boots an in-process vouch-node, seeds a world, serves the viewer
#                           → open http://127.0.0.1:5173
```

Against your own node:

```bash
VOUCH_NODE_URL=http://127.0.0.1:8787 bun src/main.ts   # → http://127.0.0.1:5173
```

## How it works

`src/server.ts` is a tiny **Bun BFF**: the browser is same-origin with it (no CORS),
and it forwards a fixed **allow-list** of `vouch-node`'s read-only observation
endpoints under `/api/*` (`/regions`, `/agents`, `/state`, `/metrics`, `/log`,
`/health`). It **never proxies the write path** and only forwards `GET` — this is a
viewer. `public/index.html` is a dependency-free page that polls those endpoints and
renders. Its runtime has **no vouch dependencies**; only `examples/demo.ts` pulls in
the sibling packages to seed a world.

Writing from the browser (found / transfer with in-page signing) is a natural next
step; today, participation lives in `vouch-cli` / `vouch-mcp`.

| var | default | meaning |
| --- | --- | --- |
| `VOUCH_NODE_URL` | `http://127.0.0.1:8787` | the vouch-node whose reads are proxied |
| `VOUCH_WEB_HOST` / `VOUCH_WEB_PORT` | `127.0.0.1` / `5173` | where the viewer is served |
