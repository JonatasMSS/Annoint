import { availableImages, proposeTask, approveTask, submitProposal, reviewProposal,
  useManualExample, authorizeBatch, cancelTask, saveDecision, saveDraft, discardProposal, imageRevision, examplesCurrent } from './assistant.js';
import { imageBlob } from './storage.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const check = (value, message) => { if (!value) throw new Error(message); };
const phases = { calibration: 'Calibração', awaiting_batch: 'Próximo lote', batch: 'Aguardando o agente', complete: 'Escopo concluído', cancelled: 'Tarefa cancelada' };
const decisions = { accepted: 'Aceita', corrected: 'Corrigida', rejected: 'Rejeitada', absent: 'Alvo ausente', manual: 'Exemplo manual' };
const button = (action, label, extra = '') => `<button type="button" class="button" ${action === 'remove-box' ? '' : `id="assistant-${action}"`} data-assistant="${action}" ${extra}>${label}</button>`;
const strict = (args, keys) => check(args && typeof args === 'object' && !Array.isArray(args)
  && Object.keys(args).every(key => keys.includes(key)), 'Argumentos inválidos.');

export function createAssistantUI(editor) {
  let config = null;
  let connectedProject = null;
  let authorizedTask = null;
  let epoch = 0;
  let working = false;
  let connecting = false;
  let error = '';
  let reviewImage = null;
  const drafts = new Map();
  let manualDraft = null;
  let draftTimer;
  let draftChain = Promise.resolve();
  const panel = document.createElement('dialog');
  panel.id = 'assistant-dialog';
  panel.className = 'assistant-panel';
  panel.setAttribute('aria-labelledby', 'assistant-title');
  document.body.append(panel);
  const state = () => editor.get().assistant;
  const frame = () => state().pending?.frames.find(item => item.imageId === reviewImage) || state().pending?.frames[0];
  const store = (transform, undo = false) => editor.commit(transform, undo);
  const save = transform => store((project, memory) => ({ project, assistant: transform(memory, project) }));

  function card() {
    const memory = state();
    return `<div class="agent-card-heading">Assistente MCP</div><p>${memory.pending ? 'Sugestões prontas para revisar.' : memory.plan ? 'Plano aguardando sua autorização.' : config ? phases[memory.task?.phase] || 'Conexão habilitada para seu agente.' : 'Conecte seu agente e ensine o que procurar.'}</p>${button('open', 'Abrir assistente')}`;
  }

  function refresh(fallbackFocus = null) {
    const focused = document.activeElement === document.body && fallbackFocus ? fallbackFocus : document.activeElement;
    const selection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const cardElement = document.querySelector('.agent-card');
    if (cardElement) cardElement.innerHTML = card();
    if (!panel.open) { if (focused?.id === 'assistant-open') document.getElementById('assistant-open')?.focus(); return; }
    const focusId = panel.contains(focused) || focused === fallbackFocus ? focused?.id : null;
    const scroll = panel.scrollTop;
    const detailsState = new Map([...panel.querySelectorAll('details[id]')].map(element => [element.id, element.open]));
    const { project } = editor.get();
    const memory = state();
    const task = memory.task;
    const pending = memory.pending;
    const stale = !examplesCurrent(project, memory);
    const activeFrame = frame();
    const currentDraft = activeFrame && (drafts.get(activeFrame.imageId)?.value || activeFrame.draft || activeFrame.review);
    const image = project.images.find(item => item.id === activeFrame?.imageId);
    const visibleIds = new Set(memory.completed.slice(memory.historyClearedCount || 0));
    const history = memory.feedback.filter(item => visibleIds.has(item.imageId));
    panel.innerHTML = `<header class="assistant-heading"><div class="dialog-heading"><h2 id="assistant-title" tabindex="-1">Assistente</h2>${button('close', 'Fechar')}</div>
      <p id="assistant-status" role="status" aria-live="polite">${working ? 'Salvando…' : config ? 'MCP habilitado neste projeto' : 'MCP desabilitado'}</p></header>
      <p class="field-error" role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p>
      ${!window.anointAgent ? '<p>Abra o aplicativo desktop para usar o MCP.</p>' : !config ? `<section class="assistant-connect"><h3>Conecte seu agente</h3><p>Ele terá acesso a nomes, classes e anotações. Você autoriza as imagens antes de compartilhá-las.</p>${button('connect', 'Habilitar MCP')}</section>` : !task && !memory.plan ? '<section><h3>Pronto para começar</h3><p>Peça ao seu agente, no chat externo, para criar um plano.</p></section>' : ''}
      ${memory.plan ? `<section><h3>Autorizar plano</h3><p class="assistant-target">${escape(memory.plan.description)}</p><div class="assistant-facts"><span>${escape(project.labels.find(item => item.id === memory.plan.labelId)?.name || 'Classe removida')}</span><span>${memory.plan.calibrationCount} de calibração</span><span>Lotes de ${memory.plan.batchSize}</span></div><details id="assistant-plan-scope"><summary>${memory.plan.imageIds.length} imagens no escopo</summary><ol>${memory.plan.imageIds.map(id => `<li>${escape(project.images.find(item => item.id === id)?.name || 'Imagem removida')}</li>`).join('')}</ol></details><p>Estas imagens poderão ser enviadas ao provedor do agente, inclusive na nuvem.</p>${task ? '<p class="field-error">Autorizar substitui a tarefa e os exemplos anteriores.</p>' : ''}<div class="assistant-actions">${button('approve-plan', 'Autorizar plano', config ? '' : 'disabled')}${button('discard-plan', 'Recusar')}</div></section>` : ''}
      ${task && !memory.plan ? `<section><div class="assistant-section-heading"><h3>${pending ? 'Revisar sugestões' : escape(phases[task.phase])}</h3>${!['complete', 'cancelled'].includes(task.phase) ? button('cancel', 'Cancelar tarefa') : ''}</div><p class="assistant-target">${escape(task.description)}</p><p class="assistant-meta">${memory.completed.length} de ${task.imageIds.length} imagens revisadas</p><progress class="project-progress" value="${memory.completed.length}" max="${task.imageIds.length}" aria-label="Imagens revisadas"></progress>
        ${stale ? '<p class="field-error" role="alert">Um exemplo de calibração foi alterado. Cancele e peça um novo plano para recalibrar; o agente não receberá exemplos antigos como válidos.</p>' : ''}
        ${config && authorizedTask !== task.id && !['complete', 'cancelled'].includes(task.phase) ? `<p>Revise o escopo salvo para retomar o compartilhamento.</p><details id="assistant-saved-scope"><summary>${task.imageIds.length} imagens autorizadas anteriormente</summary><ol>${task.imageIds.map(id => `<li>${escape(project.images.find(item => item.id === id)?.name || 'Removida')}</li>`).join('')}</ol></details><p>Estas imagens poderão ser enviadas ao provedor do agente, inclusive na nuvem.</p>${button('resume', 'Retomar e autorizar')}` : ''}
        ${task.phase === 'awaiting_batch' ? button('authorize', `Autorizar próximas ${Math.min(task.batchSize, task.imageIds.length - memory.completed.length)} imagens`, config ? '' : 'disabled') : ''}
        ${task.phase === 'calibration' && !pending ? `<p>Amostra ${memory.completed.length + 1}/${task.calibrationCount} · ${escape(project.images.find(item => item.id === availableImages(memory)[0])?.name || 'Imagem indisponível')}</p>${button('show-next', 'Mostrar imagem')}<label class="field-label" for="assistant-manual-note">Orientação ao agente (opcional)</label><textarea id="assistant-manual-note" maxlength="2000" rows="2">${escape(manualDraft?.taskId === task.id ? manualDraft.value : task.manualNote || '')}</textarea><div class="assistant-actions">${button('manual', 'Usar minhas caixas')}${button('manual-absent', 'Alvo ausente')}</div>` : ''}</section>` : ''}
      ${pending && !memory.plan ? `<section class="assistant-review-section">${pending.message ? `<p class="assistant-message">${escape(pending.message)}</p>` : ''}
        <label class="field-label" for="assistant-frame">Imagem do lote</label><select id="assistant-frame">${pending.frames.map(item => `<option value="${escape(item.imageId)}" ${item.imageId === activeFrame.imageId ? 'selected' : ''}>${escape(project.images.find(image => image.id === item.imageId)?.name || 'Removida')}${item.review ? ' · revisada' : ' · pendente'}</option>`).join('')}</select>
        <div class="assistant-section-heading">${button('show-frame', 'Mostrar imagem')}<span class="assistant-meta">${activeFrame.boxes.length} sugestões · ${image ? `${image.width} × ${image.height} px` : 'Imagem removida'}</span></div>
        <form id="assistant-review"><label class="field-label" for="assistant-decision">Sua decisão</label><select id="assistant-decision" required><option value="">Escolha uma decisão</option>${[['accepted', 'Aceitar caixas'], ['corrected', 'Corrigir ou adicionar caixas'], ['rejected', 'Rejeitar (explicar o erro)'], ['absent', 'Confirmar que o alvo não aparece']].map(([value, label]) => `<option value="${value}" ${currentDraft?.decision === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <details id="assistant-geometry" ${currentDraft?.decision === 'corrected' ? 'open' : ''}><summary>Corrigir caixas</summary><p class="assistant-meta">Medidas em pixels da imagem. Confira sobreposições com caixas existentes.</p><div id="assistant-boxes">${(currentDraft?.boxes || activeFrame.boxes).map(boxRow).join('')}</div>${button('add-box', 'Adicionar caixa')}</details>
        <label class="field-label" for="assistant-note">Comentário (obrigatório ao rejeitar)</label><textarea id="assistant-note" maxlength="2000" rows="2">${escape(currentDraft?.note || '')}</textarea><button id="assistant-save-decision" type="submit" class="button">Salvar decisão</button></form>
        <div class="assistant-apply"><p>${pending.frames.filter(item => item.review && !drafts.has(item.imageId)).length} de ${pending.frames.length} imagens com decisão.</p><p class="assistant-meta">Só caixas aprovadas serão adicionadas. As existentes serão preservadas.</p>${button('apply', 'Aplicar caixas aprovadas', pending.frames.every(item => item.review && !drafts.has(item.imageId)) ? '' : 'disabled')}${button('discard', 'Descartar lote')}
        </div>
      </section>` : ''}
      <footer class="assistant-options">
      ${config ? `<details id="assistant-connection"><summary>Conexão MCP</summary><p>Use Node.js 20+. Cole esta configuração no cliente; ela contém uma chave temporária privada.</p><textarea id="assistant-config" readonly rows="7" aria-label="Configuração MCP">${escape(JSON.stringify(config, null, 2))}</textarea><div class="assistant-actions">${button('copy', 'Copiar configuração')}${button('disconnect', 'Desconectar')}</div></details>` : ''}
      <details id="assistant-history"><summary id="assistant-history-title">Histórico (${history.length})</summary><div class="assistant-section-heading"><span class="assistant-meta">A calibração e as caixas são preservadas.</span>${button('clear-history', 'Limpar histórico', history.length ? '' : 'disabled')}</div>${history.length ? `<ul class="assistant-history-list">${history.map(item => `<li><strong>${escape(project.images.find(image => image.id === item.imageId)?.name || item.imageId)}</strong><span>${decisions[item.decision]} · ${item.final.length} caixas</span>${item.note ? `<p>${escape(item.note)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="assistant-meta">Nenhuma mensagem no histórico.</p>'}</details>
      <details id="assistant-help"><summary>Como funciona</summary><p>Continue no chat do seu agente. Ele consulta o Anoint pelo MCP; o Anoint não inicia mensagens no chat externo.</p><p>A calibração fornece exemplos e correções como contexto, sem treinar os pesos do modelo.</p><p>Sugestões pontilhadas só viram anotações após sua aprovação. Editou a imagem depois da geração? Descarte o lote e peça outro.</p><p>Limpar histórico oculta a lista neste painel. Os exemplos continuam disponíveis ao agente; o chat externo não é alterado.</p></details></footer>`;
    for (const element of panel.querySelectorAll('details[id]')) {
      element.querySelector('summary').id = `${element.id}-title`;
      if (detailsState.has(element.id)) element.open = detailsState.get(element.id);
    }
    for (const action of ['connect', 'approve-plan', 'authorize', 'apply']) panel.querySelector(`[data-assistant="${action}"]`)?.classList.add('primary');
    updateDecisionFields();
    if (working) panel.querySelectorAll('button,input,select,textarea').forEach(element => { element.disabled = true; });
    panel.scrollTop = scroll;
    if (focusId) {
      const restored = document.getElementById(focusId) || panel.querySelector('h2');
      restored?.focus({ preventScroll: true });
      if (selection) restored?.setSelectionRange?.(...selection);
    }
  }

  function boxRow(box, index) {
    return `<fieldset class="assistant-box" data-index="${index}"><legend>Sugestão ${index + 1}</legend>${['x', 'y', 'width', 'height'].map(key => `<label>${{ x: 'X', y: 'Y', width: 'Largura', height: 'Altura' }[key]}<input id="assistant-box-${index}-${key}" data-coordinate="${key}" type="number" min="${key === 'x' || key === 'y' ? 0 : .000001}" step="any" value="${escape(box[key])}" required /></label>`).join('')}${button('remove-box', 'Remover sugestão', `data-index="${index}"`)}</fieldset>`;
  }

  function updateDecisionFields() {
    const decision = panel.querySelector('#assistant-decision')?.value;
    for (const input of panel.querySelectorAll('[data-coordinate]')) {
      input.disabled = decision !== 'corrected'; input.required = decision === 'corrected';
    }
    const note = panel.querySelector('#assistant-note');
    if (note) note.required = decision === 'rejected';
  }

  const draft = () => ({ decision: panel.querySelector('#assistant-decision').value, note: panel.querySelector('#assistant-note').value,
    boxes: [...panel.querySelectorAll('.assistant-box')].map(row => Object.fromEntries([...row.querySelectorAll('[data-coordinate]')].map(input => [input.dataset.coordinate, input.value]))) });

  function captureDraft() {
    const active = frame();
    if (!active || !panel.querySelector('#assistant-review')) return;
    drafts.set(active.imageId, { requestId: state().pending.requestId, value: draft() });
    const apply = panel.querySelector('[data-assistant=apply]');
    if (apply) apply.disabled = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { void flush().catch(showDraftError); }, 200);
  }
  function showDraftError(failure) {
    error = failure.message;
    const target = panel.querySelector('.field-error');
    if (target) { target.hidden = false; target.textContent = error; }
  }
  function flush() {
    clearTimeout(draftTimer);
    const pendingDrafts = [...drafts];
    const note = manualDraft;
    draftChain = draftChain.catch(() => {}).then(async () => {
      if (note) {
        await save(memory => {
          if (memory.task?.id === note.taskId) memory.task.manualNote = note.value;
          return memory;
        });
        if (manualDraft === note) manualDraft = null;
      }
      for (const [imageId, item] of pendingDrafts) {
        await save(memory => memory.pending?.requestId === item.requestId ? saveDraft(memory, imageId, item.value) : memory);
        if (drafts.get(imageId) === item) drafts.delete(imageId);
      }
    });
    return draftChain;
  }

  async function act(operation) {
    if (working) return;
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    working = true;
    error = '';
    const status = panel.querySelector('#assistant-status');
    if (status) status.textContent = 'Salvando…';
    panel.querySelectorAll('button').forEach(element => { element.disabled = true; });
    try { await flush(); check(!editor.get().busy, 'Editor ocupado. Tente novamente.'); await operation(); }
    catch (failure) { error = failure.message; }
    finally { working = false; refresh(focused); editor.overlay(); }
  }

  async function disconnect() {
    await flush();
    const enabled = config || connecting;
    epoch += 1;
    config = null;
    connectedProject = null;
    authorizedTask = null;
    if (enabled) await window.anointAgent?.disconnect();
    panel.close();
  }

  document.addEventListener('click', event => {
    const element = event.target.closest('[data-assistant]');
    if (!element) return;
    const action = element.dataset.assistant;
    if (action === 'open') { panel.show(); refresh(); panel.querySelector('h2').focus(); return; }
    if (action === 'close') { void act(async () => { panel.close(); document.querySelector('[data-assistant=open]')?.focus(); }); return; }
    if (working || editor.get().busy) return;
    if (action === 'add-box') {
      const rows = panel.querySelector('#assistant-boxes');
      const nextIndex = Math.max(-1, ...[...rows.children].map(row => Number(row.dataset.index))) + 1;
      rows.insertAdjacentHTML('beforeend', boxRow({ x: 0, y: 0, width: 1, height: 1 }, nextIndex));
      panel.querySelector('#assistant-decision').value = 'corrected';
      updateDecisionFields();
      rows.lastElementChild.querySelector('input').focus();
      captureDraft();
      return;
    }
    if (action === 'remove-box') {
      element.closest('fieldset').remove();
      const decision = panel.querySelector('#assistant-decision');
      decision.value = 'corrected'; updateDecisionFields(); decision.focus(); captureDraft(); return;
    }
    void act(async () => {
      if (action === 'connect') {
        const projectId = editor.get().projectId;
        const startedAt = epoch;
        check(projectId, 'Abra um projeto primeiro.');
        connecting = true;
        try {
          const candidate = await window.anointAgent.connect();
          if (epoch !== startedAt || editor.get().projectId !== projectId) {
            await window.anointAgent.disconnect(); throw new Error('Projeto alterado durante a conexão. Conecte novamente.');
          }
          config = candidate; connectedProject = projectId; epoch += 1;
        } finally { connecting = false; }
      } else if (action === 'disconnect') await disconnect();
      else if (action === 'copy') await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      else if (action === 'clear-history') {
        await save(memory => ({ ...memory, historyClearedCount: memory.completed.length }));
        panel.querySelector('#assistant-history-title')?.focus();
      }
      else if (action === 'approve-plan') { check(config, 'Conecte novamente.'); await save((memory, project) => approveTask(memory, project)); authorizedTask = state().task.id; }
      else if (action === 'resume') {
        check(config, 'Conecte novamente.');
        await save((memory, project) => {
          check(project.labels.some(label => label.id === memory.task.labelId) && memory.task.imageIds.every(id => project.images.some(image => image.id === id)), 'O escopo foi alterado. Cancele e peça um novo plano.');
          memory.task.id = crypto.randomUUID();
          if (memory.pending) memory.pending.taskId = memory.task.id;
          return memory;
        });
        authorizedTask = state().task.id;
      }
      else if (action === 'discard-plan') await save(memory => ({ ...memory, plan: null }));
      else if (action === 'cancel') await save(cancelTask);
      else if (action === 'authorize') { check(config, 'Conecte novamente.'); await save(authorizeBatch); }
      else if (action === 'show-next') { editor.select(availableImages(state())[0]); panel.close(); }
      else if (action === 'show-frame') { editor.select(frame().imageId); panel.close(); }
      else if (action === 'manual' || action === 'manual-absent') {
        const note = panel.querySelector('#assistant-manual-note').value;
        await store((project, memory) => ({ project, assistant: useManualExample(project, memory, availableImages(memory)[0], note, action === 'manual-absent') }), true);
      } else if (action === 'discard') await save(discardProposal);
      else if (action === 'apply') {
        const frames = state().pending.frames;
        check(frames.every(item => item.review), 'Salve uma decisão para cada imagem.');
        const total = frames.reduce((sum, item) => sum + (item.review.decision === 'accepted' ? item.boxes.length : item.review.decision === 'corrected' ? item.review.boxes.length : 0), 0);
        if (confirm(`Aplicar ${total} caixa(s) aprovada(s) em ${frames.length} imagem(ns) e salvar o feedback? As caixas existentes serão preservadas. Você poderá desfazer esta operação.`)) {
          await store((project, memory) => reviewProposal(project, memory, memory.pending.frames.map(item => ({ imageId: item.imageId, ...item.review }))), true);
        }
      }
    });
  });
  panel.addEventListener('change', event => {
    if (event.target.id === 'assistant-frame') { reviewImage = event.target.value; refresh(); }
    else if (event.target.closest('#assistant-review')) {
      if (event.target.id === 'assistant-decision' && event.target.value === 'corrected') panel.querySelector('#assistant-geometry').open = true;
      updateDecisionFields();
      captureDraft();
    }
  });
  panel.addEventListener('invalid', event => {
    if (event.target.closest('#assistant-geometry')) panel.querySelector('#assistant-geometry').open = true;
  }, true);
  panel.addEventListener('input', event => {
    if (event.target.id === 'assistant-manual-note') {
      manualDraft = { taskId: state().task.id, value: event.target.value };
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { void flush().catch(showDraftError); }, 200);
      return;
    }
    if (!event.target.closest('#assistant-review')) return;
    if (event.target.dataset.coordinate) panel.querySelector('#assistant-decision').value = 'corrected';
    captureDraft();
  });
  panel.addEventListener('submit', event => {
    if (event.target.id !== 'assistant-review') return;
    event.preventDefault();
    const decision = draft();
    decision.boxes = decision.decision === 'corrected'
      ? decision.boxes.map(box => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value === '' ? NaN : Number(value)])))
      : decision.decision === 'accepted' ? frame().boxes : [];
    void act(() => save(memory => saveDecision(memory, frame().imageId, decision)));
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void act(async () => { panel.close(); document.querySelector('[data-assistant=open]')?.focus(); }); }
  });

  async function handleTool(name, args) {
    check(config && connectedProject && connectedProject === editor.get().projectId, 'APP_UNAVAILABLE: habilite a conexão no projeto aberto.');
    check(!working && !editor.get().busy, 'Editor ocupado. Tente novamente.');
    const currentEpoch = epoch;
    const current = editor.get();
    const { project, assistant: memory } = current;
    const metadata = async image => ({ id: image.id, name: image.name, width: image.width, height: image.height, reviewed: image.reviewed,
      revision: await imageRevision(project, image), annotations: image.annotations });
    const stillCurrent = () => check(epoch === currentEpoch && connectedProject === editor.get().projectId && editor.get().revision === current.revision, 'Conflito: projeto alterado ou conexão encerrada. Leia o contexto novamente.');
    if (name === 'anoint_get_context') {
      strict(args, []);
      const { manualNote, ...agentTask } = memory.task || {};
      const agentMemory = { ...memory, task: memory.task ? agentTask : null,
        feedback: memory.feedback.map(({ exampleState, ...feedback }) => feedback),
        pending: memory.pending ? { ...memory.pending, frames: memory.pending.frames.map(({ review, draft, ...proposal }) => proposal) } : null,
      };
      const result = { projectId: current.projectId, name: current.name, labels: project.labels, imageCount: project.images.length,
        coordinates: 'natural-pixels', memory: agentMemory, examplesStale: !examplesCurrent(project, memory), availableImageIds: authorizedTask === memory.task?.id && examplesCurrent(project, memory) ? availableImages(memory) : [],
        instructions: 'Converse com o usuário no chat externo. Proponha um plano com classe existente e IDs de imagens; aguarde autorização no Anoint. Na calibração analise uma imagem por vez; use os exemplos/feedback. Leia cada imagem e sua revisão antes de sugerir. Não interprete caixas vazias ou rejeição como ausência confirmada. Somente o humano autoriza geração e aplica sugestões. Não há ferramenta para aprovar. Após cada rodada consulte o contexto. Calibração é contexto, não treino de pesos.' };
      return result;
    }
    if (name === 'anoint_list_images') {
      strict(args, ['offset', 'limit']);
      const offset = args.offset ?? 0, limit = args.limit ?? 20;
      check(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Paginação inválida.');
      const images = await Promise.all(project.images.slice(offset, offset + limit).map(metadata));
      stillCurrent(); return { images, total: project.images.length, nextOffset: offset + images.length < project.images.length ? offset + images.length : null };
    }
    if (name === 'anoint_get_image') {
      strict(args, ['imageId']);
      check(authorizedTask === memory.task?.id, 'Aguarde autorização do escopo no Anoint.');
      check(examplesCurrent(project, memory), 'Exemplos alterados. Peça ao usuário para recalibrar com um novo plano.');
      const allowed = new Set([...availableImages(memory), ...memory.feedback.filter(item => item.phase === 'calibration').map(item => item.imageId)]);
      check(allowed.has(args.imageId), 'Imagem fora do escopo autorizado desta rodada.');
      const image = project.images.find(item => item.id === args.imageId);
      check(image && project.labels.some(label => label.id === memory.task?.labelId), 'Classe ou imagem removida. Cancele e proponha outra tarefa.');
      const blob = await imageBlob(image.src);
      check(blob.type !== 'image/gif' && !/\.gif$/i.test(image.name), 'GIF não é suportado pelo assistente; importe um frame estático.');
      const url = URL.createObjectURL(blob);
      try {
        const decoded = new Image(); decoded.src = url; await decoded.decode();
        check(decoded.naturalWidth === image.width && decoded.naturalHeight === image.height, 'Dimensões da fonte mudaram. Importe a imagem novamente.');
        const ratio = Math.min(1, 4096 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', .9).split(',')[1];
        check(data.length <= 12 * 1024 * 1024, 'Imagem muito grande para o MCP; use um frame menor.');
        const info = { ...await metadata(image), sentWidth: canvas.width, sentHeight: canvas.height, coordinates: 'natural-pixels', scaleX: image.width / canvas.width, scaleY: image.height / canvas.height,
          note: 'Multiplique medidas do preview pelas escalas para enviar pixels naturais. Objetos pequenos podem desaparecer na redução; não assuma ausência.' };
        stillCurrent();
        return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: JSON.stringify(info) }], structuredContent: info };
      } finally { URL.revokeObjectURL(url); }
    }
    check(['anoint_propose_task', 'anoint_submit_proposal'].includes(name), 'Ferramenta não permitida.');
    check(!(manualDraft?.value || memory.task?.manualNote || '').trim(), 'O usuário está preparando um exemplo manual. Aguarde a confirmação ou o descarte desse comentário no Anoint.');
    if (name === 'anoint_submit_proposal') {
      check(authorizedTask === memory.task?.id, 'Aguarde autorização do escopo no Anoint.');
      check(examplesCurrent(project, memory), 'Exemplos alterados. Peça ao usuário para recalibrar com um novo plano.');
    }
    strict(args, name === 'anoint_propose_task' ? ['requestId', 'description', 'labelId', 'calibrationCount', 'batchSize', 'imageIds'] : ['requestId', 'taskId', 'frames', 'message']);
    if (name === 'anoint_submit_proposal' && Array.isArray(args.frames)) for (const item of args.frames) {
      strict(item, ['imageId', 'revision', 'boxes']);
      if (Array.isArray(item.boxes)) for (const box of item.boxes) strict(box, ['x', 'y', 'width', 'height']);
    }
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    working = true;
    try {
      await store(async (nextProject, nextMemory) => {
        stillCurrent();
        const assistant = name === 'anoint_propose_task' ? proposeTask(nextMemory, nextProject, args) : await submitProposal(nextMemory, nextProject, args);
        stillCurrent(); return { project: nextProject, assistant };
      });
      return { status: 'awaiting_human_review', taskId: state().task?.id || null };
    } finally { working = false; refresh(focused); editor.overlay(); }
  }
  window.anointAgent?.onRequest(handleTool);
  window.addEventListener('beforeunload', event => {
    if (drafts.size || manualDraft) { event.preventDefault(); event.returnValue = ''; void flush().catch(showDraftError); }
  });
  return { card, refresh, disconnect, handleTool, flush,
    overlay(image, scale) {
      const item = state().pending?.frames.find(frame => frame.imageId === image.id);
      const boxes = item?.review?.decision === 'corrected' ? item.review.boxes : item?.boxes || [];
      return boxes.map((box, index) => `<g class="assistant-suggestion" aria-label="Sugestão ${index + 1}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/><text x="${box.x + 3 / scale}" y="${box.y + 15 / scale}" font-size="${11 / scale}">Sugestão ${index + 1}</text></g>`).join('');
    },
  };
}
