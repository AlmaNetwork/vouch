// A MINIMAL embedded OAuth 2.1 Authorization Server — for local dev and CI only.
//
// The MCP spec makes the MCP server a Resource Server and leaves the Authorization
// Server out of scope: in production you delegate to a real IdP (set VOUCH_MCP_AS_*
// and this is never mounted). This exists so the whole flow runs end-to-end with
// zero external setup. It implements exactly the OAuth 2.1 slice the MCP client
// needs: authorization-code + PKCE(S256), RFC 8414 metadata, a JWKS, and access
// tokens whose `aud` is bound to the MCP resource (RFC 8707).
//
// The ONE dev shortcut is login: there is no password UI — `/authorize` approves
// the subject named by `login_hint` (default "dev"). Everything else (PKCE
// verification, single-use codes, exact redirect echo, audience binding) is real.

import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";

const KID = "dev-ed25519-1";
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SEC = 600;

interface AuthCode {
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scope: string;
  readonly sub: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

type OAuthError = { readonly error: string; readonly error_description: string };
type AuthorizeResult = { readonly redirect: string } | { readonly status: number; readonly body: OAuthError };
type TokenResult =
  | { readonly access_token: string; readonly token_type: "Bearer"; readonly expires_in: number; readonly scope: string }
  | { readonly status: number; readonly body: OAuthError };

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * A redirect_uri is acceptable in this dev-AS only if it is LOOPBACK (http or https).
 * The dev-AS is passwordless and loopback-bound, so a redirect must stay local — a
 * bare `https:` allow would be an open-redirect gadget that leaks the code + state to
 * an arbitrary host (the endpoint would 302 the browser there).
 */
function redirectAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  return loopback && (u.protocol === "https:" || u.protocol === "http:");
}

export class DevAuthServer {
  private readonly keys: Promise<{ publicKey: KeyLike; privateKey: KeyLike }>;
  private readonly codes = new Map<string, AuthCode>();

  constructor(
    private readonly issuer: string,
    private readonly resource: string,
    private readonly scopesSupported: readonly string[],
  ) {
    this.keys = generateKeyPair("EdDSA", { extractable: true });
  }

  /** The AS signing public key — handed to the RS in-process so it need not self-fetch its own JWKS. */
  async publicKey(): Promise<KeyLike> {
    return (await this.keys).publicKey;
  }

  /** RFC 8414 authorization-server metadata. `code_challenge_methods_supported` is REQUIRED — its absence makes MCP clients refuse. */
  metadata(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      jwks_uri: `${this.issuer}/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...this.scopesSupported],
    };
  }

  async jwks(): Promise<{ keys: Record<string, unknown>[] }> {
    const jwk = await exportJWK((await this.keys).publicKey);
    return { keys: [{ ...jwk, kid: KID, use: "sig", alg: "EdDSA" }] };
  }

  /** GET /authorize — validate the request, approve the dev subject, and mint a single-use code. */
  authorize(q: URLSearchParams): AuthorizeResult {
    const err = (error: string, error_description: string, status = 400): AuthorizeResult => ({
      status,
      body: { error, error_description },
    });
    const redirectUri = q.get("redirect_uri") ?? "";
    // A bad redirect_uri must NOT be redirected to (open-redirect / code leak); report directly.
    if (!redirectAllowed(redirectUri)) return err("invalid_request", "redirect_uri must be loopback http or https");
    if (q.get("response_type") !== "code") return err("unsupported_response_type", "only response_type=code is supported");
    const clientId = q.get("client_id");
    if (!clientId) return err("invalid_request", "client_id is required");
    const codeChallenge = q.get("code_challenge");
    if (!codeChallenge) return err("invalid_request", "code_challenge is required (PKCE)");
    if (q.get("code_challenge_method") !== "S256") return err("invalid_request", "code_challenge_method must be S256");
    const resource = q.get("resource");
    if (resource !== this.resource) return err("invalid_target", `resource must be ${this.resource}`);

    const requested = (q.get("scope") ?? "").split(/\s+/).filter(Boolean);
    const granted = requested.filter((s) => this.scopesSupported.includes(s));
    const scope = granted.length > 0 ? granted.join(" ") : "vouch:read";
    const sub = q.get("login_hint") ?? "dev";

    const code = randomUUID();
    this.codes.set(code, { codeChallenge, redirectUri, resource, scope, sub, clientId, expiresAt: Date.now() + CODE_TTL_MS });

    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    const state = q.get("state");
    if (state) back.searchParams.set("state", state);
    return { redirect: back.toString() };
  }

  /** POST /token — authorization_code grant: verify PKCE + single-use code, then mint an aud-bound access token. */
  async token(form: URLSearchParams): Promise<TokenResult> {
    const err = (error: string, error_description: string, status = 400): TokenResult => ({ status, body: { error, error_description } });
    if (form.get("grant_type") !== "authorization_code") return err("unsupported_grant_type", "only authorization_code is supported");
    const code = form.get("code");
    if (!code) return err("invalid_request", "code is required");

    const record = this.codes.get(code);
    // Single-use: consume the code immediately, whatever happens next.
    if (record) this.codes.delete(code);
    if (!record) return err("invalid_grant", "unknown or already-used code");
    if (Date.now() > record.expiresAt) return err("invalid_grant", "code expired");
    if ((form.get("redirect_uri") ?? "") !== record.redirectUri) return err("invalid_grant", "redirect_uri mismatch");

    const verifier = form.get("code_verifier");
    if (!verifier) return err("invalid_request", "code_verifier is required (PKCE)");
    if (s256(verifier) !== record.codeChallenge) return err("invalid_grant", "PKCE verification failed");

    const reqResource = form.get("resource");
    if (reqResource !== null && reqResource !== record.resource) return err("invalid_target", "resource mismatch");

    const { privateKey } = await this.keys;
    const access_token = await new SignJWT({ scope: record.scope })
      .setProtectedHeader({ alg: "EdDSA", kid: KID })
      .setIssuer(this.issuer)
      .setSubject(record.sub)
      .setAudience(record.resource)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SEC}s`)
      .setJti(randomUUID())
      .sign(privateKey);

    return { access_token, token_type: "Bearer", expires_in: TOKEN_TTL_SEC, scope: record.scope };
  }
}
