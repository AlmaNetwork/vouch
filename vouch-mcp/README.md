# vouch-mcp

An **OAuth 2.1–protected MCP server** that lets an AI participate in a vouch world.
It authenticates the connecting participant with OAuth, then **custodially signs**
vouch engine commands (Ed25519) on that authenticated subject's behalf — so a model
(Claude, etc.) can found a region, join one, transfer currency, and vouch, without
ever holding a private key.

It is **Track C** of the vouch/ALMA project: one node API, many thin clients. This
package is the "participate via your AI" client; it embeds a
[`vouch-node`](../vouch-node) `VouchNode` and drives the [`vouch-world`](../vouch-world)
engine through it, so conservation, the event log, and deterministic replay are
inherited, not re-implemented.

## How the two auth models compose

MCP authorizes the **caller** (OAuth 2.1). vouch authorizes **writes** with an
Ed25519 **signature**. vouch-mcp bridges them:

```
Claude / CLI / Web  ──OAuth 2.1 access token──▶  vouch-mcp (Resource Server)
                                                    │  verify JWT (iss + aud + sig)
                                                    │  scope → command gate
                                                    │  derive key = HKDF(master, iss|sub)
                                                    │  sign command as the subject
                                                    ▼
                                                 vouch-node ──▶ vouch-world engine
```

- **MCP server = OAuth 2.1 Resource Server** (per the MCP 2025-11-25 authorization
  spec). It validates a Bearer JWT on every request and advertises RFC 9728
  protected-resource-metadata.
- A **bundled dev Authorization Server** issues those tokens locally
  (authorization-code + PKCE/S256) so the whole flow runs with zero external setup.
  In production you delegate to a real IdP instead (see config).
- Writes are **custodially signed**: the server derives a per-subject Ed25519 key and
  signs on the subject's behalf. See **[Security](#security)** — this is a real
  posture change and is deliberately bounded.

## Identity model

One OAuth subject `(iss, sub)` maps to a stable **slug** `u<hex>` (a valid vouch
name). That slug is:

- the subject's **account principal** — used to `found` and `admit` (owner actions);
- suffixed `slug@<region>`, their **resident agent id** in a region — used to
  `transfer` and `vouch`, and the thing an owner `admit`s them as.

The slug is always derived server-side from the verified token, never from a request
body, so a token can only ever act as one of its own identities.

## Run it

```bash
bun install
VOUCH_NOTARY=seed://dev-notary VOUCH_MCP_MASTER_SECRET=dev-master-secret-change-me VOUCH_MCP_DEV_AS=1 bun src/index.ts
```

The server **fails closed**: with neither an external IdP nor `VOUCH_MCP_DEV_AS=1` it
refuses to boot rather than silently exposing the passwordless dev-AS.

### Environment

| var | required | meaning |
| --- | --- | --- |
| `VOUCH_MCP_MASTER_SECRET` | ✅ | HKDF master secret for custodial key derivation. **No fallback** — unset throws. Min 16 chars. |
| `VOUCH_NOTARY` | ✅ | The embedded node's receipt-signing notary (`seed://…` or `env://VAR`). |
| `VOUCH_MCP_DEV_AS` | dev | Set `=1` to mount the bundled **passwordless** dev-AS. Refused unless the bind is loopback. Omit in production (delegate to an IdP instead). |
| `VOUCH_MCP_AS_ISSUER` + `VOUCH_MCP_AS_JWKS_URL` | prod | Set both to delegate to an **external IdP**; the dev-AS is then not mounted, and any bind host is allowed. |
| `VOUCH_MCP_HOST` / `VOUCH_MCP_PORT` | | Bind address (default `127.0.0.1:8788`). |
| `VOUCH_MCP_PUBLIC_URL` | | Canonical externally-reachable base URL; also the token audience + the Host/Origin the DNS-rebinding guard pins to (default `http://host:port`). |
| `VOUCH_MCP_SALT` | | HKDF salt (stable per deployment; default a fixed label). |
| `VOUCH_SEED` / `VOUCH_JOURNAL` / `VOUCH_ACCOUNTS` | | Embedded node seed + durable paths (default in-memory). |

### End-to-end demo

```bash
bun examples/connect.ts
```

Boots the server, runs the OAuth dance for two subjects, and drives the tools: a
founder creates a region, a joiner is admitted by the owner, the joiner transacts,
a scope-denied write is refused, and the sign audit log is printed.

## Tools

| tool | scope | what |
| --- | --- | --- |
| `vouch_whoami` | read | your principal + resident-id pattern + scopes |
| `vouch_list_regions` / `vouch_list_agents` / `vouch_metrics` | read | world state (also exposed as MCP resources `vouch://…`) |
| `vouch_found_region` | `vouch:found` | create a region (you become owner) |
| `vouch_admit_agent` | `vouch:admit` | admit a resident into a region you own (owner-gated) |
| `vouch_transfer` | `vouch:transfer` | send currency as your resident identity in a region |
| `vouch_vouch` | `vouch:vouch` | raise another agent's trust |

`vouch:write` is a coarse superscope implying every write.

## Security

A custodial signer is a **signing oracle**: whoever convinces the server to sign can
act as that subject. vouch's native model is non-custodial (authority = key
possession), so this is a deliberate, bounded trade for MCP usability. The bounds:

1. **Principal is derived from the verified token, never the body.** `transfer`/`vouch`
   force `from` to the caller's own identity; a token for A can never sign as B.
2. **Scope → command gate before signing.** A read/narrow token cannot get a write
   signed (`insufficient_scope`).
3. **Key derivation binds `iss` + `sub`** (so two IdPs can't collide onto one vouch
   identity) and is versioned (`/v1`) for deliberate rotation. Only the master secret
   is secret; no per-user private key is stored.
4. **Keys live for one signature.** The derived seed + private key are zeroed
   immediately after signing.
5. **Audience-bound tokens.** The JWT `aud` must be this server's canonical resource
   (RFC 8707); a token minted for another server is rejected — no cross-server replay.
   No inbound token is ever forwarded upstream (no confused-deputy passthrough).
6. **Append-only sign audit.** Every attempt (accepted / rejected / scope-denied) is
   logged with subject, nonce, scope, and a hash of the command — never the token,
   seed, or key. This is the accountability substrate a custodial signature needs.
7. **Session binding.** An MCP session may only be driven by the principal that
   opened it; the bearer is re-verified on every request.

A custodial signature proves the **server** signed, not that the human personally
intended it — so it is **not** non-repudiation. The clean long-term path preserves
vouch's non-custodial property: keep signing on the client (the agent has the user
sign with their own key / a wallet) and use vouch-mcp only as an authenticated relay.
Custody is the PoC posture, with that path documented.

### Hardening already in place

- **Dev-AS is fail-closed**: mounted only on an explicit `VOUCH_MCP_DEV_AS=1` opt-in
  AND a loopback bind; the server refuses to boot otherwise.
- **DNS-rebinding guard**: the `Host` header must equal the canonical origin and any
  `Origin` must match, on every route (`@hono/mcp` does not check these itself).
- **Loopback-only redirect_uri** in the dev-AS (no open-redirect / code leak).
- **Full-digest principal** (no truncation), **exception-safe key zeroization**, and
  **per-token `jti`** recorded in the sign audit.

### Still deferred (not in this PoC)

- Move signing into a KMS/HSM so plaintext keys never exist in app memory.
- Delegate the AS to a real IdP (`VOUCH_MCP_AS_*`) for any public deployment.
- Add `Idempotency-Key`, per-action step-up consent for high-value commands, and rate
  limits.
