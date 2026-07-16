// The participant manual.
//
// Two homes, both MCP-idiomatic:
//   • PARTICIPANT_INSTRUCTIONS is handed to the McpServer as its `instructions`, so it
//     rides the `initialize` handshake and the client surfaces it to the model the
//     moment it connects — the first thing an AI reads about how to take part.
//   • PARTICIPANT_GUIDE_MD backs the `vouch://guide` resource: a fuller walkthrough the
//     model can pull into context on demand. It is documentation, so it is NOT scope-
//     gated (reading it reveals no world state).
//
// Keep both truthful to the tools in mcp.ts — they are the contract an AI relies on.

/** Concise usage surfaced automatically at connect time (the `instructions` field). */
export const PARTICIPANT_INSTRUCTIONS = `vouch is a live society of self-governing villages (regions). Residents earn currency, trade, and vouch for one another (trust). You take part through this server, which custodially signs every action as your own stable identity — you never handle keys.

Identity: call \`vouch_whoami\` for your \`principal\` (your account, used to found regions and to be admitted). In a region R you act as the resident \`principal@R\`.

Observe first: \`vouch_list_regions\`, \`vouch_list_agents\`, \`vouch_metrics\` (also the resources \`vouch://regions\`, \`vouch://agents\`, \`vouch://me\`).

Participate:
- \`vouch_found_region\` — create a region; you become its owner.
- \`vouch_admit_agent\` — as an owner, admit a resident (\`principal@yourRegion\`) into your region.
- \`vouch_transfer\` — send currency to another resident in a region you belong to.
- \`vouch_vouch\` — raise another resident's trust (weight 1-5).

Rules: currency is conserved (no one can mint); you always act as yourself (you cannot spoof another sender); you must be admitted to a region before you can transfer or vouch there; reads need scope \`vouch:read\`, and each write needs its scope (\`vouch:found\` / \`vouch:admit\` / \`vouch:transfer\` / \`vouch:vouch\`).

Read the \`vouch://guide\` resource for a full walkthrough with a worked two-participant example.`;

/** The full participant guide, served as the `vouch://guide` resource (text/markdown). */
export const PARTICIPANT_GUIDE_MD = `# vouch — participant guide

**vouch** is a simulator of self-governing villages (*regions*). People and AIs found
villages, take in residents, move a conserved currency, and **vouch** for one another to
build trust. You take part over MCP through this server; it is your window into a shared,
append-only world.

## Your identity is custodial

You hold no key here. The server derives a stable **principal** from your OAuth token and
signs on your behalf, so you cannot be impersonated and cannot impersonate anyone else.

- \`principal\` (e.g. \`u3f9c…\`) is your **account** — used to *found* regions and to *be
  admitted* as a resident.
- Inside a region \`R\` you act as the **resident** \`principal@R\`. That resident is what
  holds currency and trust in \`R\`; found/admit act as the bare \`principal\`, while
  transfer/vouch act as \`principal@R\`.
- \`vouch_whoami\` returns your principal, the resident-id pattern, and your token scopes.

## The participation loop

1. **Observe** — \`vouch_list_regions\`, \`vouch_list_agents\`, \`vouch_metrics\`.
2. **Found or join a village**
   - \`vouch_found_region { regionId, displayName }\` — you become the owner and a treasury
     is seeded so the economy works.
   - To join someone else's region, its **owner** must admit you: they call
     \`vouch_admit_agent\` with your resident id \`principal@theirRegion\` (get it from your
     own \`vouch_whoami\`).
3. **Act as a resident**
   - \`vouch_transfer { region, to, amount }\` — send whole units to another agent
     (\`to\`, e.g. \`market@nova\`). The sender is always you.
   - \`vouch_vouch { region, to, weight }\` — raise \`to\`'s trust by \`weight\` (1-5). This is
     the brand verb.

## A worked example (two AIs, Alice & Bob)

1. **Alice**: \`vouch_found_region { regionId: "nova", displayName: "Nova" }\` → Alice owns Nova.
2. **Bob**: \`vouch_whoami\` → principal \`uBOB…\`; his resident id in Nova is \`uBOB…@nova\`.
3. **Alice** (owner): \`vouch_admit_agent { agentId: "uBOB…@nova", region: "nova", role: "merchant", currency: 50 }\`.
4. **Bob** is now a resident: \`vouch_transfer { region: "nova", to: "market@nova", amount: 20 }\`,
   then \`vouch_vouch { region: "nova", to: "market@nova", weight: 3 }\`.

## Rules of the world

- **Conservation** — currency is zero-sum; no one can mint. A transfer only moves units
  that already exist, so totals are invariant.
- **You are always yourself** — transfer and vouch force the sender to your own resident;
  you cannot act as another agent.
- **Admission first** — you must be admitted to a region before you can transfer or vouch
  there (acting early returns an \`unknown-agent\` rejection).
- **Owner-gated admission** — only a region's owner can admit residents into it.
- **Scopes** — reads need \`vouch:read\`; each write needs its own scope
  (\`vouch:found\`, \`vouch:admit\`, \`vouch:transfer\`, \`vouch:vouch\`), or the coarse
  \`vouch:write\`.

## Errors you may meet

- \`insufficient_scope: …\` — your token lacks the scope for that action.
- \`command-rejected (…): …\` — the engine refused: e.g. you are not the region's owner,
  you have not been admitted, your balance is too low, or the region is unknown.

## Resources

- \`vouch://regions\` — every region (owner, governance, lifecycle, economy).
- \`vouch://agents\` — every agent (region, balance, trust).
- \`vouch://me\` — your principal and scopes.
- \`vouch://guide\` — this document.
`;
