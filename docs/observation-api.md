# Observation API

The observation server is the node's **read-only connection point** — external clients
connect here to *watch* the world and can never change it (the server is handed a
read-only view, so this is enforced by construction, §2-6).

- **Spec:** [`../openapi/read.yaml`](../openapi/read.yaml) (OpenAPI 3.1)
- **Default address:** `http://localhost:8787`
- **Auth:** none (public, read-only)
- **CORS:** the server sets **no CORS headers** — a browser app on another origin needs a
  dev proxy (or CORS configured at the deployment edge).

## Routes

| Method & path | Returns |
|---|---|
| `GET /` | Service banner + the endpoint index |
| `GET /health` | `{ ok: true, tick }` |
| `GET /tick` | `{ tick }` |
| `GET /metrics` | Derived metrics (economy / trust / diplomacy / log) |
| `GET /state` | The whole world: `{ regions, agents }` keyed by id |
| `GET /regions` | All regions |
| `GET /regions/:id` | One region, or `404 { error }` |
| `GET /agents` | All agents |
| `GET /agents/:id` | One agent, or `404 { error }` |
| `GET /log?since=N` | Events with `seq >= N` (default 0), in seq order |
| `GET /log/digest` | `{ digest, length }` |

See the [Skill — part 1](../skills/SKILL.md) for worked `curl` examples and the
[Glossary](glossary.md) for the response vocabulary.

## Render the spec

The spec is linted in CI (`sh openapi/lint.sh`). To browse it as a formatted reference:

```bash
# Live preview (hot-reloading) while editing the spec:
bunx @redocly/cli@2.35.1 preview-docs openapi/read.yaml

# Or build a standalone HTML reference (output: docs/dist/observation-api.html):
sh docs/build-api-reference.sh
```

The built HTML is self-contained and can be dropped into any static host (or the
frontend in `web/`). It is generated, so it is git-ignored (`docs/.gitignore`).
