// Structured logging (pino). One JSON object per line on stdout; the supervisor
// (systemd/journald or docker) owns rotation and shipping.
//
// What is deliberately NOT logged:
//   - client IPs. Behind a proxy they are the proxy's anyway, and the edge already
//     holds real traffic data if it is ever needed. Correlation uses `requestId`,
//     which the client already receives in the `x-request-id` header and the error
//     body — so a user-reported id is enough to find the request.
//   - request bodies. A command body carries principals, amounts and a signature.
//   - pid/hostname. pino's default `base` includes them; the hostname is a machine
//     name (on a dev box, a personal one) and it is the same value on every line of
//     a single-process node, so it is pure noise with a leak attached.
//
// Timestamps are epoch millis (pino's default), which carries no timezone — nothing
// here reveals where the box is.

import pino, { type Logger } from "pino";

export type { Logger };

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export const LOG_LEVELS: readonly LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

export function isLogLevel(v: unknown): v is LogLevel {
  return typeof v === "string" && (LOG_LEVELS as readonly string[]).includes(v);
}

export function createLogger(level: LogLevel, build: string): Logger {
  return pino({
    level,
    // Drop pid/hostname (see above) and stamp the build instead, so a log line says
    // WHICH code produced it.
    base: { build },
  });
}

/** A no-op logger for tests and library embedders. */
export const silentLogger: Logger = pino({ level: "silent", base: undefined });
