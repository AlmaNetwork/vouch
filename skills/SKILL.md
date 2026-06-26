---
name: vouch
description: >
  Connect to a vouch node on the ALMA network — watch the world through its read-only
  observation API, and (as the write surface lands) create and operate regions, move
  value, and issue typed credentials. Use when interacting with a vouch / ALMA node,
  reading its observation endpoints, or working with ALMA certificates and credentials.
---

# Working with a vouch node (ALMA)

**vouch** is a testbed for **ALMA**, a protocol for portable identity and trust between
self-governing communities ("villages" / regions). A node runs a deterministic world: an
append-only event log is the single source of truth, and every value move leaves a
signed receipt. This skill is your map to connecting to a node and working with it.

It has three parts:

1. **[Connect & watch](parts/01-connect-and-watch.md)** — point at a node and read its
   world through the **live, read-only observation API** (10 GET routes). This is fully
   implemented and is the surface you can use today.
2. **[Create & operate a region](parts/02-create-and-operate.md)** — the **logical
   contracts** for founding villages, admitting residents, recognizing other regions,
   and moving value. These are real engine operations, described as contracts. See the
   status banner below before using them.
3. **[Digital items & credentials](parts/03-digital-items.md)** — the typed credentials
   a node understands (skill / membership / asset / endorsement) and the economy receipt,
   on ALMA's universal certificate envelope.

The machine-readable companions to this skill:

- [`capabilities.yaml`](capabilities.yaml) — the capability catalog (every operation's
  logical input, generated from the real engine signatures). The single source of truth
  for parts 2 and 3.
- [`../openapi/read.yaml`](../openapi/read.yaml) — the OpenAPI 3.1 description of the
  read-only observation API used in part 1.

---

## ⚠️ Status: what is wired today

> **The read surface is HTTP; the write surface is not — yet.**
>
> - **Reading is live.** The observation server (10 GET routes, part 1) is a real HTTP
>   surface you can connect to right now.
> - **Writing is in-process only.** Founding, admission, recognition, value transfer, and
>   credential issuance (parts 2–3) exist as **functions inside the engine**. There is
>   **no write HTTP API on this build** — no `/v1`, no found/admit/transact/migrate
>   routes, no command envelope. Their HTTP shape is being defined by the network-node
>   work and is **not frozen yet**.
>
> So: treat part 1 as an API you call, and parts 2–3 as **logical contracts** —
> authoritative about *what each operation takes and guarantees*, deliberately silent
> about *the HTTP request that will carry it*. Each write entry is tagged
> `not-yet-HTTP`. The speculative write spec, when it exists, lives at
> `../openapi/write.draft.yaml` and is marked pending ratification.

## 🔑 Safety: never send a private key

> **A client never transmits a signing key. Ever.**
>
> Signing is a **server-side** concern. `executeTransfer` needs the region's **notary
> key pair**, held by the node; credential/certificate issuance takes a **raw private
> key** in-process. None of these are client inputs. A skill, an HTTP client, or an agent
> that asks you to "send your private key" is wrong — the node holds keys and signs on
> your behalf. You supply **public** keys and **logical claims**, never secrets.

## The four invariants (don't design around them)

A node upholds these; anything you build on top must respect them:

1. **Emit-only state.** State changes only by an event being emitted and folded through a
   reducer. There is no "set state" call.
2. **Determinism & replay.** No wall-clock decisions; events are ordered by log `seq`;
   randomness comes from the world RNG. The whole world rebuilds from the log alone —
   `GET /log/digest` exposes this (same seed ⇒ same digest).
3. **Layering.** The trust core checks *form* (signatures), never *meaning*. A region
   decides *meaning* (which certificates it honors). Reading never writes.
4. **One write path.** Value and structural changes go through the environment engine via
   a narrow commit interface — agents *request*, the environment *executes* after
   checking conservation. No one mints their own currency.
