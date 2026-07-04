# RFC 0003 — Region Assets: countable, region-issued holdings as first-class value

- **Status:** Draft (open for comments — this PR *is* the RFC discussion)
- **Date:** 2026-07-04
- **Related:** [`docs/money-boundary.md`](../money-boundary.md) · the security audit · the
  transferable-assets direction. ALMA lightpaper §3.5 Instance / §3.6 Schema /
  §3.7 Region (3.7.1 Roles, 3.7.2 Incentive Design, 3.7.3 Asset, 3.7.4 Authority
  Management).

## Summary

Introduce **Asset** — a *countable, schema-defined, region-issued holding* — as vouch's
general in-world value primitive. Holding an amount of an asset in a region is itself
value; its worth is **region-relative** (each region defines what the holding confers, and
cross-region acceptance is gated by diplomacy). The built-in `currency` becomes one such
asset. Semantics are **hybrid**: *issuance* is a governed institutional act; *circulation*
is conserved (zero-sum trade). This is entirely in-world play value — it never touches the
money boundary.

## Motivation

Today value in vouch is a single hardcoded fungible `currency`. But value in a society is
not one universal coin — *holding a quantity of the right thing, recognized by the right
people, is value.* We want: **"holding 10 of some certificate on a Region is, in itself,
value."**

This is not a new invention — it is exactly the primitive ALMA already names. The
lightpaper distinguishes:

- **Instance** — *"a set of data passed between IDs, stored according to a schema."* A
  credential/document, associated with one ID, with disclosure controls. **Not countable.**
- **Asset** (§3.7.3) — *"Unlike instance, which is associated with an ID, asset … Assets
  are traded between IDs. Assets are countable. The timestamp at which the assets are
  exchanged and asset amount at a given time are stored."* And: *"The issued assets can be
  freely traded among the regions"* and *"Asset is also used as a method of exchanging
  credit between regions."*

So the thing we're reaching for is ALMA's **Asset**, and vouch simply hasn't built the
general form yet. Mapping the current engine onto ALMA's vocabulary:

| ALMA | vouch today | gap |
| --- | --- | --- |
| Asset (countable, issued, tradeable) | only the hardcoded `currency` | **no general Asset** ← this RFC |
| Instance (credential/document) | `vouch-world/src/credential` (typed certs) | present |
| Schema (definator-created type) | `CredentialType` / `schemaId` | present, not yet asset-typed |
| non-fungible holding | `vouch-world/src/item` (per-id ownership) | present |

> ⚠️ Naming collision to fix: the existing `AssetCredential` in
> [`credential/library.ts`](../../vouch-world/src/credential/library.ts) is an ALMA
> **Instance** (a document *claiming* `{kind, amount, unit}`), **not** a countable Asset
> holding. This RFC introduces the real Asset primitive; we should rename that credential
> (e.g. `HoldingClaimCredential`) to avoid confusion.

## Why this is deeply "vouch": value becomes region-relative

ALMA §3.7.2: *"there are no common incentives for the network as a whole … Each region can
design its own incentives."* Value is **not** protocol-global. An asset's worth depends on:

1. **Honoring** — whether another region *recognizes* it. vouch already has this: the
   diplomacy layer ([`diplomacy.ts` `assessCertificate` / `canTransactAcross`](../../vouch-world/src/environment/diplomacy.ts))
   decides absorb / map / reexamine / reject. "10 of the Nova-Artisan asset" is worth a lot
   in Nova, and worth in Delta whatever Delta's stance toward Nova says.
2. **Conferred rights** — what a region's institutions grant a holder (council weight,
   resource priority, fee discount, access). Region-defined, `institutions`-as-data.
3. **Scarcity × demand** — capped, governed issuance.

This turns "sound vs loose issuance" into a **competition axis between regions** — which
lands squarely on the decided direction (an infinite game where regions compete over
standing and institutions).

## Proposal

### The Asset primitive

An **Asset** is defined by a schema and issued by a region; holders carry a countable
balance of it.

```ts
// A holding: a countable balance of one asset, held by one agent.
// (sketch — final shape is part of this RFC's discussion)
type AssetId = string            // schemaId of the asset type, e.g. "nova.guild/seat/v1"
interface AssetDef {
  assetId: AssetId
  issuerRegion: string           // provenance — who may issue, and whose honoring matters
  policy: AssetPolicy            // issuance + conferred-rights policy (institutions-as-data)
}
type AssetSlice = {
  // per (assetId, holder) balance; holder is an agent id name@region
  readonly holdings: Readonly<Record<string /*assetId*/, Readonly<Record<string /*holder*/, number>>>>
}
```

### Hybrid semantics (the load-bearing decision)

- **Issuance = a governed institutional act.** A region issues (mints) units of its own
  asset under authority — ALMA's *definator / role / Authority Management*
  ([§3.7.1 Roles, §3.7.4](https://alma.gitbook.io/alma), and vouch's
  [`governance.ts`](../../vouch-world/src/environment/governance.ts) owner/council gate).
  Every issuance is an explicit, logged, **env-authored** event — the per-asset
  conservation baseline, mirroring `mintCurrency` /
  [`currencyOriginTotal`](../../vouch-world/src/environment/economy.ts).
- **Circulation = conserved.** Transfers of an asset are zero-sum per asset — units move,
  none are created or destroyed — mirroring `executeTransfer` / `isCurrencyConserving`.
  Cross-region transfers pass the diplomacy honoring gate (`canTransactAcross`).

So: **sound money by construction inside circulation, governed supply at the edges.** A
region can grow its asset's supply only by an auditable, policy-bounded institutional act;
holders can never inflate it by transacting.

### Conservation, generalized per asset

`currency` becomes the built-in asset `alma.core/currency/v1`. The existing invariant

> live supply == logged origin (admitted + minted)

generalizes to *per assetId*: `supply(a) == Σ issuance(a)`, asserted at runtime exactly like
[`assertCurrencyConserved`](../../vouch-world/src/environment/economy.ts). Transfers keep it
zero-sum; issuance is the only origin.

## Engine integration (reuse, don't reinvent)

- **New:** an `asset` slice, shaped like the [`item` slice](../../vouch-world/src/item/state.ts)
  but fungible (balances, not per-id ownership).
- **Issuance:** generalize `mintCurrency` → `issueAsset(env, assetId, to, amount, reason)`,
  env-authored, actor-gated, logged; a new `assetOriginTotal(events, assetId)`.
- **Transfer:** generalize `executeTransfer` → asset-parameterized; reuse
  `isCurrencyConserving` as `isAssetConserving`; reuse `canTransactAcross` for cross-region
  honoring.
- **Authority:** issuance gated by region governance / a `definator`-style role, extending
  `governance.ts`.
- **Rights:** a region's `institutions` gains an optional `assetRights` policy mapping
  `assetId → conferred rights` (institutions-as-data; consumed by council-weight /
  resource / fee logic).
- **Value events** stay env-authored (`SYSTEM_ACTOR`), so the audit's actor-gate and the
  hash-chained journal cover assets for free.

## Non-goals

- **Not real money.** Assets are in-world, conserved-in-circulation, reversible play value.
  They live *inside* the deterministic engine and never cross the money boundary
  ([`docs/money-boundary.md`](../money-boundary.md)). Real USDC/crypto remains a separate,
  non-custodial layer.
- **Not ZKP/selective disclosure** (ALMA Instance privacy) in v1 — assets are balances, not
  disclosed documents. Revisit if assets ever need privacy.
- **Not a network-global token.** Per ALMA §3.7.2, there is no vouch-wide asset or
  incentive; value is region-defined.

## Key decisions & open questions

1. **Hybrid issuance/circulation — DECIDED** (this RFC): governed issuance, conserved
   circulation.
2. **Burn / redeem?** May an issuer burn units it issued (adjusting the origin baseline)?
   Proposed: yes, as a governed act symmetric to issuance. *(open)*
3. **Rights binding:** is `assetRights` evaluated at spend-time or continuously on the
   held balance (e.g. council weight = current holding)? Proposed: continuous, derived. *(open)*
4. **Cross-region honoring of *balances* vs *certs*:** `assessCertificate` honors a
   *document*; do we need an analogous `assessAsset(issuerRegion)` stance? Proposed: reuse
   the region-stance table. *(open)*
5. **Rename `AssetCredential`** (Instance) to free the name for the real Asset. *(proposed)*

## Alternatives considered

- **Keep single `currency` only.** Rejected: cannot express region-relative,
  rights-bearing value; blocks the multi-asset direction.
- **Fully issuable, no conservation.** Rejected: holders/issuers could inflate freely at
  transaction time; loses the auditability the engine is built on.
- **Fully conserved, fixed supply per asset (no issuance).** Rejected: a region could never
  grant/adjust its own asset — kills the governance/competition axis ALMA's incentive model
  calls for.

## Phasing

1. **This RFC** — agree the model (hybrid, region-relative, in-world).
2. **P1:** land the `asset` slice + `issueAsset` + asset-parameterized transfer + per-asset
   conservation; migrate `currency` to be the built-in asset. Pure engine, zero money.
3. **P2:** `assetRights` (holdings confer standing) + cross-region honoring; wire the
   `TransferHook` primitive so issuance/transfer can be event-triggered in-world.
4. **Later:** reconcile with the money layer only as *observation* (a real-asset holding is
   a different thing, behind the money boundary — never unified with an in-world Asset).
