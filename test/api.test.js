import test from 'node:test';
import assert from 'node:assert/strict';

import apiHandler from '../netlify/functions/api.mjs';
import mcpHandler from '../netlify/functions/mcp.mjs';

const BASE = 'https://carcalculator.com.au';

const get = (path) => apiHandler(new Request(`${BASE}${path}`));
const post = (path, body) => apiHandler(new Request(`${BASE}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const rpc = (body) => mcpHandler(new Request(`${BASE}/mcp`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

/* -------------------------------------------------------------- REST --- */

test('API index lists all tools and the spec', async () => {
  const res = await get('/api');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.meta.disclaimer.includes('not a quote'));
  for (const t of ['compare', 'novated-lease', 'loan', 'stamp-duty', 'fuel', 'depreciation', 'emissions', 'break-even']) {
    assert.ok(body.tools[`/api/${t}`], t);
  }
});

test('GET /api/compare with query params matches the engine', async () => {
  const res = await get('/api/compare?price=62000&vehicleType=ev&state=NSW&salary=100000&sellAtEnd=false&includeOpportunityCost=false');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict.cheapest, 'Novated lease');
  assert.equal(body.results.length, 3);
  const lease = body.results.find((r) => r.method === 'Novated lease');
  assert.ok(lease.netCost > 0 && lease.breakdown.length > 5);
  assert.ok(body.meta.disclaimer);
});

test('POST /api/compare with JSON body works and validates', async () => {
  const ok = await post('/api/compare', { price: 50000, state: 'VIC', vehicleType: 'petrol' });
  assert.equal(ok.status, 200);
  const badState = await post('/api/compare', { state: 'XX' });
  assert.equal(badState.status, 400);
  assert.match((await badState.json()).error, /state/);
  const badPrice = await post('/api/compare', { price: -5 });
  assert.equal(badPrice.status, 400);
});

test('GET /api/stamp-duty spot check + all states', async () => {
  const res = await get('/api/stamp-duty?price=50000&state=NSW&vehicleType=petrol');
  const body = await res.json();
  assert.equal(body.stampDuty, 1600);
  assert.equal(Object.keys(body.allStates).length, 8);
  assert.equal(body.allStates.VIC, 2100);
});

test('GET /api/loan reconciles', async () => {
  const res = await get('/api/loan?amount=40000&ratePct=7.5&years=5');
  const body = await res.json();
  assert.ok(Math.abs(body.repaymentPerPeriod - 821.53) < 0.05);
  assert.equal(body.balanceAfterEachYear.length, 5);
  assert.ok(Math.abs(body.balanceAfterEachYear[4]) < 1);
});

test('unknown tool → 404; bad body → 400; CORS preflight → 204', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  const badJson = await apiHandler(new Request(`${BASE}/api/compare`, { method: 'POST', body: '{oops' }));
  assert.equal(badJson.status, 400);
  const pre = await apiHandler(new Request(`${BASE}/api/compare`, { method: 'OPTIONS' }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
});

test('openapi.json is a valid-looking 3.1 spec covering every tool', async () => {
  const res = await get('/api/openapi.json');
  const spec = await res.json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/api/compare'].post && spec.paths['/api/break-even'].get);
});

/* --------------------------------------------------------------- MCP --- */

test('MCP initialize → tools/list → tools/call round trip', async () => {
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  assert.equal(init.status, 200);
  const initBody = await init.json();
  assert.equal(initBody.result.protocolVersion, '2025-06-18');
  assert.ok(initBody.result.capabilities.tools);

  const notif = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif.status, 202);

  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes('compare') && names.includes('stamp_duty') && names.includes('break_even'));
  assert.equal(names.length, 8);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

  const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'stamp_duty', arguments: { price: 50000, state: 'NSW' } } })).json();
  assert.equal(call.result.isError, false);
  assert.equal(call.result.structuredContent.stampDuty, 1600);
  assert.ok(call.result.content[0].text.includes('1600'));
});

test('MCP error paths: bad tool args, unknown method, parse error, GET', async () => {
  const badArgs = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'compare', arguments: { state: 'XX' } } })).json();
  assert.equal(badArgs.result.isError, true);

  const unknown = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).json();
  assert.equal(unknown.error.code, -32601);

  const parse = await mcpHandler(new Request(`${BASE}/mcp`, { method: 'POST', body: 'not json' }));
  assert.equal((await parse.json()).error.code, -32700);

  const getRes = await mcpHandler(new Request(`${BASE}/mcp`, { method: 'GET' }));
  assert.equal(getRes.status, 405);
});
