// An end-to-end PARTICIPATE tour, in process (no network): boot a node, register
// two principals, found a region, admit residents, transfer conserved currency,
// vouch — then "restart" the node from its journal and show state was durable.
// Run: `bun examples/participate.ts`

import { ED25519_SUITE, encodeBase64, type KeyPair, keyPairFromSeed } from "vouch-core";
import { getAgent } from "vouch-world/agent";
import { assertCurrencyConserved } from "vouch-world/environment";
import { commandBytes, MemoryAccountLog, registerBytes } from "../src/accounts";
import { MemoryJournal } from "../src/journal";
import { VouchNode } from "../src/node";

const kp = (n: number): KeyPair => keyPairFromSeed(new Uint8Array(32).fill(n));
const alice = kp(1);
const ann = kp(3);

const signRegister = (principal: string, nonce: number, k: KeyPair) => ({
  principal,
  publicKey: encodeBase64(k.publicKey),
  nonce,
  signature: encodeBase64(ED25519_SUITE.sign(registerBytes(principal, nonce, encodeBase64(k.publicKey)), k.privateKey)),
});
const signCommand = (principal: string, nonce: number, command: unknown, k: KeyPair) => ({
  principal,
  nonce,
  command,
  signature: encodeBase64(ED25519_SUITE.sign(commandBytes(principal, nonce, command), k.privateKey)),
});

const log = (s: string) => console.log(s);

// A shared, durable journal + auth log (in memory here; on disk in production).
const journal = new MemoryJournal();
const accountLog = new MemoryAccountLog();
const notary = kp(7);

const node = new VouchNode({ seed: "participate-tour", notary, journal, accountLog });

log("\n=== 1. register principals (self-signed; unforgeable) ===");
log(`alice: ${JSON.stringify(node.register(signRegister("acct:alice", 0, alice)))}`);
log(`ann  : ${JSON.stringify(node.register(signRegister("ann@nova", 0, ann)))}`);

log("\n=== 2. alice founds 'nova' and admits two residents ===");
log(
  `found : ${JSON.stringify(node.submit(signCommand("acct:alice", 1, { kind: "found", regionId: "nova", displayName: "Nova" }, alice)))}`,
);
node.submit(signCommand("acct:alice", 2, { kind: "admit", agentId: "ann@nova", region: "nova", role: "merchant", currency: 100 }, alice));
node.submit(signCommand("acct:alice", 3, { kind: "admit", agentId: "bo@nova", region: "nova", role: "merchant", currency: 0 }, alice));
log("admitted ann@nova (100) and bo@nova (0)");

log("\n=== 3. ann transfers conserved currency + vouches for bo ===");
const t = node.submit(signCommand("ann@nova", 1, { kind: "transfer", from: "ann@nova", to: "bo@nova", amount: 20 }, ann));
log(`transfer: ${JSON.stringify(t)}`);
node.submit(signCommand("ann@nova", 2, { kind: "vouch", from: "ann@nova", to: "bo@nova", weight: 3 }, ann));
log(
  `ann currency=${getAgent(node.world.getState(), "ann@nova")?.balances.currency}, bo trust=${getAgent(node.world.getState(), "bo@nova")?.trust}`,
);

log("\n=== 4. a forged command is refused ===");
log(
  `mallory-as-alice: ${JSON.stringify(node.submit(signCommand("acct:alice", 4, { kind: "found", regionId: "evil", displayName: "Evil" }, kp(99))))}`,
);

log("\n=== 5. RESTART: rebuild the node from its journal ===");
const rebooted = new VouchNode({ seed: "participate-tour", notary, journal, accountLog });
log(`digest matches: ${rebooted.world.log.digest() === node.world.log.digest()}`);
log(`ann currency after restart=${getAgent(rebooted.world.getState(), "ann@nova")?.balances.currency}`);
assertCurrencyConserved(rebooted.world);
log("conservation holds after replay-on-boot ✓");
