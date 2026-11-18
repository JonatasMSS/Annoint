const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAgent } = require('../electron/agent.cjs');

test('IPC da ponte aceita só janela/frame confiáveis, correlaciona respostas e revoga credenciais', async t => {
  const handlers = {}, events = {}, requests = [];
  const owner = { isDestroyed: () => false, mainFrame: { url: 'file:///anoint/index.html' }, send(name, value) { requests.push(value); } };
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const backend = registerAgent({ BrowserWindow: { fromWebContents: sender => sender === owner ? {} : null },
    ipcMain: { handle(name, fn) { handlers[name] = fn; }, on(name, fn) { events[name] = fn; } },
  }, owner.mainFrame.url);
  t.after(() => backend.close());
  const connect = handlers['anoint-agent:connect'];
  for (const invalid of [{}, { ...event, senderFrame: { url: owner.mainFrame.url } }, { sender: { ...owner }, senderFrame: owner.mainFrame }]) await assert.rejects(connect(invalid), /autorizado/);
  const first = (await connect(event)).mcpServers.anoint;
  assert.equal(first.command, 'node'); assert.match(first.args[0], /mcp[\\/]server\.js$/);
  const call = config => fetch(config.env.ANOINT_URL + '/call', { method: 'POST', headers: { Authorization: 'Bearer ' + config.env.ANOINT_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'anoint_get_context', args: {} }) });
  const pending = call(first);
  while (!requests.length) await new Promise(resolve => setImmediate(resolve));
  events['anoint-agent:reply']({ ...event, senderFrame: {} }, { id: requests[0].id, result: 'forged' });
  events['anoint-agent:reply'](event, { id: 'unknown', result: 'forged' });
  events['anoint-agent:reply'](event, { id: requests[0].id, result: { projectId: 'allowed' } });
  assert.deepEqual(await (await pending).json(), { result: { projectId: 'allowed' } });
  const second = (await connect(event)).mcpServers.anoint;
  assert.notEqual(second.env.ANOINT_TOKEN, first.env.ANOINT_TOKEN);
  await assert.rejects(call(first));
  const inFlight = call(second);
  while (requests.length < 2) await new Promise(resolve => setImmediate(resolve));
  await handlers['anoint-agent:disconnect'](event);
  assert.match(JSON.stringify(await (await inFlight).json()), /encerrada/);
  await assert.rejects(call(second));
});
