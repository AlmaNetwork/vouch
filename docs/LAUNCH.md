# Running a public vouch node

This is the working plan for putting a `vouch-node` on the public internet and inviting
strangers to write to it. The repository is already public; what is not yet public is a
**running node that anyone can send signed commands to**.

Everything measured below was measured against the code on `main` (`ea3ac35`), in
process, on an M-series laptop. Where a number appears, it came from a run, not from
reading the source.

## What "launch" means here

**In scope.** One node. The read-only observation surface (`/health` `/tick` `/metrics`
`/state` `/regions` `/agents` `/log` `/log/digest`), and the four signed write commands
the node accepts today — `found`, `admit`, `transfer`, `vouch` — reached through
`vouch-cli`. Registration stays open to anyone: permissionless entry is the point of the
design, and the protections below are length limits, rate limits and value ceilings
rather than a gate on who may join.

**Out of scope, and said so out loud.** `vouch-web` (`public/index.html:197` polls every
2 seconds and refetches the *entire* `/regions` and `/agents` lists each time — see the
read-cost table below for what that costs per open tab), `vouch-mcp` (a second process
opening a second `FileJournal` on the same path breaks the hash chain),
the RFC 0007 command engine (an internal library, deliberately not on the HTTP surface),
tick progression (the world stays frozen at tick 0), federation, npm publishing, and real
money of any kind. `docs/money-boundary.md` is the standing statement on the last one.

## The decision the rest of this document depends on

The world we launch has no way to undo anything. Regions are never deleted. A vouch
cannot be withdrawn. Currency handed out at `admit` cannot be burned. And the sanction
machinery that RFC 0007 §9 describes is not reachable over HTTP at all — nor would it
help, because `canSanction` (`vouch-world/src/environment/sanctions.ts:40`) authorizes
only whoever governs the target's citizenship or residence region. Someone who founds
their own region governs it, so no one else can touch them.

We are not going to build a penal layer before launch. That leaves one honest way to open
the door:

> **The launch world is an experiment. It will be reset without notice until v1.0.**

Said in the README, in `SECURITY.md` and in the node's own `GET /` response, this changes
what the missing pieces *are*. A squatted name, an inflated currency supply, a bloated
journal and an untouchable troll stop being unrecoverable incidents and become properties
of an experiment we described in advance. Without the declaration, the first person who
takes the world seriously is someone we misled.

Everything in Phase 1 and Phase 2 still needs doing. The declaration is what makes it
truthful to launch *with* those limits rather than with a complete governance layer.

## What a stranger can do to the node today

Measured, not inferred. All four go through the real signed path — they are what a
correctly-behaving client is allowed to do.

| | Result |
|---|---|
| `found` with a 200 KB `regionId` | **200 OK**, and the journal grows **600.9 KB** from that one request. The journal is hash-chained, so it can never be trimmed. |
| `found` with a 200 KB `displayName` | **200 OK**, journal +200.9 KB. `displayName` has no grammar constraint at all. |
| `admit` with `currency: 9007199254740991` | **200 OK**. `/metrics` then reports `agents.totalCurrency = 9007199254740991` — permanently, on a public endpoint. |
| `/v1/register` with a 100 KB principal | **200 OK**, and 100 KB lands in `accounts.jsonl`, which is replayed on every boot. |

One detail worth recording, because it looks like a defence and is not: a 200 KB
**uppercase** `regionId` is rejected with 422, while the same length in lowercase
succeeds. That is `vouch-core/src/identifier.ts` constraining the *character set* of
`name@region` — it says nothing about length. Reading the rejection as "long ids are
handled" would be a mistake.

Throughput, one client, in process, with an `fsync` per append: **596 signed writes per
second**. There is no rate limiting anywhere in the repository (`grep -rniE
"rate.?limit|throttl|token.?bucket"` returns nothing).

The read side is the other half of the same problem. Every endpoint is unauthenticated,
uncached, and serializes synchronously on Bun's single thread, so one slow response
delays every other request including the health check:

| regions | `GET /metrics` | `GET /state` |
|---|---|---|
| 100 | 1 ms | 0.1 MB |
| 500 | 4 ms | 0.4 MB |
| 1,000 | 11 ms | 0.8 MB |
| 2,000 | 39 ms | 1.6 MB |
| 4,000 | **154 ms** | **3.2 MB** |

`/metrics` quadruples every time the world doubles — `metrics()` calls `agentsInRegion`
once per region, and that scans every agent. At the 50,000-entry journal ceiling proposed
below it is seconds per request, and a single client in a loop owns the node. `/state` is
linear but is a bandwidth amplifier: 3.2 MB per unauthenticated GET.

## Things we built that are not doing anything

Four of these. Each was written deliberately and then quietly failed to take effect.

- **`StartLimitIntervalSec` and `StartLimitBurst` are in `[Service]`** in
  `deploy/vouch-node.service`. systemd reads them from `[Unit]` and ignores them where
  they are. A corrupt journal makes the node exit 1 on every boot, which is the correct
  behaviour, but with the cap inert it becomes an infinite restart loop every 2 seconds
  instead of an alert. `deploy/DEPLOY.md` currently tells the reader this cap protects
  them, which is not true today.
- **`VOUCH_BUILD` is never actually set on any path.** The `Dockerfile` accepts it as a
  build arg and the comment shows the incantation, but `docker-compose.yml` passes no
  `args`, `deploy/node.env.example` does not mention it, `DEPLOY.md`'s container route is
  a plain `docker build`, and CI does not pass it either. So production `/health` reports
  `"dev"`, and a deploy and a failed rollback look identical from outside — exactly what
  the field was added to prevent.
- **There is no step that installs Bun itself.** `DEPLOY.md` step 4 runs three
  `bun install`s, and the unit's `ExecStart` is `/usr/local/bin/bun`, but nothing says how
  Bun gets there. The official installer puts it under `$HOME/.bun/bin`, and the unit sets
  `ProtectHome=true`, so a node installed the usual way cannot see its own runtime.
- **`smoke.sh --write` writes to whatever it is pointed at**, and `DEPLOY.md` step 7
  points it at the public hostname. Regions are never deleted, so every run leaves a
  permanent `smoke*` region in `/regions` and in `/metrics`. The script documents this
  honestly; the problem is that the documented procedure aims it at production.

## Work

### Phase 1 — bound the write surface

- [ ] `.max()` on every string in `vouch-node/src/commands.ts`: `regionId`,
      `displayName`, `agentId`, `region`, and `transfer`/`vouch`'s `from` and `to`
- [ ] Length bounds on `principal` and `publicKey` in `vouch-node/src/accounts.ts`
- [ ] Ceilings on `admit.currency` and `transfer.amount`, well under `MAX_SAFE_INTEGER`
- [ ] An in-app token bucket keyed by IP and by principal, answering 429. In the app and
      not only at the CDN — an origin reachable around the CDN must still be bounded
- [ ] A test asserting the RFC 0007 command engine has no HTTP route, so it cannot be
      exposed by accident later

### Phase 2 — bound the read surface

- [ ] Memoize `metrics()` on `log.length`; the world only changes when the log grows
- [ ] `Cache-Control` on every read endpoint
- [ ] Report journal length at `/health` so the ceiling below is observable
- [ ] Decide what `/state` does at scale: cap it, paginate it, or drop it from the public
      surface and leave `/regions` and `/agents`

### Phase 3 — make the deploy assets true

- [ ] Move `StartLimitIntervalSec` / `StartLimitBurst` to `[Unit]`
- [ ] Wire `VOUCH_BUILD` through all four paths (env file, compose build args, `DEPLOY.md`,
      CI) and assert it at `/health` in the CI image job
- [ ] Add the Bun installation step, landing the binary somewhere `ProtectHome=true`
      permits
- [ ] Give `smoke.sh --write` a target that is not production, or reserve the `smoke`
      prefix in the world

### Phase 4 — say what this is

- [ ] `SECURITY.md`: how to report, what is in scope, and the known limits stated up
      front rather than discovered
- [ ] Turn on private vulnerability reporting, secret scanning, push protection, and
      required status checks
- [ ] The reset declaration in the README, in `SECURITY.md` and in `GET /`
- [ ] Correct the README: test counts are stale (the table says 106 / 35 / 44 / 61 / 28;
      the real counts are **156 / 60 / 46 / 62 / 28**, plus `vouch-web` at **7**, which the
      table omits entirely), `vouch-web` is missing from the package list, and there are no
      links to `docs/rfc/` or `docs/money-boundary.md`
- [ ] Fix `vouch-node/README.md`'s Security section, which says journal tamper-evidence is
      unimplemented — it is implemented and verified on every boot
      (`vouch-node/src/journal.ts`)

### Phase 5 — AWS

Detail lives in the EC2 track; the shape is one `t4g.small` in `us-east-1`, IMDSv2 with
hop limit 1, a dedicated EBS volume for the journal, the notary secret in SSM Parameter
Store as a `SecureString` (not Secrets Manager — its rotation is actively harmful when
the key is the world's identity), a security group that admits only Cloudflare's prefix
list on 443 with no port 22 at all, Caddy with a Cloudflare Origin CA certificate and
authenticated origin pulls, and DLM snapshots.

- [ ] Instance, volume, security group
- [ ] Domain, DNS, TLS
- [ ] Notary secret generated on the box, stored in SSM, escrowed
- [ ] Backups **and a rehearsed restore** compared against `/log/digest`
- [ ] Alerting that reaches a person
- [ ] Journal ceiling of 50,000 entries with an alarm at 25,000, and a rehearsed world
      reset. The binding constraint is boot replay time, not disk

## Open decisions

These are not blocked on code. Four items above cannot be finished without the first two.

| | Recommendation |
|---|---|
| Reset declaration | Yes. Everything else in this document assumes it |
| Domain | Cloudflare Registrar |
| Project mailbox | One address on the launch domain, used for the registrar, `SECURITY.md`, the code of conduct and the org profile. Needed in the same sitting as the domain |
| Registration stays open | Yes. Permissionless entry is the design; bound it with limits, not with a gate |
| Operator powers inside the world | None at launch. Adding an administrative override to a governance protocol in a hurry is the worst version of this. A signed `suspend` route from a genesis region is week-one work |
| Rate limits | Start at 10 writes/min/principal, 60/h/IP, 600 reads/min/IP and loosen from there. Nothing written to the journal can be taken back, so the tight end is the safe end |
| Instance size | `t4g.small` |
| Tick progression | Frozen at 0, and said so |
| npm | Reserve the `@almanetwork` scope, publish nothing. The unscoped `vouch`, `vouch-cli` and `vouch-mcp` names are all taken already (the registry answers 200 for each) |
| CLI distribution | Clone and run from source at launch; a `bun build --compile` binary in week one |
| Discussions | On |
| Commit author emails | Leave history alone. Turn on email privacy so it stops there |
