import { validateProject } from './model.js';

const check = (value, message) => { if (!value) throw new Error(message); };
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = value => text(value, 200);
const count = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;
const copy = value => structuredClone(value);
const signature = value => JSON.stringify(value);
const exampleState = (project, image) => signature([project.labels, image?.width, image?.height, image?.annotations]);
export const examplesCurrent = (project, state) => state.feedback.filter(item => item.phase === 'calibration')
  .every(item => item.exampleState === exampleState(project, project.images.find(image => image.id === item.imageId)));
const same = (a, b) => signature(a) === signature(b);
const geometries = boxes => boxes.map(({ x, y, width, height }) => ({ x, y, width, height }));

function validBoxes(boxes) {
  check(Array.isArray(boxes) && boxes.length <= 1000, 'Máximo de 1000 sugestões por imagem.');
  for (const box of boxes) check(box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0, 'Coordenadas de sugestão inválidas.');
}

function within(boxes, image) {
  validBoxes(boxes);
  for (const box of boxes) check(box.x <= image.width - box.width && box.y <= image.height - box.height, 'Sugestão fora dos limites da imagem.');
}

function plan(value) {
  check(value && id(value.requestId) && text(value.description) && id(value.labelId), 'Plano de anotação inválido.');
  check(count(value.calibrationCount, 100) && count(value.batchSize, 100), 'Calibração e lote devem ter de 1 a 100 imagens.');
  check(Array.isArray(value.imageIds) && count(value.imageIds.length, 10000)
    && value.imageIds.every(id) && new Set(value.imageIds).size === value.imageIds.length, 'Escopo de imagens inválido ou duplicado.');
  check(value.calibrationCount <= value.imageIds.length, 'A calibração excede o escopo de imagens.');
  return { requestId: value.requestId, description: value.description.trim(), labelId: value.labelId,
    calibrationCount: value.calibrationCount, batchSize: value.batchSize, imageIds: [...value.imageIds] };
}

export const emptyAssistant = () => ({ version: 1, task: null, plan: null, pending: null, feedback: [], completed: [], receipts: [] });

export function validateAssistant(value) {
  if (value === undefined || value === null) return emptyAssistant();
  check(value && value.version === 1 && JSON.stringify(value).length <= 8 * 1024 * 1024, 'Memória do agente inválida ou acima de 8 MiB.');
  if (value.plan) plan(value.plan);
  if (value.task) {
    plan(value.task);
    check(id(value.task.id) && ['calibration', 'awaiting_batch', 'batch', 'complete', 'cancelled'].includes(value.task.phase)
      && Number.isInteger(value.task.examplesVersion) && value.task.examplesVersion >= 0, 'Etapa do agente inválida.');
    check(value.task.manualNote === undefined || (typeof value.task.manualNote === 'string' && value.task.manualNote.length <= 2000), 'Comentário manual inválido.');
  }
  for (const key of ['feedback', 'completed', 'receipts']) check(Array.isArray(value[key]), 'Memória do agente incompleta.');
  check(value.completed.length <= 10000 && value.completed.every(id) && new Set(value.completed).size === value.completed.length, 'Revisões de imagens inválidas.');
  check(value.historyClearedCount === undefined || (Number.isInteger(value.historyClearedCount)
    && value.historyClearedCount >= 0 && value.historyClearedCount <= value.completed.length), 'Histórico exibido inválido.');
  check(value.task || (!value.feedback.length && !value.completed.length && !value.receipts.length && !value.pending), 'Histórico sem tarefa.');
  if (value.task) check(value.completed.every(id => value.task.imageIds.includes(id)), 'Imagem revisada fora do escopo da tarefa.');
  check(value.feedback.length <= 200 && value.receipts.length <= 100, 'Histórico do agente acima do limite.');
  for (const item of value.receipts) check(item && id(item.requestId) && text(item.signature, 1024 * 1024), 'Recibo de proposta inválido.');
  for (const item of value.feedback) {
    check(item && id(item.imageId) && ['accepted', 'corrected', 'rejected', 'absent', 'manual'].includes(item.decision)
      && ['calibration', 'batch'].includes(item.phase) && typeof item.note === 'string' && item.note.length <= 2000, 'Feedback inválido.');
    validBoxes(item.proposed);
    validBoxes(item.final);
    const scope = item.phase === 'calibration' ? value.task.imageIds.slice(0, value.task.calibrationCount) : value.task.imageIds.slice(value.task.calibrationCount);
    check(scope.includes(item.imageId) && value.completed.includes(item.imageId), 'Feedback fora do escopo autorizado.');
    check(item.exampleState === undefined || (typeof item.exampleState === 'string' && item.exampleState.length <= 4 * 1024 * 1024), 'Estado do exemplo inválido.');
  }
  if (value.pending) {
    const pending = value.pending;
    check(value.task && ['calibration', 'batch'].includes(value.task.phase) && pending.phase === value.task.phase
      && pending.taskId === value.task.id && id(pending.requestId) && /^[a-f0-9]{64}$/.test(pending.signature)
      && ['calibration', 'batch'].includes(pending.phase) && typeof pending.message === 'string' && pending.message.length <= 2000, 'Proposta pendente inválida.');
    check(Array.isArray(pending.frames) && count(pending.frames.length, 100), 'Lote pendente inválido.');
    const ids = new Set();
    for (const frame of pending.frames) {
      check(frame && id(frame.imageId) && /^[a-f0-9]{64}$/.test(frame.revision) && !ids.has(frame.imageId), 'Imagem de proposta inválida.');
      ids.add(frame.imageId);
      validBoxes(frame.boxes);
      if (frame.review) {
        check(['accepted', 'corrected', 'rejected', 'absent'].includes(frame.review.decision)
          && typeof frame.review.note === 'string' && frame.review.note.length <= 2000, 'Decisão de revisão inválida.');
        validBoxes(frame.review.boxes);
      }
      if (frame.draft) {
        check(['', 'accepted', 'corrected', 'rejected', 'absent'].includes(frame.draft.decision)
          && typeof frame.draft.note === 'string' && frame.draft.note.length <= 2000
          && Array.isArray(frame.draft.boxes) && frame.draft.boxes.length <= 1000, 'Rascunho de revisão inválido.');
        for (const box of frame.draft.boxes) for (const key of ['x', 'y', 'width', 'height']) check(typeof box[key] === 'string' && box[key].length <= 64, 'Medida de rascunho inválida.');
        check(!frame.review, 'Salve novamente a decisão após alterar o rascunho.');
      }
    }
    const allowed = availableImages(value);
    check(pending.frames.length === allowed.length && pending.frames.every(frame => allowed.includes(frame.imageId)), 'Proposta fora do escopo da rodada.');
  }
  return copy({ version: 1, task: value.task || null, plan: value.plan || null, pending: value.pending || null,
    feedback: value.feedback, completed: value.completed, receipts: value.receipts,
    ...(value.historyClearedCount === undefined ? {} : { historyClearedCount: value.historyClearedCount }) });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(signature(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const imageRevision = (project, image) => digest([project.labels, image.src, image.width, image.height, image.annotations, image.reviewed]);

export function availableImages(state) {
  const task = state.task;
  if (!task || !['calibration', 'batch'].includes(task.phase)) return [];
  const scope = task.phase === 'calibration' ? task.imageIds.slice(0, task.calibrationCount) : task.imageIds.slice(task.calibrationCount);
  return scope.filter(imageId => !state.completed.includes(imageId)).slice(0, task.phase === 'calibration' ? 1 : task.batchSize);
}

export function proposeTask(state, project, args) {
  const candidate = plan(args);
  check(project.labels.some(label => label.id === candidate.labelId), 'Crie ou escolha uma classe existente antes de iniciar.');
  const ids = new Set(project.images.map(image => image.id));
  check(candidate.imageIds.every(imageId => ids.has(imageId)), 'O escopo contém uma imagem que não existe neste projeto.');
  const next = validateAssistant(state);
  if (next.task?.requestId === candidate.requestId) {
    check(same(plan(next.task), candidate), 'ID de plano já usado com outro conteúdo.');
    return next;
  }
  if (next.plan?.requestId === candidate.requestId) check(same(next.plan, candidate), 'ID de plano já usado com outro conteúdo.');
  check(!next.plan || next.plan.requestId === candidate.requestId, 'Há um plano aguardando revisão do usuário.');
  next.plan = candidate;
  return next;
}

export function approveTask(state, project) {
  check(state.plan, 'Não há plano para autorizar.');
  const candidate = proposeTask(emptyAssistant(), project, state.plan).plan;
  return { ...emptyAssistant(), task: { ...candidate, id: crypto.randomUUID(), phase: 'calibration', examplesVersion: 0 } };
}

export async function submitProposal(state, project, args) {
  const next = validateAssistant(state);
  check(next.task && args.taskId === next.task.id, 'Tarefa inválida ou cancelada. Consulte o contexto novamente.');
  check(id(args.requestId), 'ID de proposta inválido.');
  check(project.labels.some(label => label.id === next.task.labelId), 'A classe da tarefa foi removida.');
  check(signature(args).length <= 1024 * 1024, 'Proposta acima de 1 MiB.');
  check(Array.isArray(args.frames), 'Imagens da proposta inválidas.');
  for (const frame of args.frames) validBoxes(frame?.boxes);
  const proposalSignature = await digest({ requestId: args.requestId, taskId: args.taskId,
    frames: args.frames.map(frame => ({ imageId: frame.imageId, revision: frame.revision, boxes: geometries(frame.boxes) })), message: args.message || '' });
  const receipt = next.receipts.find(item => item.requestId === args.requestId);
  if (receipt) { check(receipt.signature === proposalSignature, 'ID de proposta já usado com outro conteúdo.'); return next; }
  if (next.pending) {
    check(next.pending.requestId === args.requestId && next.pending.signature === proposalSignature, 'Já existe um lote aguardando revisão.');
    return next;
  }
  const allowed = availableImages(next);
  check(allowed.length && Array.isArray(args.frames) && args.frames.length === allowed.length
    && new Set(args.frames.map(frame => frame.imageId)).size === allowed.length
    && args.frames.every(frame => allowed.includes(frame.imageId)), 'Envie exatamente as imagens liberadas nesta rodada.');
  check(args.message === undefined || (typeof args.message === 'string' && args.message.length <= 2000), 'Mensagem inválida.');
  const frames = [];
  for (const frame of args.frames) {
    const image = project.images.find(item => item.id === frame.imageId);
    check(image && frame.revision === await imageRevision(project, image), 'A imagem ou suas anotações mudaram. Leia novamente antes de sugerir.');
    within(frame.boxes, image);
    frames.push({ imageId: frame.imageId, revision: frame.revision, boxes: geometries(frame.boxes) });
  }
  next.pending = { requestId: args.requestId, taskId: args.taskId, phase: next.task.phase, message: args.message || '', signature: proposalSignature, frames };
  return validateAssistant(next);
}

function recordFeedback(state, items) {
  const next = copy(state);
  next.feedback.push(...items);
  // shortcut: preserva toda a calibração e os 100 feedbacks de lote mais recentes; ampliar para um arquivo de treino dedicado quando necessário.
  next.feedback = [...next.feedback.filter(item => item.phase === 'calibration'), ...next.feedback.filter(item => item.phase === 'batch').slice(-100)];
  next.completed = [...new Set([...next.completed, ...items.map(item => item.imageId)])];
  next.task.examplesVersion += 1;
  delete next.task.manualNote;
  if (!availableImages(next).length) next.task.phase = next.task.phase === 'calibration' && next.completed.length < next.task.imageIds.length ? 'awaiting_batch' : 'complete';
  else if (next.task.phase === 'batch') next.task.phase = 'awaiting_batch';
  return next;
}

export async function reviewProposal(project, state, decisions) {
  const nextProject = validateProject(project);
  const memory = validateAssistant(state);
  const pending = memory.pending;
  check(pending && pending.taskId === memory.task?.id && ['calibration', 'batch'].includes(memory.task.phase)
    && pending.phase === memory.task.phase, 'Não há proposta ativa para revisar.');
  check(Array.isArray(decisions) && decisions.length === pending.frames.length, 'Revise cada imagem do lote.');
  const feedback = [];
  let added = 0;
  for (const frame of pending.frames) {
    const image = nextProject.images.find(item => item.id === frame.imageId);
    const decision = decisions.find(item => item.imageId === frame.imageId);
    check(image && frame.revision === await imageRevision(project, image), 'Conflito: houve edição manual. Descarte o lote e peça uma nova proposta.');
    check(decision && ['accepted', 'corrected', 'rejected', 'absent'].includes(decision.decision), 'Escolha aceitar, corrigir, rejeitar ou confirmar ausência em cada imagem.');
    check(typeof decision.note === 'string' && decision.note.length <= 2000, 'Comentário de revisão inválido.');
    const final = decision.decision === 'accepted' ? frame.boxes : decision.decision === 'corrected' ? geometries(decision.boxes) : [];
    within(final, image);
    check(!['accepted', 'corrected'].includes(decision.decision) || final.length > 0, 'Uma proposta vazia exige confirmar explicitamente que não há alvo.');
    check(decision.decision !== 'rejected' || decision.note.trim(), 'Explique o erro para o agente ao rejeitar.');
    check(decision.decision !== 'absent' || !image.annotations.some(box => box.labelId === memory.task.labelId), 'Há caixas desta classe; remova-as antes de confirmar ausência.');
    for (const box of final) image.annotations.push({ id: crypto.randomUUID(), labelId: memory.task.labelId, ...box });
    if (final.length) image.reviewed = false;
    added += final.length;
    feedback.push({ imageId: image.id, phase: pending.phase, decision: decision.decision, note: decision.note,
      proposed: copy(frame.boxes), final: copy(final), exampleState: exampleState(nextProject, image) });
  }
  let next = recordFeedback(memory, feedback);
  next.receipts.push({ requestId: pending.requestId, signature: pending.signature });
  next.receipts = next.receipts.slice(-100);
  next.pending = null;
  return { project: validateProject(nextProject), assistant: validateAssistant(next), added };
}

export function useManualExample(project, state, imageId, note, absent = false) {
  check(typeof absent === 'boolean', 'A confirmação de ausência deve ser booleana.');
  const memory = validateAssistant(state);
  check(memory.task?.phase === 'calibration' && !memory.pending && availableImages(memory).includes(imageId), 'Escolha a próxima imagem de calibração, sem proposta pendente.');
  check(typeof note === 'string' && note.length <= 2000, 'Comentário inválido.');
  const image = project.images.find(item => item.id === imageId);
  check(image, 'Imagem não encontrada.');
  const boxes = geometries(image.annotations.filter(box => box.labelId === memory.task.labelId));
  check(boxes.length || absent, 'Marque o alvo manualmente ou confirme que ele não aparece nesta imagem.');
  check(!boxes.length || !absent, 'Há caixas desta classe; remova-as antes de confirmar ausência.');
  return validateAssistant(recordFeedback(memory, [{ imageId, phase: 'calibration', decision: absent ? 'absent' : 'manual', note, proposed: [], final: boxes, exampleState: exampleState(project, image) }]));
}

export function authorizeBatch(state) {
  const next = validateAssistant(state);
  check(next.task?.phase === 'awaiting_batch' && !next.pending, 'O lote ainda não pode ser autorizado.');
  next.task.phase = 'batch';
  return next;
}

export function cancelTask(state) {
  const next = validateAssistant(state);
  if (next.task) { next.task.phase = 'cancelled'; next.task.id = crypto.randomUUID(); }
  next.plan = null;
  next.pending = null;
  return next;
}

export function saveDecision(state, imageId, decision) {
  const next = validateAssistant(state);
  const frame = next.pending?.frames.find(item => item.imageId === imageId);
  check(frame, 'Proposta não encontrada.');
  frame.review = copy(decision);
  delete frame.draft;
  return validateAssistant(next);
}

export function saveDraft(state, imageId, draft) {
  const next = validateAssistant(state);
  const frame = next.pending?.frames.find(item => item.imageId === imageId);
  check(frame, 'Proposta não encontrada.');
  frame.draft = copy(draft);
  delete frame.review;
  return validateAssistant(next);
}

export function discardProposal(state) {
  const next = validateAssistant(state);
  check(next.pending, 'Não há proposta para descartar.');
  next.receipts.push({ requestId: next.pending.requestId, signature: next.pending.signature });
  next.receipts = next.receipts.slice(-100);
  next.pending = null;
  return next;
}
