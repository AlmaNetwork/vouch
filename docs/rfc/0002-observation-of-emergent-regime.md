# RFC 0002 — Observation of the emergent regime (stub)

- **Status:** Draft stub (placeholder — not for implementation)
- **Scope:** the *observation* layer (a Layer 5 extension). **Measurement only** — it
  defines dependent variables, never control knobs.

## Relationship to RFC 0001

RFC 0001 sets the **procedure** (the independent variables: the presets / affordances a
founder chooses and an experiment sweeps). This RFC defines what we **measure** to see the
regime that results. The experiment's independent variables are the RFC 0001 presets
themselves; there is deliberately **no separate control layer** here.

## Why measurement-only

Configuring outcomes (trust, stance, growth-vs-cult) would defeat the goal of observing
governance conflict as an emergent result. This layer only reads.

## Candidate dependent variables (to refine)

- Exit rate / migration flow; secession events (the existing §3-D emergence).
- Run-style collapse signature (sudden mass exit when exit cost drops) — cf. bank-run
  dynamics.
- Voice volume (only once Voice exists — separate design).
- Survival / dormancy / ownership turnover.
- Prosperity distribution (e.g. currency Gini, treasury balances).
- Trust / legitimacy proxies (derived from satisfaction, endorsements, retention) —
  measured, never set.

## Dependencies (why this is heavier than it looks)

- The Layer 3 agent trust/satisfaction model is currently thin (`valueProfile`
  strict/lenient, plus `reputation` / `vouchFor`); a richer signal is likely needed.
- Voice does not exist yet (separate design).
- Builds on the existing Layer 5 observation (`metrics`, the read-only server) and the
  existing Exit primitives (`immigrate`, §3-D emergence).

## Methodology caution

Keep the headline independent variables small (2–3, e.g. a legitimacy-direction proxy,
exit cost, weighting). Exposing every RFC 0001 parameter as a free axis makes results
unanalyzable (combinatorial explosion).
