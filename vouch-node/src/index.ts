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
const server = Bun.serve({ hostname: config.host, port: config.port, maxRequestBodySize: 256 * 1024, fetch: app.fetch });

console.log(`vouch-node listening on http://${server.hostname}:${server.port}`);
console.log(`  persistence: journal=${config.journalPath ?? "(memory)"} accounts=${config.accountsPath ?? "(memory)"}`);
console.log("  GET  /state /regions /agents /metrics /log …   observation (read-only)");
console.log("  POST /v1/register                              bind principal -> public key (self-signed)");
console.log("  POST /v1/command                               signed command: found | admit | transfer | vouch");
