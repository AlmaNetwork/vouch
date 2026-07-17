# The money boundary

**Status:** design only — no real-money implementation exists or is authorized yet.
**Why this doc exists now:** to pin the seam between the core and any real value
*before* the economic layer leaks into it. If the boundary is not defined up front,
money concerns creep into the deterministic engine's reducers and rot the design. We
draw the line first; we implement the far side much later, behind it.

Reviewed alongside the security audit (`custody prohibited from touching real funds`,
`ship non-custodial only`) and the decided strategy (Path A: vouch is a neutral,
asset-agnostic protocol over money it neither issues, holds, nor converts).

---

## The one invariant

> **Real value never enters the deterministic world engine.**

The engine's `currency` is an **in-world token** — conserved, reversible, replayable, of
no real value. **Real assets** (USDC, ETH, …) live in a *separate money layer* that
depends on the core's read surface and on user-signed intents, but **the core never
imports the money layer**. In-world `Currency` and real `Asset` are permanently distinct
types; unifying them would (a) make in-world coins a claim on real money — e-money
regulation — and (b) pull async on-chain settlement into a pure, replayable reducer.

## Dependency direction (strict, one-way)

```
money layer ──depends on──▶ core   (identity refs · observation events · in-world reads)
core        ──never imports──▶ money layer
```

`vouch-core` and `vouch-world` MUST have **zero** dependencies on any wallet / chain /
asset / settlement module. This is mechanically enforceable — a dependency-boundary
check in CI that fails if the engine imports anything from the money layer. The point of
the boundary is that the *compiler*, not a code reviewer's memory, keeps money out of the
core.

## What may cross the boundary — and nothing else

1. **Identity references** — a vouch `principal` (one-way). Personhood is the anchor.
2. **Read-only observation events** — world events the money layer may *subscribe to* as
   triggers. Idempotent (event id). The core emits; it does not know a subscriber might
   move money.
3. **User-signed intents** — the money layer executes them; **the core never fires
   funds**. A valid OAuth scope is provably insufficient to move real value (audit gate).

No money type ever appears in a reducer. No wallet or asset balance is ever stored in
core state. No transfer of real value is ever triggered automatically by the core.

## The ports (interfaces now; real implementations much later)

These are the seam. Sketched as signatures — the shape is the design.

```ts
// value operations, backend-agnostic. Two implementations, one interface.
interface ValuePort {
  balanceOf(principal: string, asset: AssetId): Promise<Amount>
  quoteTransfer(spec: TransferSpec): Promise<TransferPlan>   // never executes
}

// the unifying primitive: a transfer hooked to a trigger, with explicit authority.
interface TransferHook {
  trigger: Trigger                 // e.g. "agent.vouched", a milestone, a schedule
  condition?: Condition            // optional predicate on the trigger's payload
  spec: TransferSpec               // from, to, asset, amount (or amount fn)
  authorization: Authorization     // WHO is allowed to make this fire (below)
}

type Authorization =
  | { kind: 'engine' }                       // in-world: the engine/owner policy authorizes
  | { kind: 'user-signed'; intent: SignedIntent }  // real: a user pre-signed a bounded policy

// real value settles OUT OF PROCESS, behind this. The core never calls it — only the
// money layer does. Deposit/transfer/withdraw = build intent -> user signs -> submit ->
// report finality. Non-custodial: the adapter holds no keys and no funds.
interface SettlementAdapter {
  submit(intent: SignedIntent): Promise<TxHandle>
  finality(tx: TxHandle): Promise<{ confirmed: boolean; reorged: boolean }>
}

// one-way identity<->wallet binding, held in the money layer keyed by principal.
// The core neither stores nor reads this.
interface IdentityBinding {
  walletFor(principal: string): Promise<WalletRef | null>
}

// outbound, read-only: world events -> a stream the money layer consumes as triggers.
interface ObservationBridge {
  subscribe(onEvent: (e: WorldEvent) => void): Unsubscribe   // idempotent by e.id
}
```

`AssetId`, `Amount`, `SignedIntent`, `WalletRef`, `TxHandle` are money-layer types; the
core never names them. `WorldEvent` and `principal` are core types the money layer reads.

## Two backends, one shape (the Transfer Hook)

The same `TransferHook` primitive runs two ways, and that is the whole trick:

| | in-world (play money) | real value |
| --- | --- | --- |
| authority | `{ kind: 'engine' }` — engine + region/owner policy | `{ kind: 'user-signed' }` — a bounded session-key / intent |
| execution | a reducer reaction, conserved & reversible | the user's own AA wallet / an on-chain contract |
| trigger source | native engine events | engine events **via an oracle** (its trust cost is explicit) |
| regulation | none (it's a game) | user is the mover; vouch is not (Path A) |

In-world hooks are free and safe to build now. Real hooks are always **user-pre-authorized
and bounded** (per-tx or a capped session key with destination allow-list) — never
"scope-only" auto-movement. Same design; the enforcement backend differs.

## Package topology (proposed)

- **`vouch-value` (new, interfaces only for now)** — the ports above. No real
  implementation. This package *is* the seam; both sides depend on it, it depends on
  nothing risky.
- **In-world implementation** of `ValuePort` / `TransferHook{engine}` lives in
  `vouch-world` (the existing conserved economy, wired to the hook primitive).
- **Real adapters** (`SettlementAdapter`, AA wallet, chain client, `RealAssetAdapter`)
  are FUTURE, separate package(s) that implement the ports and are **never imported by
  the core**.

## Phasing

- **Now (this doc):** pin the boundary + the port signatures. Next: scaffold `vouch-value`
  as types only, and add the CI dependency-boundary check.
- **P1:** implement `TransferHook{engine}` in-world (engine reactions) against the port —
  proves the primitive with zero money and zero regulatory surface.
- **P2 (hard-gated by the audit's real-money gates + qualified counsel):** a non-custodial
  `SettlementAdapter` (AA wallet, user-signed intents) implements the same ports. The core
  is untouched because the far side was always behind an interface.

## The payoff

When real money finally arrives, the work is *"implement an adapter behind an existing
interface,"* not *"perform surgery on the engine."* The economic layer can never pollute
the core, because the type system forbids the core from importing it — and that guarantee
is worth more the day real value is at stake than any amount of after-the-fact cleanup.

## Non-negotiables (restated)

- The core imports nothing money/chain/wallet. Enforced in CI.
- In-world `Currency` and real `Asset` stay distinct types, forever.
- Real settlement is out-of-process, non-custodial, behind `SettlementAdapter`.
- Real transfers are user-pre-authorized and bounded — never scope-only, never core-fired.
- vouch issues no asset, holds no key, custodies no funds, operates no ramp (Path A).
