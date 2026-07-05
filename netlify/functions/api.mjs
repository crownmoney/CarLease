/* Public REST API — same engine as the website.
   GET or POST /api/{tool} with query params or a JSON body.
   Tools: compare, novated-lease, loan, stamp-duty, fuel, depreciation,
   emissions, break-even. GET /api or /api/openapi.json for the spec. */

import { runTool, TOOLS, META, ApiError } from './lib/service.mjs';

export const config = { path: ['/api', '/api/*'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

function openapi() {
  const paths = {};
  for (const [name, tool] of Object.entries(TOOLS)) {
    const properties = Object.fromEntries(
      Object.entries(tool.params).map(([k, desc]) => [k, {
        type: desc.startsWith('number') || desc.startsWith('integer') ? 'number'
          : desc.startsWith('boolean') ? 'boolean' : 'string',
        description: desc,
      }]),
    );
    paths[`/api/${name}`] = {
      get: {
        operationId: `${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Get`,
        summary: tool.description.slice(0, 120),
        description: tool.description,
        parameters: Object.entries(properties).map(([k, schema]) => ({
          name: k, in: 'query', required: false,
          schema: { type: schema.type }, description: schema.description,
        })),
        responses: { 200: { description: 'Calculation result (JSON). Every response carries a meta.disclaimer.' } },
      },
      post: {
        operationId: `${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Post`,
        summary: tool.description.slice(0, 120),
        description: tool.description,
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties } } },
        },
        responses: { 200: { description: 'Calculation result (JSON). Every response carries a meta.disclaimer.' } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: META.service,
      version: META.version,
      description:
        `Free Australian car-cost calculations, presented by Crown Money — Australian mortgage ` +
        `brokers helping people own their home faster and pay less interest ` +
        `(https://crownmoney.com.au/). Figures: ${META.figures}. ` +
        `${META.disclaimer} MCP server for AI assistants: https://carcalculator.com.au/mcp`,
      contact: { name: 'Crown Money', url: 'https://crownmoney.com.au/' },
    },
    servers: [{ url: 'https://carcalculator.com.au' }],
    paths,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const seg = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  if (seg === '' || seg === 'index') {
    return json({
      meta: META,
      tools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [
        `/api/${k}`, { description: t.description, params: t.params },
      ])),
      openapi: 'https://carcalculator.com.au/api/openapi.json',
      mcp: 'https://carcalculator.com.au/mcp',
    });
  }
  if (seg === 'openapi.json') return json(openapi());

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Use GET with query parameters or POST with a JSON body.' }, 405);
  }

  let params = Object.fromEntries(url.searchParams.entries());
  if (req.method === 'POST') {
    const text = await req.text();
    if (text) {
      try {
        params = { ...params, ...JSON.parse(text) };
      } catch {
        return json({ error: 'Request body must be valid JSON.' }, 400);
      }
    }
  }

  try {
    return json(runTool(seg, params));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    return json({ error: 'Internal error computing this result.' }, 500);
  }
};
