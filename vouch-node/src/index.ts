// Entrypoint: load config, boot the node (replaying its journal), and serve.
// Run: `bun src/index.ts` (see README for env vars).

import { FileAccountLog, MemoryAccountLog } from "./account-log";
import { loadConfig } from "./config";
import { createNodeApp } from "./http";
import { FileJournal, MemoryJournal } from "./journal";
import { VouchNode } from "./node";

const config = loadConfig(process.env);
const journal = config.journalPath ? new FileJournal(config.journalPath) : new MemoryJournal();
const accountLog = config.accountsPath ? new FileAccountLog(config.accountsPath) : new MemoryAccountLog();

const node = new VouchNode({ seed: config.seed, notary: config.notary, journal, accountLog });
const app = createNodeApp(node);

// Cap the request body: a signed command is tiny, so don't let an unauthenticated
// caller force large allocations before we ever check a signature.
//
// `development: false` explicitly rather than by NODE_ENV: unset, Bun defaults to
// development and serves an HTML error page carrying the message, the source line and
// absolute filesystem paths.
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: 256 * 1024,
  development: false,
  fetch: app.fetch,
});

console.log(`vouch-node listening on http://${server.hostname}:${server.port}`);
console.log(`  persistence: journal=${config.journalPath ?? "(memory)"} accounts=${config.accountsPath ?? "(memory)"}`);
console.log("  GET  /state /regions /agents /metrics /log …   observation (read-only)");
console.log("  POST /v1/register                              bind principal -> public key (self-signed)");
console.log("  POST /v1/command                               signed command: found | admit | transfer | vouch");

// Graceful shutdown. `docker stop` and systemd both send SIGTERM and then hard-kill
// after a timeout; without this the process dies mid-request, so a client whose nonce
// was already consumed never learns whether its write landed.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — draining`);
    server.stop(); // let in-flight requests finish; stop accepting new ones
    process.exit(0);
  });
}
