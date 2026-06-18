/**
 * The "Mastra way" — point a real Mastra MCPClient at Descript's MCP and capture
 * exactly what a Mastra agent experiences. FREE (no tools/call → no credits).
 *
 * This is the connector layer we deliberately did NOT build on. We build on the
 * REST surface (bearer token, headless). This script shows why: a Mastra MCPClient
 * with no OAuth credentials connects (initialize is open) but fails the moment it
 * enumerates tools (tools/list → 401), because Descript's MCP wants a Stytch
 * OAuth2 access token, not the REST dx_bearer token.
 *
 * Run:  node --env-file=.env --import tsx/esm scripts/descript-mcp-mastra.ts
 */
import { env } from '../src/lib/env';
import { MCPClient } from '@mastra/mcp';

const MCP_URL = 'https://api.descript.com/v2/mcp';

async function attempt(label: string, requestInit?: RequestInit) {
  console.log(`\n── ${label}`);
  const mcp = new MCPClient({
    id: `descript-probe-${label.replace(/\W+/g, '-').toLowerCase()}`,
    servers: {
      descript: {
        url: new URL(MCP_URL),
        ...(requestInit ? { requestInit } : {}),
      },
    },
  });
  try {
    const tools = await mcp.listTools();
    const names = Object.keys(tools);
    console.log(`   ✓ listTools() succeeded — ${names.length} tools: ${names.join(', ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ✗ listTools() failed: ${msg.split('\n').slice(0, 3).join(' | ')}`);
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}

async function main() {
  console.log('Mastra MCPClient → Descript MCP (api.descript.com/v2/mcp)');
  console.log('This is the connector layer; we build on REST instead.\n');

  // A. No credentials — the naive "just point Mastra at the URL" case.
  await attempt('A. MCPClient, no auth', undefined);

  // B. REST bearer in requestInit headers — does the REST token carry over? (no)
  await attempt('B. MCPClient + REST bearer header', {
    headers: { Authorization: `Bearer ${env.DESCRIPT_API_TOKEN}` },
  });

  console.log(
    '\nNote: completing the MCP OAuth flow needs Stytch Dynamic Client Registration',
  );
  console.log(
    '+ an INTERACTIVE browser sign-in at https://web.descript.com/mcp — not headless.',
  );
  console.log('✓ Done. No tools/call → 0 credits, 0 media-seconds.');
  process.exit(0);
}

main();
