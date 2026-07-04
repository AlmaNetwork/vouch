// A tiny client SDK — what a CLI, a Web GUI, or a test drives the node through.
//
// It does two things: run the OAuth 2.1 authorization-code + PKCE dance against the
// bundled dev-AS to obtain a scoped access token, then open an MCP session carrying
// that token as a Bearer on every request. A production client would swap
// `fetchDevToken` for a real IdP login; the MCP half is unchanged.

import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export interface DevTokenOptions {
  readonly baseUrl: string;
  /** RFC 8707 resource — MUST equal the MCP server's canonical resource (its token audience). */
  readonly resource: string;
  readonly scopes: readonly string[];
  /** Dev-AS convenience: the subject to log in as (default "dev"). */
  readonly sub?: string;
  readonly clientId?: string;
}

export interface DevToken {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope: string;
}

/** Run authorization-code + PKCE(S256) against the bundled dev-AS and return the access token. */
export async function fetchDevToken(opts: DevTokenOptions): Promise<DevToken> {
  const clientId = opts.clientId ?? "vouch-client";
  const redirectUri = "http://127.0.0.1:53682/callback"; // loopback; we read the code from the redirect directly

  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const authUrl = new URL(`${opts.baseUrl}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", opts.scopes.join(" "));
  authUrl.searchParams.set("state", b64url(randomBytes(8)));
  authUrl.searchParams.set("resource", opts.resource);
  if (opts.sub) authUrl.searchParams.set("login_hint", opts.sub);

  const authRes = await fetch(authUrl, { redirect: "manual" });
  const location = authRes.headers.get("location");
  if (!location) throw new Error(`/authorize did not redirect (${authRes.status}): ${await authRes.text()}`);
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`/authorize redirect carried no code: ${location}`);

  const tokenRes = await fetch(`${opts.baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      resource: opts.resource,
      client_id: clientId,
    }),
  });
  if (!tokenRes.ok) throw new Error(`/token failed (${tokenRes.status}): ${await tokenRes.text()}`);
  return (await tokenRes.json()) as DevToken;
}

/** Open an authenticated MCP session; the token is sent as a Bearer on every request. */
export async function connectMcp(baseUrl: string, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "vouch-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/** Convenience for tests/examples: extract the text payload of a tool result. */
export function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}
