import { describe, expect, test } from "bun:test";
import { DevAuthServer } from "../src/dev-as";
import { makeVerifier, protectedResourceMetadata, wwwAuthenticate } from "../src/resource-server";
import { makeCustody, pkce } from "./helpers";

const ISSUER = "https://mcp.test";
const RESOURCE = "https://mcp.test/mcp";
const REDIRECT = "http://127.0.0.1:53682/cb";
const SCOPES = ["vouch:read", "vouch:transfer"];

function authorize(devAs: DevAuthServer, challenge: string, opts: { scope?: string; sub?: string; resource?: string } = {}) {
  return devAs.authorize(
    new URLSearchParams({
      response_type: "code",
      client_id: "c",
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: opts.scope ?? "vouch:read",
      state: "s",
      resource: opts.resource ?? RESOURCE,
      login_hint: opts.sub ?? "alice",
    }),
  );
}

async function mint(devAs: DevAuthServer, opts: { scope?: string; sub?: string } = {}): Promise<string> {
  const { verifier, challenge } = pkce();
  const a = authorize(devAs, challenge, opts);
  if (!("redirect" in a)) throw new Error(`authorize failed: ${JSON.stringify(a)}`);
  const code = new URL(a.redirect).searchParams.get("code");
  if (!code) throw new Error("no code");
  const t = await devAs.token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      client_id: "c",
    }),
  );
  if (!("access_token" in t)) throw new Error(`token failed: ${JSON.stringify(t)}`);
  return t.access_token;
}

describe("dev authorization server", () => {
  test("metadata advertises S256 PKCE (absence would make clients refuse)", () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    expect(devAs.metadata().code_challenge_methods_supported).toEqual(["S256"]);
  });

  test("authorization-code + PKCE mints an access token", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const token = await mint(devAs, { scope: "vouch:read vouch:transfer" });
    expect(token.split(".").length).toBe(3); // a JWT
  });

  test("PKCE verifier mismatch is rejected", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { challenge } = pkce();
    const a = authorize(devAs, challenge);
    const code = new URL((a as { redirect: string }).redirect).searchParams.get("code");
    const t = await devAs.token(
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        code_verifier: "the-wrong-verifier",
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        client_id: "c",
      }),
    );
    expect("access_token" in t).toBe(false);
  });

  test("an authorization code is single-use", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { verifier, challenge } = pkce();
    const a = authorize(devAs, challenge);
    const code = new URL((a as { redirect: string }).redirect).searchParams.get("code") ?? "";
    const form = () =>
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        client_id: "c",
      });
    expect("access_token" in (await devAs.token(form()))).toBe(true);
    expect("access_token" in (await devAs.token(form()))).toBe(false); // replay of the code fails
  });

  test("a token can only be requested for this resource (RFC 8707 binding)", () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { challenge } = pkce();
    const a = authorize(devAs, challenge, { resource: "https://evil.test/mcp" });
    expect("redirect" in a).toBe(false); // invalid_target, no code minted
  });

  test("redirect_uri must be loopback — no open redirect to an arbitrary https host", () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { challenge } = pkce();
    const a = devAs.authorize(
      new URLSearchParams({
        response_type: "code",
        client_id: "c",
        redirect_uri: "https://attacker.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "vouch:read",
        resource: RESOURCE,
      }),
    );
    expect("redirect" in a).toBe(false); // rejected before any 302 → no code/state leak
  });
});

describe("resource server — token verification", () => {
  test("a valid token resolves to the subject's principal + scopes", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { custody } = makeCustody();
    const verify = makeVerifier({ issuer: ISSUER, audience: RESOURCE, key: () => devAs.publicKey(), custody });
    const token = await mint(devAs, { scope: "vouch:read vouch:transfer", sub: "alice" });
    const r = await verify(`Bearer ${token}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.principal).toBe(custody.principalFor({ iss: ISSUER, sub: "alice" }));
      expect(r.ctx.scopes).toEqual(["vouch:read", "vouch:transfer"]);
    }
  });

  test("a token minted for another audience is rejected (no cross-server replay)", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { custody } = makeCustody();
    const wrongAudience = makeVerifier({ issuer: ISSUER, audience: "https://other.test/mcp", key: () => devAs.publicKey(), custody });
    const token = await mint(devAs);
    const r = await wrongAudience(`Bearer ${token}`);
    expect(r.ok).toBe(false);
  });

  test("a tampered token is rejected", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { custody } = makeCustody();
    const verify = makeVerifier({ issuer: ISSUER, audience: RESOURCE, key: () => devAs.publicKey(), custody });
    const token = await mint(devAs);
    const tampered = `${token.slice(0, -3)}xyz`;
    expect((await verify(`Bearer ${tampered}`)).ok).toBe(false);
  });

  test("a missing bearer is rejected", async () => {
    const devAs = new DevAuthServer(ISSUER, RESOURCE, SCOPES);
    const { custody } = makeCustody();
    const verify = makeVerifier({ issuer: ISSUER, audience: RESOURCE, key: () => devAs.publicKey(), custody });
    const r = await verify(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_token");
  });
});

describe("discovery documents", () => {
  test("protected-resource-metadata lists the authorization server (MCP-mandated)", () => {
    const prm = protectedResourceMetadata(RESOURCE, ISSUER, SCOPES);
    expect(prm.resource).toBe(RESOURCE);
    expect(prm.authorization_servers).toEqual([ISSUER]);
  });

  test("the WWW-Authenticate challenge points at the metadata", () => {
    const h = wwwAuthenticate("https://mcp.test/.well-known/oauth-protected-resource/mcp", "invalid_token");
    expect(h).toContain('resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"');
    expect(h).toContain('error="invalid_token"');
  });
});

describe("dev-AS request validation (error branches)", () => {
  const dev = () => new DevAuthServer(ISSUER, RESOURCE, SCOPES);
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  const ok = {
    response_type: "code",
    client_id: "c",
    redirect_uri: REDIRECT,
    code_challenge: "abc",
    code_challenge_method: "S256",
    scope: "vouch:read",
    resource: RESOURCE,
  };

  test("authorize rejects a non-code response_type", () => {
    expect("redirect" in dev().authorize(q({ ...ok, response_type: "token" }))).toBe(false);
  });
  test("authorize requires client_id", () => {
    expect("redirect" in dev().authorize(q({ ...ok, client_id: "" }))).toBe(false);
  });
  test("authorize requires code_challenge_method=S256 (no plain downgrade)", () => {
    expect("redirect" in dev().authorize(q({ ...ok, code_challenge_method: "plain" }))).toBe(false);
  });
  test("authorize requires a code_challenge (PKCE)", () => {
    expect("redirect" in dev().authorize(q({ ...ok, code_challenge: "" }))).toBe(false);
  });
  test("token rejects an unsupported grant_type", async () => {
    expect("access_token" in (await dev().token(q({ grant_type: "password" })))).toBe(false);
  });
  test("token requires a code", async () => {
    expect("access_token" in (await dev().token(q({ grant_type: "authorization_code" })))).toBe(false);
  });

  // mint a valid code, then break ONE token-request field at a time
  const mintCode = (d: DevAuthServer): { code: string; verifier: string } => {
    const { verifier, challenge } = pkce();
    const a = d.authorize(q({ ...ok, code_challenge: challenge }));
    return { code: new URL((a as { redirect: string }).redirect).searchParams.get("code") ?? "", verifier };
  };

  test("token rejects a redirect_uri mismatch", async () => {
    const d = dev();
    const { code, verifier } = mintCode(d);
    const r = await d.token(
      q({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: "http://127.0.0.1:1/other",
        resource: RESOURCE,
        client_id: "c",
      }),
    );
    expect("access_token" in r).toBe(false);
  });
  test("token requires a code_verifier", async () => {
    const d = dev();
    const { code } = mintCode(d);
    const r = await d.token(q({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, resource: RESOURCE, client_id: "c" }));
    expect("access_token" in r).toBe(false);
  });
  test("token rejects a resource mismatch (RFC 8707)", async () => {
    const d = dev();
    const { code, verifier } = mintCode(d);
    const r = await d.token(
      q({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        resource: "https://evil.test/mcp",
        client_id: "c",
      }),
    );
    expect("access_token" in r).toBe(false);
  });

  test("jwks exposes the EdDSA signing public key", async () => {
    const j = await dev().jwks();
    expect(j.keys[0]?.alg).toBe("EdDSA");
    expect(j.keys[0]?.kty).toBe("OKP");
    expect(j.keys[0]?.kid).toBeTruthy();
  });
});
