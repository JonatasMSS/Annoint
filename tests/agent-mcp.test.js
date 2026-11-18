import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../mcp/server.js';
import bridgeModule from '../mcp/bridge.cjs';

const { startAgentBridge } = bridgeModule;
const serverPath = fileURLToPath(new URL('../mcp/server.js', import.meta.url));
const task = { requestId: 'request-1', description: 'Bola amarela', labelId: 'ball', calibrationCount: 2, batchSize: 10, imageIds: ['image-1', 'image-2'] };
const proposal = { requestId: 'request-2', taskId: 'task-1', frames: [{ imageId: 'image-1', revision: 'rev-1', boxes: [{ x: 0, y: 2.5, width: 3, height: 4 }] }] };

async function connect(t, dispatch, token) {
  const bridge = await startAgentBridge(dispatch);
  t.after(() => bridge.close());
  const transport = new StdioClientTransport({
    command: process.execPath, args: [serverPath], stderr: 'pipe',
    env: { ANOINT_URL: bridge.url, ANOINT_TOKEN: token ?? bridge.token },
  });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'anoint-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await transport.close(); });
  await client.connect(transport);
  return { client, bridge, stderr: () => stderr };
}

test('SDK real v2 percorre stdio/HTTP, publica cinco tools e preserva imagens MCP', async t => {
  const calls = [];
  const image = { content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }, { type: 'text', text: 'imagem autorizada' }] };
  const { client, stderr } = await connect(t, (name, args) => {
    calls.push([name, args]);
    return name === 'anoint_get_image' ? image : { ok: true, args };
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'anoint_get_context', 'anoint_get_image', 'anoint_list_images', 'anoint_propose_task', 'anoint_submit_proposal',
  ]);
  for (const [name, args] of [
    ['anoint_get_context', {}], ['anoint_list_images', {}],
    ['anoint_propose_task', task], ['anoint_submit_proposal', proposal],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).ok, true);
  }
  const result = await client.callTool({ name: 'anoint_get_image', arguments: { imageId: 'image-1' } });
  assert.deepEqual(result.content, image.content);
  assert.deepEqual(calls, [
    ['anoint_get_context', {}], ['anoint_list_images', { offset: 0, limit: 20 }],
    ['anoint_propose_task', task], ['anoint_submit_proposal', proposal],
    ['anoint_get_image', { imageId: 'image-1' }],
  ]);
  assert.equal(stderr(), '');
});

test('SDK rejeita schemas inválidos antes de encaminhar ao domínio', async t => {
  const calls = [];
  const { client } = await connect(t, (name, args) => { calls.push([name, args]); return null; });
  const cases = [
    ['anoint_get_context', { extra: true }], ['anoint_get_image', {}],
    ...[{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 101 }].map(args => ['anoint_list_images', args]),
    ...[{ description: '' }, { description: 'x'.repeat(2001) }, { calibrationCount: 0 }, { calibrationCount: 101 },
      { batchSize: 0 }, { imageIds: [] }, { imageIds: ['x', 'x'] }, { imageIds: Array.from({ length: 10001 }, (_, i) => String(i)) }]
      .map(patch => ['anoint_propose_task', { ...task, ...patch }]),
    ['anoint_submit_proposal', { ...proposal, frames: [] }],
    ['anoint_submit_proposal', { ...proposal, message: 'x'.repeat(2001) }],
    ['anoint_submit_proposal', { ...proposal, frames: Array(101).fill(proposal.frames[0]) }],
    ...[{ x: -1 }, { width: 0 }, { height: -1 }, { x: null }, { width: '3' }, { extra: true }]
      .map(patch => ['anoint_submit_proposal', { ...proposal, frames: [{ ...proposal.frames[0], boxes: [{ ...proposal.frames[0].boxes[0], ...patch }] }] }]),
    ['anoint_submit_proposal', { ...proposal, frames: [{ ...proposal.frames[0], boxes: Array(1001).fill(proposal.frames[0].boxes[0]) }] }],
  ];
  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name + JSON.stringify(args).slice(0, 80));
  }
  assert.equal(calls.length, 0);
  const result = await client.callTool({ name: 'anoint_submit_proposal', arguments: {
    ...proposal, frames: [{ ...proposal.frames[0], boxes: [] }],
  } });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
});

test('erros de autenticação e domínio viram erro de tool MCP', async t => {
  const bad = await connect(t, () => assert.fail('Não autorizado'), '0'.repeat(64));
  const denied = await bad.client.callTool({ name: 'anoint_get_context', arguments: {} });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /Token/);
  const good = await connect(t, () => { throw new Error('Projeto não está aberto.'); });
  const failed = await good.client.callTool({ name: 'anoint_get_context', arguments: {} });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Projeto não está aberto/);
});

test('CLI recusa URL não literal/externa/path/porta inválida e token ausente sem escrever stdout', async () => {
  for (const url of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.2:1234',
    'http://127.0.0.1:1234/path', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234?x=1', 'http://127.0.0.1:1234#x', undefined]) {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ANOINT_URL: url, ANOINT_TOKEN: 'a'.repeat(64) }, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /ANOINT_URL/);
  }
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, ANOINT_URL: 'http://127.0.0.1:1234', ANOINT_TOKEN: '' }, windowsHide: true });
  child.stderr.resume();
  child.stdout.resume();
  assert.equal((await once(child, 'close'))[0], 1);
});

test('serveStdio atende handshake legado, UTF8 fragmentado e encerra por EOF', { timeout: 10000 }, async t => {
  const bridge = await startAgentBridge((name, args) => ({ name, args }));
  t.after(() => bridge.close());
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, ANOINT_URL: bridge.url, ANOINT_TOKEN: bridge.token }, windowsHide: true });
  t.after(() => child.kill());
  let stderr = '';
  let output = '';
  const messages = [];
  const waiters = new Map();
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    let newline;
    while ((newline = output.indexOf('\n')) !== -1) {
      const message = JSON.parse(output.slice(0, newline));
      output = output.slice(newline + 1);
      messages.push(message);
      waiters.get(message.id)?.(message);
    }
  });
  const receive = id => new Promise(resolve => {
    const found = messages.find(message => message.id === id);
    if (found) resolve(found);
    else waiters.set(id, resolve);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1.0.0' },
  } }) + '\n');
  assert.equal((await receive(1)).result.protocolVersion, '2025-11-25');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const args = { ...task, description: 'Bola amarela: ação, revisão ⚽' };
  const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'anoint_propose_task', arguments: args } }) + '\n');
  const marker = bytes.indexOf(Buffer.from('ç'));
  child.stdin.write(bytes.subarray(0, marker + 1));
  child.stdin.write(bytes.subarray(marker + 1));
  assert.deepEqual(JSON.parse((await receive(2)).result.content[0].text).args, args);
  const closed = once(child, 'close');
  child.stdin.end();
  assert.equal((await closed)[0], 0);
  assert.equal(stderr, '');
});

test('factory valida callback e pode ser importada sem iniciar transporte', () => {
  assert.throws(() => createServer(null), TypeError);
  const server = createServer(async () => null);
  assert.equal(typeof server.registerTool, 'function');
});
