# vouch-core

The **ALMA Trust Core** — extracted as a standalone, dependency-free* package.

A stateless factory that generates ids/keys/certificates and **formally verifies**
signatures. It knows nothing of villages, economies, or agents — meaning lives
*outside* the core (ALMA §2-2 / §2-3). Anyone can build their own world on top of it.

\* *No dependency on any ALMA layer.* Its only externals are `@noble/curves`,
`canonicalize`, and `zod`.

## Why it is its own package

The core fixes only two things: the **shape of the certificate envelope** and **how
the signature is attached**. It makes no trust judgement, stores nothing, and never
interprets `claims`. That independence is structural — the core imports nothing from
the simulator — so it is published on its own and consumed as a dependency:

```ts
import { generateKeyPair, issueCertificate, verifyCertificate } from "vouch-core";

const issuer = generateKeyPair();
const cert = issueCertificate(
  {
    issuer: "guild@umi",
    subject: "alice@umi",
    schemaId: "alma.trust/artisan/v1",
    claims: { role: "artisan", grade: 2 }, // opaque to the core
    issuedAt: "2026-01-01T00:00:00.000Z",   // caller supplies time (no clock in the core)
  },
  issuer.privateKey,
);

verifyCertificate(cert, issuer.publicKey); // { ok: true } | { ok: false, reason, detail }
```

`verifyCertificate` takes the issuer's public key explicitly — the core keeps **no key
directory**. Supplying the key is the caller's job.

## Surface

| Module | Exports |
|--------|---------|
| `identifier` | `parseIdentifier`, `isValidIdentifier`, `isValidRegion`, `formatIdentifier` |
| `keys` | `generateKeyPair`, `keyPairFromSeed`, `publicKeyFor` |
| `suite` | `getSuite`, `registerSuite`, `listSuites`, `ED25519_SUITE` |
| `jcs` | `canonicalBytes`, `canonicalString` (RFC 8785) |
| `certificate` | `issueCertificate`, `verifyCertificate`, `certificateSigningBytes`, types |

## Run

```bash
bun install
bun test
bun run typecheck
```

## Publishing note

For this PoC the package ships TypeScript source and bun resolves it directly
(`exports` → `src/index.ts`). For a real npm release, add a `tsc`/`tsup` build step
emitting `dist/` and point `main`/`types`/`exports` at the built files.

## Scope (unchanged from M0)

Does **not** do: storage, verification policy, certificate chains, revocation,
regions, economy, currency, CBOR, or any suite other than ed25519. Those belong to
the layers built on top — see the `vouch-world` simulator.
