// A tiny shared result union for fallible operations that return a REASON on
// failure (as opposed to throwing on an invariant violation). One shape, used by
// every environment mutator and by the node, so callers narrow the same way.
//
//   Result                              -> { ok: true } | { ok: false; reason }
//   Result<{ fee: number }>             -> { ok: true; fee: number } | { ok: false; reason }
//   Result<{ region: RegionState }>     -> …
//
// The success extras are intersected into the ok branch, so existing call sites
// that read `res.fee` / `res.region` keep working.

export type Result<T extends object = Record<never, never>, E = string> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: E };
