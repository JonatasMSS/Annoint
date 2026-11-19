import { availableImages, proposeTask, approveTask, submitProposal, reviewProposal, confirmManualExample,
  authorizeBatch, cancelTask, discardProposal, imageRevision, examplesCurrent, refreshClassExamples } from './assistant.js';
import { validateProject, updateClass, removeClass } from './model.js';
import { imageBlob } from './storage.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const check = (value, message) => { if (!value) throw new Error(message); };
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const strict = (args, keys) => check(args && typeof args === 'object' && !Array.isArray(args)
  && Object.keys(args).every(key => keys.includes(key)), 'Argumentos inválidos.');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const button = (action, label) => `<button type="button" class="button" id="assistant-${action}" data-assistant="${action}">${label}</button>`;

export function createAssistantUI(editor) {
  let config = null, connectedProject = null, authorizedTask = null;
  let epoch = 0, working = false, connecting = false, error = '';
  let resetCompleted = false;
  const confirmations = new Map();
  const panel = document.createElement('dialog');
  panel.id = 'assistant-dialog'; panel.className = 'assistant-panel';
  panel.setAttribute('aria-labelledby', 'assistant-title');
  document.body.append(panel);
  const state = () => editor.get().assistant;

  function card() {
    return `<div class="agent-card-heading">Agente externo</div><p>${config ? 'Continue a conversa no seu chat.' : 'Conecte seu chat pelo MCP.'}</p>${button('open', 'Conexão MCP')}`;
  }

  function refresh() {
    const focused = document.activeElement;
    const cardElement = document.querySelector('.agent-card');
    if (cardElement) cardElement.innerHTML = card();
    if (!panel.open) { if (focused?.id === 'assistant-open') document.getElementById('assistant-open')?.focus(); return; }
    const focusId = panel.contains(focused) ? focused.id : null;
    panel.innerHTML = `<header class="assistant-heading"><div class="dialog-heading"><h2 id="assistant-title" tabindex="-1">Conexão MCP</h2>${button('close', 'Fechar')}</div><p id="assistant-status" role="status">${working ? 'Aguarde…' : config ? resetCompleted ? 'Conexão resetada. Copie a configuração e retome no chat.' : 'MCP habilitado neste projeto' : 'MCP desabilitado'}</p></header>
      <p class="field-error" role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p>
      ${!window.anointAgent ? '<p>Abra o aplicativo desktop para usar o MCP.</p>' : !config ? `<section><p>Seu agente terá acesso a nomes, classes e anotações e poderá criar e renomear classes. Autorizações de imagens, revisão e remoção são confirmadas no chat.</p>${button('connect', 'Habilitar MCP')}</section>`
        : `<section><p>Copie a configuração para seu cliente. Depois, faça tudo no chat; volte ao editor apenas para ajustes manuais.</p><textarea id="assistant-config" readonly rows="8" aria-label="Configuração MCP">${escape(JSON.stringify(config, null, 2))}</textarea><p class="assistant-meta">Esta configuração contém uma chave privada temporária. Resetar revoga a configuração anterior.</p><div class="assistant-actions">${button('copy', 'Copiar configuração')}${button('reset', 'Resetar conexão MCP')}${button('disconnect', 'Desconectar')}</div></section>`}`;
    panel.querySelector('[data-assistant=connect]')?.classList.add('primary');
    if (working) panel.querySelectorAll('button').forEach(element => { element.disabled = true; });
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  async function disconnect(closePanel = true) {
    const enabled = config || connecting;
    epoch += 1; config = null; connectedProject = null; authorizedTask = null;
    resetCompleted = false;
    confirmations.clear();
    if (!closePanel) refresh();
    if (enabled) await window.anointAgent?.disconnect();
    if (closePanel) panel.close();
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-assistant]')?.dataset.assistant;
    if (!action) return;
    if (action === 'open') { panel.show(); refresh(); panel.querySelector('h2').focus(); return; }
    if (action === 'close') { panel.close(); document.getElementById('assistant-open')?.focus(); return; }
    if (working || editor.get().busy) return;
    const focusId = document.activeElement?.id;
    void (async () => {
      working = true; error = ''; refresh();
      try {
        if (action === 'connect' || action === 'reset') {
          const projectId = editor.get().projectId;
          check(projectId, 'Abra um projeto primeiro.');
          const closing = action === 'reset' ? disconnect(false) : null;
          const startedAt = epoch;
          if (closing) await closing;
          check(epoch === startedAt && editor.get().projectId === projectId, 'Projeto alterado ou conexão encerrada. Conecte novamente.');
          connecting = true;
          const candidate = await window.anointAgent.connect();
          if (epoch !== startedAt || editor.get().projectId !== projectId) {
            await window.anointAgent.disconnect(); throw new Error('Projeto alterado. Conecte novamente.');
          }
          config = candidate; connectedProject = projectId; epoch += 1;
          resetCompleted = action === 'reset';
        } else if (action === 'disconnect') await disconnect();
        else if (action === 'copy') await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      } catch (failure) { error = failure.message; }
      finally {
        connecting = false; working = false; refresh();
        if (panel.open && focusId) (document.getElementById(focusId) || panel.querySelector('[data-assistant=connect]') || panel.querySelector('h2'))?.focus({ preventScroll: true });
      }
    })();
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); panel.close(); document.getElementById('assistant-open')?.focus(); }
  });

  function checkpoint(key, current, message, extra = false, phrase = 'CONFIRMAR') {
    for (const [id, item] of confirmations) if (item.expires < Date.now()) confirmations.delete(id);
    const existing = [...confirmations.values()].find(item => !item.result && item.key === key && item.revision === current.revision && item.extra === extra);
    if (existing) return existing.response;
    check([...confirmations.values()].filter(item => !item.result).length < 64, 'Muitas confirmações pendentes. Conclua as solicitações abertas ou aguarde sua expiração.');
    const id = crypto.randomUUID();
    const response = { status: 'confirmation_required', confirmation: { id, message, phrase, extra } };
    confirmations.set(id, { key, revision: current.revision, epoch, expires: Date.now() + 15 * 60 * 1000, extra, response });
    return response;
  }

  async function handleTool(name, input) {
    check(config && connectedProject === editor.get().projectId, 'APP_UNAVAILABLE: habilite a conexão no projeto aberto.');
    check(!working && !editor.get().busy, 'Editor ocupado. Termine o ajuste manual e tente novamente.');
    const current = editor.get(), { project, assistant: memory } = current, currentEpoch = epoch;
    const stillCurrent = () => check(epoch === currentEpoch && connectedProject === editor.get().projectId && current.revision === editor.get().revision,
      'Conflito: projeto alterado ou conexão encerrada. Leia o contexto e confirme novamente.');
    const metadata = async image => ({ id: image.id, name: image.name, width: image.width, height: image.height, reviewed: image.reviewed,
      revision: await imageRevision(project, image), annotations: image.annotations });
    if (name === 'anoint_get_context') {
      strict(input, []);
      const shared = authorizedTask === memory.task?.id;
      const { manualNote, ...task } = memory.task || {};
      const visibleIds = new Set(memory.completed.slice(memory.historyClearedCount || 0));
      const feedback = memory.feedback.map(({ exampleState, ...item }) => item);
      return { projectId: current.projectId, name: current.name, labels: project.labels, imageCount: project.images.length,
        activeImageId: current.activeImageId, activeLabelId: current.activeLabelId, coordinates: 'natural-pixels',
        memory: { ...memory, task: memory.task ? { ...task, ...(shared && manualNote ? { manualNote } : {}) } : null, feedback,
          pending: memory.pending ? { ...memory.pending, frames: memory.pending.frames.map(({ review, draft, ...frame }) => shared ? { ...frame, review, draft } : frame) } : null },
        history: feedback.filter(item => visibleIds.has(item.imageId)), examplesStale: !examplesCurrent(project, memory),
        availableImageIds: shared && examplesCurrent(project, memory) ? availableImages(memory) : [],
        instructions: 'TODA conversa, autorização e revisão acontece aqui no chat. Não mande o usuário abrir o painel do Anoint. Crie/renomeie classes se necessário; proponha plano e use control_task plan para pedir autorização. Mostre alvo, classe, imagens, calibração, lote e acesso pelo provedor/nuvem. batchSize define as imagens por rodada também na calibração (até 100). Leia todas as availableImageIds e envie suas caixas juntas em submit_proposal. Mostre as prévias para o usuário avaliar quais ficaram boas ou ruins e reúna decisões por imagem numa única chamada review, com uma confirmação para o conjunto, sem exigir uma por imagem. Confirmações nativas são apresentadas pelo cliente; se receber confirmation_required, pergunte ao usuário e só repita com confirmation após resposta explícita. Nunca invente aprovação. Use get_image view=review para mostrar as caixas no chat antes de avaliar. review aplica somente as decisões confirmadas; lote seguinte exige control_task batch separado. Este é o correto após edição manual: leia a imagem atual e confirme manual_example, ou review manual se houver proposta pendente. Não duplique caixas manuais. Ausência é explícita; rejeição não prova ausência. Retome tarefas e rascunhos salvos por control_task resume. Remover classe exige duas confirmações, a segunda com a frase exata. Calibração usa contexto, não treina pesos.' };
    }
    if (name === 'anoint_list_images') {
      strict(input, ['offset', 'limit']);
      const offset = input.offset ?? 0, limit = input.limit ?? 20;
      check(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Paginação inválida.');
      const images = await Promise.all(project.images.slice(offset, offset + limit).map(metadata));
      stillCurrent(); return { images, total: project.images.length, nextOffset: offset + images.length < project.images.length ? offset + images.length : null };
    }
    if (name === 'anoint_get_image') {
      strict(input, ['imageId', 'view']);
      check(input.view === undefined || ['source', 'review'].includes(input.view), 'Visualização inválida.');
      check(authorizedTask === memory.task?.id, 'Autorize ou retome o escopo pelo chat.');
      const allowed = new Set([...memory.feedback.map(item => item.imageId), ...(memory.pending?.frames || []).map(item => item.imageId),
        ...(examplesCurrent(project, memory) ? availableImages(memory) : [])]);
      check(allowed.has(input.imageId), 'Imagem fora do escopo autorizado desta rodada.');
      const image = project.images.find(item => item.id === input.imageId);
      check(image && project.labels.some(label => label.id === memory.task.labelId), 'Classe ou imagem removida. Proponha outra tarefa.');
      const proposal = memory.pending?.frames.find(frame => frame.imageId === image.id);
      if (input.view === 'review') check(proposal, 'Esta imagem não tem sugestões pendentes.');
      const blob = await imageBlob(image.src);
      check(blob.type !== 'image/gif' && !/\.gif$/i.test(image.name), 'GIF não é suportado; importe um frame estático.');
      const url = URL.createObjectURL(blob);
      try {
        const decoded = new Image(); decoded.src = url; await decoded.decode();
        check(decoded.naturalWidth === image.width && decoded.naturalHeight === image.height, 'Dimensões da fonte mudaram. Importe a imagem novamente.');
        const ratio = Math.min(1, 4096 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
        if (input.view === 'review') {
          const draw = (boxes, color, dashed, prefix) => boxes.forEach((box, index) => {
            const x = box.x * canvas.width / image.width, y = box.y * canvas.height / image.height;
            context.strokeStyle = color; context.lineWidth = 2; context.setLineDash(dashed ? [7, 5] : []);
            context.strokeRect(x, y, box.width * canvas.width / image.width, box.height * canvas.height / image.height);
            context.font = '14px sans-serif'; context.fillStyle = color; context.fillText(`${prefix} ${index + 1}`, x + 2, Math.max(14, y - 3));
          });
          draw(image.annotations, '#166534', false, 'Anotação'); draw(proposal.boxes, '#b21acb', true, 'Sugestão');
        }
        const data = canvas.toDataURL('image/jpeg', .9).split(',')[1];
        check(data.length <= 12 * 1024 * 1024, 'Imagem muito grande para o MCP; use um frame menor.');
        const info = { ...await metadata(image), sentWidth: canvas.width, sentHeight: canvas.height, coordinates: 'natural-pixels', view: input.view || 'source',
          proposalId: proposal ? memory.pending.requestId : null, scaleX: image.width / canvas.width, scaleY: image.height / canvas.height,
          note: 'Sugestões pontilhadas são provisórias; anotações verdes são finais. Converta medidas pelas escalas. Objetos pequenos podem sumir na redução; não assuma ausência.' };
        stillCurrent(); return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: JSON.stringify(info) }], structuredContent: info };
      } finally { URL.revokeObjectURL(url); }
    }
    const schemas = {
      anoint_propose_task: ['requestId', 'description', 'labelId', 'calibrationCount', 'batchSize', 'imageIds'],
      anoint_submit_proposal: ['requestId', 'taskId', 'frames', 'message'],
      anoint_control_task: ['action', 'taskId', 'requestId', 'confirmation'],
      anoint_review: ['taskId', 'requestId', 'decisions', 'confirmation'],
      anoint_manual_example: ['taskId', 'imageId', 'revision', 'note', 'absent', 'confirmation'],
      anoint_create_class: ['id', 'name', 'color'], anoint_update_class: ['id', 'name'],
      anoint_remove_class: ['id', 'replacementId', 'confirmation'],
    };
    check(schemas[name], 'Ferramenta não permitida.'); strict(input, schemas[name]);
    const { confirmation, ...args } = input;
    const key = canonical([name, args]);
    let ticket;
    if (confirmation !== undefined) {
      strict(confirmation, ['id', 'answer']);
      ticket = confirmations.get(confirmation.id);
      check(ticket && ticket.epoch === epoch && ticket.expires >= Date.now() && ticket.key === key, 'Confirmação inválida, expirada ou de outra ação.');
      check(confirmation.answer === ticket.response.confirmation.phrase, 'A confirmação precisa corresponder à frase solicitada.');
      if (ticket.result) return ticket.result;
      check(ticket.revision === current.revision, 'Conflito: houve alteração depois do pedido. Leia o contexto e peça nova confirmação.');
    }
    let candidate = { project, assistant: memory }, message = '', undo = true, authorize = false;
    const taskMatches = () => check(text(args.taskId) && args.taskId === memory.task?.id, 'Tarefa mudou. Leia o contexto novamente.');
    const scopeText = ids => ids.slice(0, 12).map(id => project.images.find(image => image.id === id)?.name || id).join(', ')
      + (ids.length > 12 ? ` e mais ${ids.length - 12} (lista completa no contexto)` : '');
    if (name === 'anoint_propose_task') { candidate.assistant = proposeTask(memory, project, args); undo = false; }
    else if (name === 'anoint_submit_proposal') {
      taskMatches(); check(authorizedTask === memory.task.id && examplesCurrent(project, memory), 'Retome o escopo ou atualize os exemplos pelo chat.');
      check(Array.isArray(args.frames), 'Imagens inválidas.');
      for (const frame of args.frames) { strict(frame, ['imageId', 'revision', 'boxes']); check(Array.isArray(frame.boxes), 'Caixas inválidas.'); for (const box of frame.boxes) strict(box, ['x', 'y', 'width', 'height']); }
      candidate.assistant = await submitProposal(memory, project, args); undo = false;
    } else if (name === 'anoint_control_task') {
      check(['plan', 'batch', 'resume', 'cancel', 'discard', 'clear_history'].includes(args.action), 'Ação de tarefa inválida.');
      if (args.action === 'plan') {
        check(text(args.requestId) && memory.plan?.requestId === args.requestId, 'Plano mudou. Leia o contexto.');
        candidate.assistant = approveTask(memory, project); authorize = true;
        message = `Autorizar plano no projeto ${current.name}: ${memory.plan.description}. Classe ${project.labels.find(label => label.id === memory.plan.labelId)?.name}; calibração ${memory.plan.calibrationCount} imagens; rodadas de até ${memory.plan.batchSize} imagens na calibração e nos lotes seguintes. Imagens: ${scopeText(memory.plan.imageIds)}. Poderão ser enviadas ao cliente/provedor do agente, inclusive na nuvem.${memory.task ? ' Substitui a tarefa anterior e seus exemplos.' : ''}`;
      } else if (args.action === 'discard' && memory.plan && args.requestId === memory.plan.requestId) {
        candidate.assistant = { ...memory, plan: null };
      } else {
        taskMatches();
        if (args.action === 'batch') {
          check(authorizedTask === memory.task.id && examplesCurrent(project, memory), 'Retome o escopo ou atualize os exemplos.');
          candidate.assistant = authorizeBatch(memory);
          message = `Gerar sugestões para o próximo lote: ${scopeText(availableImages(candidate.assistant))}. Esta autorização não aplica caixas.`;
        } else if (args.action === 'resume') {
          check(project.labels.some(label => label.id === memory.task.labelId) && memory.task.imageIds.every(id => project.images.some(image => image.id === id))
            && memory.task.phase !== 'cancelled', 'Escopo removido ou tarefa cancelada. Proponha um novo plano.');
          candidate.assistant = structuredClone(memory); candidate.assistant.task.id = crypto.randomUUID();
          if (candidate.assistant.pending) candidate.assistant.pending.taskId = candidate.assistant.task.id;
          authorize = true;
          message = `Retomar ${current.name}: ${memory.task.description}. Compartilhar escopo ${scopeText(memory.task.imageIds)}, exemplos e rascunhos/decisões salvos com o cliente/provedor, inclusive na nuvem?`;
        } else if (args.action === 'cancel') candidate.assistant = cancelTask(memory);
        else if (args.action === 'discard') {
          check(text(args.requestId) && args.requestId === memory.pending?.requestId, 'A proposta mudou. Leia o lote atual antes de descartar.');
          candidate.assistant = discardProposal(memory);
        }
        else candidate.assistant = { ...memory, historyClearedCount: memory.completed.length };
      }
    } else if (name === 'anoint_review') {
      taskMatches(); check(authorizedTask === memory.task.id && args.requestId === memory.pending?.requestId, 'Retome a tarefa e leia a proposta atual.');
      check(examplesCurrent(project, memory), 'Um exemplo anterior foi alterado. Confirme o exemplo manual atual antes de revisar novas sugestões.');
      check(Array.isArray(args.decisions), 'Decisões inválidas.');
      for (const decision of args.decisions) {
        strict(decision, ['imageId', 'decision', 'note', 'boxes', 'revision']);
        if (decision.boxes !== undefined) { check(Array.isArray(decision.boxes), 'Caixas inválidas.'); for (const box of decision.boxes) strict(box, ['x', 'y', 'width', 'height']); }
      }
      candidate = await reviewProposal(project, memory, args.decisions.map(decision => ({ note: '', ...decision })));
      message = `Confirmar revisão do lote ${args.requestId}, ${args.decisions.length} imagem(ns): ${args.decisions.slice(0, 12).map(item => `${scopeText([item.imageId])}: ${item.decision}`).join('; ')}. Adicionar ${candidate.added} caixa(s), preservar existentes e salvar o feedback?`;
    } else if (name === 'anoint_manual_example') {
      taskMatches(); check(authorizedTask === memory.task.id, 'Retome a tarefa pelo chat.');
      candidate.assistant = await confirmManualExample(project, memory, args.imageId, args.revision, args.note ?? '', args.absent ?? false);
      message = `Registrar ${scopeText([args.imageId])} como ${args.absent ? 'ausência confirmada' : 'exemplo correto com as caixas manuais atuais'}, sem duplicar anotações? Atualizar exemplo anterior invalida propostas pendentes.`;
    } else if (name === 'anoint_create_class' || name === 'anoint_update_class') {
      check(text(args.id) && text(args.name), 'ID ou nome de classe inválido.');
      const nameValue = args.name.trim(), existing = project.labels.find(label => label.id === args.id);
      check(!project.labels.some(label => label.id !== args.id && label.name.toLocaleLowerCase() === nameValue.toLocaleLowerCase()), 'Já existe uma classe com esse nome.');
      if (name === 'anoint_create_class') {
        check(!existing || (existing.name === nameValue && existing.color === args.color), 'ID de classe já usado.');
        check(existing || project.labels.length < 100, 'O projeto suporta até 100 classes.');
        candidate.project = existing ? project : validateProject({ ...project, labels: [...project.labels, { id: args.id, name: nameValue, color: args.color }] });
      } else candidate.project = updateClass(project, args.id, { name: nameValue });
      if (canonical(candidate.project.labels) === canonical(project.labels)) return { status: 'unchanged', labels: project.labels, taskId: memory.task?.id || null };
      candidate.assistant = await refreshClassExamples(project, candidate.project, memory);
    } else {
      candidate.project = removeClass(project, args.id, args.replacementId);
      const label = project.labels.find(label => label.id === args.id), replacement = project.labels.find(label => label.id === args.replacementId);
      const affected = project.images.filter(image => image.annotations.some(box => box.labelId === args.id));
      const boxes = affected.reduce((sum, image) => sum + image.annotations.filter(box => box.labelId === args.id).length, 0);
      candidate.assistant = memory.task?.labelId === args.id ? cancelTask(memory) : memory;
      message = `Remover classe ${label.name}: ${boxes} caixa(s) em ${affected.length} imagem(ns). ${replacement ? `Transferir caixas para ${replacement.name}, preservando geometria.` : 'Classe sem caixas.'}${memory.task?.labelId === args.id ? ' A tarefa desta classe será cancelada.' : ''} Há confirmação adicional antes de remover.`;
    }
    stillCurrent();
    if (message && !ticket) return checkpoint(key, current, message);
    if (name === 'anoint_remove_class' && ticket && !ticket.extra) {
      const label = project.labels.find(label => label.id === args.id);
      const result = checkpoint(key, current, `${message} Confirmação extra: digite REMOVER ${label.name}.`, true, `REMOVER ${label.name}`);
      ticket.result = result; return result;
    }
    working = true;
    try {
      await editor.commit(() => { stillCurrent(); return candidate; }, undo);
      if (authorize) authorizedTask = state().task.id;
      const result = { status: 'saved', projectId: connectedProject, taskId: state().task?.id || null,
        phase: state().task?.phase || null, pendingProposalId: state().pending?.requestId || null,
        added: candidate.added || 0, labels: editor.get().project.labels,
        next: state().pending ? 'Mostre get_image view=review no chat, peça as decisões e chame review. Não volte ao painel.' : 'Consulte o contexto e continue a conversa no chat.' };
      if (ticket) ticket.result = result;
      return result;
    } finally { working = false; refresh(); editor.overlay(); }
  }
  window.anointAgent?.onRequest(handleTool);
  return { card, refresh, disconnect, handleTool, flush: async () => {},
    overlay(image, scale) {
      const boxes = state().pending?.frames.find(frame => frame.imageId === image.id)?.boxes || [];
      return boxes.map((box, index) => `<g class="assistant-suggestion" aria-label="Sugestão ${index + 1}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/><text x="${box.x + 3 / scale}" y="${box.y + 15 / scale}" font-size="${11 / scale}">Sugestão ${index + 1}</text></g>`).join('');
    },
  };
}
