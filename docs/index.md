# vouch documentation

**vouch** is a testbed for **ALMA** — a protocol for portable identity and trust between
self-governing communities. This is the developer documentation; for the project pitch
and architecture overview see the [root README](../README.md).

## Start here

| Page | What it covers |
|---|---|
| [Quickstart](quickstart.md) | Clone → install → run the observation server → read `/metrics`. |
| [Glossary](glossary.md) | Every term and enum used across the code and the API, from the real types. |
| [Observation API](observation-api.md) | The read-only HTTP surface (10 GET routes) and how to render the OpenAPI spec. |

## Working with a node

- **[Skill: Working with a vouch node](../skills/SKILL.md)** — the flagship guide:
  connect & watch (live), create & operate a region (logical contracts), and digital
  items / credentials. Start here if you want to *use* a node rather than build the repo.
- **[Capability catalog](../skills/capabilities.yaml)** — every engine operation's logical
  input, generated from the real signatures.
- **[Read API (OpenAPI 3.1)](../openapi/read.yaml)** — the machine-readable description of
  the observation endpoints.

## What is and isn't here yet

- **Reading is live.** The observation server (read-only) is a real HTTP surface today.
- **Writing is in-process only.** Founding, admission, recognition, value transfer, and
  credential issuance are engine functions; there is **no write HTTP API on this build**.
  Its shape is the network-node work (Track B) and is not frozen — the docs mark those
  operations as logical contracts (`not-yet-HTTP`), never as live endpoints.

> 🔑 **A client never sends a private key.** Signing is a server-side concern; you supply
> public keys and logical claims. See the [Skill](../skills/SKILL.md) for details.
