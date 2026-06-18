/**
 * Descript MCP-surface probe — FREE diagnostics only (no tool execution, no credits).
 *
 * Contrasts the MCP connector layer (api.descript.com/v2/mcp) against the
 * already-verified REST surface (descriptapi.com/v1). Three checks:
 *   1. OAuth discovery metadata (.well-known/*) the MCP advertises.
 *   2. Unauthenticated `initialize` — what auth challenge comes back.
 *   3. Bearer-token `initialize` — does the REST bearer work on MCP? (expect 401)
 *
 * Everything here fails at the auth/handshake layer, BEFORE any tool runs, so it
 * spends zero AI credits and zero media-seconds.
 *
 * Run:  node --env-file=.env --import tsx/esm scripts/descript-mcp-probe.ts
 */
import { env } from '../src/lib/env';

const MCP_HOST = 'https://api.descript.com';
const MCP_URL = `${MCP_HOST}/v2/mcp`;

function initBody(id = 1) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mastra-descript-probe', version: '0.1.0' },
    },
  });
}

function dumpHeaders(h: Headers, only?: string[]) {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    if (!only || only.some((o) => k.toLowerCase() === o.toLowerCase())) out[k] = v;
  });
  return out;
}

/** Send one JSON-RPC POST to the MCP endpoint, return status + headers + body. */
async function rpc(
  label: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  console.log(`\n── ${label}\n   POST ${MCP_URL}  (${(payload as any).method ?? 'notification'})`);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    console.log(`   → ${res.status} ${res.statusText}`);
    const all = dumpHeaders(res.headers, [
      'www-authenticate',
      'content-type',
      'mcp-session-id',
    ]);
    if (Object.keys(all).length) console.log(`   headers: ${JSON.stringify(all)}`);
    const text = await bodyPreview(res, 900);
    if (text) console.log(`   body: ${text}`);
    return { status: res.status, sessionId: res.headers.get('mcp-session-id'), text };
  } catch (err) {
    console.log(`   → network error: ${err instanceof Error ? err.message : String(err)}`);
    return { status: 0, sessionId: null, text: '' };
  }
}

const initPayload = JSON.parse(initBody());
const toolsListPayload = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

async function bodyPreview(res: Response, max = 600) {
  const text = await res.text().catch(() => '');
  return text.length > max ? `${text.slice(0, max)}… (${text.length} bytes)` : text;
}

async function getJson(label: string, url: string) {
  console.log(`\n── ${label}\n   GET ${url}`);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    console.log(`   → ${res.status} ${res.statusText}`);
    const text = await bodyPreview(res);
    if (text) console.log(`   body: ${text}`);
    return { status: res.status, text };
  } catch (err) {
    console.log(`   → network error: ${err instanceof Error ? err.message : String(err)}`);
    return { status: 0, text: '' };
  }
}

async function postInitialize(label: string, headers: Record<string, string>) {
  console.log(`\n── ${label}\n   POST ${MCP_URL}`);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: initBody(),
    });
    console.log(`   → ${res.status} ${res.statusText}`);
    const interesting = dumpHeaders(res.headers, [
      'www-authenticate',
      'content-type',
      'mcp-session-id',
      'mcp-protocol-version',
    ]);
    if (Object.keys(interesting).length) console.log(`   headers: ${JSON.stringify(interesting)}`);
    const text = await bodyPreview(res);
    if (text) console.log(`   body: ${text}`);
    return { status: res.status, headers: interesting, text };
  } catch (err) {
    console.log(`   → network error: ${err instanceof Error ? err.message : String(err)}`);
    return { status: 0, headers: {}, text: '' };
  }
}

async function main() {
  console.log('Descript MCP-surface probe (free / auth-layer only)');
  console.log(`MCP endpoint: ${MCP_URL}`);
  console.log(`REST surface (for contrast): ${env.DESCRIPT_BASE_URL}`);

  // 1. OAuth discovery metadata (per MCP auth spec).
  await getJson(
    '1a. Protected-resource metadata',
    `${MCP_HOST}/.well-known/oauth-protected-resource`,
  );
  await getJson(
    '1b. Protected-resource metadata (path-scoped)',
    `${MCP_HOST}/.well-known/oauth-protected-resource/v2/mcp`,
  );
  await getJson(
    '1c. Authorization-server metadata',
    `${MCP_HOST}/.well-known/oauth-authorization-server`,
  );

  // 2. Unauthenticated initialize — capture the auth challenge + session id.
  await postInitialize('2. initialize — NO auth', {});

  // 3. Bearer initialize — does the REST token work on MCP?
  const tokenMask = `${env.DESCRIPT_API_TOKEN.slice(0, 12)}…(${env.DESCRIPT_API_TOKEN.length} chars)`;
  console.log(`\n   (using REST bearer token: ${tokenMask})`);
  await postInitialize('3. initialize — REST Bearer token', {
    Authorization: `Bearer ${env.DESCRIPT_API_TOKEN}`,
  });

  // ── The real test: the TOOL layer. initialize is open; auth bites here. ──
  const bearer = { Authorization: `Bearer ${env.DESCRIPT_API_TOKEN}` };

  // 4. tools/list with NO auth — is the catalogue readable unauthenticated?
  const noAuthInit = await rpc('4a. initialize (capture session id, no auth)', initPayload);
  const sess = noAuthInit.sessionId ? { 'mcp-session-id': noAuthInit.sessionId } : {};
  if (noAuthInit.sessionId) console.log(`   (session id: ${noAuthInit.sessionId})`);
  await rpc('4b. tools/list — NO auth', toolsListPayload, sess);

  // 5. tools/list WITH the REST bearer — does Descript's MCP accept the REST token?
  const bearerInit = await rpc('5a. initialize (capture session id, bearer)', initPayload, bearer);
  const bsess = bearerInit.sessionId ? { 'mcp-session-id': bearerInit.sessionId } : {};
  await rpc('5b. tools/list — REST Bearer token', toolsListPayload, { ...bearer, ...bsess });

  console.log('\n✓ Probe complete. No tools/call → 0 credits, 0 media-seconds.');
}

main();
