// Track C — the node entrypoint (task C8).
//
// `main(config)` is the lifecycle the deploy artifacts (Docker / systemd / cloud-init)
// drive: it loads nothing itself (config is injected), boots the REAL read observation
// server + the write-node STUB, and returns a handle with `stop()` for graceful shutdown.
//
// This is the SHAPE the Track B node entrypoint is expected to take (config in →
// {readPort, writePort, stop()} out). When Track B's real `main(config)` lands, the write
// half (serveWriteStub) is swapped for its app and this wiring stays. See deploy/B-CONTRACT.md.

import { type NodeConfig, describeConfig, loadConfig } from "./config";
import { composeReadWorld, serveRead } from "./read-server";
import { serveWriteStub } from "./write-stub";

export interface NodeHandle {
  readonly readPort: number;
  readonly writePort: number;
  /** Idempotent: stops both servers. */
  stop(): void;
}

/** Boot the node from a resolved config. Pure of process concerns (no signal handlers here). */
export function main(config: NodeConfig): NodeHandle {
  const world = composeReadWorld(config);
  const read = serveRead(world, config);
  const write = serveWriteStub(config);

  let stopped = false;
  return {
    readPort: read.port,
    writePort: write.port,
    stop() {
      if (stopped) return;
      stopped = true;
      read.stop();
      write.stop();
    },
  };
}

// Runnable entry: load config, boot, and wire graceful shutdown on SIGTERM/SIGINT.
if (import.meta.main) {
  const config = loadConfig();
  const node = main(config);
  console.log(`vouch node up — ${describeConfig(config)}`);
  console.log(`  read  :${node.readPort}  (observation, live)   try /metrics /health`);
  console.log(`  write :${node.writePort}  (STUB, pending Track B) /v1/* → 501`);

  const shutdown = (signal: string) => {
    console.log(`\n${signal} → graceful shutdown`);
    node.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
