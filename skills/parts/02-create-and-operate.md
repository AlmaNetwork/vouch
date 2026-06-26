# Part 2 — Create & operate a region

> **`not-yet-HTTP`.** Everything here is a real operation in the node's engine, described
> as a **logical contract**: what it takes, what it returns, what event it records. There
> is **no write HTTP API on this build** — the request envelope, auth, and routes are
> defined by the network-node work and are not frozen. Use this to understand *what the
> operations are*; do not assume an endpoint shape. Server-side arguments (the commit
> handle, the sim `tick`, the region **notary key pair**) are the node's, never a
> client's. See [`../capabilities.yaml`](../capabilities.yaml) for the catalog form.

Each entry lists its **logical input** (what a caller provides) and **server-supplied**
arguments (held by the node). Shapes and enums are in `capabilities.yaml`.

## Founding a village

A village ("region") is **data**: an id, a display name, and its **institutions** (a
certificate-schema ledger, a verification policy, a diplomacy policy). Founding records a
`region.founded` event; the village is born **unrecognized** unless it is genesis.

- **`seedGenesis`** — seed the initial village(s), born `recognized`.
  - logical input: `definitions: RegionDefinition[]`
  - server-supplied: commit handle · emits `region.founded` (one per definition)
- **`proposeFounding`** — found a village mid-run (born `unrecognized`).
  - logical input: `proposal: { definition: RegionDefinition, proposer: Proposer }`
  - errors: invalid region id (must be lowercase alphanumeric); region already exists
  - the same engine serves every proposer (`experimenter`, `emergence`, `genesis`) —
    the propose/execute split means there is one path in.
- **`amendInstitution`** — replace one institution policy; every change is logged.
  - logical input: `{ regionId, change: InstitutionChange, proposer: Proposer }`
  - `InstitutionChange` is tagged by `policy`: `verification` | `diplomacy` | `schemaLedger`
  - note: this is legislator *plumbing*. The mechanism + audit trail exist; provenance
    gating (only collective-origin proposers may amend) is **not enforced** on this build.

```ts
// In-process contract (illustrative — NOT an HTTP call):
const umi = seedGenesis(env, [defineRegion("umi", "Umi")])[0];          // recognized
const nova = proposeFounding(env, experimenterProposal(
  defineRegion("nova", "Nova")));                                       // unrecognized
```

## Admitting & moving residents

An **agent** has a stable `name@region` identity, a role, a value profile, a public key,
and balances (`credit` is non-transferable trust; `currency` is the transferable medium).

- **`admitAgent`** — admit a resident.
  - logical input: `spec: AdmitSpec` =
    `{ id, region, role, valueProfile, publicKey, currency?, credit? }`
  - the `publicKey` is the agent's **public** Ed25519 key (base64) — never a private key.
  - `id` must be `name@region` and must match the `region`; role ∈
    `artisan|merchant|broker|treasury`; valueProfile ∈ `strict|lenient`.
- **`admitTreasury`** — admit the per-region treasury (collects fees so currency is
  conserved). logical input: `{ region, initialCurrency? }`.
- **`immigrate`** — move an agent to another region (founded/unrecognized regions are
  valid targets). logical input: `{ agentId, toRegion }`.

## Recognizing other regions (diplomacy)

Recognition is **interoperability**, not conquest: a recognized region admits a founded
one into the international society, which is what lets value flow across the border.

- **`recognizeRegion`** — `{ by, target }`. The recognizer must itself be recognized; an
  unrecognized region cannot recognize. Idempotent. Emits `region.recognized`.

Foreign certificates are translated by a region's **diplomacy stance** toward the issuer:
`absorb` (accept as-is) · `map` (translate into local vocabulary) · `reexamine` (re-check
under local policy) · `reject`. The trust core checks the signature (*form*); the region
applies the *meaning*.

## Moving value

- **`executeTransfer`** — the **sole** producer of value events. The environment alone
  changes balances; agents only request.
  - logical input: `move: { from, to, amount }` (`amount` is a **positive integer** of
    currency)
  - **server-supplied:** commit handle · sim `tick` · the region **notary key pair**
    (used to sign the receipt — held by the node, never sent by a client)
  - result: `{ ok: true, fee, receipt }` — `receipt` is an ALMA certificate, schemaId
    `alma.tx/receipt/v1` — or `{ ok: false, reason }`.
  - **failure reasons (stable set):** `unknown-agent`, `self-transfer`,
    `not-transferable`, `bad-amount`, `insufficient-funds`, `no-treasury`, and for a
    cross-region move the diplomacy gate adds `unknown-region`,
    `sender-region-unrecognized`, `receiver-region-unrecognized`, `receiver-rejects-sender`.
  - **cross-region caveat:** a transfer where `from.region != to.region` only succeeds if
    **both** regions are recognized and the receiver does not `reject` the sender. For a
    first integration, keep transfers **within one region** so the gate never fires.

Currency is conserved by construction: the moved amounts plus the treasury fee sum to
zero. The node will refuse any transfer it cannot settle conservatively.
