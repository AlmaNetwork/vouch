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
  migrate <toRegion>                 move yourself to another region

items  (unique assets; who may mint = the recipient's region's "items" institution)
  mint-item <itemId> <kind> <owner>  mint an item for an agent (sign as whoever the rule names)
  transfer-item <itemId> <to>        hand over an item you hold

govern  (a region's institutions; dictatorships amend, councils propose+vote)
  amend <regionId> '<change-json>'   change the rules directly (dictatorship only)
  propose <regionId> '<change-json>' open a council proposal (your ballot is cast with it)
  vote <regionId>                    approve the open proposal

market  (a region is never deleted — a defunct one is hibernated and handed on)
  lifecycle <regionId> <active|dormant>
  list <regionId> <price|none>       list a DORMANT region, or delist with "none"
  handover <regionId> <to>           give a listed region to another account.
                                     NOTE: no currency moves — settlement is not built

data-defined commands (RFC 0007 §4 — definitions live in the log, not in code)
  invoke <definitionId> '<payload-json>'
                                     e.g. vouch invoke core.transfer \
                                            '{"from":"ann@umi","to":"bo@umi","amount":10}'

read
  regions | agents | items | state | metrics
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
        const client = new VouchClient(nodeUrl, loadKey(cfg), cfg.timeoutMs);
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
        const client = new VouchClient(nodeUrl, loadKey(cfg), cfg.timeoutMs);
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
      case "vouch":
      case "migrate":
      case "amend":
      case "propose":
      case "vote":
      case "lifecycle":
      case "list":
      case "handover":
      case "invoke":
      case "mint-item":
      case "transfer-item": {
        const principal = activePrincipal();
        if (!principal) {
          io.err("no active principal — run: vouch register <name>, or pass --as <name>");
          return 1;
        }
        const client = new VouchClient(nodeUrl, loadKey(cfg), cfg.timeoutMs);
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
      case "items":
      case "state":
      case "metrics": {
        const client = new VouchClient(nodeUrl, undefined, cfg.timeoutMs);
        const data = await client[cmd]();
        io.out(JSON.stringify(data, null, 2));
        return 0;
      }

      case "watch": {
        const interval = flags.interval !== undefined ? Math.max(0.2, Number(flags.interval)) : 2;
        const ticks = flags.ticks !== undefined ? Number(flags.ticks) : Number.POSITIVE_INFINITY;
        const client = new VouchClient(nodeUrl, undefined, cfg.timeoutMs);
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
  if (cmd === "migrate") {
    const [, toRegion] = positional;
    if (!toRegion) {
      io.err("usage: vouch migrate <toRegion>");
      return "usage";
    }
    return client.migrate(principal, toRegion);
  }
  // `change` is a nested policy object with six shapes, so it is taken as JSON rather
  // than flattened into a flag grammar that would have to grow a case per policy and
  // still could not express a council's member list.
  if (cmd === "amend" || cmd === "propose") {
    const [, regionId, changeJson] = positional;
    if (!regionId || !changeJson) {
      io.err(`usage: vouch ${cmd} <regionId> '<change-json>'`);
      io.err(
        `example: vouch ${cmd} umi '{"policy":"economy","value":{"baseCostRate":0.1,"minCostRate":0.02,"repDiscount":0.01,"creditPerTx":1}}'`,
      );
      return "usage";
    }
    let change: unknown;
    try {
      change = JSON.parse(changeJson);
    } catch {
      io.err("the change argument is not valid JSON — quote it as a single shell argument");
      return "usage";
    }
    return cmd === "amend" ? client.amend(principal, regionId, change) : client.propose(principal, regionId, change);
  }
  if (cmd === "invoke") {
    const [, definitionId, payloadJson] = positional;
    if (!definitionId || !payloadJson) {
      io.err("usage: vouch invoke <definitionId> '<payload-json>'");
      io.err(`example: vouch invoke core.transfer '{"from":"ann@umi","to":"bo@umi","amount":10}'`);
      return "usage";
    }
    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      io.err("the payload argument is not valid JSON — quote it as a single shell argument");
      return "usage";
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      io.err("the payload must be a JSON object");
      return "usage";
    }
    return client.invoke(principal, definitionId, payload as Record<string, unknown>);
  }
  if (cmd === "vote") {
    const [, regionId] = positional;
    if (!regionId) {
      io.err("usage: vouch vote <regionId>");
      return "usage";
    }
    return client.vote(principal, regionId);
  }
  if (cmd === "lifecycle") {
    const [, regionId, lifecycle] = positional;
    if (!regionId || (lifecycle !== "active" && lifecycle !== "dormant")) {
      io.err("usage: vouch lifecycle <regionId> <active|dormant>");
      return "usage";
    }
    return client.lifecycle(principal, regionId, lifecycle);
  }
  if (cmd === "list") {
    const [, regionId, price] = positional;
    if (!regionId || price === undefined) {
      io.err('usage: vouch list <regionId> <price|none>   ("none" delists)');
      return "usage";
    }
    // "none" rather than a bare flag: delisting and pricing at 0 are different acts,
    // and a free region is a legitimate listing.
    const salePrice = price === "none" ? null : Number(price);
    if (salePrice !== null && !Number.isFinite(salePrice)) {
      io.err(`not a price: ${price}  (use a whole number, or "none" to delist)`);
      return "usage";
    }
    return client.list(principal, regionId, salePrice);
  }
  if (cmd === "handover") {
    const [, regionId, to] = positional;
    if (!regionId || !to) {
      io.err("usage: vouch handover <regionId> <to>");
      return "usage";
    }
    return client.handover(principal, regionId, to);
  }
  if (cmd === "mint-item") {
    const [, itemId, itemKind, owner] = positional;
    if (!itemId || !itemKind || !owner) {
      io.err("usage: vouch mint-item <itemId> <kind> <owner>");
      io.err(
        "who may mint is the recipient's region's `items` institution — sign as the region owner (default), or as a resident there under {minting:'residents'}",
      );
      return "usage";
    }
    return client.mintItem(principal, itemId, itemKind, owner);
  }
  if (cmd === "transfer-item") {
    const [, itemId, to] = positional;
    if (!itemId || !to) {
      io.err("usage: vouch transfer-item <itemId> <to>");
      return "usage";
    }
    return client.transferItem(principal, itemId, to);
  }
  // vouch
  const [, to, weight] = positional;
  if (!to || weight === undefined) {
    io.err("usage: vouch vouch <to> <weight>");
    return "usage";
  }
  return client.vouch(principal, to, Number(weight));
}
