# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **[Report a vulnerability](https://github.com/AlmaNetwork/vouch/security/advisories/new)**.
It opens a private thread with the maintainers, so nothing is disclosed while a fix is
being worked out.

Please don't open a public issue for a security problem.

We'll acknowledge a report within **3 business days** and tell you what we think of it
within **10**. This is a small project run by a couple of people, so we would rather
promise something we can keep than a number that reads well.

If you find something, we would like to credit you in the advisory. Say so if you would
rather not be.

## What is in scope

The code in this repository, and any node we operate. In particular:

- Forging a signed command, or acting as a principal without its private key
- Getting the engine to mint, destroy or duplicate value outside a normal admission
- Making a node serve state its journal never recorded, or accept a tampered journal
- Escaping the read/write boundary — a `GET` that changes the world
- Crashing or hanging a node with a single request, or with far less traffic than the
  documented rate limits should allow

## What is already known

**Read this before spending your time.** Everything below is a property of the current
design, not a discovery. We would rather say so up front than have someone spend an
evening on it.

### The world does not forget, and cannot be corrected

Nothing in the world can be undone.

- **Regions are never deleted.** A name, once taken, is taken.
- **A vouch cannot be withdrawn.** `trust` only ever accumulates.
- **Currency issued at admission cannot be burned.**
- **The journal is append-only and hash-chained**, so nothing already written can be
  removed or edited without breaking the chain and stopping the node from booting.

### An abuser inside their own region is beyond reach

`canSanction` authorizes only whoever governs the target's citizenship or residence
region. Someone who founds their own region governs it, so nobody else can sanction
them. The sanction machinery is also not reachable over HTTP at all today.

This is a real gap rather than a subtlety, and it is tracked in `docs/LAUNCH.md`.

### Registration is permissionless

Anyone can register a principal and found a region. That is the design, not an
oversight — it is bounded by length limits, value ceilings and rate limits rather than
by a gate on who may join. Sybil resistance is not implemented.

### A single node, and its operator

There is one node and one operator. Whoever controls the machine controls the world it
serves. Concretely:

- **The notary secret string *is* the private key** — the keypair is
  `keyPairFromSeed(sha256(secret))`. Anyone who learns it can forge notary-signed
  receipts.
- **The hash chain detects edits, not a full rewrite.** Chaining anchors every line to
  the one before it, so editing, reordering, inserting or truncating in the middle is
  caught at boot. Someone who rewrites the *whole* file and recomputes every hash from
  genesis is not, because nothing outside the file commits to its contents. That needs
  an external anchor — a signed checkpoint of the chain tip — and it is a tracked
  follow-up.
- **There is no federation and no finality.** A second node cannot check this one's work.

### Not running, and not exposed

- **The tick loop is frozen at 0.** The economy does not run on its own.
- **`vouch-web` and `vouch-mcp` are not part of a public deployment.**
- **The RFC 0007 command engine is an internal library** with no HTTP route.
- **There is no real money anywhere in this system**, and no path to it. See
  `docs/money-boundary.md`.

## Supported versions

Nothing is released yet, so only `main` is supported. Once there is a tagged release,
this section will say which ones get fixes.
