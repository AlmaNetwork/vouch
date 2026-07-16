// The OAuth 2.1 Resource Server side.
//
// The MCP endpoint is protected: every request must carry `Authorization: Bearer
// <jwt>`, and the token is verified on EVERY request (not just at handshake). We
// check the signature AND the issuer AND the audience — the audience check is the
// RFC 8707 binding that stops a token minted for another resource from being
// replayed here; jose does NOT enforce it unless we pass `audience`, so it is
// explicit. On failure we answer 401 with a `WWW-Authenticate` header that points
// at our RFC 9728 protected-resource-metadata, per the spec's discovery flow.

import { type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Custody } from "./custody";

/**
 * A JWT verification key resolver. Both the bundled dev-AS (a fixed in-process key
 * wrapped in a resolver) and an external IdP (`createRemoteJWKSet`) present as this
 * one function shape, so jwtVerify always takes its get-key overload.
 */
export type VerifyKey = JWTVerifyGetKey;

/** The identity a valid token resolves to. `principal` is derived server-side from (iss, sub) — never from the body. */
export interface AuthContext {
  readonly principal: string;
  readonly iss: string;
  readonly sub: string;
  readonly scopes: string[];
  readonly jti: string | null;
}

export type VerifyResult =
  | { readonly ok: true; readonly ctx: AuthContext }
  | { readonly ok: false; readonly status: 401; readonly error: string };

export interface VerifierDeps {
  readonly issuer: string;
  readonly audience: string;
  readonly key: VerifyKey;
  readonly custody: Custody;
}

/** Build a bearer-token verifier bound to this resource server's issuer + audience. */
export function makeVerifier(deps: VerifierDeps): (authHeader: string | undefined) => Promise<VerifyResult> {
  return async (authHeader) => {
    if (!authHeader?.startsWith("Bearer ")) {
      return { ok: false, status: 401, error: "missing_token" };
    }
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const { payload } = await jwtVerify(token, deps.key, {
        issuer: deps.issuer,
        audience: deps.audience,
        algorithms: ["EdDSA"],
      });
      if (!payload.sub || !payload.iss) return { ok: false, status: 401, error: "invalid_token" };
      const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
      const ctx: AuthContext = {
        principal: deps.custody.principalFor({ iss: payload.iss, sub: payload.sub }),
        iss: payload.iss,
        sub: payload.sub,
        scopes,
        jti: typeof payload.jti === "string" ? payload.jti : null,
      };
      return { ok: true, ctx };
    } catch {
      // Bad signature, wrong issuer/audience, expired — all collapse to invalid_token.
      return { ok: false, status: 401, error: "invalid_token" };
    }
  };
}

/** RFC 9728 protected-resource-metadata document — MCP mandates at least one authorization_servers entry. */
export function protectedResourceMetadata(resource: string, issuer: string, scopesSupported: string[]): Record<string, unknown> {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ["header"],
  };
}

/** The `WWW-Authenticate: Bearer …` challenge that lets an unauthenticated client discover our auth server. */
export function wwwAuthenticate(prmUrl: string, error?: string): string {
  const parts = [`Bearer resource_metadata="${prmUrl}"`];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}
