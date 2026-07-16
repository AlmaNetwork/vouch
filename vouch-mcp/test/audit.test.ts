import { describe, expect, test } from "bun:test";
import { commandHash, MemoryAudit } from "../src/audit";

describe("sign audit", () => {
  test("commandHash is deterministic, content-addressed, and reveals no secret", () => {
    const h = commandHash({ kind: "transfer", from: "a", to: "b", amount: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(commandHash({ kind: "transfer", from: "a", to: "b", amount: 1 })).toBe(h);
    expect(commandHash({ kind: "transfer", from: "a", to: "b", amount: 2 })).not.toBe(h);
  });

  test("MemoryAudit appends and returns entries in order", () => {
    const audit = new MemoryAudit();
    expect(audit.entries().length).toBe(0);
    audit.append({
      requestId: "r1",
      ts: 1,
      iss: "i",
      sub: "s",
      principal: "uabc",
      nonce: 1,
      scope: ["vouch:found"],
      jti: "j1",
      commandKind: "found",
      commandHash: "h",
      outcome: "accepted",
      reason: null,
    });
    expect(audit.entries().length).toBe(1);
    expect(audit.entries()[0]?.commandKind).toBe("found");
    expect(audit.entries()[0]?.jti).toBe("j1");
  });
});
