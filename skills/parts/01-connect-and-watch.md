# Part 1 — Connect & watch

The observation API is the node's **read-only connection point**. The server is handed
only a read-only view of the world (no way to emit), so *watching can never write* — it
is enforced by construction, not by convention. This is the surface you can use today.

Full machine-readable description: [`../../openapi/read.yaml`](../../openapi/read.yaml)
(OpenAPI 3.1). The default address is `http://localhost:8787`.

> **CORS:** the server sets no CORS headers. A browser app on another origin must go
> through a dev proxy (or have CORS configured at the node's deployment edge). `curl` and
> server-to-server clients are unaffected.

> **Liveness note:** the reference world (`vouch-world/examples/observe.ts`) runs a finite
> simulation and then serves a **static** snapshot, so `tick` does not advance while it is
> up. Don't poll expecting movement unless the node you're watching is advancing its world.

## The 10 routes

| Method & path | Returns |
|---|---|
| `GET /` | Service banner + the endpoint index |
| `GET /health` | `{ ok: true, tick }` — liveness + current tick |
| `GET /tick` | `{ tick }` — the discrete sim clock |
| `GET /metrics` | Derived metrics (economy / trust / diplomacy / log) |
| `GET /state` | The whole world: `{ regions, agents }` keyed by id |
| `GET /regions` | All regions (array) |
| `GET /regions/:id` | One region, or `404 { error }` |
| `GET /agents` | All agents (array) |
| `GET /agents/:id` | One agent, or `404 { error }` |
| `GET /log?since=N` | Events with `seq >= N` (default 0), in seq order |
| `GET /log/digest` | `{ digest, length }` — a stable hash of the whole log |

## Connect

```bash
NODE=http://localhost:8787
curl -s $NODE/                 # discover the endpoints
curl -s $NODE/health           # { "ok": true, "tick": 8 }
```

## Watch the world

```bash
curl -s $NODE/metrics
# {
#   "tick": 8,
#   "regions": { "total": 1, "recognized": 1, "unrecognized": 0 },
#   "agents":  { "total": 4, "residents": 3, "treasuries": 1,
#                "totalCurrency": 300, "totalCredit": 48, "currencyGini": 0.0856… },
#   "log": { "length": 61, "digest": "91a22c60", "eventTypes": { … } }
# }

curl -s $NODE/regions/umi
# { "id": "umi", "displayName": "Umi",
#   "institutions": { "schemaLedger": [], "verificationPolicy": {…}, "diplomacyPolicy": {…} },
#   "status": "recognized", "proposer": { "kind": "genesis" }, "foundedAtSeq": 0 }

curl -s "$NODE/agents/ada@umi"     # 404 { "error": "agent not found" } if absent
```

`metrics` is **comparative on purpose** — `currencyGini`, `recognized` vs `unrecognized`,
per-region counts let you see how different rules of trust play out. It describes the
world; it does not rank villages.

## Follow the event log

The log is the source of truth. Tail it incrementally with `since`:

```bash
curl -s "$NODE/log?since=0"        # the whole history, oldest first
curl -s "$NODE/log?since=55"       # only events at seq >= 55
```

Each event is `{ seq, tick, type, actor, payload }`. Known `type`s on this build:
`region.founded`, `region.institution.changed`, `region.recognized`, `agent.admitted`,
`agent.migrated`, `agent.decided`, `economy.settled`, `system.tick`. The richest payload
is `economy.settled`, which carries a signed `receipt` (an ALMA certificate, schemaId
`alma.tx/receipt/v1`) plus the balance deltas — see
[part 3](03-digital-items.md#economy-receipt).

## Verify determinism

```bash
curl -s $NODE/log/digest           # { "digest": "91a22c60", "length": 61 }
```

Two runs from the same seed produce the **same digest**. That is the determinism/replay
guarantee in observable form: the entire world is a pure function of its log.
