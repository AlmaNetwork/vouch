---
name: verify
description: Run the full verification gate for the vouch monorepo — typecheck + tests in BOTH packages (vouch-core and vouch-world), the same checks CI runs. Use before declaring any change done, before committing, or when asked to "verify", "run the tests", or "check it's green".
---

# Verify the vouch monorepo

The repo has two packages. CI runs a single job that installs **both** then
typechecks + tests **both**. Reproduce that locally before calling a change done.

`vouch-world`'s typecheck follows into `vouch-core`'s source (no build step), so
`vouch-core`'s dependencies must be installed first.

## Steps

Run from the repo root:

```bash
# 1) Trust engine (standalone)
cd vouch-core  && bun install && bun run typecheck && bun test

# 2) Simulator (depends on ../vouch-core)
cd ../vouch-world && bun install && bun run typecheck && bun test
```

Both must be fully green. Report failures with the actual output — do not paper
over a red test.

## What "green" means

- `bun run typecheck` (= `tsc --noEmit`) passes under maximal strictness in both
  packages.
- `bun test` passes: **vouch-core = 35**, **vouch-world = 76** at last update. If you
  added/removed tests, update those counts in the root `README.md` Packages table —
  that is where the numeric counts are tracked (the package READMEs only say "tests
  green" qualitatively).

## Notes

- Runtime is **Bun, pinned to 1.3.2** in CI. If local Bun differs and you see a
  Bun-specific failure, note it.
- Tests are deterministic by design (fixed seeds, no clock). A flaky result is a
  real bug — most likely a stray `Date.now()` / `Math.random()` or an unseeded draw.
  Track it down rather than re-running until green.
- Don't switch test runners or add a separate test config; tests are `bun:test`
  invoked via `bun test`.
