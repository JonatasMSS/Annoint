import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../mcp/server.js';
import bridgeModule from '../mcp/bridge.cjs';
import isolatedMcpArgs from '../scripts/mcp-test-args.cjs';

const { startAgentBridge } = bridgeModule;
const serverPath = fileURLToPath(new URL('../mcp/server.js', import.meta.url));
const task = { requestId: 'request-1', description: 'Bola amarela', labelId: 'ball', calibrationCount: 2, batchSize: 10, imageIds: ['image-1', 'image-2'] };
const proposal = { requestId: 'request-2', taskId: 'task-1', frames: [{ imageId: 'image-1', revision: 'rev-1', boxes: [{ x: 0, y: 2.5, width: 3, height: 4 }] }] };

async function connect(t, dispatch, token, options = {}) {
  const bridge = await startAgentBridge(dispatch);
  t.after(() => bridge.close());
  const transport = new StdioClientTransport({
    command: process.execPath, args: isolatedMcpArgs([serverPath]), stderr: 'pipe',
    env: { ANOINT_URL: bridge.url, ANOINT_TOKEN: token ?? bridge.token,
      ...(options.confirmationMode === undefined ? {} : { ANOINT_CONFIRMATION_MODE: options.confirmationMode }) },
  });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'anoint-test', version: '1.0.0' }, {
    capabilities: options.capabilities || {},
    versionNegotiation: { mode: options.era === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
  });
  const prompts = [];
  if (options.capabilities?.elicitation) client.setRequestHandler('elicitation/create', async request => {
    prompts.push(request.params);
    return options.answer ? options.answer(request.params) : { action: 'accept', content: { confirm: true } };
  });
  if (options.interceptSend) {
    const send = transport.send.bind(transport);
    transport.send = (message, extra) => send(options.interceptSend(structuredClone(message)), extra);
  }
  t.after(async () => { await client.close(); await transport.close(); });
  await client.connect(transport);
  if (options.interceptReceive) {
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => receive(options.interceptReceive(message), extra);
  }
  return { client, bridge, prompts, stderr: () => stderr };
}

test('SDK real v2 percorre stdio/HTTP, publica onze tools e preserva imagens MCP', async t => {
  const calls = [];
  const image = { content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }, { type: 'text', text: 'imagem autorizada' }] };
  const { client, stderr } = await connect(t, (name, args) => {
    calls.push([name, args]);
    return name === 'anoint_get_image' ? image : { ok: true, args };
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'anoint_control_task', 'anoint_create_class', 'anoint_get_context', 'anoint_get_image', 'anoint_list_images',
    'anoint_manual_example', 'anoint_propose_task', 'anoint_remove_class', 'anoint_review', 'anoint_submit_proposal', 'anoint_update_class',
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
  for (const [name, args] of [
    ['anoint_control_task', { action: 'plan', taskId: 'task-1', requestId: 'control-1' }],
    ['anoint_review', { taskId: 'task-1', requestId: 'review-1', decisions: [{ imageId: 'image-1', decision: 'manual', boxes: [], revision: 'rev-1' }] }],
    ['anoint_manual_example', { taskId: 'task-1', imageId: 'image-1', revision: 'rev-1' }],
    ['anoint_create_class', { id: 'ball', name: 'Bola', color: '#fc0' }],
    ['anoint_update_class', { id: 'ball', name: 'Bola amarela' }],
    ['anoint_remove_class', { id: 'ball', replacementId: 'other', confirmation: { id: 'confirm-1', answer: 'REMOVER' } }],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, undefined);
  assert.deepEqual(calls.find(([name]) => name === 'anoint_review')[1].decisions[0].note, '');
  assert.deepEqual(calls.find(([name]) => name === 'anoint_manual_example')[1], {
    taskId: 'task-1', imageId: 'image-1', revision: 'rev-1', note: '', absent: false,
  });
  assert.deepEqual((await client.callTool({ name: 'anoint_get_image', arguments: { imageId: 'image-1', view: 'review' } })).content, image.content);
  assert.equal(stderr(), '');
});

test('SDK rejeita schemas inválidos antes de encaminhar ao domínio', async t => {
  const calls = [];
  const { client } = await connect(t, (name, args) => { calls.push([name, args]); return null; });
  const cases = [
    ['anoint_get_context', { extra: true }], ['anoint_get_image', {}],
    ['anoint_get_image', { imageId: 'x'.repeat(201) }], ['anoint_get_image', { imageId: 'x', view: 'invalid' }],
    ['anoint_control_task', { action: 'approve' }], ['anoint_control_task', { action: 'plan', confirmation: { id: 'x', answer: 'yes', extra: true } }],
    ['anoint_control_task', { action: 'plan', confirmationMode: 'chat' }],
    ['anoint_control_task', { action: 'plan', confirmation: { id: 'x'.repeat(201), answer: 'yes' } }],
    ['anoint_control_task', { action: 'plan', confirmation: { id: 'x', answer: 'x'.repeat(2001) } }],
    ['anoint_review', { taskId: 't', requestId: 'r', decisions: [] }],
    ['anoint_review', { taskId: 't', requestId: 'r', decisions: [{ imageId: 'i', decision: 'automatic' }] }],
    ['anoint_review', { taskId: 't', requestId: 'r', decisions: [{ imageId: 'i', decision: 'corrected', boxes: [{ x: -1, y: 0, width: 1, height: 1 }] }] }],
    ['anoint_review', { taskId: 't', requestId: 'r', decisions: [{ imageId: 'i', decision: 'absent', note: 'x'.repeat(2001) }] }],
    ['anoint_manual_example', { taskId: 't', imageId: 'i', revision: 'r', absent: 'false' }],
    ['anoint_create_class', { id: 'x', name: ' ', color: '#fc0' }], ['anoint_create_class', { id: 'x', name: 'Bola', color: 'red' }],
    ['anoint_update_class', { id: 'x', name: 'Bola', color: '#fc0' }], ['anoint_remove_class', { id: 'x', force: true }],
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
    const child = spawn(process.execPath, isolatedMcpArgs([serverPath]), {
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
  const child = spawn(process.execPath, isolatedMcpArgs([serverPath]), { env: { ...process.env, ANOINT_URL: 'http://127.0.0.1:1234', ANOINT_TOKEN: '' }, windowsHide: true });
  child.stderr.resume();
  child.stdout.resume();
  assert.equal((await once(child, 'close'))[0], 1);
});

test('serveStdio atende handshake legado, UTF8 fragmentado e encerra por EOF', { timeout: 10000 }, async t => {
  const bridge = await startAgentBridge((name, args) => ({ name, args }));
  t.after(() => bridge.close());
  const child = spawn(process.execPath, isolatedMcpArgs([serverPath]), { env: { ...process.env, ANOINT_URL: bridge.url, ANOINT_TOKEN: bridge.token }, windowsHide: true });
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
  assert.throws(() => createServer(async () => null, { confirmationMode: 'auto' }), /ANOINT_CONFIRMATION_MODE/);
  const server = createServer(async () => null);
  assert.equal(typeof server.registerTool, 'function');
});

test('CLI rejeita modo de confirmação inválido antes de abrir stdio', async () => {
  const child = spawn(process.execPath, isolatedMcpArgs([serverPath]), { windowsHide: true,
    env: { ...process.env, ANOINT_URL: 'http://127.0.0.1:1234', ANOINT_TOKEN: 'a'.repeat(64), ANOINT_CONFIRMATION_MODE: 'auto' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  assert.equal((await once(child, 'close'))[0], 1);
  assert.equal(stdout, '');
  assert.match(stderr, /ANOINT_CONFIRMATION_MODE/);
});

function confirmingController({ extra = false, chained = false } = {}) {
  const calls = [];
  const executions = [];
  const challenges = new Map();
  const base = args => {
    const result = { ...args };
    delete result.confirmation;
    return result;
  };
  const issue = (name, args, extra) => {
    const id = `confirmation-${challenges.size + 1}`;
    const confirmation = { id, message: extra ? 'Remover classe Bola e transferir suas caixas?' : 'Autorizar esta operação no projeto ativo?',
      phrase: extra ? 'REMOVER Bola' : 'AUTORIZAR', extra };
    challenges.set(id, { name, args: structuredClone(base(args)), confirmation, consumed: false });
    return { status: 'confirmation_required', confirmation };
  };
  return {
    calls, executions, challenges,
    async dispatch(name, args) {
      calls.push([name, structuredClone(args)]);
      if (name === 'anoint_get_context') return { ready: true };
      if (!args.confirmation) return issue(name, args, extra);
      const entry = challenges.get(args.confirmation.id);
      if (!entry || entry.consumed || entry.name !== name || JSON.stringify(entry.args) !== JSON.stringify(base(args))
        || args.confirmation.answer !== entry.confirmation.phrase) throw new Error('Confirmação inválida.');
      if (entry.stale) throw new Error('Conflito de revisão.');
      entry.consumed = true;
      if (chained && !entry.confirmation.extra) return issue(name, args, true);
      executions.push([name, structuredClone(args)]);
      return { status: 'applied' };
    },
  };
}

const control = { action: 'plan', taskId: 'task-1', requestId: 'control-1' };
const controlCall = client => client.callTool({ name: 'anoint_control_task', arguments: control });
const resultData = result => JSON.parse(result.content[0].text);

for (const era of ['modern', 'legacy']) {
  for (const confirmationMode of [undefined, 'chat']) {
    test(`${era}: modo ${confirmationMode ?? 'padrão'} confirma pelo chat mesmo com form anunciado que cancela automaticamente`, async t => {
      const controller = confirmingController();
      const { client, prompts } = await connect(t, controller.dispatch, undefined, {
        era, confirmationMode, capabilities: { elicitation: { form: {} } }, answer: () => ({ action: 'cancel' }),
      });
      const checkpoint = resultData(await controlCall(client));
      assert.equal(checkpoint.status, 'confirmation_required');
      assert.equal(controller.executions.length, 0);
      const confirmation = { id: checkpoint.confirmation.id, answer: checkpoint.confirmation.phrase };
      const wrong = await client.callTool({ name: 'anoint_control_task', arguments: { ...control, action: 'batch', confirmation } });
      assert.equal(wrong.isError, true);
      assert.equal(controller.executions.length, 0);
      const result = await client.callTool({ name: 'anoint_control_task', arguments: { ...control, confirmation } });
      assert.equal(resultData(result).status, 'applied');
      assert.equal(prompts.length, 0);
      assert.equal(controller.executions.length, 1);
    });
  }

  test(`${era}: remoção no chat mantém confirmação extra mesmo com elicitation anunciada`, async t => {
    const controller = confirmingController({ chained: true });
    const { client, prompts } = await connect(t, controller.dispatch, undefined, {
      era, capabilities: { elicitation: { form: {} } }, answer: () => ({ action: 'cancel' }),
    });
    const args = { id: 'ball', replacementId: 'other' };
    const invoke = args => client.callTool({ name: 'anoint_remove_class', arguments: args });
    const first = resultData(await invoke(args)).confirmation;
    const second = resultData(await invoke({ ...args, confirmation: { id: first.id, answer: first.phrase } })).confirmation;
    assert.equal(second.extra, true);
    assert.equal(second.phrase, 'REMOVER Bola');
    assert.equal(controller.executions.length, 0);
    assert.equal((await invoke({ ...args, confirmation: { id: second.id, answer: 'sim' } })).isError, true);
    assert.equal(controller.executions.length, 0);
    assert.equal(resultData(await invoke({ ...args, confirmation: { id: second.id, answer: second.phrase } })).status, 'applied');
    assert.equal(controller.executions.length, 1);
    assert.equal(prompts.length, 0);
  });

  test(`${era}: confirmação nativa é coletada no cliente antes de executar`, async t => {
    const controller = confirmingController();
    const { client, prompts } = await connect(t, controller.dispatch, undefined, {
      era, confirmationMode: 'native', capabilities: { elicitation: { form: {} } },
      answer: () => {
        assert.equal(controller.calls.length, 1);
        assert.equal(controller.executions.length, 0);
        return { action: 'accept', content: { confirm: true } };
      },
    });
    assert.equal(resultData(await controlCall(client)).status, 'applied');
    assert.equal(prompts.length, 1);
    assert.deepEqual(controller.calls[1], ['anoint_control_task', {
      ...control, confirmation: { id: 'confirmation-1', answer: 'AUTORIZAR' },
    }]);
    assert.equal(controller.executions.length, 1);
  });

  for (const answer of [{ action: 'decline' }, { action: 'cancel' },
    { action: 'accept', content: { confirm: false } }, { action: 'accept', content: { confirm: 'true' } }]) {
    test(`${era}: ${JSON.stringify(answer)} não executa nem repete diálogo`, async t => {
      const controller = confirmingController();
      const { client, prompts } = await connect(t, controller.dispatch, undefined, {
        era, confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => answer,
      });
      const result = resultData(await controlCall(client));
      assert.ok(['declined', 'cancelled', 'confirmation_invalid'].includes(result.status));
      assert.equal(prompts.length, 1);
      assert.equal(controller.calls.length, 1);
      assert.equal(controller.executions.length, 0);
    });
  }

  test(`${era}: cliente sem elicitation mantém checkpoint e aceita fallback explícito posterior`, async t => {
    const controller = confirmingController();
    const { client, prompts } = await connect(t, controller.dispatch, undefined, { era });
    const checkpoint = resultData(await controlCall(client));
    assert.equal(checkpoint.status, 'confirmation_required');
    assert.equal(prompts.length, 0);
    assert.equal(controller.executions.length, 0);
    assert.equal(resultData(await client.callTool({ name: 'anoint_get_context', arguments: {} })).ready, true);
    const result = await client.callTool({ name: 'anoint_control_task', arguments: {
      ...control, confirmation: { id: checkpoint.confirmation.id, answer: checkpoint.confirmation.phrase },
    } });
    assert.equal(resultData(result).status, 'applied');
    assert.equal(controller.executions.length, 1);
  });

  test(`${era}: cancelamento no modo nativo não libera confirmação por argumento no retry`, async t => {
    const controller = confirmingController();
    const { client, prompts } = await connect(t, controller.dispatch, undefined, {
      era, confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => ({ action: 'cancel' }),
    });
    assert.equal(resultData(await controlCall(client)).status, 'cancelled');
    const retry = await client.callTool({ name: 'anoint_control_task', arguments: {
      ...control, confirmation: { id: 'confirmation-1', answer: 'AUTORIZAR' },
    } });
    assert.equal(resultData(retry).status, 'cancelled');
    assert.equal(prompts.length, 2);
    assert.equal(controller.executions.length, 0);
    assert.ok(controller.calls.every(([, args]) => !Object.hasOwn(args, 'confirmation')));
  });

  test(`${era}: remoção exige segunda pergunta e frase textual exata`, async t => {
    const controller = confirmingController({ chained: true });
    const { client, prompts } = await connect(t, controller.dispatch, undefined, {
      era, confirmationMode: 'native', capabilities: { elicitation: { form: {} } },
      answer: params => params.requestedSchema.properties.answer
        ? { action: 'accept', content: { answer: 'REMOVER Bola' } }
        : { action: 'accept', content: { confirm: true } },
    });
    const result = await client.callTool({ name: 'anoint_remove_class', arguments: { id: 'ball', replacementId: 'other' } });
    assert.equal(resultData(result).status, 'applied');
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].requestedSchema.properties.answer.default, undefined);
    assert.match(prompts[1].message, /REMOVER Bola/);
    assert.equal(controller.calls.length, 3);
    assert.equal(controller.executions.length, 1);
    assert.deepEqual(controller.calls[2][1].confirmation, { id: 'confirmation-2', answer: 'REMOVER Bola' });
  });

  test(`${era}: frase extra incorreta não remove classe`, async t => {
    const controller = confirmingController({ extra: true });
    const { client } = await connect(t, controller.dispatch, undefined, {
      era, confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => ({ action: 'accept', content: { answer: 'remover bola' } }),
    });
    assert.equal(resultData(await client.callTool({ name: 'anoint_remove_class', arguments: { id: 'ball' } })).status, 'declined');
    assert.equal(controller.executions.length, 0);
  });
}

test('form anunciado ignora confirmation enviado pelo agente nos argumentos da tool', async t => {
  const controller = confirmingController();
  const { client, prompts } = await connect(t, controller.dispatch, undefined, {
    era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => ({ action: 'decline' }),
  });
  await client.callTool({ name: 'anoint_control_task', arguments: { ...control, confirmation: { id: 'forged', answer: 'AUTORIZAR' } } });
  assert.equal(Object.hasOwn(controller.calls[0][1], 'confirmation'), false);
  assert.equal(prompts.length, 1);
  assert.equal(controller.executions.length, 0);
});

test('capability form vazia funciona; apenas URL usa fallback em vez de bloquear conversa', async t => {
  const form = confirmingController();
  const native = await connect(t, form.dispatch, undefined, { era: 'modern', confirmationMode: 'native', capabilities: { elicitation: {} } });
  assert.equal(resultData(await controlCall(native.client)).status, 'applied');
  assert.equal(native.prompts.length, 1);
  const url = confirmingController();
  const fallback = await connect(t, url.dispatch, undefined, { era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { url: {} } } });
  assert.equal(resultData(await controlCall(fallback.client)).status, 'confirmation_required');
  assert.equal(fallback.prompts.length, 0);
  assert.equal(url.executions.length, 0);
});

test('nonce adulterado e mudança de argumentos no retry não executam ação', async t => {
  for (const tamper of ['nonce', 'args']) {
    const controller = confirmingController();
    const { client } = await connect(t, controller.dispatch, undefined, {
      era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { form: {} } },
      interceptSend: message => {
        if (message.method === 'tools/call' && message.params.requestState) {
          if (tamper === 'nonce') message.params.requestState += 'x';
          else message.params.arguments.action = 'cancel';
        }
        return message;
      },
    });
    const result = await controlCall(client);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Confirmação expirada, consumida ou associada/);
    assert.equal(controller.calls.length, 1);
    assert.equal(controller.executions.length, 0);
  }
});

test('nonce só identifica a pendência, é de uso único e não publica projeto nem segredo', async t => {
  const controller = confirmingController();
  let nonce;
  const { client, bridge } = await connect(t, controller.dispatch, undefined, {
    era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { form: {} } },
    interceptReceive: message => {
      if (message.result?.resultType === 'input_required') nonce = message.result.requestState;
      return message;
    },
  });
  assert.equal(resultData(await controlCall(client)).status, 'applied');
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.equal(nonce.includes(bridge.token), false);
  const replay = await client.callTool({ name: 'anoint_control_task', arguments: control,
    requestState: nonce, inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
  });
  assert.equal(replay.isError, true);
  assert.equal(controller.executions.length, 1);
});

test('inputResponses sem nonce emitido não substitui a confirmação', async t => {
  const controller = confirmingController();
  const { client } = await connect(t, controller.dispatch, undefined, { era: 'modern' });
  const result = await client.callTool({ name: 'anoint_control_task', arguments: control,
    inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
  });
  assert.equal(result.isError, true);
  assert.equal(controller.calls.length, 0);
  assert.equal(controller.executions.length, 0);
});

test('espera do usuário não mantém chamada HTTP nem bloqueia ferramentas de contexto', async t => {
  const controller = confirmingController();
  let prompted;
  let answer;
  const ready = new Promise(resolve => { prompted = resolve; });
  const { client } = await connect(t, controller.dispatch, undefined, {
    era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => {
      prompted();
      return new Promise(resolve => { answer = resolve; });
    },
  });
  const pending = controlCall(client);
  await ready;
  for (let index = 0; index < 10; index++) {
    assert.equal(resultData(await client.callTool({ name: 'anoint_get_context', arguments: {} })).ready, true);
  }
  assert.equal(controller.executions.length, 0);
  answer({ action: 'accept', content: { confirm: true } });
  assert.equal(resultData(await pending).status, 'applied');
});

test('controller revalida revisão depois do aceite; conflito não força aplicação', async t => {
  const controller = confirmingController();
  const { client } = await connect(t, controller.dispatch, undefined, {
    era: 'modern', confirmationMode: 'native', capabilities: { elicitation: { form: {} } }, answer: () => {
      controller.challenges.get('confirmation-1').stale = true;
      return { action: 'accept', content: { confirm: true } };
    },
  });
  const result = await controlCall(client);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Conflito/);
  assert.equal(controller.executions.length, 0);
});
