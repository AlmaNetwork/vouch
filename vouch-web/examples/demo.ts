// Self-contained demo: boot an in-process vouch-node, seed a couple of villages with
// signed commands, and serve the viewer against it. Run: `bun examples/demo.ts` then
// open http://127.0.0.1:5173.

import { ED25519_SUITE, encodeBase64, type KeyPair, keyPairFromSeed } from "vouch-core";
import { commandBytes, createNodeApp, MemoryAccountLog, MemoryJournal, registerBytes, VouchNode } from "vouch-node";
import { createHandler } from "../src/server";

const NODE_PORT = Number(process.env.VOUCH_NODE_PORT ?? 8799);
const WEB_PORT = Number(process.env.VOUCH_WEB_PORT ?? 5173);
const nodeUrl = `http://127.0.0.1:${NODE_PORT}`;
const key = (b: number) => keyPairFromSeed(new Uint8Array(32).fill(b));

// 1. the node
const node = new VouchNode({ seed: "web-demo", notary: key(7), journal: new MemoryJournal(), accountLog: new MemoryAccountLog() });

// 2. seed directly through the node's signed write path (each identity holds its own key)
const nonce = new Map<string, number>();
const register = (principal: string, kp: KeyPair) => {
  const publicKey = encodeBase64(kp.publicKey);
  node.register({
    principal,
    publicKey,
    nonce: 0,
    signature: encodeBase64(ED25519_SUITE.sign(registerBytes(principal, 0, publicKey), kp.privateKey)),
  });
};
const submit = (principal: string, command: unknown, kp: KeyPair) => {
  const n = (nonce.get(principal) ?? 0) + 1;
  nonce.set(principal, n);
  node.submit({
    principal,
    nonce: n,
    command,
    signature: encodeBase64(ED25519_SUITE.sign(commandBytes(principal, n, command), kp.privateKey)),
  });
};

const alice = key(1);
const bob = key(2);
register("alice", alice);
submit("alice", { kind: "found", regionId: "nova", displayName: "Nova" }, alice);
submit("alice", { kind: "found", regionId: "delta", displayName: "Delta" }, alice);
register("bob@nova", bob);
submit("alice", { kind: "admit", agentId: "bob@nova", region: "nova", role: "merchant", currency: 50 }, alice);
submit("alice", { kind: "admit", agentId: "market@nova", region: "nova", role: "broker", currency: 0 }, alice);
submit("alice", { kind: "admit", agentId: "carol@delta", region: "delta", role: "artisan", currency: 30 }, alice);
submit("bob@nova", { kind: "transfer", from: "bob@nova", to: "market@nova", amount: 20 }, bob);
submit("bob@nova", { kind: "vouch", from: "bob@nova", to: "market@nova", weight: 3 }, bob);

// 3. serve the node's read surface + the viewer
const nodeServer = Bun.serve({ hostname: "127.0.0.1", port: NODE_PORT, fetch: createNodeApp(node).fetch });
const indexHtml = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
const web = Bun.serve({ hostname: "127.0.0.1", port: WEB_PORT, fetch: createHandler({ nodeUrl, indexHtml }) });

console.log(`vouch-node  http://127.0.0.1:${nodeServer.port}`);
console.log(`vouch-web   http://127.0.0.1:${web.port}   ← open this`);
console.log("seeded: villages nova + delta, residents bob@nova / market@nova / carol@delta, a transfer + a vouch");
