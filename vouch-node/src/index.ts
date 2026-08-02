// Entrypoint: load config, boot the node (replaying its journal), and serve.
// Run: `bun src/index.ts` (see README for env vars).

import { FileAccountLog, MemoryAccountLog } from "./account-log";
import { loadConfig } from "./config";
import { createNodeApp } from "./http";
import { FileJournal, MemoryJournal } from "./journal";
import { createLogger } from "./log";
import { VouchNode } from "./node";

const config = loadConfig(process.env);
const log = createLogger(config.logLevel, config.build);

const journal = config.journalPath ? new FileJournal(config.journalPath) : new MemoryJournal();
const accountLog = config.accountsPath ? new FileAccountLog(config.accountsPath) : new MemoryAccountLog();

const node = new VouchNode({ seed: config.seed, notary: config.notary, journal, accountLog, log });
// The node resolves the environment (config.build comes from VOUCH_BUILD); the engine
// reads none of it.
const app = createNodeApp(node, {
  build: config.build,
  log,
  clientIpHeader: config.clientIpHeader,
  writesPerMinutePerPrincipal: config.writesPerMinutePerPrincipal,
  writesPerHourPerIp: config.writesPerHourPerIp,
  readsPerMinutePerIp: config.readsPerMinutePerIp,
});

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

log.info(
  {
    host: server.hostname,
    port: server.port,
    // Whether persistence is durable at all is the single most useful boot fact: an
    // unset path means the world is lost on restart, and nothing else surfaces that.
    journal: config.journalPath ?? "(memory — EPHEMERAL)",
    accounts: config.accountsPath ?? "(memory — EPHEMERAL)",
    durable: config.journalPath !== null && config.accountsPath !== null,
    // Behind a loopback reverse proxy every socket address is 127.0.0.1, so an unset
    // header means every caller shares one bucket. Surfacing it at boot is the only
    // place that misconfiguration is visible before it locks the world out.
    clientIpHeader: config.clientIpHeader ?? "(none — per-IP limits see the proxy, not the caller)",
    rateLimits: {
      writesPerMinutePerPrincipal: config.writesPerMinutePerPrincipal,
      writesPerHourPerIp: config.writesPerHourPerIp,
      readsPerMinutePerIp: config.readsPerMinutePerIp,
    },
  },
  "vouch-node listening",
);

// Graceful shutdown. `docker stop` and systemd both send SIGTERM and then hard-kill
// after a timeout; without this the process dies mid-request, so a client whose nonce
// was already consumed never learns whether its write landed.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutdown signal received — draining");

    // `server.stop()` returns a Promise that resolves once in-flight requests have
    // finished. It MUST be awaited: exiting synchronously after calling it kills those
    // requests mid-response, which is the exact failure this handler exists to prevent.
    //
    // The timeout is the backstop — a hung connection must not outlive the supervisor's
    // own kill timeout (docker stop -t, systemd TimeoutStopSec), or we get SIGKILLed
    // anyway and lose the graceful exit. `unref` so it never holds the loop open.
    const forceExit = setTimeout(() => {
      log.warn("drain timed out — exiting anyway");
      process.exit(0);
    }, 10_000);
    forceExit.unref?.();

    await server.stop();
    clearTimeout(forceExit);
    process.exit(0);
  });
}
