import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { formatEvent, run } from "../src/cli";
import type { Env } from "../src/config";
import { bootNode, captureIo, tmpConfigDir } from "./helpers";

const PORT = 8796;
let base: string;
let stop: () => void;

beforeAll(() => {
  const n = bootNode(PORT);
  base = n.base;
  stop = n.stop;
});
afterAll(() => stop());

const envFor = (dir: string): Env => ({ VOUCH_NODE_URL: base, VOUCH_CONFIG_DIR: dir });

describe("vouch CLI — run()", () => {
  test("keygen → register → found → owner-admits-join → transfer → vouch", async () => {
    const alice = tmpConfigDir();
    const bob = tmpConfigDir();
    try {
      const a = envFor(alice.dir);
      const b = envFor(bob.dir);

      // alice: keygen, register, found
      expect(await run(["keygen"], a, captureIo().io)).toBe(0);
      expect(await run(["register", "alice"], a, captureIo().io)).toBe(0);
      const founded = captureIo();
      expect(await run(["found", "clitown", "Clitown"], a, founded.io)).toBe(0);
      expect(founded.text()).toContain("found ok");

      // bob: keygen + register his resident id
      expect(await run(["keygen"], b, captureIo().io)).toBe(0);
      expect(await run(["register", "bob@clitown"], b, captureIo().io)).toBe(0);

      // bob can't act before admission
      const early = captureIo();
      expect(await run(["transfer", "market@clitown", "5"], b, early.io)).toBe(1);
      expect(early.text()).toContain("unknown-agent");

      // alice (owner) admits bob + a market
      expect(await run(["admit", "bob@clitown", "clitown", "merchant", "--currency", "50"], a, captureIo().io)).toBe(0);
      expect(await run(["admit", "market@clitown", "clitown", "broker"], a, captureIo().io)).toBe(0);

      // bob transacts as his active principal (bob@clitown)
      expect(await run(["transfer", "market@clitown", "20"], b, captureIo().io)).toBe(0);
      expect(await run(["vouch", "market@clitown", "3"], b, captureIo().io)).toBe(0);

      // whoami reflects the advanced nonce
      const who = captureIo();
      expect(await run(["whoami"], b, who.io)).toBe(0);
      expect(who.text()).toContain("bob@clitown");

      // read back + conservation
      const agentsIo = captureIo();
      expect(await run(["agents"], a, agentsIo.io)).toBe(0);
      const agents = JSON.parse(agentsIo.out[0] ?? "[]") as Array<{
        id: string;
        region: string;
        balances: { currency: number };
        trust: number;
      }>;
      const town = agents.filter((x) => x.region === "clitown");
      expect(town.reduce((n, x) => n + x.balances.currency, 0)).toBe(50);
      expect(town.find((x) => x.id === "bob@clitown")?.balances.currency).toBe(30);
      expect(town.find((x) => x.id === "market@clitown")?.trust).toBe(3);
    } finally {
      alice.cleanup();
      bob.cleanup();
    }
  });

  test("a command with no active principal is a clear error", async () => {
    const t = tmpConfigDir();
    try {
      const e = envFor(t.dir);
      await run(["keygen"], e, captureIo().io); // key but no register → no active principal
      const io = captureIo();
      expect(await run(["found", "x", "X"], e, io.io)).toBe(1);
      expect(io.text()).toContain("no active principal");
    } finally {
      t.cleanup();
    }
  });

  test("reads need no key", async () => {
    const t = tmpConfigDir();
    try {
      const io = captureIo();
      expect(await run(["regions"], envFor(t.dir), io.io)).toBe(0);
      expect(io.out[0]?.startsWith("[")).toBe(true); // a JSON array
    } finally {
      t.cleanup();
    }
  });

  test("watch tails the feed for a bounded number of ticks", async () => {
    const t = tmpConfigDir();
    try {
      const io = captureIo();
      expect(await run(["watch", "--ticks", "1", "--interval", "0.2"], envFor(t.dir), io.io)).toBe(0);
      expect(io.text()).toContain("watching");
    } finally {
      t.cleanup();
    }
  });

  test("an unknown command prints usage and fails", async () => {
    const io = captureIo();
    expect(await run(["frobnicate"], {}, io.io)).toBe(1);
    expect(io.text()).toContain("unknown command");
    expect(io.text()).toContain("usage: vouch");
  });

  test("formatEvent renders a one-line headline", () => {
    const line = formatEvent({ seq: 7, type: "region.founded", actor: "world", payload: { region: { id: "nova" } } });
    expect(line).toContain("#  7");
    expect(line).toContain("region.founded");
    expect(line).toContain("world");
    expect(line).toContain("nova");
  });
});

describe("vouch CLI — usage, reads, and failure modes", () => {
  test("help exits 0 with usage; no command exits 1", async () => {
    const h = captureIo();
    expect(await run(["help"], {}, h.io)).toBe(0);
    expect(h.text()).toContain("usage: vouch");
    expect(await run([], {}, captureIo().io)).toBe(1);
  });

  test("state and metrics reads (no key needed)", async () => {
    const t = tmpConfigDir();
    try {
      const s = captureIo();
      expect(await run(["state"], envFor(t.dir), s.io)).toBe(0);
      const m = captureIo();
      expect(await run(["metrics"], envFor(t.dir), m.io)).toBe(0);
      expect(m.out[0]).toBeTruthy();
    } finally {
      t.cleanup();
    }
  });

  test("whoami with a key but no registered principal shows (none)", async () => {
    const t = tmpConfigDir();
    try {
      const e = envFor(t.dir);
      await run(["keygen"], e, captureIo().io);
      const io = captureIo();
      expect(await run(["whoami"], e, io.io)).toBe(0);
      expect(io.text()).toContain("(none");
    } finally {
      t.cleanup();
    }
  });

  test("write commands without enough args print usage and fail", async () => {
    const t = tmpConfigDir();
    try {
      const e = envFor(t.dir);
      await run(["keygen"], e, captureIo().io);
      await run(["register", "u@rgn"], e, captureIo().io);
      for (const args of [
        ["found", "onlyone"],
        ["admit", "a", "b"],
        ["transfer", "onlyto"],
        ["vouch", "onlyto"],
      ]) {
        const io = captureIo();
        expect(await run(args, e, io.io)).toBe(1);
        expect(io.text()).toContain("usage:");
      }
    } finally {
      t.cleanup();
    }
  });

  test("keygen refuses to overwrite an existing key", async () => {
    const t = tmpConfigDir();
    try {
      const e = envFor(t.dir);
      expect(await run(["keygen"], e, captureIo().io)).toBe(0);
      const io = captureIo();
      expect(await run(["keygen"], e, io.io)).toBe(1);
      expect(io.text()).toContain("already exists");
    } finally {
      t.cleanup();
    }
  });

  test("--node overrides the configured (dead) node URL", async () => {
    const t = tmpConfigDir();
    try {
      const io = captureIo();
      const code = await run(["regions", "--node", base], { VOUCH_CONFIG_DIR: t.dir, VOUCH_NODE_URL: "http://127.0.0.1:1" }, io.io);
      expect(code).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  test("a dead node fails fast with a clean error, not a hang", async () => {
    const t = tmpConfigDir();
    try {
      const io = captureIo();
      expect(
        await run(["regions"], { VOUCH_CONFIG_DIR: t.dir, VOUCH_NODE_URL: "http://127.0.0.1:1", VOUCH_TIMEOUT_MS: "1500" }, io.io),
      ).toBe(1);
      expect(io.text().toLowerCase()).toContain("error");
    } finally {
      t.cleanup();
    }
  });

  test("register needs a principal; a name taken by another key is refused", async () => {
    const t1 = tmpConfigDir();
    const t2 = tmpConfigDir();
    try {
      const e1 = envFor(t1.dir);
      await run(["keygen"], e1, captureIo().io);
      const noArg = captureIo();
      expect(await run(["register"], e1, noArg.io)).toBe(1);
      expect(noArg.text()).toContain("usage: vouch register");

      expect(await run(["register", "taken@rgn"], e1, captureIo().io)).toBe(0);

      const e2 = envFor(t2.dir);
      await run(["keygen"], e2, captureIo().io);
      const dup = captureIo();
      expect(await run(["register", "taken@rgn"], e2, dup.io)).toBe(1);
      expect(dup.text()).toContain("register failed");
    } finally {
      t1.cleanup();
      t2.cleanup();
    }
  });

  test("flag parsing handles both --k=v and bare --flag forms", async () => {
    const t = tmpConfigDir();
    try {
      const io = captureIo();
      // --foo=bar exercises the '=' form; --baz is a trailing boolean flag; reads ignore them
      expect(await run(["regions", `--node=${base}`, "--baz"], { VOUCH_CONFIG_DIR: t.dir }, io.io)).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  test("formatEvent tolerates an unserializable payload", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const line = formatEvent({ seq: 1, type: "weird.event", actor: "world", payload: circular });
    expect(line).toContain("weird.event");
  });
});
