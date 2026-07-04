#!/usr/bin/env bun
// The vouch-web server — serves the viewer and proxies vouch-node's read surface.
// Run: `bun src/main.ts` (VOUCH_NODE_URL points at a running vouch-node).

import { createHandler } from "./server";

const nodeUrl = process.env.VOUCH_NODE_URL ?? "http://127.0.0.1:8787";
const host = process.env.VOUCH_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.VOUCH_WEB_PORT ?? 5173);
const indexHtml = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

const server = Bun.serve({ hostname: host, port, fetch: createHandler({ nodeUrl, indexHtml }) });

console.log(`vouch-web listening on http://${server.hostname}:${server.port}`);
console.log(`  proxying read-only /api/* → ${nodeUrl}`);
console.log("  open the URL above in a browser to watch the world");
