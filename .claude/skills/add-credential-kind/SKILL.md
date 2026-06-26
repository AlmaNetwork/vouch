---
name: add-credential-kind
description: Declare a new typed credential kind in vouch-world's credential layer — a schemaId + a zod claims shape via defineCredentialType, optionally registered. Use when adding a new certificate type (a new skill/asset/membership-like credential) on top of the meaning-free vouch-core envelope.
---

# Add a typed credential kind

The credential layer (`vouch-world/src/credential`) is the "meaning" layer above the
meaning-free `vouch-core` envelope. A credential kind = a `schemaId` paired with the
zod shape its `claims` must satisfy. The core signs/verifies form; this layer
enforces claim structure.

## 1. Declare the type

Use **`defineCredentialType`** — never hand-build the object. Put built-ins in
`credential/library.ts`; a one-off can live near its use.

```ts
import { z } from "zod";
import { isValidIdentifier } from "vouch-core";
import { defineCredentialType } from "./types";

// reuse the shared identifier validator for any name@region claim field
const identifier = z.string().refine(isValidIdentifier, "must be a valid name@region identifier");

export const LicenseCredential = defineCredentialType(
  "alma.license/v1",                                  // schemaId — see naming rules below
  z.object({
    authority: identifier,
    license: z.string().min(1),
    expiresAt: z.string().min(1),
  }),
  "license",                                          // optional human label
);
```

### schemaId naming rules

- Namespace is the literal **`alma.*`** prefix with a **`/vN`** suffix:
  `alma.license/v1`. (This is the credential schema namespace — distinct from the
  envelope version `CERT_VERSION = "alma-cert/v1"`.)
- The `alma.` prefix is kept by the naming split even though the brand is `vouch`.
- `schemaId` is the identity used for registry lookup and the verify equality check.

## 2. Register it (optional)

To make holders/verifiers resolve it automatically by `schemaId`:

```ts
const registry = standardRegistry().register(LicenseCredential); // chainable
// or add to STANDARD_CREDENTIALS in library.ts if it's a built-in
```

`CredentialRegistry.register` is intentionally **non-generic** (it takes the erased
`CredentialType`). Do not try to make the registry generic — it's a deliberate zod-v4
covariance workaround. You recover the typed `T` at verify time by passing the type
explicitly.

## 3. Issue & verify

```ts
const cert = issueCredential(LicenseCredential, { issuer, subject, claims, issuedAt }, issuerPrivateKey);

// typed claims (pass the type explicitly):
const res = verifyCredential(cert, issuerPublicKey, LicenseCredential);
if (res.ok) res.claims.license; // typed as string

// or resolve from a registry (claims come back as Record<string, unknown>):
const res2 = verifyCredentialWith(cert, issuerPublicKey, registry);
```

Behavior to rely on:
- `issueCredential` validates claims with `schema.parse` (**throws** on bad claims)
  **before** signing, and sets the cert `schemaId` from `type.schemaId` (never
  caller input). An invalid credential can't be issued through the typed path.
- `verifyCredential` checks **form via the core first** (so a tampered cert returns a
  core reason like `bad-signature`), then `schema-mismatch` if `schemaId` differs,
  then `invalid-claims` if claims fail `safeParse`. `verifyCredentialWith` adds
  `unknown-credential-type` when the registry has no match.
- **A valid signature does not imply valid claims** — always re-validate on verify;
  never trust `schemaId` alone.

## 4. Versioning

To change a kind's meaning, mint a **new** `schemaId` (`alma.license/v2`) — never
edit the v1 schema in place. Old certs keep referencing the old `schemaId`.

## 5. Tests (in `test/credential/`)

- **Round-trip**: issue → verify ok, with a typed claim read after narrowing on
  `res.ok`.
- **Issue-time rejection**: `expect(() => issueCredential(...bad claims...)).toThrow()`.
- **Bypass trap**: build a validly-signed cert directly via core `issueCertificate`
  with out-of-schema claims → `verifyCredential` returns `invalid-claims`.
- **Wrong/unknown type**: verify against the wrong type → `schema-mismatch`; via a
  registry with no match → `unknown-credential-type`.
- **Form pass-through**: tamper claims → `bad-signature`.
- **Determinism**: same seeded key + fixed `issuedAt` ⇒ identical signature.
- If you added it to `STANDARD_CREDENTIALS`, update the
  `standardRegistry().list().sort()` assertion.

## 6. Finish

Run the `verify` skill; update READMEs/test counts if needed; commit.

> Out of scope here: wiring a kind into a village's schema ledger so a region
> accepts/rejects it is **M4 diplomacy**, not this layer. This module is the
> catalogue + issue/verify only.
