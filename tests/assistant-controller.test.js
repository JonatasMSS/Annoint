import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantUI } from '../src/assistant-ui.js';
import { createProject } from '../src/model.js';
import { emptyAssistant, imageRevision } from '../src/assistant.js';

async function controller(t, length = 3, calibrationCount = 1) {
  const previous = { window: globalThis.window, document: globalThis.document };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const listeners = {};
  const panel = { open: false, setAttribute() {}, close() {}, querySelector() { return null; } };
  globalThis.document = { activeElement: {}, body: { append() {} }, createElement: () => panel, querySelector: () => null,
    addEventListener(name, listener) { listeners[name] = listener; } };
  panel.addEventListener = () => {};
  let connections = 0, disconnections = 0;
  globalThis.window = { anointAgent: { connect: async () => { connections++; return { mcpServers: {} }; },
    disconnect: async () => { disconnections++; }, onRequest() {} } };
  let project = createProject(Array.from({ length }, (_, index) => ({ id: `image-${index}`, name: `image-${index}.svg`,
    src: './assets/demo-street.svg', width: 100, height: 80, reviewed: false, annotations: [] })), [{ id: 'ball', name: 'Bola', color: '#123456' }]);
  let assistant = emptyAssistant(), revision = 0;
  const ui = createAssistantUI({ get: () => ({ project, assistant, revision, projectId: 'project-1', name: 'Teste', busy: false }), overlay() {},
    async commit(transform) { const result = await transform(); project = structuredClone(result.project); assistant = structuredClone(result.assistant); revision += 1; } });
  listeners.click({ target: { closest: () => ({ dataset: { assistant: 'connect' } }) } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const call = (name, args = {}) => ui.handleTool('anoint_' + name, args);
  const confirm = async (name, args) => {
    const response = await call(name, args);
    assert.equal(response.status, 'confirmation_required');
    const confirmed = { ...args, confirmation: { id: response.confirmation.id, answer: response.confirmation.phrase } };
    return { result: await call(name, confirmed), confirmed };
  };
  await call('propose_task', { requestId: 'plan', description: 'Bola', labelId: 'ball', calibrationCount, batchSize: 2, imageIds: project.images.map(image => image.id) });
  await confirm('control_task', { action: 'plan', requestId: 'plan' });
  return { call, confirm, state: () => ({ project, assistant, revision }), disconnect: ui.disconnect,
    connectionStats: () => ({ connections, disconnections }),
    async click(action) {
      listeners.click({ target: { closest: () => ({ dataset: { assistant: action } }) } });
      await new Promise(resolve => setTimeout(resolve, 0));
    } };
}

test('reset revoga confirmações e autorização, preservando projeto, feedback, recibos e proposta até retomar', async t => {
  const app = await controller(t);
  const callProposal = async requestId => {
    const { project, assistant } = app.state();
    const context = await app.call('get_context');
    await app.call('submit_proposal', { taskId: assistant.task.id, requestId,
      frames: await Promise.all(context.availableImageIds.map(async imageId => ({ imageId,
        revision: await imageRevision(project, project.images.find(image => image.id === imageId)),
        boxes: [{ x: 1, y: 2, width: 3, height: 4 }] }))) });
  };
  const review = requestId => ({ taskId: app.state().assistant.task.id, requestId,
    decisions: app.state().assistant.pending.frames.map(frame => ({ imageId: frame.imageId, decision: 'accepted' })) });
  await callProposal('calibration');
  await app.confirm('review', review('calibration'));
  await app.confirm('control_task', { action: 'batch', taskId: app.state().assistant.task.id });
  await callProposal('pending');
  const memory = app.state().assistant;
  memory.task.manualNote = 'Orientação salva';
  memory.pending.frames[0].draft = { decision: 'corrected', note: 'Rascunho', boxes: [{ x: '', y: '2', width: '3', height: '4' }] };
  const args = review('pending');
  const old = await app.call('review', args);
  const before = structuredClone(app.state());
  await app.click('reset');
  assert.deepEqual(app.connectionStats(), { connections: 2, disconnections: 1 });
  assert.deepEqual(app.state(), before);
  const context = await app.call('get_context');
  assert.deepEqual(context.availableImageIds, []);
  assert.equal(context.memory.task.manualNote, undefined);
  assert.equal(context.memory.pending.frames[0].draft, undefined);
  await assert.rejects(() => app.call('review', { ...args, confirmation: { id: old.confirmation.id, answer: old.confirmation.phrase } }), /Confirmação inválida/);
  await app.confirm('control_task', { action: 'resume', taskId: memory.task.id });
  const resumed = await app.call('get_context');
  assert.notEqual(resumed.memory.task.id, memory.task.id);
  assert.deepEqual(resumed.availableImageIds, ['image-1', 'image-2']);
  assert.deepEqual(resumed.memory.pending.frames[0].draft, before.assistant.pending.frames[0].draft);
  assert.equal(resumed.memory.task.manualNote, 'Orientação salva');
  assert.deepEqual(app.state().project, before.project);
  assert.deepEqual(app.state().assistant.feedback, before.assistant.feedback);
  assert.deepEqual(app.state().assistant.receipts, before.assistant.receipts);
});

test('falha no reset mantém dados e deixa a conexão desabilitada até conectar novamente', async t => {
  const app = await controller(t);
  const before = structuredClone(app.state());
  const connect = window.anointAgent.connect;
  window.anointAgent.connect = async () => { throw new Error('Falha simulada na conexão.'); };
  await app.click('reset');
  assert.deepEqual(app.state(), before);
  assert.equal(app.connectionStats().disconnections, 1);
  await assert.rejects(() => app.call('get_context'), /APP_UNAVAILABLE/);
  window.anointAgent.connect = connect;
  await app.click('connect');
  assert.deepEqual((await app.call('get_context')).availableImageIds, []);
  assert.deepEqual(app.state(), before);
});

test('desconectar durante reset impede publicar a configuração que chegar depois', async t => {
  const app = await controller(t);
  const before = structuredClone(app.state());
  let release;
  window.anointAgent.connect = () => new Promise(resolve => { release = resolve; });
  await app.click('reset');
  assert.equal(typeof release, 'function');
  await app.disconnect();
  release({ mcpServers: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(() => app.call('get_context'), /APP_UNAVAILABLE/);
  assert.deepEqual(app.state(), before);
});

test('desconectar enquanto reset fecha a ponte antiga impede iniciar outra conexão', async t => {
  const app = await controller(t);
  const before = structuredClone(app.state());
  let release;
  const disconnect = window.anointAgent.disconnect;
  window.anointAgent.disconnect = async () => { await disconnect(); await new Promise(resolve => { release = resolve; }); };
  await app.click('reset');
  assert.equal(typeof release, 'function');
  await app.disconnect();
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.connectionStats().connections, 1);
  await assert.rejects(() => app.call('get_context'), /APP_UNAVAILABLE/);
  assert.deepEqual(app.state(), before);
});

test('uma confirmação aplica a revisão conjunta de várias imagens sem aprovar as rejeitadas', async t => {
  const app = await controller(t, 3, 2);
  const { project, assistant } = app.state();
  assert.deepEqual((await app.call('get_context')).availableImageIds, ['image-0', 'image-1']);
  const args = { requestId: 'multiple', taskId: assistant.task.id,
    frames: await Promise.all(project.images.slice(0, 2).map(async image => ({ imageId: image.id,
      revision: await imageRevision(project, image), boxes: [{ x: 10, y: 10, width: 20, height: 20 }, { x: 40, y: 40, width: 10, height: 10 }] }))) };
  await app.call('submit_proposal', args);
  const review = { requestId: args.requestId, taskId: args.taskId, decisions: [
    { imageId: 'image-0', decision: 'accepted' }, { imageId: 'image-1', decision: 'rejected', note: 'Não é o alvo' },
  ] };
  const checkpoint = await app.call('review', review);
  assert.equal(checkpoint.status, 'confirmation_required');
  assert.match(checkpoint.confirmation.message, /2 imagem\(ns\)/);
  assert.match(checkpoint.confirmation.message, /Adicionar 2 caixa/);
  assert.deepEqual(app.state().project, project);
  assert.equal(app.state().assistant.completed.length, 0);
  const confirmed = { ...review, confirmation: { id: checkpoint.confirmation.id, answer: checkpoint.confirmation.phrase } };
  await assert.rejects(() => app.call('review', { ...confirmed, decisions: review.decisions.map(item => ({ ...item, decision: 'accepted' })) }), /outra ação/);
  const result = await app.call('review', confirmed);
  assert.deepEqual(app.state().project.images.map(image => image.annotations.length), [2, 0, 0]);
  assert.deepEqual(app.state().assistant.completed, ['image-0', 'image-1']);
  assert.equal(app.state().assistant.task.phase, 'awaiting_batch');
  assert.deepEqual(await app.call('review', confirmed), result);
  assert.equal(app.state().assistant.feedback.length, 2);
  assert.deepEqual((await app.call('get_context')).availableImageIds, []);
  await app.confirm('control_task', { action: 'batch', taskId: args.taskId });
  assert.deepEqual((await app.call('get_context')).availableImageIds, ['image-2']);
});

test('descarte atrasado de A não consome B da mesma tarefa', async t => {
  const app = await controller(t);
  const { project, assistant } = app.state();
  const proposal = { taskId: assistant.task.id, frames: [{ imageId: 'image-0', revision: await imageRevision(project, project.images[0]), boxes: [] }] };
  await app.call('submit_proposal', { ...proposal, requestId: 'A' });
  await app.call('control_task', { taskId: assistant.task.id, action: 'discard', requestId: 'A' });
  await app.call('submit_proposal', { ...proposal, requestId: 'B' });
  await assert.rejects(() => app.call('control_task', { taskId: assistant.task.id, action: 'discard', requestId: 'A' }), /proposta mudou/);
  await assert.rejects(() => app.call('control_task', { taskId: assistant.task.id, action: 'discard' }), /proposta mudou/);
  assert.equal(app.state().assistant.pending.requestId, 'B');
});

test('70 confirmações concluídas não ocupam vagas de pendências e mantêm recibo para retry', async t => {
  const app = await controller(t, 100, 100);
  const taskId = app.state().assistant.task.id;
  let first;
  for (let index = 0; index < 70; index++) {
    const { project } = app.state();
    const args = { taskId, imageId: `image-${index}`, revision: await imageRevision(project, project.images[index]), absent: true, note: 'Sem alvo' };
    const result = await app.confirm('manual_example', args);
    if (!first) first = result;
  }
  assert.equal(app.state().assistant.completed.length, 70);
  assert.deepEqual(await app.call('manual_example', first.confirmed), first.result);
  assert.equal(app.state().assistant.completed.length, 70);
});

test('confirmação não autoriza troca de argumentos ou ação e tem limite de pendências reais', async t => {
  const app = await controller(t, 100, 100);
  const { project, assistant } = app.state();
  const args = { taskId: assistant.task.id, imageId: 'image-0', revision: await imageRevision(project, project.images[0]), absent: true, note: '0' };
  const response = await app.call('manual_example', args);
  const confirmation = { id: response.confirmation.id, answer: response.confirmation.phrase };
  await assert.rejects(() => app.call('manual_example', { ...args, note: 'Outro', confirmation }), /outra ação/);
  for (let index = 1; index < 64; index++) await app.call('manual_example', { ...args, note: String(index) });
  await assert.rejects(() => app.call('manual_example', { ...args, note: '65' }), /Muitas confirmações pendentes/);
  assert.equal(app.state().assistant.completed.length, 0);
});
