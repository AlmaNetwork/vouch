# Quickstart

You need [Bun](https://bun.sh) (the repo runs TypeScript directly — there is no build
step). CI pins **Bun 1.3.2**.

## 1. Clone

```bash
git clone https://github.com/AlmaNetwork/vouch.git
cd vouch
```

## 2. Install — `vouch-core` first

The two packages are independent and installed separately. **Install `vouch-core`
before `vouch-world`**: `vouch-world` typechecks directly against `vouch-core`'s source
(its exports point at `src/`), so the core's dependencies must already be present.

```bash
cd vouch-core  && bun install --frozen-lockfile && cd ..
cd vouch-world && bun install --frozen-lockfile && cd ..
```

## 3. Verify the baseline

```bash
cd vouch-core  && bun run typecheck && bun test && cd ..   # 35 tests
cd vouch-world && bun run typecheck && bun test && cd ..   # 76 tests
```

## 4. Run the observation server

`examples/observe.ts` builds a small world, runs a finite simulation, and then serves the
read-only observation API (default port **8787**).

```bash
cd vouch-world
bun examples/observe.ts
# → vouch observation (read-only) — http://localhost:8787
```

In another shell, watch the world:

```bash
NODE=http://localhost:8787
curl -s $NODE/             # the endpoint index
curl -s $NODE/health       # { "ok": true, "tick": 8 }
curl -s $NODE/metrics      # economy / trust / diplomacy / log metrics
curl -s $NODE/regions/umi  # one region
curl -s "$NODE/log?since=0"# the full event log
```

> The reference world runs **8 ticks and then freezes** — it serves a static snapshot, so
> `tick` won't advance. See the [Observation API](observation-api.md) page for every route.

## 5. (Track C) extra checks

These additive checks live alongside the packages and have their own CI jobs:

```bash
# Lint the read-only OpenAPI spec (Redocly):
sh openapi/lint.sh

# Determinism + replay-equivalence gate on the real world composition:
bun scripts/determinism-gate.ts

# Biome lint (advisory):
sh scripts/lint.sh
```

## Next

- Understand the vocabulary → [Glossary](glossary.md)
- Use a node (connect, operate, credentials) → [Skill](../skills/SKILL.md)
