// Typed credentials — varied certificate TYPES on the universal envelope.
//
// This is the "meaning" layer (§2-3): vouch-core fixes the envelope FORM and
// signs it; here we attach a STRUCTURE to a given `schemaId` so a certificate can
// carry various, validated elements. The core stays meaning-free — these schemas
// live above it and never change the envelope.
//
// NOTE: wiring credential types into a village's schema ledger so a Region
// *accepts/rejects* them is M4 (diplomacy). This module is just the typed
// catalogue + issue/verify helpers.

import type { z } from "zod";

/** A credential type: a `schemaId` plus the structured shape its `claims` must take. */
export interface CredentialType<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly schemaId: string;
  readonly schema: z.ZodType<T>;
  readonly label?: string;
}

export function defineCredentialType<T extends Record<string, unknown>>(
  schemaId: string,
  schema: z.ZodType<T>,
  label?: string,
): CredentialType<T> {
  return { schemaId, schema, label };
}

/** A lookup of credential types by `schemaId` — what a holder/verifier understands. */
export class CredentialRegistry {
  private readonly types = new Map<string, CredentialType>();

  register(type: CredentialType): this {
    this.types.set(type.schemaId, type);
    return this;
  }

  get(schemaId: string): CredentialType | undefined {
    return this.types.get(schemaId);
  }

  has(schemaId: string): boolean {
    return this.types.has(schemaId);
  }

  list(): string[] {
    return [...this.types.keys()];
  }
}
