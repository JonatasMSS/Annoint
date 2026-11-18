import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAssistant, validateAssistant, imageRevision, availableImages, proposeTask, approveTask,
  submitProposal, reviewProposal, useManualExample, authorizeBatch, cancelTask, saveDecision, saveDraft, discardProposal, examplesCurrent,
} from '../src/assistant.js';
import { createProject, validateProject } from '../src/model.js';

const geometry = { x: 10, y: 12, width: 6, height: 8 };
const corrected = { x: 11.5, y: 13.25, width: 7, height: 9 };
const clone = value => structuredClone(value);

function fixture(length = 5, targetBox = false) {
  return createProject(Array.from({ length }, (_, index) => ({
    id: `image-${index + 1}`, name: `imagem-${index + 1}.svg`, src: './assets/demo-street.svg',
    width: 100, height: 100, reviewed: true,
    annotations: [
      { id: `existing-${index + 1}`, labelId: 'other', x: 60, y: 60, width: 10, height: 10 },
      ...(targetBox && index === 0 ? [{ id: 'manual-ball', labelId: 'ball', ...geometry }] : []),
    ],
  })), [{ id: 'ball', name: 'Bola', color: '#fc0' }, { id: 'other', name: 'Outra', color: '#abc' }]);
}

const taskArgs = (project, changes = {}) => ({
  requestId: 'plan-1', description: 'Bola amarela', labelId: 'ball', calibrationCount: 2, batchSize: 2,
  imageIds: project.images.map(image => image.id), ...changes,
});
const activate = (project, changes = {}) => approveTask(proposeTask(emptyAssistant(), project, taskArgs(project, changes)), project);

async function proposal(project, state, requestId = 'proposal-1', boxes = [geometry]) {
  return {
    requestId, taskId: state.task.id,
    frames: await Promise.all(availableImages(state).map(async imageId => {
      const image = project.images.find(image => image.id === imageId);
      return { imageId, revision: await imageRevision(project, image), boxes: clone(boxes) };
    })),
  };
}

const decisions = (state, decision = 'accepted', boxes = undefined, note = '') => state.pending.frames.map(frame => ({
  imageId: frame.imageId, decision, boxes: clone(boxes), note,
}));

test('limpar a lista preserva calibração, recibos e progresso após serializar e continuar', () => {
  const project = fixture();
  const original = useManualExample(project, activate(project), 'image-1', 'Sem bola', true);
  const cleared = validateAssistant({ ...original, historyClearedCount: original.completed.length });
  assert.deepEqual(cleared.feedback, original.feedback);
  assert.deepEqual(cleared.task, original.task);
  assert.deepEqual(cleared.completed, original.completed);
  assert.deepEqual(cleared.receipts, original.receipts);
  assert.equal(original.historyClearedCount, undefined);
  const restored = validateAssistant(JSON.parse(JSON.stringify(cleared)));
  assert.equal(restored.historyClearedCount, 1);
  assert.equal(examplesCurrent(project, restored), true);
  const next = useManualExample(project, restored, 'image-2', 'Outra negativa', true);
  assert.equal(next.historyClearedCount, 1);
  assert.deepEqual(next.completed.slice(next.historyClearedCount), ['image-2']);
  for (const historyClearedCount of [-1, 1.5, 3, '1', null]) {
    assert.throws(() => validateAssistant({ ...cleared, historyClearedCount }), /Histórico exibido/);
  }
});

test('rascunho incompleto é durável e invalida decisão antiga até salvar novamente', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state));
  state = saveDecision(state, 'image-1', { decision: 'accepted', note: 'Ok', boxes: [geometry] });
  const draft = { decision: 'corrected', note: 'Ajustando', boxes: [{ x: '', y: '12', width: '6', height: '8' }] };
  state = saveDraft(state, 'image-1', draft);
  const restored = validateAssistant(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.pending.frames[0].draft, draft);
  assert.equal(restored.pending.frames[0].review, undefined);
  assert.throws(() => saveDraft(state, 'image-1', { ...draft, boxes: [{ x: '" onclick=oops', y: 1, width: '1', height: '1' }] }), /rascunho/);
});

test('memória importada não amplia escopo usando feedback ou imagens concluídas', () => {
  const project = fixture();
  let state = useManualExample(project, activate(project, { calibrationCount: 1 }), 'image-1', 'Sem bola', true);
  for (const mutate of [value => value.feedback[0].imageId = 'image-5', value => value.completed.push('fora')]) {
    const invalid = clone(state); mutate(invalid);
    assert.throws(() => validateAssistant(invalid), /escopo/);
  }
  assert.equal(examplesCurrent(project, state), true);
  const edited = clone(project); edited.images[0].annotations[0].x += 1;
  assert.equal(examplesCurrent(edited, state), false);
});

test('descartar consome o ID antigo e impede reinserir proposta por retry atrasado', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  const discarded = discardProposal(await submitProposal(state, project, args));
  assert.equal((await submitProposal(discarded, project, args)).pending, null);
  assert.ok((await submitProposal(discarded, project, { ...args, requestId: 'nova-tentativa' })).pending);
});

test('plano e proposta não aprovam nem modificam projeto; autorizações são operações separadas', async () => {
  const project = fixture();
  const original = clone(project);
  const empty = emptyAssistant();
  const planned = proposeTask(empty, project, taskArgs(project));
  assert.equal(planned.task, null);
  assert.deepEqual(availableImages(planned), []);
  await assert.rejects(submitProposal(planned, project, { requestId: 'x', taskId: 'x', frames: [] }));
  assert.throws(() => authorizeBatch(planned));
  assert.throws(() => approveTask(empty, project));
  const active = approveTask(planned, project);
  assert.equal(active.task.phase, 'calibration');
  assert.equal(active.plan, null);
  assert.deepEqual(availableImages(active), ['image-1']);
  const pending = await submitProposal(active, project, await proposal(project, active));
  assert.equal(pending.completed.length, 0);
  assert.equal(pending.feedback.length, 0);
  assert.equal(pending.task.phase, 'calibration');
  assert.equal(active.pending, null);
  assert.deepEqual(empty, emptyAssistant());
  assert.deepEqual(project, original);
});

test('calibração avança uma imagem por vez e cada lote exige nova autorização humana', async () => {
  let project = fixture();
  let state = activate(project);
  for (let index = 1; index <= 2; index++) {
    assert.deepEqual(availableImages(state), [`image-${index}`]);
    state = await submitProposal(state, project, await proposal(project, state, `cal-${index}`));
    assert.throws(() => authorizeBatch(state));
    const result = await reviewProposal(project, state, decisions(state));
    project = result.project;
    state = result.assistant;
    assert.equal(result.added, 1);
  }
  assert.equal(state.task.phase, 'awaiting_batch');
  assert.equal(state.task.examplesVersion, 2);
  assert.deepEqual(availableImages(state), []);
  const stale = await proposal(project, state, 'early');
  await assert.rejects(submitProposal(state, project, stale));
  state = authorizeBatch(state);
  assert.deepEqual(availableImages(state), ['image-3', 'image-4']);
  state = await submitProposal(state, project, await proposal(project, state, 'batch-1'));
  ({ project, assistant: state } = await reviewProposal(project, state, decisions(state)));
  assert.equal(state.task.phase, 'awaiting_batch');
  state = authorizeBatch(state);
  assert.deepEqual(availableImages(state), ['image-5']);
  state = await submitProposal(state, project, await proposal(project, state, 'batch-2'));
  ({ project, assistant: state } = await reviewProposal(project, state, decisions(state)));
  assert.equal(state.task.phase, 'complete');
  assert.deepEqual(state.completed, project.images.map(image => image.id));
  assert.deepEqual(availableImages(state), []);
  assert.throws(() => authorizeBatch(state));
});

test('escopo inteiro usado na calibração termina sem lote adicional', () => {
  const project = fixture(1);
  const state = activate(project, { calibrationCount: 1 });
  const next = useManualExample(project, state, 'image-1', '', true);
  assert.equal(next.task.phase, 'complete');
  assert.throws(() => authorizeBatch(next));
});

test('aceitar/corrigir preserva caixas existentes e produz IDs novos com revisão pendente', async () => {
  for (const decision of ['accepted', 'corrected']) {
    const project = fixture(2, true);
    const before = clone(project);
    let state = activate(project);
    state = await submitProposal(state, project, await proposal(project, state));
    const stateBefore = clone(state);
    const result = await reviewProposal(project, state, decisions(state, decision, [corrected]));
    const target = result.project.images[0];
    assert.deepEqual(target.annotations.slice(0, 2), project.images[0].annotations);
    assert.deepEqual(target.annotations.at(-1), {
      id: target.annotations.at(-1).id, labelId: 'ball', ...(decision === 'accepted' ? geometry : corrected),
    });
    assert.match(target.annotations.at(-1).id, /^[a-f0-9-]{36}$/);
    assert.ok(!project.images[0].annotations.some(box => box.id === target.annotations.at(-1).id));
    assert.equal(target.reviewed, false);
    assert.deepEqual(result.project.images[1], project.images[1]);
    assert.deepEqual(result.assistant.feedback[0].proposed, [geometry]);
    assert.deepEqual(result.assistant.feedback[0].final, [decision === 'accepted' ? geometry : corrected]);
    assert.equal(result.assistant.pending, null);
    assert.equal(result.assistant.receipts.length, 1);
    assert.deepEqual(project, before);
    assert.deepEqual(state, stateBefore);
    assert.deepEqual(validateProject(result.project), result.project);
  }
});

test('rejeição requer explicação e devolve feedback sem remover caixas', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state));
  await assert.rejects(reviewProposal(project, state, decisions(state, 'rejected')));
  const result = await reviewProposal(project, state, decisions(state, 'rejected', undefined, 'Isto é uma luminária.'));
  assert.deepEqual(result.project, project);
  assert.equal(result.added, 0);
  assert.equal(result.assistant.feedback[0].decision, 'rejected');
  assert.deepEqual(result.assistant.feedback[0].final, []);
  assert.equal(result.assistant.feedback[0].note, 'Isto é uma luminária.');
});

test('caixas vazias exigem ausência explícita e não contam como aceite positivo', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state, 'empty', []));
  for (const decision of ['accepted', 'corrected']) {
    await assert.rejects(reviewProposal(project, state, decisions(state, decision, [])));
  }
  const result = await reviewProposal(project, state, decisions(state, 'absent'));
  assert.equal(result.added, 0);
  assert.deepEqual(result.project, project);
  assert.deepEqual(result.assistant.feedback[0].final, []);
  assert.equal(result.assistant.feedback[0].decision, 'absent');
});

test('exemplos manuais usam somente a classe alvo e preservam projeto/revisão', () => {
  const project = fixture(3, true);
  const before = clone(project);
  const original = activate(project);
  const first = useManualExample(project, original, 'image-1', 'Bola em oclusão parcial.');
  assert.equal(first.feedback[0].decision, 'manual');
  assert.deepEqual(first.feedback[0].final, [geometry]);
  assert.deepEqual(first.feedback[0].proposed, []);
  assert.equal(first.task.examplesVersion, 1);
  assert.deepEqual(availableImages(first), ['image-2']);
  const second = useManualExample(project, first, 'image-2', 'Sem bola.', true);
  assert.equal(second.task.phase, 'awaiting_batch');
  assert.equal(second.feedback[1].decision, 'absent');
  assert.equal(second.task.examplesVersion, 2);
  assert.equal(original.completed.length, 0);
  assert.deepEqual(project, before);
});

test('exemplo manual rejeita imagem fora da vez, alvo faltante e ausência contraditória', async () => {
  const project = fixture(3, true);
  const state = activate(project);
  assert.throws(() => useManualExample(project, state, 'image-2', '', true));
  assert.throws(() => useManualExample(project, state, 'image-1', '', true));
  assert.throws(() => useManualExample(project, state, 'image-1', 'x'.repeat(2001)));
  const withoutBox = fixture();
  assert.throws(() => useManualExample(withoutBox, activate(withoutBox), 'image-1', ''));
  const pending = await submitProposal(state, project, await proposal(project, state));
  assert.throws(() => useManualExample(project, pending, 'image-1', ''));
});

test('plano valida IDs, descrição, classe, escopo único e limites inteiros', () => {
  const project = fixture();
  const invalid = [
    { requestId: '' }, { requestId: 'x'.repeat(201) }, { description: ' ' }, { description: 'x'.repeat(2001) },
    { labelId: 'missing' }, { imageIds: [] }, { imageIds: ['image-1', 'image-1'] }, { imageIds: ['missing'] },
    { imageIds: [null] }, { imageIds: Array.from({ length: 10001 }, (_, i) => String(i)) },
    { calibrationCount: 0 }, { calibrationCount: 1.5 }, { calibrationCount: 101 },
    { calibrationCount: 2, imageIds: ['image-1'] }, { batchSize: 0 }, { batchSize: 101 }, { batchSize: NaN },
  ];
  for (const patch of invalid) assert.throws(() => proposeTask(emptyAssistant(), project, taskArgs(project, patch)));
  const large = fixture(100);
  assert.doesNotThrow(() => proposeTask(emptyAssistant(), large, taskArgs(large, { calibrationCount: 100, batchSize: 100 })));
});

test('retry de plano mantém tarefa aprovada e rejeita reaproveitamento do ID com outro conteúdo', () => {
  const project = fixture();
  const args = taskArgs(project, { description: '  Bola amarela  ' });
  const planned = proposeTask(emptyAssistant(), project, args);
  assert.deepEqual(proposeTask(planned, project, args), planned);
  assert.throws(() => proposeTask(planned, project, { ...args, batchSize: 3 }));
  assert.throws(() => proposeTask(planned, project, { ...args, requestId: 'another' }));
  const active = approveTask(planned, project);
  assert.deepEqual(proposeTask(active, project, args), active);
  assert.throws(() => proposeTask(active, project, { ...args, description: 'Outro alvo' }));
});

test('retry de proposta pendente e confirmada não duplica caixa nem recibo', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  const pending = await submitProposal(state, project, args);
  assert.deepEqual(await submitProposal(pending, project, clone(args)), pending);
  await assert.rejects(submitProposal(pending, project, { ...args, message: 'Mudou' }));
  await assert.rejects(submitProposal(pending, project, { ...args, requestId: 'other' }));
  const reviewed = await reviewProposal(project, pending, decisions(pending));
  const snapshot = clone(reviewed);
  assert.deepEqual(await submitProposal(reviewed.assistant, reviewed.project, clone(args)), reviewed.assistant);
  await assert.rejects(submitProposal(reviewed.assistant, reviewed.project, { ...args, message: 'Mudou' }));
  assert.deepEqual(reviewed, snapshot);
});

test('revisão da imagem muda com geometria, fontes, classes e reviewed', async () => {
  const original = fixture();
  const revision = await imageRevision(original, original.images[0]);
  assert.match(revision, /^[a-f0-9]{64}$/);
  assert.equal(await imageRevision(clone(original), clone(original.images[0])), revision);
  for (const change of [
    p => { p.images[0].annotations[0].x++; }, p => { p.images[0].reviewed = false; },
    p => { p.images[0].width++; }, p => { p.images[0].src = 'asset:00000000-0000-0000-0000-000000000000'; },
    p => { p.labels[0].name = 'Outra bola'; },
  ]) {
    const changed = clone(original);
    change(changed);
    assert.notEqual(await imageRevision(changed, changed.images[0]), revision);
  }
});

test('rejeita revisão velha, escopo errado, frame duplicado e rodada incompleta', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  for (const patch of [
    { taskId: 'missing' }, { requestId: '' }, { frames: [] }, { frames: [...args.frames, ...args.frames] },
    { frames: [{ ...args.frames[0], imageId: 'image-2' }] },
    { frames: [{ ...args.frames[0], revision: '0'.repeat(64) }] }, { message: 'x'.repeat(2001) },
  ]) await assert.rejects(submitProposal(state, project, { ...args, ...patch }));
  const changed = clone(project);
  changed.images[0].annotations[0].x++;
  await assert.rejects(submitProposal(state, changed, args), /mudaram/);
});

test('geometria inválida é rejeitada sem clamp ou mutação; borda fracionária é aceita', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  const before = clone(project);
  for (const patch of [{ x: -1 }, { y: -1 }, { width: 0 }, { height: -1 }, { x: NaN },
    { y: Infinity }, { width: '6' }, { x: 99 }, { height: 101 }]) {
    await assert.rejects(submitProposal(state, project, { ...args, frames: [{ ...args.frames[0], boxes: [{ ...geometry, ...patch }] }] }));
  }
  for (const boxes of [null, {}, new Array(1), Array(1001).fill(geometry)]) {
    await assert.rejects(submitProposal(state, project, { ...args, frames: [{ ...args.frames[0], boxes }] }));
  }
  const next = await submitProposal(state, project, { ...args, frames: [{ ...args.frames[0], boxes: [{ x: 99.5, y: 99.5, width: .5, height: .5 }] }] });
  assert.deepEqual(next.pending.frames[0].boxes, [{ x: 99.5, y: 99.5, width: .5, height: .5 }]);
  assert.deepEqual(project, before);
});

test('limite de 1000 caixas e mensagens no teto são aceitos; proposta acima de 1 MiB é rejeitada', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state, 'many', Array(1000).fill(geometry));
  args.message = 'x'.repeat(2000);
  assert.equal((await submitProposal(state, project, args)).pending.frames[0].boxes.length, 1000);
  await assert.rejects(submitProposal(state, project, { ...args, padding: 'x'.repeat(1024 * 1024) }), /1 MiB/);
});

test('conflito durante revisão de lote impede resultado parcial e preserva as duas entradas', async () => {
  let project = fixture();
  let state = activate(project, { calibrationCount: 1 });
  state = useManualExample(project, state, 'image-1', '', true);
  state = authorizeBatch(state);
  state = await submitProposal(state, project, await proposal(project, state));
  project = clone(project);
  project.images[2].annotations[0].x++;
  const before = clone({ project, state });
  await assert.rejects(reviewProposal(project, state, decisions(state)), /Conflito/);
  assert.deepEqual({ project, state }, before);
});

test('revisão exige todas as decisões e valida correção e comentário', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state));
  for (const input of [[], [{ imageId: 'missing', decision: 'accepted', note: '' }],
    decisions(state, 'auto'), decisions(state, 'accepted', undefined, 'x'.repeat(2001)),
    decisions(state, 'corrected', [{ ...geometry, x: 99 }]), decisions(state, 'corrected', [])]) {
    await assert.rejects(reviewProposal(project, state, input));
  }
});

test('quota final por imagem não permite aplicar caixas acima das 10000 anotações', async () => {
  const project = fixture(1);
  project.images[0].annotations = Array.from({ length: 10000 }, (_, i) => ({ id: `old-${i}`, labelId: 'other', ...geometry }));
  const before = clone(project);
  let state = activate(project, { calibrationCount: 1 });
  state = await submitProposal(state, project, await proposal(project, state));
  const pending = clone(state);
  await assert.rejects(reviewProposal(project, state, decisions(state)), /10000/);
  assert.deepEqual(project, before);
  assert.deepEqual(state, pending);
});

test('quota global de 100000 anotações também impede commit e preserva projeto', async () => {
  const project = fixture(11);
  for (let image = 0; image < 10; image++) {
    project.images[image].annotations = Array.from({ length: 10000 }, (_, box) => ({
      id: `old-${image}-${box}`, labelId: 'other', ...geometry,
    }));
  }
  project.images[10].annotations = [];
  let state = activate(project, { imageIds: ['image-11'], calibrationCount: 1 });
  state = await submitProposal(state, project, await proposal(project, state));
  await assert.rejects(reviewProposal(project, state, decisions(state)), /100000/);
  assert.equal(project.images[10].annotations.length, 0);
  assert.equal(state.pending.frames[0].imageId, 'image-11');
});

test('histórico mantém 100 calibrações, 100 feedbacks de lote e 100 recibos sem perder progresso', async () => {
  let project = fixture(201);
  let state = activate(project, { calibrationCount: 100, batchSize: 1 });
  for (let image = 1; image <= 100; image++) state = useManualExample(project, state, `image-${image}`, '', true);
  for (let image = 101; image <= 201; image++) {
    state = authorizeBatch(state);
    state = await submitProposal(state, project, await proposal(project, state, `batch-${image}`, []));
    ({ project, assistant: state } = await reviewProposal(project, state, decisions(state, 'absent')));
  }
  assert.equal(state.task.phase, 'complete');
  assert.equal(state.completed.length, 201);
  assert.equal(state.feedback.length, 200);
  assert.equal(state.feedback.filter(item => item.phase === 'calibration').length, 100);
  assert.equal(state.feedback.filter(item => item.phase === 'batch').length, 100);
  assert.equal(state.feedback[100].imageId, 'image-102');
  assert.equal(state.receipts.length, 100);
});

test('cancelar revoga taskId, limpa pendência e bloqueia novas sugestões/revisão', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  const pending = await submitProposal(state, project, args);
  const cancelled = cancelTask(pending);
  assert.notEqual(cancelled.task.id, state.task.id);
  assert.equal(cancelled.task.phase, 'cancelled');
  assert.equal(cancelled.pending, null);
  assert.equal(cancelled.plan, null);
  assert.deepEqual(availableImages(cancelled), []);
  await assert.rejects(submitProposal(cancelled, project, args));
  await assert.rejects(reviewProposal(project, cancelled, decisions(pending)));
  assert.throws(() => authorizeBatch(cancelled));
  assert.ok(pending.pending);
});

test('decisão intermediária persiste sem aplicar caixa nem avançar fase', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state));
  const review = { decision: 'corrected', note: 'Ajustei a borda.', boxes: [corrected] };
  const saved = saveDecision(state, 'image-1', review);
  assert.deepEqual(saved.pending.frames[0].review, review);
  assert.equal(state.pending.frames[0].review, undefined);
  assert.equal(saved.completed.length, 0);
  assert.equal(saved.feedback.length, 0);
  assert.deepEqual(validateAssistant(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => saveDecision(saved, 'missing', review));
  assert.throws(() => saveDecision(saved, 'image-1', { ...review, decision: 'auto' }));
});

test('validação de memória rejeita versões, histórico, IDs, geometrias e limites inválidos', async () => {
  assert.deepEqual(validateAssistant(null), emptyAssistant());
  assert.deepEqual(validateAssistant(undefined), emptyAssistant());
  for (const memory of [{}, { ...emptyAssistant(), version: 2 }, { ...emptyAssistant(), feedback: null },
    { ...emptyAssistant(), completed: ['x', 'x'] }, { ...emptyAssistant(), completed: [''] },
    { ...emptyAssistant(), feedback: Array(201).fill(null) }, { ...emptyAssistant(), receipts: Array(101).fill(null) },
    { ...emptyAssistant(), receipts: [{ requestId: '', signature: 'x' }] },
    { ...emptyAssistant(), padding: 'x'.repeat(8 * 1024 * 1024) }]) assert.throws(() => validateAssistant(memory));
  const project = fixture();
  let state = activate(project);
  assert.throws(() => validateAssistant({ ...state, task: { ...state.task, phase: 'automatic' } }));
  state = await submitProposal(state, project, await proposal(project, state));
  assert.throws(() => validateAssistant({ ...state, pending: { ...state.pending, frames: [...state.pending.frames, ...state.pending.frames] } }));
});

// Estes testes assertam o comportamento necessário; permanecem vermelhos enquanto o defeito existir na raiz.
test('[regressão] revisão não pode confirmar ausência enquanto há caixas manuais da classe alvo', async () => {
  const project = fixture(2, true);
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state, 'absent-with-manual', []));
  await assert.rejects(reviewProposal(project, state, decisions(state, 'absent')));
});

test('[regressão] memória não pode restaurar pending em fase diferente da tarefa', async () => {
  const project = fixture();
  let state = activate(project);
  state = await submitProposal(state, project, await proposal(project, state));
  for (const phase of ['awaiting_batch', 'complete']) {
    assert.throws(() => validateAssistant({ ...state, task: { ...state.task, phase } }));
  }
  assert.throws(() => validateAssistant({ ...state, pending: { ...state.pending, phase: 'batch' } }));
});

test('[regressão] retry semanticamente igual deve ignorar ordem das chaves JSON', async () => {
  const project = fixture();
  const state = activate(project);
  const args = await proposal(project, state);
  const pending = await submitProposal(state, project, args);
  const reordered = { frames: args.frames, taskId: args.taskId, requestId: args.requestId };
  assert.deepEqual(await submitProposal(pending, project, reordered), pending);
});

test('[regressão] classe alvo removida impede publicar proposta nova', async () => {
  const project = fixture();
  const state = activate(project);
  project.labels = project.labels.filter(label => label.id !== 'ball');
  const args = await proposal(project, state);
  await assert.rejects(submitProposal(state, project, args));
});

test('[regressão] ausência manual exige booleano em vez de truthiness', () => {
  const project = fixture();
  const state = activate(project);
  for (const absent of ['false', 1, {}]) {
    assert.throws(() => useManualExample(project, state, 'image-1', '', absent));
  }
});
