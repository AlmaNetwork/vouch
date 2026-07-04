// vouch-mcp configuration.
//
// Strict, like vouch-node's config: the custodial master secret has NO silent
// fallback (a missing VOUCH_MCP_MASTER_SECRET throws rather than deriving every
// user's signing key from a predictable value), integers are range-checked, and
// the server binds loopback by default. The embedded node's own settings (notary,
// seed, persistence) are loaded through vouch-node's loadConfig so there is one
// source of truth for them.

import { loadConfig as loadNodeConfig, type NodeConfig, type RawEnv } from "vouch-node";

/** The five scopes a token may carry. Reads need `vouch:read`; each write needs its own scope (or the coarse `vouch:write`). */
export const SCOPES_SUPPORTED = ["vouch:read", "vouch:found", "vouch:admit", "vouch:transfer", "vouch:vouch"] as const;

export interface McpConfig {
  readonly host: string;
  readonly port: number;
  /** Canonical externally-reachable base URL (lowercased scheme/host, no trailing slash). */
  readonly publicUrl: string;
  /** OAuth issuer the RS trusts. For the bundled dev-AS this equals publicUrl; for an external IdP it is that IdP. */
  readonly issuer: string;
  /** RFC 8707 audience — the canonical resource identifier a token MUST be minted for. */
  readonly resource: string;
  /** RFC 9728 protected-resource-metadata URL (path-inserted under the /mcp endpoint). */
  readonly prmUrl: string;
  readonly scopesSupported: string[];
  /** HKDF input keying material for per-subject key derivation (never logged). */
  readonly master: Uint8Array;
  /** HKDF salt — stable per deployment so derived keys are reproducible across restarts. */
  readonly salt: Uint8Array;
  /** Settings for the embedded participate node. */
  readonly node: Pick<NodeConfig, "notary" | "seed" | "journalPath" | "accountsPath">;
  /** When set, the RS delegates token issuance to an external IdP instead of mounting the dev-AS. */
  readonly external: { readonly issuer: string; readonly jwksUri: string } | null;
  /** Whether to mount the bundled passwordless dev-AS. Only ever true for an explicit, loopback-bound dev opt-in. */
  readonly devAs: boolean;
}

/** Loopback hosts the passwordless dev-AS is allowed to bind to. */
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

function requireInt(raw: string | undefined, name: string, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  if (!/^-?\d+$/.test(raw)) throw new Error(`config: ${name} must be a decimal integer, got "${raw}"`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`config: ${name} must be in [${min}, ${max}], got ${n}`);
  return n;
}

/** Canonical origin+path per RFC 8707 §2 / RFC 3986: lowercase scheme+host, no fragment, no trailing slash. */
function canonicalBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`config: VOUCH_MCP_PUBLIC_URL must be an absolute URL, got "${raw}"`);
  }
  if (url.hash) throw new Error("config: VOUCH_MCP_PUBLIC_URL must not contain a fragment");
  const scheme = url.protocol.toLowerCase();
  const host = url.host.toLowerCase();
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${scheme}//${host}${path}`;
}

export function loadMcpConfig(env: RawEnv): McpConfig {
  const master = env.VOUCH_MCP_MASTER_SECRET;
  if (!master || master.length === 0) {
    throw new Error(
      "config: VOUCH_MCP_MASTER_SECRET is required — it is the custodial HKDF master secret; there is no fallback (a missing value would derive every subject's signing key from a predictable default).",
    );
  }
  if (master.length < 16) throw new Error("config: VOUCH_MCP_MASTER_SECRET must be at least 16 characters");

  const host = env.VOUCH_MCP_HOST ?? "127.0.0.1";
  const port = requireInt(env.VOUCH_MCP_PORT, "VOUCH_MCP_PORT", 8788, 1, 65535);
  const publicUrl = canonicalBase(env.VOUCH_MCP_PUBLIC_URL ?? `http://${host}:${port}`);
  const resource = `${publicUrl}/mcp`;

  const externalIssuer = env.VOUCH_MCP_AS_ISSUER;
  const externalJwks = env.VOUCH_MCP_AS_JWKS_URL;
  if ((externalIssuer && !externalJwks) || (!externalIssuer && externalJwks)) {
    throw new Error(
      "config: VOUCH_MCP_AS_ISSUER and VOUCH_MCP_AS_JWKS_URL must be set together (external IdP) or both unset (bundled dev-AS)",
    );
  }
  const external = externalIssuer && externalJwks ? { issuer: externalIssuer, jwksUri: externalJwks } : null;
  const issuer = external ? external.issuer : publicUrl;

  // The bundled dev-AS is a PASSWORDLESS signing-oracle front door (it approves any
  // `login_hint` subject with no authentication), so it must never fail-open. It is
  // mounted ONLY on an explicit opt-in (VOUCH_MCP_DEV_AS) AND a loopback bind; with no
  // external IdP and no dev opt-in we refuse to boot rather than silently exposing it.
  const devAsOptIn = env.VOUCH_MCP_DEV_AS === "1" || env.VOUCH_MCP_DEV_AS === "true";
  let devAs = false;
  if (!external) {
    if (!devAsOptIn) {
      throw new Error(
        "config: no authorization server configured — set VOUCH_MCP_AS_ISSUER + VOUCH_MCP_AS_JWKS_URL to delegate to an IdP (production), or VOUCH_MCP_DEV_AS=1 to mount the bundled passwordless dev-AS (local dev only).",
      );
    }
    if (!isLoopbackHost(host)) {
      throw new Error(
        `config: the bundled dev-AS is passwordless and MUST NOT be exposed on a non-loopback interface (VOUCH_MCP_HOST="${host}"); bind loopback, or configure an external IdP for a public deployment.`,
      );
    }
    devAs = true;
  }

  const node = loadNodeConfig(env);

  return {
    host,
    port,
    publicUrl,
    issuer,
    resource,
    prmUrl: `${publicUrl}/.well-known/oauth-protected-resource/mcp`,
    scopesSupported: [...SCOPES_SUPPORTED],
    master: new TextEncoder().encode(master),
    salt: new TextEncoder().encode(env.VOUCH_MCP_SALT ?? "vouch-mcp/hkdf-salt/v1"),
    node: { notary: node.notary, seed: node.seed, journalPath: node.journalPath, accountsPath: node.accountsPath },
    external,
    devAs,
  };
}
