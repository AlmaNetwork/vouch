# Part 3 — Digital items & credentials

Every "digital item" in ALMA rides the **same universal certificate envelope** (defined
by the trust core); only the `claims` inside differ. The core fixes the *form* and the
*signature*; a credential **type** attaches a validated *meaning* to a `schemaId`. The
envelope never changes — only what you put in it.

```jsonc
// the universal envelope (vouch-core)
{
  "version": "alma-cert/v1",
  "suite": "ed25519",
  "issuer": "name@region",        // who signs
  "subject": "name@region",       // who it is about
  "schemaId": "alma.skill/v1",    // which credential type
  "claims": { … },                // validated against the type's schema
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "signature": "base64"
}
```

> **`not-yet-HTTP` + 🔑 key custody.** Issuing is an in-process operation; there is no
> issue-credential HTTP route on this build. Crucially, `issueCredential` takes a **raw
> private key** to sign with — that key is **server-held**. A client supplies the
> **public** subject/issuer identifiers and the **claims**, and the node signs. Never
> transmit a private key to issue a credential.

## The standard credential library

Four ready-made types (define your own with the same pattern — the envelope is unchanged):

| `schemaId` | Meaning | Claims (validated) |
|---|---|---|
| `alma.skill/v1` | A skill attestation: holder can do X at level N | `{ skill: string, level: int 0..10 }` |
| `alma.membership/v1` | Membership of an org in a role, since a date | `{ org: string, role: string, since: string }` |
| `alma.asset/v1` | A claim over some amount of an asset | `{ kind: string, amount: number ≥ 0, unit: string }` |
| `alma.endorsement/v1` | One party endorsing another | `{ of: name@region, weight: int 1..5, note?: string }` |

## Issue & verify

- **`issueCredential(type, input, issuerPrivateKey)`** → a signed `Certificate`.
  - logical input: `type` (a credential type / its `schemaId`) and
    `input: { issuer, subject, claims, issuedAt, suite? }`
  - **server-supplied:** `issuerPrivateKey` (raw — held by the node, never a client input)
  - throws if the claims don't match the type's schema (structured validation).
- **`verifyCredential(cert, issuerPublicKey, type)`** → `{ ok: true, schemaId, claims }`
  or `{ ok: false, reason, detail }`. Takes a **public** key — safe to pass. It checks
  *form* (the core: signature + envelope shape) then *meaning* (claims match the type).
  Failure reasons include the core's (`bad-signature`, `malformed-envelope`, …) plus
  `schema-mismatch`, `unknown-credential-type`, `invalid-claims`.
- **`verifyCredentialWith(cert, issuerPublicKey, registry)`** — verify against whichever
  type a registry holds for the cert's `schemaId` (use when you don't know the type up front).

```ts
// In-process contract (illustrative — the private key is the NODE's, not a client's):
const cert = issueCredential(
  SkillCredential,
  { issuer: "guild@umi", subject: "ada@umi",
    claims: { skill: "smithing", level: 4 },
    issuedAt: "2026-01-01T00:00:00.000Z" },
  nodeHeldPrivateKey,          // 🔑 server-side only
);
const check = verifyCredential(cert, adaGuildPublicKey, SkillCredential);
// { ok: true, schemaId: "alma.skill/v1", claims: { skill: "smithing", level: 4 } }
```

## Economy receipt

`executeTransfer` (see [part 2](02-create-and-operate.md#moving-value)) mints one more
credential as a **byproduct**: a receipt signed by the region's notary.

| `schemaId` | Meaning | Claims |
|---|---|---|
| `alma.tx/receipt/v1` | "this transfer settled" | `{ from, to, amount, fee, kind: "currency" }` |

You don't issue this directly — the node produces it server-side when a transfer settles,
and it accumulates in the log inside the `economy.settled` event's `receipt` field. Replay
folds it as data; it is never re-signed. This is how value moves leave an auditable,
verifiable trail without any client ever touching a signing key.
