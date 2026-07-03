// The CLI — a thin shell over VouchClient. `run()` is pure-ish: it takes argv, env,
// and an IO sink and returns an exit code, so it is scriptable and testable without a
// real terminal or home directory.

import { encodeBase64 } from "vouch-core";
import { type LogEvent, VouchClient } from "./client";
import { type CliConfig, type Env, generateKey, keyExists, loadConfig, loadKey, saveConfig } from "./config";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Parsed {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = "true";
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A compact one-line rendering of a world event — the newspaper's headline format. */
export function formatEvent(e: LogEvent): string {
  let payload = "";
  try {
    payload = JSON.stringify(e.payload);
    if (payload.length > 88) payload = `${payload.slice(0, 85)}…`;
  } catch {
    payload = "";
  }
  return `#${String(e.seq).padStart(3)}  ${e.type.padEnd(28)} by ${(e.actor || "?").padEnd(10)} ${payload}`;
}

function usage(io: Io): void {
  io.out(`vouch — a non-custodial CLI for a vouch world

usage: vouch <command> [args] [--flags]

identity
  keygen                             create your local Ed25519 key
  register <principal>               bind your key to a principal (sets it active)
  whoami [--as <p>]                  show your key + a principal's node account

write  (signed as your active principal, or --as <p>)
  found <regionId> <displayName>
  admit <agentId> <region> <role> [--currency N]
  transfer <to> <amount>
  vouch <to> <weight>

read
  regions | agents | state | metrics
  watch [--interval N]               tail the world's event feed (the village newspaper)

flags:  --as <principal>   --node <url>   --currency N   --interval N
env:    VOUCH_NODE_URL  VOUCH_PRINCIPAL  VOUCH_KEYFILE  VOUCH_CONFIG_DIR`);
}

export async function run(argv: string[], env: Env, io: Io): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional[0];
  const cfg: CliConfig = loadConfig(env);
  const nodeUrl = flags.node ?? cfg.nodeUrl;
  const activePrincipal = (): string | null => flags.as ?? cfg.principal;

  try {
    switch (cmd) {
      case "keygen": {
        if (keyExists(cfg)) {
          io.err(`a key already exists at ${cfg.keyfile}`);
          return 1;
        }
        const kp = generateKey(cfg);
        io.out(`created key at ${cfg.keyfile}`);
        io.out(`public key: ${encodeBase64(kp.publicKey)}`);
        io.out("next: vouch register <your-name>");
        return 0;
      }

      case "register": {
        const principal = positional[1];
        if (!principal) {
          io.err("usage: vouch register <principal>");
          return 1;
        }
        const client = new VouchClient(nodeUrl, loadKey(cfg));
        const r = await client.register(principal);
        if (!r.ok) {
          io.err(`register failed (${r.status}): ${r.reason}`);
          return 1;
        }
        saveConfig(cfg, { principal });
        io.out(`registered "${principal}" — now your active identity`);
        return 0;
      }

      case "whoami": {
        const client = new VouchClient(nodeUrl, loadKey(cfg));
        io.out(`node:       ${nodeUrl}`);
        io.out(`public key: ${client.publicKey}`);
        const principal = activePrincipal();
        if (!principal) {
          io.out("principal:  (none — run: vouch register <name>)");
          return 0;
        }
        const acct = await client.account(principal);
        io.out(`principal:  ${principal}`);
        io.out(`registered: ${acct.registered}`);
        io.out(`nonce:      ${acct.nonce}`);
        return 0;
      }

      case "found":
      case "admit":
      case "transfer":
      case "vouch": {
        const principal = activePrincipal();
        if (!principal) {
          io.err("no active principal — run: vouch register <name>, or pass --as <name>");
          return 1;
        }
        const client = new VouchClient(nodeUrl, loadKey(cfg));
        const result = await dispatchWrite(client, principal, cmd, positional, flags, io);
        if (result === "usage") return 1;
        if (!result.ok) {
          io.err(`${cmd} rejected (${result.status}): ${result.reason}`);
          return 1;
        }
        io.out(`${cmd} ok — ${JSON.stringify(result.detail)}  (${result.events} event${result.events === 1 ? "" : "s"})`);
        return 0;
      }

      case "regions":
      case "agents":
      case "state":
      case "metrics": {
        const client = new VouchClient(nodeUrl);
        const data = await client[cmd]();
        io.out(JSON.stringify(data, null, 2));
        return 0;
      }

      case "watch": {
        const interval = flags.interval !== undefined ? Math.max(0.2, Number(flags.interval)) : 2;
        const ticks = flags.ticks !== undefined ? Number(flags.ticks) : Number.POSITIVE_INFINITY;
        const client = new VouchClient(nodeUrl);
        io.out(`watching ${nodeUrl} every ${interval}s … (Ctrl-C to stop)`);
        let cursor = (await client.log(0)).length; // tail: start after existing history
        for (let i = 0; i < ticks; i++) {
          const events = await client.log(cursor);
          for (const e of events) io.out(formatEvent(e));
          cursor += events.length;
          if (i + 1 < ticks) await sleep(interval * 1000);
        }
        return 0;
      }

      case undefined:
      case "help":
      case "--help":
      case "-h": {
        usage(io);
        return cmd === undefined ? 1 : 0;
      }

      default: {
        io.err(`unknown command: ${cmd}`);
        usage(io);
        return 1;
      }
    }
  } catch (e) {
    io.err(`error: ${(e as Error).message}`);
    return 1;
  }
}

type WriteResult = Awaited<ReturnType<VouchClient["submit"]>>;

async function dispatchWrite(
  client: VouchClient,
  principal: string,
  cmd: string,
  positional: string[],
  flags: Record<string, string>,
  io: Io,
): Promise<WriteResult | "usage"> {
  if (cmd === "found") {
    const [, regionId, displayName] = positional;
    if (!regionId || !displayName) {
      io.err("usage: vouch found <regionId> <displayName>");
      return "usage";
    }
    return client.found(principal, regionId, displayName);
  }
  if (cmd === "admit") {
    const [, agentId, region, role] = positional;
    if (!agentId || !region || !role) {
      io.err("usage: vouch admit <agentId> <region> <role> [--currency N]");
      return "usage";
    }
    return client.admit(principal, agentId, region, role, flags.currency !== undefined ? Number(flags.currency) : undefined);
  }
  if (cmd === "transfer") {
    const [, to, amount] = positional;
    if (!to || amount === undefined) {
      io.err("usage: vouch transfer <to> <amount>");
      return "usage";
    }
    return client.transfer(principal, to, Number(amount));
  }
  // vouch
  const [, to, weight] = positional;
  if (!to || weight === undefined) {
    io.err("usage: vouch vouch <to> <weight>");
    return "usage";
  }
  return client.vouch(principal, to, Number(weight));
}
