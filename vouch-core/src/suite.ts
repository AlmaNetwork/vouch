// 第1層 信頼コア — signature-suite registry.
//
// The envelope carries a `suite` field (§4) so the byte format can grow later
// (CBOR, other curves, BBS+ ...) WITHOUT rebuilding the envelope. Signing and
// verifying dispatch through a registered suite. Today only "ed25519" is
// registered; an unknown suite is an explicit failure (§M0).

import { ed25519 } from "@noble/curves/ed25519";

export interface SignatureSuite {
  readonly id: string;
  sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

const registry = new Map<string, SignatureSuite>();

export function registerSuite(suite: SignatureSuite): void {
  registry.set(suite.id, suite);
}

export function getSuite(id: string): SignatureSuite | undefined {
  return registry.get(id);
}

export function listSuites(): string[] {
  return [...registry.keys()];
}

export const ED25519_SUITE: SignatureSuite = {
  id: "ed25519",
  sign(message, privateKey) {
    return ed25519.sign(message, privateKey);
  },
  verify(message, signature, publicKey) {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch {
      // Malformed signature/key bytes verify as `false` rather than throwing.
      return false;
    }
  },
};

registerSuite(ED25519_SUITE);
