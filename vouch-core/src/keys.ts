// 第1層 信頼コア — Ed25519 key generation.
//
// The core is a factory: it generates keys (§2-2). It stores nothing.
// An Ed25519 private key IS its 32-byte seed, so `keyPairFromSeed` lets a later
// layer derive keys deterministically from the world RNG (§2-7) without the core
// itself ever touching a clock or a global RNG.

import { ed25519 } from "@noble/curves/ed25519";

export interface KeyPair {
  readonly privateKey: Uint8Array; // 32-byte Ed25519 seed
  readonly publicKey: Uint8Array; // 32-byte Ed25519 public key
}

/** Generate a fresh random Ed25519 key pair. */
export function generateKeyPair(): KeyPair {
  return keyPairFromSeed(ed25519.utils.randomPrivateKey());
}

/** Derive a key pair deterministically from a 32-byte seed. */
export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) {
    throw new Error(`alma-core: ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const privateKey = Uint8Array.from(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Recover the public key for a given private key/seed. */
export function publicKeyFor(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}
