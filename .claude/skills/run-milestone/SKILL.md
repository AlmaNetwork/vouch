---
name: run-milestone
description: The working rhythm for landing a milestone or feature slice in the vouch repo — implement one slice, get both packages green, adversarially review the invariants, update the READMEs, then commit + PR. Use when starting or finishing a milestone (M4/M5/…) or any non-trivial feature.
---

# Run a milestone (the working rhythm)

This repo was built bottom-up, one milestone at a time, with the invariants kept
honest by adversarial review. Follow the same cadence for every slice.

## 1. Scope one slice

- Implement **one milestone (or one slice of it) at a time**. Do not pull future
  scope forward. If you discover adjacent work, note it and keep it separate.
- Respect the **out-of-scope** boundaries in the root `CLAUDE.md` (no clock/global
  RNG in domain code, no upward imports, no auto-triggered institution amendments,
  observation stays read-only, vouch-core stays a stateless form-verifier).
- Put writes in `environment` (L4); keep `region`/`agent` as pure read-models and
  brains. Extend state by adding a slice **downward** in the composition root.

## 2. Implement against the invariants

Keep these true as you write (full list in the root `CLAUDE.md`):

- State changes only via `emit()` folded by a pure reducer. Order by `seq`.
- Value moves only through `executeTransfer`; reducers honor value events only from
  `SYSTEM_ACTOR`; currency is conserved; settlements are atomic.
- vouch-core verifies **form** only; **meaning** lives above it.
- No `Date.now()` / `Math.random()` — all randomness via the seeded `Rng`; brains are
  pure and journaled.
- Keep the ALMA protocol identifiers (`alma-cert/v1`, `alma.*`, `createAlmaWorld`,
  `alma-core:`) — don't rename to `vouch`.

## 3. Get green (use the `verify` skill)

Typecheck + test **both** packages. Add tests for the new behavior:

- **Determinism (forward)**: same seed + same script ⇒ identical `log.digest()`.
- **Replay (reconstruction)**: fold the log ⇒ live state (`replayState(...).state`
  `toEqual` `getState()`).
- **Conservation** for any value change; **actor-gate** for any value event.
- **Read-only** for any observation surface (writes 404, digest unchanged).

## 4. Adversarially review before declaring done

For anything protocol-level, do a deliberate adversarial pass over the diff — don't
just trust the happy-path tests. Re-derive, against the actual changed code:

- **Conservation** — can value be minted, burned, stranded, or double-spent? Is the
  fee routed to the sender's treasury and is its absence handled?
- **Determinism** — any hidden clock/RNG? Any ordering that depends on insertion
  order instead of `seq` / sorted ids? Does replay reproduce state exactly?
- **Separation of responsibility** — does form stay in the core and meaning stay
  above it? Any upward import? Does a lower layer reach a `World`/`CommitSink` it
  shouldn't?

Fix every **confirmed** bug before moving on. (Spawning independent reviewers per
dimension and only acting on confirmed findings is the pattern this repo used.)

## 5. Update the READMEs (they are a contract)

- Package **test counts** in the root `README.md` table.
- The **milestone status** table (root + `vouch-world/README.md`) — flip the row and
  note what's next.
- The **architecture / layout** if a layer was added or its surface changed.

The READMEs track *what is actually implemented*. Keep them in lockstep with the
code.

## 6. Commit + PR

- Scoped commits, descriptive messages.
- Open or extend the PR. `main` is protected; land via PR.
- CI (single job, Bun 1.3.2, installs both packages then typecheck+test both) must be
  green. The check is named `test`.

## 7. Only then, the next slice

Move to the next milestone/slice only once the current one is green, reviewed, and
documented.
