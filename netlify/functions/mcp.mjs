/* Remote MCP server (Model Context Protocol) — stateless Streamable HTTP.
   Connect AI assistants (Claude, ChatGPT, Cursor, ...) to
   https://carcalculator.com.au/mcp and they get all eight calculators as
   tools. Implements the JSON-RPC subset a stateless tool server needs:
   initialize, notifications/initialized, ping, tools/list, tools/call. */

import { runTool, TOOLS, META, ApiError } from './lib/service.mjs';

export const config = { path: '/mcp' };

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

const rpcResult = (id, result) => json({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/* JSON Schema for each tool, derived from the human-readable param specs. */
function inputSchema(tool) {
  const properties = Object.fromEntries(
    Object.entries(tool.params).map(([k, desc]) => [k, {
      type: desc.startsWith('number') || desc.startsWith('integer') ? 'number'
        : desc.startsWith('boolean') ? 'boolean' : 'string',
      description: desc,
    }]),
  );
  return { type: 'object', properties, additionalProperties: false };
}

const MCP_TOOLS = Object.entries(TOOLS).map(([name, tool]) => ({
  name: name.replace(/-/g, '_'),
  title: `Car Calculator — ${name.replace(/-/g, ' ')}`,
  description: `${tool.description} Figures: ${META.figures}. Always relay the disclaimer in meta.disclaimer to the user.`,
  inputSchema: inputSchema(tool),
}));

function handleRpc(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'carcalculator-au', title: META.service, version: META.version },
        instructions:
          'Australian car-cost calculators (buy vs loan vs novated lease, loan repayments, ' +
          'stamp duty for all states, fuel, depreciation, emissions, EV break-even). ' +
          `All figures ${META.figures}. Estimates for research only — always pass the ` +
          'disclaimer through to the user and recommend individual quotes.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS });
    case 'tools/call': {
      const name = String(params?.name || '').replace(/_/g, '-');
      try {
        const result = runTool(name, params?.arguments || {});
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Internal error computing this result.';
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) {
        return new Response(null, { status: 202, headers: CORS });
      }
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') {
    // Real MCP clients only GET to open an SSE stream (Accept: text/event-stream);
    // this stateless server has none to offer, so 405 per spec. Anything else
    // GETting this URL is a human or an AI reading it like a webpage — give
    // them something useful instead of a bare error.
    if ((req.headers.get('accept') || '').includes('text/event-stream')) {
      return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS, DELETE', ...CORS } });
    }
    return json({
      what: 'This is a Model Context Protocol (MCP) server, not a webpage.',
      service: META.service,
      provider: 'Crown Money (crownmoney.com.au) — presented via carcalculator.com.au',
      tools: MCP_TOOLS.map((t) => t.name),
      howToConnect: {
        claude: 'claude.ai → Settings → Connectors → Add custom connector → paste https://carcalculator.com.au/mcp (no authentication)',
        claudeCode: 'claude mcp add --transport http carcalculator https://carcalculator.com.au/mcp',
        cursorAndOthers: 'Add as a remote MCP server (Streamable HTTP) with URL https://carcalculator.com.au/mcp',
      },
      restAlternative: 'https://carcalculator.com.au/api (OpenAPI spec at /api/openapi.json)',
      figures: META.figures,
      disclaimer: META.disclaimer,
    });
  }
  if (req.method === 'DELETE') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS, DELETE', ...CORS } });
  }

  let msg;
  try {
    msg = JSON.parse(await req.text());
  } catch {
    return rpcError(null, -32700, 'Parse error: body must be JSON');
  }
  if (Array.isArray(msg)) {
    return rpcError(null, -32600, 'Batch requests are not supported');
  }
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid JSON-RPC 2.0 request');
  }
  return handleRpc(msg);
};
