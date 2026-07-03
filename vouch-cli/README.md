# vouch-cli

A **non-custodial terminal client** for a vouch world — and the reusable
`VouchClient` SDK underneath it. You hold your own Ed25519 key, the CLI signs
commands **locally**, and talks to a `vouch-node` over HTTP.

This is the counterpart to [`vouch-mcp`](../vouch-mcp): same command surface, two
clients over one engine.

| | who holds the key | who signs |
| --- | --- | --- |
| `vouch-cli` (this) | **you** (`~/.vouch/key`, 0600) | you, locally — non-custodial |
| `vouch-mcp` | the server | the server, on your behalf — custodial |

## Install / run

```bash
bun install
bun src/main.ts help            # or: bun run vouch help
```

It talks to a running `vouch-node` (default `http://127.0.0.1:8787`; override with
`--node <url>` or `VOUCH_NODE_URL`). To see the whole thing end-to-end against an
in-process node with zero setup:

```bash
bun examples/tour.ts
```

## Commands

```
identity
  keygen                             create your local Ed25519 key
  register <principal>               bind your key to a principal (sets it active)
  whoami [--as <p>]                  show your key + a principal's node account

write  (signed as your active principal, or --as <p>)
  found <regionId> <displayName>
  admit <agentId> <region> <role> [--currency N]
  transfer <to> <amount>
  vouch <to> <weight>

read
  regions | agents | state | metrics
  watch [--interval N]               tail the world's event feed (the village newspaper)
```

Flags: `--as <principal>` `--node <url>` `--currency N` `--interval N`.
Env: `VOUCH_NODE_URL` `VOUCH_PRINCIPAL` `VOUCH_KEYFILE` `VOUCH_CONFIG_DIR`.

## A session

```
$ vouch keygen
$ vouch register alice
$ vouch found nova Nova                         # alice owns nova
$ vouch admit bob@nova nova merchant --currency 50   # owner-gated join
$ vouch transfer market@nova 20 --as alice      # (or set active principal)
$ vouch watch                                   # tail the feed:
  #  0  region.founded    by world   {"region":{"id":"nova",…}}
  #  2  agent.admitted    by world   {"agent":{"id":"bob@nova",…}}
  #  4  economy.settled   by world   {"entries":[…]}
```

## Identity model

You pick your own principals. A principal is either an **account** (e.g. `alice`,
for `found`/`admit`) or a **resident agent** `name@region` (e.g. `bob@nova`, for
`transfer`/`vouch`, and what an owner `admit`s). Register each principal you want to
act as; the same key can back several. `register` remembers the last one as your
active identity, overridable per-command with `--as`.

## The SDK

`src/client.ts` exports `VouchClient` — the transport + signing layer, usable on its
own (a Web GUI would import the same class):

```ts
import { VouchClient } from "vouch-cli/client";
const c = new VouchClient("http://127.0.0.1:8787", myKeyPair);
await c.register("alice");
await c.found("alice", "nova", "Nova");
await c.transfer("bob@nova", "market@nova", 20);
const feed = await c.log(0);
```

It stores **no nonce state** — it reads `GET /v1/account/:principal` from the node
(the single source of truth) and signs with `nonce+1`, retrying once on a stale
nonce. Reads work without a key.
