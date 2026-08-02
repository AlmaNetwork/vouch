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
Env: `VOUCH_NODE_URL` `VOUCH_PRINCIPAL` `VOUCH_KEYFILE` `VOUCH_CONFIG_DIR` `VOUCH_TIMEOUT_MS`.

Requests carry a timeout (`VOUCH_TIMEOUT_MS`, default 10 s), so a dead or slow node
fails fast with a clear error instead of hanging.

## A session

There is no installed `vouch` binary yet, so run it from source. To follow along, put
`vouch() { bun /path/to/vouch-cli/src/main.ts "$@"; }` in your shell, or write
`bun src/main.ts` wherever this shows `vouch`.

```
$ vouch keygen
$ vouch register alice                                # your ACCOUNT
$ vouch found umi Umi                                 # alice owns umi
$ vouch admit alice@umi umi merchant --currency 50    # alice's RESIDENT in umi
$ vouch admit market@umi umi broker                   # a counterparty
$ vouch register alice@umi                            # bind a key to that resident
$ vouch transfer market@umi 20 --as alice@umi         # -> {"fee":4}
$ vouch vouch market@umi 3 --as alice@umi
$ vouch watch                                         # tail the feed:
  #  0  region.founded    by world   {"region":{"id":"umi",…}}
  #  2  agent.admitted    by world   {"agent":{"id":"alice@umi",…}}
  #  4  economy.settled   by world   {"entries":[…]}
```

The two `register` calls are the thing to notice, and the reason for the identity model
below: **an account is not a resident.** `alice` founds and governs regions; only
`alice@umi` lives in one, holds a balance and can transfer. A transfer's `from` has to
be the principal that signed it, so acting as a resident means registering that resident
id too. Transferring `--as alice` is refused with `unknown-agent` — alice is an account,
and accounts hold nothing.

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
