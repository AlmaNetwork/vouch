// Scope → command gate.
//
// The OAuth access token's `scope` decides WHICH vouch commands the custodial
// server is willing to sign. This is a load-bearing mitigation: a broad or
// prompt-injected agent call cannot sign an action the human's token was never
// granted. Enforced server-side BEFORE any signing happens (see custody.ts /
// mcp.ts); a miss is surfaced to the caller as insufficient_scope.

/** The write command kinds vouch-mcp can sign, each mapped to the scope that authorizes it. */
export const SCOPE_FOR_COMMAND: Readonly<Record<string, string>> = {
  found: "vouch:found",
  admit: "vouch:admit",
  transfer: "vouch:transfer",
  vouch: "vouch:vouch",
  migrate: "vouch:migrate",
  // Governance is one scope, not three. `propose` and `vote` are the council's two
  // halves of the same act that `amend` performs alone under a dictatorship — a token
  // trusted to change a region's rules is trusted to change them whichever way that
  // region is constituted.
  amend: "vouch:govern",
  propose: "vouch:govern",
  vote: "vouch:govern",
  // The market is its own scope, separate from vouch:govern. Amending a region's rules
  // and GIVING THE REGION AWAY are different kinds of trust — the second is
  // irreversible from the old owner's side, since only the new owner can hand it back.
  lifecycle: "vouch:market",
  list: "vouch:market",
  handover: "vouch:market",
  // One scope for the item ledger: minting and handing over are the two ends of the
  // same asset moving, and both are already gated in-world (the region's `items`
  // institution for minting, current-holder-only for transfer).
  "mint-item": "vouch:item",
  "transfer-item": "vouch:item",
};

/** The coarse scope that implies every write scope (a convenience for trusted clients). */
export const WRITE_SUPERSCOPE = "vouch:write";
export const READ_SCOPE = "vouch:read";

export type ScopeCheck = { readonly ok: true } | { readonly ok: false; readonly needed: string };

/** May a token holding `granted` scopes have this command kind signed? */
export function commandAllowed(granted: readonly string[], commandKind: string): ScopeCheck {
  const needed = SCOPE_FOR_COMMAND[commandKind];
  if (!needed) return { ok: false, needed: "unknown-command" };
  if (granted.includes(needed) || granted.includes(WRITE_SUPERSCOPE)) return { ok: true };
  return { ok: false, needed };
}

/** May a token holding `granted` scopes read world state? Any vouch scope grants read. */
export function readAllowed(granted: readonly string[]): boolean {
  return granted.includes(READ_SCOPE) || granted.includes(WRITE_SUPERSCOPE) || granted.some((s) => s.startsWith("vouch:"));
}
