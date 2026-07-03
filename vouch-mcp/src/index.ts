// Entrypoint: load config, build the OAuth-protected MCP app, and serve.
// Run: `bun src/index.ts` (see README for env vars: VOUCH_NOTARY, VOUCH_MCP_MASTER_SECRET, …).

import { loadMcpConfig } from "./config";
import { createMcpApp } from "./server";

const config = loadMcpConfig(process.env);
const { app, devAs } = await createMcpApp(config);

const server = Bun.serve({ hostname: config.host, port: config.port, maxRequestBodySize: 256 * 1024, fetch: app.fetch });

console.log(`vouch-mcp listening on http://${server.hostname}:${server.port}`);
console.log(`  resource (audience): ${config.resource}`);
console.log(`  auth server:         ${config.issuer} ${devAs ? "(bundled dev-AS)" : "(external IdP)"}`);
console.log(`  metadata:            GET ${config.prmUrl}`);
console.log("  MCP endpoint:        ALL /mcp   (Bearer required; Streamable HTTP)");
