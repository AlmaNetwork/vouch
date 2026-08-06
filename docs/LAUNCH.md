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

## The world keeps what it is given

The world we launch has no way to undo anything. Regions are never deleted. A vouch
cannot be withdrawn — `agent/reducer.ts:98` is `trust: a.trust + weight` and nothing
subtracts. Currency handed out at `admit` cannot be burned. And the sanction machinery
that RFC 0007 §9 describes is not reachable over HTTP at all — nor would it help as
written, because `canSanction` (`vouch-world/src/environment/sanctions.ts:40`) authorizes
only whoever governs the target's citizenship or residence region. Someone who founds
their own region governs it, so no one else can reach them.

**Decided: we are not declaring the launch world resettable.** The alternative was to say
in the README, in `SECURITY.md` and at `GET /` that the world is an experiment and will be
reset without notice until v1.0, which would have made every gap above a property we
described in advance rather than an incident. We are not doing that, so the world we open
is one people are entitled to take seriously — and that makes a way to stop an abuser a
launch requirement rather than week-one work. Phase 3 is that requirement.

Phases 1, 2 and 4 are unchanged by this decision; they were always needed.

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

*(Phase 2 removes that quadratic: a cold `/metrics` at 4,000 regions is 14.4 ms and a warm
one 0.2 ms. `/state` is unchanged and still open.)*

## Things we built that are not doing anything

Four of these. Each was written deliberately and then quietly failed to take effect.
All four are fixed in #52; they are recorded here because the shape of the mistake is
worth remembering — none of them failed, they just silently were not there.

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

A ticked box means the change is in an open pull request, not that it is on `main`.

| | |
|---|---|
| Phase 1 — write-surface bounds | #49 |
| Phase 1 — rate limiting | #50 |
| Phase 2 — read-surface cost | #51 |
| Phase 4 — deploy assets | #52 |
| Phase 5 — SECURITY.md + READMEs | #53 |

Each branches from `main` rather than stacking, so they can land in any order. Phase 3
and Phase 6 are not started.

### Phase 1 — bound the write surface

The limits go in **both** layers: the node's zod schemas reject early with a clear 400,
and `vouch-world` enforces the same ceilings so any other entry point onto the engine
(`vouch-mcp`, an embedder, a future route) inherits them instead of having to remember.

- [x] `.max()` on every string in `vouch-node/src/commands.ts`: `regionId`,
      `displayName`, `agentId`, `region`, and `transfer`/`vouch`'s `from` and `to`
- [x] Length bounds on `principal` and `publicKey` in `vouch-node/src/accounts.ts`
- [x] Ceilings on `admit.currency` and `transfer.amount`, well under `MAX_SAFE_INTEGER`
- [x] The same bounds in `vouch-world`, at the mutators that accept the values
      (`defineRegion` / `admitAgent` / `executeTransfer`). Existing journals must still
      replay — the bounds are on new writes, and nothing already recorded may become
      un-replayable
- [x] Rate limiting in the app, keyed by IP and by principal, answering 429. Starting
      values: **10 writes/min/principal, 60 writes/h/IP, 600 reads/min/IP**. Nothing
      written to the journal can be taken back, so the tight end is the safe end and we
      loosen from there. In the app and not only at the CDN — an origin reachable around
      the CDN must still be bounded
- [ ] A test asserting the RFC 0007 command engine has no HTTP route, so it cannot be
      exposed by accident later

### Phase 2 — bound the read surface

- [x] Memoize `metrics()` on `log.length`; the world only changes when the log grows.
      Also removed the quadratic underneath it, so a cold read is linear rather than
      merely cached, and memoized `EventLog.digest()`, which restringified the whole log
- [x] `Cache-Control` on the derived reads. Deliberately NOT on `/health`, `/tick` or
      `/log/digest` — a cached digest turns a successful write into a failed deploy
- [x] Report journal length at `/health` so the ceiling below is observable
- [ ] Decide what `/state` does at scale: cap it, paginate it, or drop it from the public
      surface and leave `/regions` and `/agents`

### Phase 3 — a way to stop an abuser

Required because we are not declaring the world resettable. The design question is *where*
the power lives, and the two obvious answers are both bad: leaving `canSanction` as it is
leaves self-governed abusers untouchable, and granting the operator authority **inside** the
world puts an administrative override into a governance protocol whose whole subject is how
authority is constituted. Rushing that is how the protocol ends up with a backdoor nobody
can remove later.

The proposal is to keep it **outside** the world: a node-level denylist of principals,
enforced at the HTTP boundary before the engine is touched, held in the operator's own
config rather than in the journal. It stops abuse on *this node*, it is honestly what it
is — an operator refusing service — and it makes no claim about in-world legitimacy, so it
does not prejudge the §9 design. Not yet agreed.

- [ ] Agree where the power lives (node-level refusal, or in-world authority)
- [ ] Implement it, with the refusal visible in the logs and to the refused caller
- [ ] Write down the policy: what gets someone refused, and how they contest it
- [ ] Decide what happens to what an abuser already wrote, given none of it can be removed

### Phase 4 — make the deploy assets true

- [x] Move `StartLimitIntervalSec` / `StartLimitBurst` to `[Unit]`
- [x] Wire `VOUCH_BUILD` through all four paths (env file, compose build args, `DEPLOY.md`,
      CI) and assert it at `/health` in the CI image job
- [x] Add the Bun installation step, landing the binary somewhere `ProtectHome=true`
      permits
- [x] `smoke.sh --write` now refuses a non-loopback target without `--force`, and the
      procedure runs the write check over loopback

### Phase 5 — say what this is

- [x] `SECURITY.md`: how to report, what is in scope, and the known limits stated up
      front rather than discovered. The reporting address depends on the domain, so this
      can be written now and the contact filled in later
- [ ] Turn on private vulnerability reporting, secret scanning, push protection, and
      required status checks
- [x] Correct the README: test counts were stale (the table says 106 / 35 / 44 / 61 / 28;
      the real counts are **156 / 60 / 46 / 62 / 28**, plus `vouch-web` at **7**, which the
      table omits entirely), `vouch-web` is missing from the package list, and there are no
      links to `docs/rfc/` or `docs/money-boundary.md`
- [x] Fix `vouch-node/README.md`'s Security section, which says journal tamper-evidence is
      unimplemented — it is implemented and verified on every boot
      (`vouch-node/src/journal.ts`)

### Phase 5.5 — open the command surface

The node accepts four commands — `found`, `admit`, `transfer`, `vouch`. The engine can do
far more, and the gap makes the README untrue of a running node: it promises villages that
migrate, secede, amend their institutions and negotiate across borders, and none of that
is reachable over the network. Worse, with one governance model available there is nothing
to compare, so "watch which institutions prosper" has no subject.

Each command touches five places: the node's schema and dispatch, `SCOPE_FOR_COMMAND`,
the MCP tool, the CLI SDK method, and the CLI dispatch arm. `commandAllowed` is
fail-closed, so a command missing from the scope map is denied by MCP rather than waved
through — forgetting that step breaks loudly, which is the right way round.

- [x] `migrate` — the exit option (#55)
- [x] `amend` / `propose` / `vote` — governance. The one that makes comparison possible (#57)
- [ ] `recognize` — diplomacy
- [ ] `list-region` / `set-lifecycle` / `transfer-region` — the region market
- [x] `mint-item` / `transfer-item` — digital items. Who may mint is a per-region
      institution (`items`, amendable like any other policy), so mint rules are
      themselves an experiment variable (#60)
- [ ] `suspend` / `reinstate` — a region's own discipline over its residents

#### Deliberately not exposed

- **`mintCurrency` — never.** Unlike every other mutator it has **no authorization check
  at all**: `suspendAgent` consults `canSanction`, `listRegion` consults `isOwner`,
  `mintCurrency` consults nothing, because it is engine-internal and the environment is
  its only caller. On the HTTP surface it would be "anyone may print money to
  themselves", and the README's *no one can mint themselves money* would be false in one
  request. There is no version of open-everything that includes this one.
- **`drawResource` — blocked on the tick.** Resource pools refill at `regenPerTick`, and
  the node never advances the tick, so every pool is permanently empty and the command
  could only ever fail. Exposing it would ship a button that does nothing.
- **`detectEmergence` — not a command.** It takes a whole `World` (not a `WorldCommit`),
  sweeps every agent, and founds regions on their behalf. It belongs to a tick loop, not
  to a participant. Secession stays unreachable until the world runs on its own.

The first is a permanent exclusion. The other two are consequences of the tick being
frozen, and would come back into scope with it.

### Phase 6 — AWS

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
- [ ] Journal ceiling of 50,000 entries with an alarm at 25,000. The binding constraint is
      boot replay time, not disk. Since the world is not declared resettable, hitting the
      ceiling is an incident to be handled, not a routine wipe — decide in advance what
      the answer is

## Decisions

### Settled

| | |
|---|---|
| Reset declaration | **No.** The launch world is not declared resettable, which is what puts Phase 3 in scope |
| Where the write limits live | **Both layers** — the node's schemas and `vouch-world`'s mutators |
| Rate limits | **10 writes/min/principal, 60 writes/h/IP, 600 reads/min/IP**, loosened from there |
| Registration stays open | **Yes.** Permissionless entry is the design; bound it with limits, not with a gate |
| Instance size | `t4g.small` |
| Tick progression | Frozen at 0, and said so |

### Still open

| | Recommendation |
|---|---|
| Domain | Not registered yet. Cloudflare Registrar. Everything that does not need it is being done first |
| Project mailbox | One address on the launch domain, shared by the registrar, `SECURITY.md`, the code of conduct and the org profile. Worth doing in the same sitting as the domain — four items depend on it |
| Where the power to stop an abuser lives | Node-level refusal, outside the world. See Phase 3 |
| npm | Reserve the `@almanetwork` scope, publish nothing. The unscoped `vouch`, `vouch-cli` and `vouch-mcp` names are all taken already (the registry answers 200 for each) |
| CLI distribution | Clone and run from source at launch; a `bun build --compile` binary in week one |
| Discussions | On |
| Commit author emails | Leave history alone. Turn on email privacy so it stops there |
