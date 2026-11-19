const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { startAgentBridge } = require('../mcp/bridge.cjs');

const payload = { name: 'anoint_get_context', args: {} };
const post = (bridge, body = payload, headers = {}) => fetch(`${bridge.url}/call`, {
  method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('ponte usa loopback/token aleatório e entrega nomes/argumentos exatos', async t => {
  const calls = [];
  const bridge = await startAgentBridge((name, args) => { calls.push([name, args]); return { ok: true }; });
  t.after(() => bridge.close());
  assert.match(bridge.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(bridge.token, /^[a-f0-9]{64}$/);
  const names = ['anoint_get_context', 'anoint_list_images', 'anoint_get_image', 'anoint_propose_task', 'anoint_submit_proposal',
    'anoint_control_task', 'anoint_review', 'anoint_manual_example', 'anoint_create_class', 'anoint_update_class', 'anoint_remove_class'];
  for (const name of names) {
    const response = await post(bridge, { name, args: { id: 'imagem' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: { ok: true } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(calls, names.map(name => [name, { id: 'imagem' }]));
  const second = await startAgentBridge(() => null);
  t.after(() => second.close());
  assert.notEqual(bridge.token, second.token);
});

test('rejeita bearer, qualquer Origin e Host diferente antes do dispatch', async t => {
  let calls = 0;
  const bridge = await startAgentBridge(() => { calls++; });
  t.after(() => bridge.close());
  for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer errado' }, { Authorization: `bearer ${bridge.token}` }]) {
    assert.equal((await post(bridge, payload, headers)).status, 401);
  }
  for (const Origin of ['', 'null', bridge.url, 'https://evil.example']) {
    assert.equal((await post(bridge, payload, { Origin })).status, 403);
  }
  for (const Host of ['localhost', 'evil.example', '127.0.0.1:1']) {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(`${bridge.url}/call`, {
        method: 'POST', headers: { Host, Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      request.end(JSON.stringify(payload));
    });
    assert.equal(status, 403);
  }
  assert.equal(calls, 0);
});

test('valida rota, método, tipo JSON, allowlist e objeto de argumentos', async t => {
  let calls = 0;
  const bridge = await startAgentBridge(() => { calls++; });
  t.after(() => bridge.close());
  const headers = { Authorization: `Bearer ${bridge.token}` };
  assert.equal((await fetch(`${bridge.url}/other`, { headers })).status, 404);
  assert.equal((await fetch(`${bridge.url}/call`, { headers })).status, 405);
  assert.equal((await post(bridge, payload, { 'Content-Type': 'text/plain' })).status, 415);
  for (const body of [null, [], {}, { name: 'approve', args: {} }, { name: payload.name },
    { ...payload, args: [] }, { ...payload, args: null }, { ...payload, extra: true }]) {
    assert.equal((await post(bridge, body)).status, 400);
  }
  const malformed = await fetch(`${bridge.url}/call`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);
});

test('limita bytes tanto com Content-Length quanto em streaming', async t => {
  let calls = 0;
  const bridge = await startAgentBridge(() => { calls++; }, { maxBytes: 100 });
  t.after(() => bridge.close());
  assert.equal((await post(bridge, { ...payload, args: { text: 'á'.repeat(100) } })).status, 413);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${bridge.url}/call`, {
      method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
    }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.write('x'.repeat(60));
    request.end('y'.repeat(60));
  });
  assert.equal(status, 413);
  assert.equal(calls, 0);
});

test('propaga falha do domínio e não publica resultado tardio após timeout', async t => {
  let release;
  const bridge = await startAgentBridge((name, args) => {
    if (args.fail) throw new Error('Projeto indisponível.');
    if (args.nullError) return Promise.reject(null);
    if (args.wait) return new Promise(resolve => { release = resolve; });
    return 'ok';
  }, { timeoutMs: 40 });
  t.after(() => bridge.close());
  const failed = await post(bridge, { ...payload, args: { fail: true } });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Projeto indisponível.' });
  const unknown = await post(bridge, { ...payload, args: { nullError: true } });
  assert.equal(unknown.status, 500);
  assert.deepEqual(await unknown.json(), { error: 'Falha na ponte.' });
  const timed = await post(bridge, { ...payload, args: { wait: true } });
  assert.equal(timed.status, 504);
  assert.match((await timed.json()).error, /Tempo/);
  release('tarde');
  const next = await post(bridge);
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), { result: 'ok' });
});

test('limita concorrência a oito dispatches reais inclusive após timeout', async t => {
  const releases = [];
  const bridge = await startAgentBridge(() => new Promise(resolve => { releases.push(resolve); }), { timeoutMs: 100 });
  t.after(() => bridge.close());
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(bridge)));
  assert.equal(releases.length, 8);
  assert.ok(responses.every(response => response.status === 504));
  assert.equal((await post(bridge)).status, 429);
  releases.forEach(resolve => resolve(null));
});

test('timeout também cobre corpo incompleto', async t => {
  const bridge = await startAgentBridge(() => assert.fail('Não deve despachar'), { timeoutMs: 40 });
  t.after(() => bridge.close());
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${bridge.url}/call`, {
      method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', 'Content-Length': 100 },
    }, response => { response.resume(); resolve(response.statusCode); request.destroy(); });
    request.on('error', reject);
    request.write('{');
  });
  assert.equal(status, 504);
});

test('cliente interrompido não derruba ponte nem retém vaga de leitura', async t => {
  let calls = 0;
  const bridge = await startAgentBridge(() => { calls++; return 'ok'; });
  t.after(() => bridge.close());
  await new Promise(resolve => {
    const request = http.request(`${bridge.url}/call`, {
      method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', 'Content-Length': 100 },
    });
    request.on('error', () => {});
    request.on('close', resolve);
    request.write('{', () => request.destroy());
  });
  assert.equal((await post(bridge)).status, 200);
  assert.equal(calls, 1);
});

test('shutdown é idempotente e não aguarda dispatch bloqueado', async () => {
  let started;
  let release;
  const ready = new Promise(resolve => { started = resolve; });
  const bridge = await startAgentBridge(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const request = post(bridge).catch(() => null);
  await ready;
  const closing = bridge.close();
  assert.equal(bridge.close(), closing);
  await closing;
  const response = await request;
  if (response) assert.equal(response.status, 503);
  await assert.rejects(post(bridge));
  release(null);
});

test('valida configuração antes de abrir listener', async () => {
  await assert.rejects(startAgentBridge(null), TypeError);
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { maxBytes: 0 }, { maxBytes: 1.5 }]) {
    await assert.rejects(startAgentBridge(() => null, options), TypeError);
  }
});

test('shutdown libera timers mesmo se dispatch nunca resolver', { timeout: 5000 }, async t => {
  const script = `
    const { startAgentBridge } = require(${JSON.stringify(require.resolve('../mcp/bridge.cjs'))});
    const http = require('node:http');
    (async () => {
      const bridge = await startAgentBridge(() => {
        bridge.close();
        return new Promise(() => {});
      });
      const request = http.request(bridge.url + '/call', {
        method: 'POST', headers: { Authorization: 'Bearer ' + bridge.token, 'Content-Type': 'application/json' },
      }, response => response.resume());
      request.on('error', () => {});
      request.end(JSON.stringify({ name: 'anoint_get_context', args: {} }));
    })();
  `;
  const child = spawn(process.execPath, ['-e', script], { windowsHide: true });
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.resume();
  assert.equal((await once(child, 'close'))[0], 0);
  assert.equal(stderr, '');
});
