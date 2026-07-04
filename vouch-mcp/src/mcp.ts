// The MCP surface an authenticated participant drives.
//
// One McpServer instance is built PER authenticated caller (see server.ts), closing
// over that caller's AuthContext. That is how identity reaches a tool: the caller's
// principal is fixed at connection time from their verified token, so a tool can
// never be tricked into acting as someone else — `transfer`/`vouch` force `from` to
// the caller's own principal, and every write is routed through custodial signing,
// which re-derives the principal from the token and scope-gates the command.
//
// Reads (regions/agents/metrics) are exposed both as tools and as MCP resources so a
// model can pull world state into context. Writes are tools only.
//
// Note on the `as ZodRawShape` casts: the SDK's registerTool generic tries to
// synthesize the callback's argument type from the exact input shape, which
// explodes into "excessively deep" instantiation for multi-field tools. Erasing the
// shape's compile-time type caps that — the shape is still the real Zod object at
// runtime, so the JSON schema advertised to clients and the argument validation are
// unchanged; we just recover precise argument types with a cast inside each handler.

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { type ZodRawShape, z } from "zod";
import type { Custody, Subject } from "./custody";
import { PARTICIPANT_GUIDE_MD, PARTICIPANT_INSTRUCTIONS } from "./guide";
import type { AuthContext } from "./resource-server";
import { readAllowed } from "./scopes";

export interface McpDeps {
  readonly custody: Custody;
  /** Read-only observation reads (delegates to the engine's read model). */
  readonly read: (path: string) => Promise<unknown>;
  readonly serverInfo: { readonly name: string; readonly version: string };
}

interface FoundArgs {
  regionId: string;
  displayName: string;
}
interface AdmitArgs {
  agentId: string;
  region: string;
  role: "artisan" | "merchant" | "broker";
  currency?: number;
}
interface TransferArgs {
  region: string;
  to: string;
  amount: number;
}
interface VouchArgs {
  region: string;
  to: string;
  weight: number;
}

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function buildMcpServer(deps: McpDeps, ctx: AuthContext): McpServer {
  const server = new McpServer(deps.serverInfo, {
    capabilities: { tools: {}, resources: {} },
    // The participant manual, surfaced to the model on connect (rides `initialize`).
    instructions: PARTICIPANT_INSTRUCTIONS,
  });
  const subject: Subject = { iss: ctx.iss, sub: ctx.sub, jti: ctx.jti };

  // --- shared handlers ---------------------------------------------------------

  const runWrite = (actingPrincipal: string, commandKind: string, command: unknown): CallToolResult => {
    const outcome = deps.custody.signAndSubmit(subject, actingPrincipal, randomUUID(), ctx.scopes, commandKind, command);
    if (outcome.kind === "scope-denied") {
      return errorResult(`insufficient_scope: this token cannot ${commandKind} — it lacks ${outcome.needed}`);
    }
    const r = outcome.result;
    if (!r.ok) return errorResult(`command-rejected (${r.status}): ${r.reason}`);
    return textResult({ ok: true, actingAs: outcome.principal, detail: r.detail ?? {}, events: r.events });
  };

  /** The subject's resident agent id in a region — how they hold currency and act as a citizen there. */
  const residentIn = (region: string): string => `${ctx.principal}@${region}`;

  const runRead = async (path: string): Promise<CallToolResult> => {
    if (!readAllowed(ctx.scopes)) return errorResult("insufficient_scope: this token lacks vouch:read");
    return textResult(await deps.read(path));
  };

  // --- identity ---------------------------------------------------------------

  server.registerTool(
    "vouch_whoami",
    {
      title: "Who am I",
      description:
        "Your vouch identity, derived from your OAuth token. `principal` is your account (for founding/admitting); in a region R you act as the resident agent `principal@R`.",
      inputSchema: {},
    },
    () =>
      textResult({
        principal: ctx.principal,
        residentIdPattern: `${ctx.principal}@<region>`,
        subject: `${ctx.iss} / ${ctx.sub}`,
        scopes: ctx.scopes,
      }),
  );

  // --- reads ------------------------------------------------------------------

  server.registerTool(
    "vouch_list_regions",
    { title: "List regions", description: "Every region in the world: owner, governance, lifecycle, economy.", inputSchema: {} },
    () => runRead("/regions"),
  );
  server.registerTool(
    "vouch_list_agents",
    { title: "List agents", description: "Every agent: their region, currency balance, and trust.", inputSchema: {} },
    () => runRead("/agents"),
  );
  server.registerTool(
    "vouch_metrics",
    { title: "World metrics", description: "Aggregate world metrics (supply, counts, conservation baseline).", inputSchema: {} },
    () => runRead("/metrics"),
  );

  // --- writes (custodially signed, scope-gated) -------------------------------
  //
  // All writes go through `writeTool`, which pins the SDK's registerTool input
  // generic to ZodRawShape in ONE place. Left to infer the exact nested shape per
  // call, the SDK's argument-type synthesis hits "excessively deep instantiation" on
  // the multi-field tools; pinning it keeps that shallow. Runtime schema + validation
  // are unaffected (the real Zod shape is still handed to the SDK), and each handler
  // recovers precise argument types with a cast.

  // Bind + retype registerTool to a plain, non-generic signature. This is the ONE
  // place we escape the SDK's ZodRawShape generic (whose per-field argument-type
  // synthesis otherwise triggers "excessively deep instantiation"); `this` is bound
  // to the server and the real Zod shape still flows through at runtime.
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: ZodRawShape },
    cb: (args: Record<string, unknown>) => CallToolResult,
  ) => void;

  const writeTool = (
    name: string,
    title: string,
    description: string,
    inputSchema: ZodRawShape,
    run: (args: Record<string, unknown>) => CallToolResult,
  ): void => {
    register(name, { title, description, inputSchema }, (args) => run(args));
  };

  writeTool(
    "vouch_found_region",
    "Found a region",
    "Create a new region. You become its owner; its treasury is seeded so its economy works. Needs scope vouch:found.",
    {
      regionId: z.string().min(1).describe("Stable id, e.g. 'nova'"),
      displayName: z.string().min(1).describe("Human name, e.g. 'Nova'"),
    },
    (args) => runWrite(ctx.principal, "found", { kind: "found", ...(args as unknown as FoundArgs) }),
  );

  writeTool(
    "vouch_admit_agent",
    "Admit an agent into your region",
    "Admit a resident into a region YOU own (owner-gated). Pass the joiner's resident id as agentId so their own key can then act as that agent. Needs scope vouch:admit.",
    {
      agentId: z
        .string()
        .min(1)
        .describe("The new resident's agent id `name@region` — for a joining MCP user, their `<slug>@<thisRegion>` (from their whoami)"),
      region: z.string().min(1).describe("A region you own"),
      role: z.enum(["artisan", "merchant", "broker"]).describe("The resident's role"),
      currency: z.number().int().nonnegative().optional().describe("Optional starting balance"),
    },
    (args) => runWrite(ctx.principal, "admit", { kind: "admit", ...(args as unknown as AdmitArgs) }),
  );

  writeTool(
    "vouch_transfer",
    "Transfer currency",
    "Send currency as your resident identity in a region (the sender is always you) to another agent there. Needs scope vouch:transfer.",
    {
      region: z.string().min(1).describe("The region you are a resident of"),
      to: z.string().min(1).describe("Recipient agent id, e.g. 'market@nova'"),
      amount: z.number().int().positive().describe("Whole units to send"),
    },
    (args) => {
      const a = args as unknown as TransferArgs;
      const from = residentIn(a.region);
      return runWrite(from, "transfer", { kind: "transfer", from, to: a.to, amount: a.amount });
    },
  );

  writeTool(
    "vouch_vouch",
    "Vouch for an agent",
    "Raise another agent's trust — the brand verb. You vouch as your resident identity in a region. Needs scope vouch:vouch.",
    {
      region: z.string().min(1).describe("The region you are a resident of"),
      to: z.string().min(1).describe("Agent to vouch for, e.g. 'market@nova'"),
      weight: z.number().int().min(1).max(5).describe("Strength of the vouch, 1–5"),
    },
    (args) => {
      const a = args as unknown as VouchArgs;
      const from = residentIn(a.region);
      return runWrite(from, "vouch", { kind: "vouch", from, to: a.to, weight: a.weight });
    },
  );

  // --- resources (read model as MCP context) ----------------------------------

  const resource = async (uri: string, path: string): Promise<ReadResourceResult> => {
    if (!readAllowed(ctx.scopes)) throw new Error("insufficient_scope: this token lacks vouch:read");
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await deps.read(path), null, 2) }] };
  };

  server.registerResource(
    "regions",
    "vouch://regions",
    { title: "Regions", description: "All regions in the world.", mimeType: "application/json" },
    () => resource("vouch://regions", "/regions"),
  );
  server.registerResource(
    "agents",
    "vouch://agents",
    { title: "Agents", description: "All agents in the world.", mimeType: "application/json" },
    () => resource("vouch://agents", "/agents"),
  );
  server.registerResource(
    "me",
    "vouch://me",
    { title: "Me", description: "Your principal and scopes.", mimeType: "application/json" },
    () => ({
      contents: [
        {
          uri: "vouch://me",
          mimeType: "application/json",
          text: JSON.stringify({ principal: ctx.principal, scopes: ctx.scopes }, null, 2),
        },
      ],
    }),
  );

  // The participant manual as a pullable resource. Documentation, so it is NOT scope-
  // gated — reading it reveals no world state (unlike regions/agents above).
  server.registerResource(
    "guide",
    "vouch://guide",
    {
      title: "Participant guide",
      description: "How to take part in vouch through this server — identity, the loop, the rules, a worked example.",
      mimeType: "text/markdown",
    },
    () => ({ contents: [{ uri: "vouch://guide", mimeType: "text/markdown", text: PARTICIPANT_GUIDE_MD }] }),
  );

  return server;
}
