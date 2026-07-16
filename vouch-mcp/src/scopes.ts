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
