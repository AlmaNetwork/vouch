import { describe, expect, test } from "bun:test";
import { commandAllowed, readAllowed } from "../src/scopes";

describe("scope → command gate", () => {
  test("a write needs its own scope", () => {
    expect(commandAllowed(["vouch:transfer"], "transfer").ok).toBe(true);
    const denied = commandAllowed(["vouch:read"], "transfer");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.needed).toBe("vouch:transfer");
  });

  test("the coarse vouch:write implies every write", () => {
    for (const kind of ["found", "admit", "transfer", "vouch"]) {
      expect(commandAllowed(["vouch:write"], kind).ok).toBe(true);
    }
  });

  test("an unknown command is never allowed", () => {
    const r = commandAllowed(["vouch:write"], "selfdestruct");
    expect(r.ok).toBe(false);
  });

  test("read is granted by any vouch scope", () => {
    expect(readAllowed(["vouch:read"])).toBe(true);
    expect(readAllowed(["vouch:transfer"])).toBe(true);
    expect(readAllowed([])).toBe(false);
    expect(readAllowed(["email"])).toBe(false);
  });
});
