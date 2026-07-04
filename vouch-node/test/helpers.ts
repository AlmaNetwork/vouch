// Client-side signing helpers — what a real participant's client would do to
// produce a self-signed registration / a signed command.

import { ED25519_SUITE, encodeBase64, type KeyPair, keyPairFromSeed } from "vouch-core";
import { commandBytes, type RegisterRequest, registerBytes, type SignedRequest } from "../src/accounts";

export function keypair(seedByte: number): KeyPair {
  return keyPairFromSeed(new Uint8Array(32).fill(seedByte));
}

export function signRegister(principal: string, nonce: number, kp: KeyPair): RegisterRequest {
  const publicKey = encodeBase64(kp.publicKey);
  const signature = encodeBase64(ED25519_SUITE.sign(registerBytes(principal, nonce, publicKey), kp.privateKey));
  return { principal, publicKey, nonce, signature };
}

export function signCommand(principal: string, nonce: number, command: unknown, kp: KeyPair): SignedRequest {
  const signature = encodeBase64(ED25519_SUITE.sign(commandBytes(principal, nonce, command), kp.privateKey));
  return { principal, nonce, command, signature };
}
