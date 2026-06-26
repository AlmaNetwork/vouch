# CLAUDE.md — vouch-core (L1, the trust engine)

Package-specific rules. Read the [root CLAUDE.md](../CLAUDE.md) first.

`vouch-core` is the **stateless, dependency-free\* trust engine**: it mints
identifiers / Ed25519 keys / certificates and **formally verifies** signatures. It
fixes only the certificate envelope shape and how the signature is attached.

\* Depends on no other monorepo layer; only `zod`, `@noble/curves`, `canonicalize`.

## The one rule: form, not meaning

This layer verifies **form** (envelope shape + signature). It must **never**:

- decide whether a certificate is *trustworthy* — that is a village's job;
- interpret, validate-deeper, or branch on `claims` or `schemaId` — they are opaque
  (`claims` is checked only as a plain JSON object; `schemaId` only as a non-empty
  string);
- store certificates or keys — `verifyCertificate` takes the issuer public key as an
  argument precisely because the core keeps **no** key directory;
- read a clock or any global RNG — `issuedAt` is caller-supplied (ISO 8601);
  randomness enters only via `generateKeyPair` or caller-supplied seeds;
- import any other monorepo layer, or grow knowledge of villages/economies/agents.

## Public surface (what callers use)

- `issueCertificate(input, issuerPrivateKey): Certificate` — validates input (zod),
  JCS-canonicalizes every field **except** `signature`, signs, returns the cert.
  **THROWS** on invalid input or unknown suite (`alma-core:` prefix). Stateless.
- `verifyCertificate(cert, issuerPublicKey): VerificationResult` — form-only.
  Returns `{ok:true}` or `{ok:false, reason, detail}`. **Never throws.**
- `certificateSigningBytes(cert)` — the exact signed payload (all fields except
  `signature`, JCS-canonicalized).
- Keys: `generateKeyPair()`, `keyPairFromSeed(seed /* 32 bytes */)`,
  `publicKeyFor(privateKey)`. A private key **is** its 32-byte seed.
- Identifiers: `parseIdentifier`, `formatIdentifier`, `isValidName`,
  `isValidRegion`, `isValidIdentifier`.
- Suites: `registerSuite`, `getSuite`, `listSuites`, `ED25519_SUITE`. Only
  `ed25519` is registered at import.
- Encoding/JCS: `encodeBase64`, `decodeBase64` (strict), `canonicalString`,
  `canonicalBytes`.

## Invariants (pinned by tests)

- **`verifyCertificate` never throws**; all outcomes flow through
  `VerificationResult`. **`issueCertificate` does throw** on bad input/unknown
  suite. Don't wrap verify in try/catch; do branch on `result.ok`.
- **Success is exactly `{ok:true}`** with no extra fields (tests use
  `toEqual({ok:true})`). Do not add to the success arm.
- **The six failure reasons are a stable API:** `malformed-envelope`,
  `invalid-issuer`, `invalid-subject`, `unknown-suite`,
  `invalid-signature-encoding`, `bad-signature`. Tests assert them verbatim.
- **`version` must equal `CERT_VERSION` = `"alma-cert/v1"`** (`z.literal`); any other
  version is `malformed-envelope`.
- **Signed payload = the seven non-signature fields, JCS-canonicalized.** Issue and
  verify both go through `certificateSigningBytes`, so key/field order doesn't
  matter. **If you add a `Certificate` field, update `certificateSigningBytes`** or
  the signature silently won't cover it.
- **Unknown suite is an explicit failure**, never a silent fallback (issue throws;
  verify returns `unknown-suite`).
- **A suite's `verify()` must return `false` (not throw)** on malformed bytes so
  `verifyCertificate` can map it to `bad-signature`.
- **`decodeBase64` is strict** (length % 4 == 0 and matches the base64 charset) and
  throws `invalid base64 string`, surfaced as `invalid-signature-encoding`. Keep it
  strict.
- **Ed25519 seeds are exactly 32 bytes** (`keyPairFromSeed` rejects otherwise).
- **No clock:** `issuedAt` is validated (ISO 8601 regex + `Date.parse`), never
  generated.

## Gotchas

- The internal/protocol name is **`alma`**, not `vouch` (error prefix `alma-core:`,
  version `alma-cert/v1`). This is intentional — see the naming split in the root
  guide; do not "fix" it during a branding pass.
- `region` must be **lowercase** alphanumerics: `bob@Umi` is invalid, `bob@umi` is
  valid. `name` must start with a letter.
- `issuedAt` must be real ISO 8601 (e.g. `2026-01-01T00:00:00.000Z`); `2026/01/01`
  and `yesterday` are rejected.
- The suite registry is module-global mutable state populated by a top-level
  `registerSuite(ED25519_SUITE)` side effect at import.

## Versioning a contract

Changing `CERT_VERSION`, the failure-reason set, the `alma-core:` prefix, or the
`name@region` grammar is a **breaking wire/API change**. Tests and every downstream
layer pin these exact strings — treat such a change as deliberate, not incidental.

## Out of scope (deliberately excluded from L1)

Storage, a key directory, verification policy, certificate chains, revocation,
regions/economy/currency, CBOR, and any suite other than `ed25519`. These belong to
higher layers. Keep the core a stateless form-verifier.

## Add a signature suite (recipe)

1. Implement `SignatureSuite` (`{ id, sign(msg, sk), verify(msg, sig, pk) }`).
   `verify` must return `false` on bad bytes, never throw.
2. `registerSuite(yourSuite)` at module load.
3. Callers pass `suite: yourSuite.id` to `issueCertificate`; verify resolves it from
   the registry. An unregistered id stays an explicit `unknown-suite` failure.
