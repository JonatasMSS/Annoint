import { normalizeBox, clampBox, moveBox, validateProject, createProject, MAX_ANNOTATIONS_PER_IMAGE, MAX_PROJECT_ANNOTATIONS, MAX_IMAGES, BATCH_SIZE, updateClass, removeClass, removeImages } from './model.js';
import { initializeProjects, listProjects, createLocalProject, loadProject, saveProject, storeImage, externalizeProject, portableProject, imageBlob, loadView, saveView, pruneImages, loadAssistant } from './storage.js';
import { emptyAssistant, validateAssistant } from './assistant.js';
import { createAssistantUI } from './assistant-ui.js';
import { exportDataset } from './export.js';
import { batches, BatchCache } from './batches.js';

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const paths = {
  logo: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M2 4h4M4 2v4m14-2h4m-2-2v4M2 20h4m-2-2v4m14-2h4m-2-2v4"/>',
  cursor: '<path d="m5 3 15 10-7 1-3 7Z"/>',
  undo: '<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5" transform="translate(0 -3)"/>',
  redo: '<path d="M20 10H10a6 6 0 0 0 0 12m10-12-5-5m5 5-5 5" transform="translate(0 -3)"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  sparkles: '<path d="m10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5ZM19 2v5m-2.5-2.5h5M20 17v5m-2.5-2.5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 2.5M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const uid = () => crypto.randomUUID();
const appVersion = $('meta[name=application-version]').content;
let project = createProject([{
  id: 'demo-image', name: 'estacionamento_001.svg', src: './assets/demo-street.svg', width: 1440, height: 900, reviewed: false,
  annotations: [
    { id: 'demo-car-1', labelId: 'car', x: 308, y: 126, width: 118, height: 201 },
    { id: 'demo-car-2', labelId: 'car', x: 308, y: 389, width: 118, height: 201 },
    { id: 'demo-tree', labelId: 'tree', x: 18, y: 77, width: 137, height: 137 },
    { id: 'demo-person', labelId: 'person', x: 1161, y: 657, width: 37, height: 59 },
  ],
}], [
  { id: 'car', name: 'Carro', color: '#7c5ce0' },
  { id: 'person', name: 'Pessoa', color: '#ce8a27' },
  { id: 'tree', name: 'Árvore', color: '#299680' },
]);
const demo = project;
let activeProjectId = null;
let activeProjectName = '';
let assistant = emptyAssistant();
const assistantSnapshots = new WeakMap();
let screen = 'projects';
let library = [];
let libraryError = '';
let operationError = '';
let navigating = false;
let viewChain = Promise.resolve();
const sessions = new Map();
let imageId = project.images[0].id;
let selectedId = project.images[0].annotations[0].id;
let labelId = 'car';
let tool = 'select';
let zoom = 1;
let fitScale = 1;
let fittedViewport = '';
let history = [];
let future = [];
let drag = null;
let filter = 'all';
let saveTimer;
let toastTimer;
let saveChain = Promise.resolve();
let revision = 0;
let savedRevision = 0;
let saveError = false;
let loadingError = false;
let importing = false;
let exporting = false;
let editingLabelId = null;
let ready = false;
let sessionBlocked = false;
let selectingImages = false;
const selectedImages = new Set();
const imageSelections = new Map();
const cache = new BatchCache();
let batchIndex = 0;
let filmstripHidden = false;
const batchSelections = new Map();
const batchImages = () => project.images.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
const filteredImages = () => batchImages().filter((item) => filter === 'all' || (filter === 'done' ? item.reviewed : !item.reviewed));
const sourceAttributes = (image) => {
  const item = cache.entries.get(image.src);
  return `data-source="${escapeHTML(image.src)}" ${item?.url ? `src="${escapeHTML(item.url)}"` : ''}`;
};

function currentView() {
  batchSelections.set(batchIndex, imageId);
  imageSelections.set(imageId, selectedId);
  return { imageId, filmstripHidden, labelId, filter, tool, zoom, batchSelections: [...batchSelections], imageSelections: [...imageSelections] };
}

function rememberView() {
  const id = activeProjectId;
  const view = currentView();
  viewChain = viewChain.catch(() => {}).then(() => saveView(id, view));
  viewChain.catch(() => notify('Não foi possível salvar a posição de navegação.', true));
}

function restoreView(view) {
  filmstripHidden = Boolean(view?.filmstripHidden);
  batchSelections.clear();
  imageSelections.clear();
  if (Array.isArray(view?.batchSelections)) for (const entry of view.batchSelections) if (Array.isArray(entry) && entry.length === 2) batchSelections.set(...entry);
  if (Array.isArray(view?.imageSelections)) for (const entry of view.imageSelections) if (Array.isArray(entry) && entry.length === 2) imageSelections.set(...entry);
  imageId = project.images.some((image) => image.id === view?.imageId) ? view.imageId : project.images[0]?.id;
  selectedId = imageSelections.get(imageId) || null;
  if (!currentBox()) selectedId = null;
  labelId = project.labels.some((label) => label.id === view?.labelId) ? view.labelId : project.labels[0]?.id;
  filter = ['all', 'pending', 'done'].includes(view?.filter) ? view.filter : 'all';
  tool = view?.tool === 'box' ? 'box' : 'select';
  zoom = Number.isFinite(view?.zoom) ? Math.min(8, Math.max(.25, view.zoom)) : 1;
  fittedViewport = '';
  batchIndex = Math.max(0, Math.floor(project.images.findIndex((image) => image.id === imageId) / BATCH_SIZE));
}

async function commitEditor() {
  if (!activeProjectId || screen !== 'editor') return;
  await assistantUI.flush();
  cancelDrag();
  clearTimeout(saveTimer);
  await saveChain;
  if (savedRevision < revision || saveError) await persist();
  if (saveError || savedRevision < revision) throw new Error('Salve as alterações antes de sair. Você também pode exportar uma cópia.');
  rememberView();
  await viewChain;
  sessions.set(activeProjectId, { project, assistant, history, future, view: currentView() });
}

async function showProjects() {
  if (navigating) return;
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating) return;
  navigating = true;
  showLoading('Salvando alterações…');
  try {
    await paintLoading();
    await commitEditor();
    await assistantUI.disconnect();
    const records = await listProjects();
    library = records;
    libraryError = '';
    screen = 'projects';
    cache.clear();
    render();
    $('#projects-title').focus();
  } catch (error) { notify(error.message, true); }
  finally { navigating = false; hideLoading(); if (screen === 'projects') $('#projects-title').focus(); }
}

async function activateProject(id, record = null) {
  const session = sessions.get(id);
  const value = session?.project || record?.project || await loadProject(id);
  if (!value) throw new Error('Projeto local não encontrado.');
  const view = session?.view || await loadView(id);
  const memory = session?.assistant || await loadAssistant(id);
  const restored = validateProject(value);
  if (!restored.labels.length) throw new Error('O projeto precisa ter pelo menos uma classe.');
  const external = await externalizeProject(restored);
  if (restored.images.some((image) => image.src.startsWith('data:'))) await saveProject(id, external);
  const unavailable = window.anointFiles?.available ? await window.anointFiles.available(external.images.map((image) => image.src)) : [];
  activeProjectId = id;
  await assistantUI.disconnect();
  activeProjectName = record?.name || library.find((item) => item.id === id)?.name || 'Projeto local';
  clearImageSelection();
  project = external;
  assistant = memory;
  history = session?.history || [];
  future = session?.future || [];
  restoreView(view);
  revision = savedRevision = 0;
  saveError = loadingError = false;
  screen = 'editor';
  cache.clear();
  render();
  $('[data-action=projects]').focus();
  if (unavailable.length) notify(`${unavailable.length} arquivo(s) indisponível(is). As imagens e anotações foram preservadas; você pode remover a referência pelo botão Excluir imagem.`, true);
}

async function openLocalProject(id) {
  if (navigating) return;
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating) return;
  navigating = true;
  showLoading('Abrindo projeto…');
  try { await paintLoading(); await commitEditor(); await activateProject(id); }
  catch (error) { notify(`Não foi possível abrir o projeto. ${error.message}`, true); }
  finally { navigating = false; hideLoading(); if (screen === 'editor') $('[data-action=projects]').focus(); }
}

function renderProjects() {
  observer.disconnect();
  $('#app').innerHTML = `<div class="projects-shell" id="projects-screen">
    <header class="topbar"><div class="brand"><span class="brand-mark">${icon('logo')}</span>anoint<span class="sr-only">Estúdio de anotação</span></div><span class="pill">${icon('lock')}Local neste dispositivo</span><div class="top-actions"><button class="icon-button" data-action="help" aria-label="Como usar o Anoint">${icon('help')}</button></div></header>
    <main class="projects-main" aria-labelledby="projects-title"><div class="projects-heading"><div><p class="eyebrow">Seu espaço de trabalho</p><h1 id="projects-title" tabindex="-1">Projetos</h1><p class="projects-intro">Cada conjunto de imagens, um novo olhar. Continue de onde parou.</p></div><div class="projects-actions"><button class="button" data-action="open-project" ${!ready || libraryError ? 'disabled' : ''}>${icon('upload')}Importar JSON</button><button class="button primary" data-action="new-project" ${!ready || libraryError ? 'disabled' : ''}>${icon('plus')}Novo projeto</button></div></div><p class="operation-error" role="alert" ${operationError ? '' : 'hidden'}>${escapeHTML(operationError)}</p>
    ${!ready ? '<p role="status">Carregando seus projetos…</p>' : libraryError ? `<div class="projects-empty" role="alert"><h2>Não foi possível carregar seus projetos</h2><p>${escapeHTML(libraryError)}</p><button class="button" data-action="retry-library">Tentar novamente</button></div>` : `<p class="library-count">${library.length} ${library.length === 1 ? 'projeto local' : 'projetos locais'}</p><section class="project-grid" id="project-list" aria-label="Projetos locais">${library.map((record) => {
      const percent = record.imageCount ? Math.round(record.completedCount / record.imageCount * 100) : 0;
      return `<article class="project-library-card" data-project-id="${escapeHTML(record.id)}"><div class="project-card-heading"><span class="project-symbol">${icon('folder')}</span><span class="pill">Local</span></div><h2 title="${escapeHTML(record.name)}">${escapeHTML(record.name)}</h2><p class="project-image-count">${record.imageCount} ${record.imageCount === 1 ? 'imagem' : 'imagens'}</p><div class="progress-heading"><span>${record.completedCount} de ${record.imageCount} concluídas</span><strong>${percent}%</strong></div><progress class="project-progress" value="${record.completedCount}" max="${record.imageCount || 1}" aria-label="Progresso de ${escapeHTML(record.name)}">${percent}%</progress><button class="button" data-action="open-local-project" data-project-id="${escapeHTML(record.id)}" aria-label="Abrir ${escapeHTML(record.name)}">Abrir projeto${icon('chevron')}</button></article>`;
    }).join('') || '<div class="projects-empty"><h2>Seu próximo projeto começa aqui.</h2><p>Crie um projeto ou importe uma cópia JSON para começar.</p></div>'}</section>`}
    </main><footer class="projects-footer">${icon('lock')}Imagens e anotações ficam neste dispositivo. Exporte JSON para guardar uma cópia.</footer></div>`;
  document.title = 'Anoint — Projetos';
}

function loadBatch() {
  cache.load(batchImages(), updateSources);
  updateSources();
}

function updateSources() {
  for (const element of document.querySelectorAll('img[data-source]')) {
    const item = cache.entries.get(element.dataset.source);
    element.onload = updateSources;
    element.onerror = () => { element.dataset.decodeError = 'Não foi possível carregar esta imagem.'; updateSources(); };
    if (item?.url && element.getAttribute('src') !== item.url) {
      delete element.dataset.decodeError;
      element.src = item.url;
    }
    const error = item?.error || element.dataset.decodeError;
    const loading = !error && (!item || !element.complete || !element.naturalWidth);
    const container = element.closest('.thumbnail, .image-surface');
    container?.classList.toggle('image-loading', loading);
    container?.classList.toggle('image-error', Boolean(error));
    if (container) {
      container.dataset.loadStatus = error || (loading ? 'Carregando…' : '');
      container.setAttribute('aria-description', container.dataset.loadStatus);
      container.setAttribute('aria-busy', String(loading));
    }
    if (error) element.title = error;
  }
}

function selectBatch(index) {
  if (importing || exporting) return;
  clearImageSelection();
  cancelDrag();
  batchSelections.set(batchIndex, imageId);
  batchIndex = Math.max(0, Math.min(batches(project.images).length - 1, index));
  const images = batchImages();
  const selected = batchSelections.get(batchIndex);
  selectImage(images.some((image) => image.id === selected) ? selected : images[0]?.id);
}
const currentImage = () => project.images.find((image) => image.id === imageId) || project.images[0];
const currentBox = () => currentImage()?.annotations.find((box) => box.id === selectedId);
const labelFor = (id) => project.labels.find((label) => label.id === id);
const snapshot = () => ({ ...project, labels: project.labels.map((label) => ({ ...label })), images: project.images.map((image) => ({ ...image, annotations: image.annotations.map((box) => ({ ...box })) })) });

function notify(message, error = false) {
  operationError = error ? message : '';
  for (const element of document.querySelectorAll('.operation-error')) { element.textContent = operationError; element.hidden = !operationError; }
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3500);
}

function showLoading(message, current = null, total = 1) {
  $('#loading-message').textContent = message;
  const progress = $('#loading-progress');
  progress.max = total || 1;
  if (current === null) progress.removeAttribute('value');
  else progress.value = current;
  $('#app').ariaBusy = 'true';
  if (!$('#loading-dialog').open) $('#loading-dialog').showModal();
}

function hideLoading() {
  $('#loading-dialog').close();
  $('#app').ariaBusy = 'false';
}

const paintLoading = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
$('#loading-dialog').addEventListener('cancel', (event) => event.preventDefault());

function clearImageSelection() {
  selectedImages.clear();
  selectingImages = false;
}

function saveStatus() {
  const element = $('.save-status');
  if (!element) return;
  element.textContent = loadingError ? 'Restauração falhou · exporte antes de salvar' : saveError ? 'Falha ao salvar · tentar novamente' : savedRevision < revision ? 'Salvando alterações…' : 'Todas as alterações salvas';
  element.classList.toggle('error', saveError || loadingError);
  element.classList.toggle('saving', !saveError && !loadingError && savedRevision < revision);
  element.title = loadingError ? 'O projeto salvo não foi substituído. Exporte uma cópia antes de tentar salvar.' : saveError ? 'Clique para tentar salvar de novo. Você também pode exportar uma cópia.' : 'Salvo localmente neste dispositivo';
}

function persist() {
  clearTimeout(saveTimer);
  const version = revision;
  const id = activeProjectId;
  const value = snapshot();
  const memory = structuredClone(assistant);
  saveChain = saveChain.catch(() => {}).then(async () => {
    try {
      await saveProject(id, value, memory);
      if (activeProjectId === id) {
        if (saveError) notify('Alterações salvas neste dispositivo.');
        savedRevision = version;
        saveError = false;
      }
    } catch (error) {
      if (activeProjectId === id) saveError = true;
      notify('Não foi possível salvar neste dispositivo. Exporte uma cópia do projeto.', true);
    }
    saveStatus();
  });
  return saveChain;
}

function changed() {
  revision += 1;
  saveStatus();
  clearTimeout(saveTimer);
  if (!loadingError) saveTimer = setTimeout(persist, 350);
}

function remember() {
  history.push(historySnapshot());
  if (history.length > 30) history.shift();
  future = [];
}

function updateHistory(direction) {
  clearImageSelection();
  cancelDrag();
  const from = direction === 'undo' ? history : future;
  const to = direction === 'undo' ? future : history;
  if (!from.length) return;
  to.push(historySnapshot());
  project = from.pop();
  assistant = structuredClone(assistantSnapshots.get(project) || emptyAssistant());
  // Uma resposta anterior ao Desfazer/Refazer não pode reutilizar a autorização antiga.
  if (assistant.task) { assistant.task.id = uid(); assistant.task.examplesVersion += 1; }
  if (assistant.pending) assistant.pending.taskId = assistant.task.id;
  if (!project.images.some((image) => image.id === imageId)) imageId = project.images[0]?.id;
  batchIndex = Math.max(0, Math.floor(project.images.findIndex((image) => image.id === imageId) / BATCH_SIZE));
  if (!labelFor(labelId)) labelId = project.labels[0].id;
  if (!currentBox()) selectedId = null;
  changed();
  render();
  assistantUI.refresh();
}

function historySnapshot() {
  const value = snapshot();
  assistantSnapshots.set(value, structuredClone(assistant));
  return value;
}

const assistantUI = createAssistantUI({
  get: () => ({ project, assistant, projectId: screen === 'editor' ? activeProjectId : null, name: activeProjectName, revision,
    activeImageId: imageId, activeLabelId: labelId,
    busy: navigating || importing || exporting || !ready || loadingError || Boolean(drag)
      || Boolean(document.querySelector('#class-dialog[open], #project-dialog[open]'))
      || [...document.querySelectorAll('[data-geometry]')].some(input => !input.validity.valid || input.valueAsNumber !== currentBox()?.[input.dataset.geometry]) }),
  select: selectImage,
  overlay: renderOverlay,
  async commit(transform, undo = false) {
    if (navigating || importing || exporting || !ready || loadingError || drag || screen !== 'editor') throw new Error('Editor ocupado ou indisponível.');
    navigating = true;
    clearTimeout(saveTimer);
    try {
      await saveChain;
      const result = await transform(snapshot(), structuredClone(assistant));
      const candidate = validateProject(result.project);
      const memory = validateAssistant(result.assistant);
      await saveProject(activeProjectId, candidate, memory);
      if (undo) remember();
      project = candidate;
      assistant = memory;
      if (!labelFor(labelId)) labelId = project.labels[0].id;
      revision += 1;
      savedRevision = revision;
      saveError = false;
      render();
    } finally {
      navigating = false;
      if (savedRevision < revision && !loadingError) saveTimer = setTimeout(persist, 350);
      saveStatus();
    }
  },
});

function render() {
  if (screen === 'projects') { renderProjects(); return; }
  document.title = `Anoint — ${activeProjectName}`;
  const focused = document.activeElement;
  const focusKey = ['action', 'tool', 'label', 'editLabel', 'box', 'image'].find((key) => focused?.dataset?.[key]);
  const focusSelector = focused?.id ? `#${CSS.escape(focused.id)}` : focusKey ? `[data-${focusKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${CSS.escape(focused.dataset[focusKey])}"]` : null;
  const scroll = ['#stage', '.sidebar', '.inspector', '.annotation-list', '.thumbnails'].map((selector) => ({ selector, x: $(selector)?.scrollLeft || 0, y: $(selector)?.scrollTop || 0 }));
  batchIndex = Math.max(0, Math.min(batchIndex, Math.ceil(project.images.length / BATCH_SIZE) - 1));
  const image = currentImage() || { id: '', name: 'Nenhuma imagem', src: '', width: 1, height: 1, annotations: [], reviewed: false };
  const completed = project.images.filter((item) => item.reviewed).length;
  const percent = project.images.length ? Math.round(completed / project.images.length * 100) : 0;
  const box = currentBox();
  const filtered = filteredImages();
  const visibleIds = new Set(filtered.map((item) => item.id));
  for (const id of selectedImages) if (!visibleIds.has(id)) selectedImages.delete(id);
  $('#app').innerHTML = `<div class="app-shell" data-project-id="${escapeHTML(activeProjectId)}">
    <header class="topbar"><div class="brand"><span class="brand-mark">${icon('logo')}</span>anoint<span class="sr-only">Estúdio de anotação</span></div><span class="top-divider"></span><div class="project-crumb">${icon('folder')}<button class="project-back" data-action="projects">Projetos</button>${icon('chevron')}<strong title="${escapeHTML(activeProjectName)}">${escapeHTML(activeProjectName)}</strong><span class="pill">Local</span></div><div class="top-actions"><button class="icon-button" data-action="help" title="Como usar o Anoint" aria-label="Como usar o Anoint">${icon('help')}</button><button class="button" data-action="open-project" title="Importar JSON como novo projeto">${icon('folder')}<span>Importar JSON</span></button><button class="button primary" data-action="export">${icon('download')}Exportar projeto</button></div></header>
    <aside class="sidebar" aria-label="Projeto e classes"><div class="workspace-label"><span class="status-dot"></span>Seu espaço de trabalho</div><div class="project-card"><h2 title="${escapeHTML(activeProjectName)}">${escapeHTML(activeProjectName)}</h2><p>Um detalhe de cada vez.</p></div><button class="nav-item active" data-action="show-all">${icon('box')}Anotações<span class="count">${project.images.length}</span></button><button class="nav-item" data-action="import-images">${icon('upload')}Importar imagens</button><hr class="sidebar-separator" /><div class="section-label">Classes<button class="icon-button" data-action="new-class" title="Criar classe" aria-label="Criar classe">${icon('plus')}</button></div><div class="classes">${project.labels.map((label) => `<div class="class-item ${label.id === labelId ? 'selected' : ''}" data-color="${label.color}"><button class="class-select" data-label="${escapeHTML(label.id)}" aria-pressed="${label.id === labelId}"><span class="class-dot"></span><span class="class-name">${escapeHTML(label.name)}</span><span class="class-count">${project.images.reduce((count, item) => count + item.annotations.filter((annotation) => annotation.labelId === label.id).length, 0)}</span></button><button class="icon-button edit-class" data-edit-label="${escapeHTML(label.id)}" aria-label="Editar classe ${escapeHTML(label.name)}" title="Editar nome, cor ou remover classe">${icon('edit')}</button></div>`).join('')}</div><button class="button subtle edit-selected-class" data-action="edit-class">${icon('edit')}Editar classe selecionada</button><p class="sidebar-tip">Escolha uma classe para desenhar. Use o botão acima para editar nome, cor ou remover a classe.</p><div class="sidebar-bottom"><div class="agent-card"></div><button class="sidebar-help" data-action="shortcuts">${icon('keyboard')}Atalhos de teclado</button></div></aside>
    <main class="workspace"><p class="operation-error" role="alert" ${operationError ? '' : 'hidden'}>${escapeHTML(operationError)}</p><section class="editor" aria-label="Editor de imagem"><div class="editor-toolbar"><div class="tools" role="group" aria-label="Ferramentas de anotação"><button class="tool ${tool === 'select' ? 'selected' : ''}" data-tool="select" aria-pressed="${tool === 'select'}" title="Selecionar e mover (V)">${icon('cursor')}Selecionar<kbd>V</kbd></button><button class="tool ${tool === 'box' ? 'selected' : ''}" data-tool="box" aria-pressed="${tool === 'box'}" title="Desenhar caixa (B)">${icon('box')}Caixa<kbd>B</kbd></button></div><span class="toolbar-divider"></span><button class="icon-button" data-action="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" ${history.length ? '' : 'disabled'}>${icon('undo')}</button><button class="icon-button" data-action="redo" title="Refazer (Ctrl+Y)" aria-label="Refazer" ${future.length ? '' : 'disabled'}>${icon('redo')}</button><div class="zoom-controls"><button class="icon-button" data-action="zoom-out" title="Diminuir zoom" aria-label="Diminuir zoom">${icon('minus')}</button><span class="zoom-readout" aria-live="polite"></span><button class="icon-button" data-action="zoom-in" title="Aumentar zoom" aria-label="Aumentar zoom">${icon('plus')}</button><span class="toolbar-divider"></span><button class="icon-button" data-action="fit" title="Ajustar imagem à área de edição" aria-label="Ajustar imagem à área de edição">${icon('fit')}</button></div></div><div class="stage" id="stage"><div class="image-space"><div class="image-surface"><img ${sourceAttributes(image)} alt="${escapeHTML(image.name)}" draggable="false" /><svg class="annotation-layer ${tool === 'box' ? 'draw-mode' : ''}" viewBox="0 0 ${image.width} ${image.height}" aria-label="Anotações sobre ${escapeHTML(image.name)}"></svg></div></div></div><div class="editor-infobar">${icon('image')}<span class="image-filename" title="${escapeHTML(image.name)}">${escapeHTML(image.name)}</span><span class="dimensions">${image.id ? `${image.width} × ${image.height} px` : ''}</span><span class="image-badge">${image.id === 'demo-image' ? 'Exemplo ilustrado' : 'Arquivo local'}</span></div></section><div class="editor-hint"><span>${icon('info')}${tool === 'box' ? 'Clique e arraste para criar uma caixa.' : 'Selecione uma caixa para ajustar os detalhes.'}</span><span><kbd>B</kbd>Caixa <kbd>V</kbd>Selecionar <kbd>Esc</kbd>Cancelar</span></div><section class="filmstrip ${filmstripHidden ? 'collapsed' : ''}" aria-label="Imagens do projeto"><div class="filmstrip-heading"><h2>Imagens do projeto</h2><span class="number">${project.images.length}</span>${batchSelectorMarkup()}<button class="button subtle" data-action="select-images" aria-pressed="${selectingImages}" ${project.images.length ? '' : 'disabled'}>${selectingImages ? 'Cancelar seleção' : 'Selecionar imagens'}</button><button class="button subtle" data-action="toggle-filmstrip" aria-expanded="${!filmstripHidden}" aria-controls="project-thumbnails">${filmstripHidden ? 'Mostrar miniaturas' : 'Ocultar miniaturas'}</button><select id="image-filter" aria-label="Filtrar imagens"><option value="all" ${filter === 'all' ? 'selected' : ''}>Todas as imagens</option><option value="pending" ${filter === 'pending' ? 'selected' : ''}>Pendentes</option><option value="done" ${filter === 'done' ? 'selected' : ''}>Concluídas</option></select></div>${imageSelectionMarkup()}<div class="thumbnails" id="project-thumbnails" ${filmstripHidden ? 'hidden' : ''}>${filtered.map(thumbnailMarkup).join('')}${!filtered.length ? '<span class="filmstrip-empty">Nenhuma imagem neste filtro.</span>' : ''}<button class="add-images" data-action="import-images" title="Importar imagens">${icon('plus')}Adicionar</button></div></section></main>
    <aside class="inspector" aria-label="Anotações e propriedades"><div class="inspector-header"><h2>Anotações</h2><span class="number">${image.annotations.length}</span><button class="icon-button" data-action="draw" title="Criar anotação (B)" aria-label="Criar anotação">${icon('plus')}</button><button class="icon-button delete-box" data-action="delete" title="Excluir caixa selecionada (Delete)" aria-label="Excluir caixa selecionada" ${box ? '' : 'disabled'}>${icon('trash')}</button></div><div class="annotation-list">${image.annotations.map((annotation, index) => `<button class="annotation-row ${annotation.id === selectedId ? 'selected' : ''}" data-box="${escapeHTML(annotation.id)}" data-color="${labelFor(annotation.labelId).color}" aria-pressed="${annotation.id === selectedId}"><span class="class-dot"></span><span class="class-name">${escapeHTML(labelFor(annotation.labelId).name)}</span><span class="annotation-id">${String(index + 1).padStart(2, '0')}</span>${icon('box')}</button>`).join('') || '<div class="empty-inspector">Nenhuma anotação ainda.<br />Use <kbd>B</kbd> para criar a primeira.</div>'}</div>${box ? `<section class="inspector-section"><h3>Propriedades da seleção</h3><label class="field-label" for="box-class">Classe</label><select id="box-class">${project.labels.map((label) => `<option value="${escapeHTML(label.id)}" ${box.labelId === label.id ? 'selected' : ''}>${escapeHTML(label.name)}</option>`).join('')}</select><div class="geometry-grid">${[['x', 'Posição X'], ['y', 'Posição Y'], ['width', 'Largura'], ['height', 'Altura']].map(([key, name]) => `<div class="geometry-field"><label class="field-label" for="box-${key}">${name}</label><input type="number" id="box-${key}" data-geometry="${key}" value="${box[key]}" min="0" max="${key === 'x' || key === 'width' ? image.width : image.height}" step="any" required /><span class="unit">px</span></div>`).join('')}</div><button class="delete-annotation" data-action="delete">${icon('trash')}Excluir anotação<kbd>Del</kbd></button></section>` : '<div class="inspector-section empty-inspector">' + icon('cursor') + '<strong>Um lugar para cada detalhe.</strong><br />Selecione uma anotação para<br />ver e editar suas propriedades.</div>'}<section class="progress-section"><div class="progress-heading"><strong>Seu progresso</strong><span>${percent}%</span></div><div class="progress-track" role="progressbar" aria-label="Imagens concluídas" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill"></div></div><p class="progress-caption">${completed} de ${project.images.length} ${project.images.length === 1 ? 'imagem concluída' : 'imagens concluídas'}</p><button class="button complete-button ${image.reviewed ? 'done' : ''}" data-action="complete" aria-pressed="${image.reviewed}">${icon('checkCircle')}${image.reviewed ? 'Imagem concluída' : 'Concluir imagem'}<kbd>C</kbd></button><p class="inspector-footnote">${image.reviewed ? 'Clique para voltar a editar esta imagem.' : 'Tudo certo? Marque como concluída para continuar.'}</p></section></aside>
    <footer class="statusbar">${icon('checkCircle')}<button class="save-status" data-action="retry-save"></button><div class="statusbar-right"><span>${icon('lock')}MCP: imagens somente com sua autorização</span><button data-action="shortcuts">${icon('keyboard')}Atalhos</button><span class="app-version">ANOINT · v${escapeHTML(appVersion)}</span></div></footer></div>`;
  $('[data-action="import-images"]').insertAdjacentHTML('afterend', `<button class="nav-item" data-action="import-folder">${icon('folder')}Importar pasta</button>`);
  document.querySelectorAll('[data-color]').forEach((element) => element.style.setProperty('--label-color', element.dataset.color));
  $('.progress-fill').style.setProperty('--progress', `${percent}%`);
  saveStatus();
  $('.agent-card').innerHTML = assistantUI.card();
  $('.annotation-layer')?.addEventListener('pointerdown', pointerDown);
  $('.annotation-layer').addEventListener('pointermove', pointerMove);
  $('.annotation-layer').addEventListener('pointerup', pointerUp);
  $('.annotation-layer').addEventListener('pointercancel', cancelDrag);
  if (!project.images.length) {
    $('.image-space').innerHTML = '<div class="empty-editor"><strong>Nenhuma imagem no projeto</strong><p>Importe imagens ou uma pasta para começar.</p><button class="button primary" data-action="import-folder">Importar pasta</button></div>';
    $('.complete-button').disabled = true;
  }
  loadBatch();
  observer.disconnect();
  observer.observe($('#stage'));
  fitImage();
  for (const item of scroll) {
    $(item.selector).scrollLeft = item.x;
    $(item.selector).scrollTop = item.y;
  }
  if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
  if (ready && !loadingError) rememberView();
}

function fitImage() {
  const image = currentImage();
  const stage = $('#stage');
  if (!stage || !image) return;
  const rect = stage.getBoundingClientRect();
  const viewport = [image.id, image.width, image.height, rect.width, rect.height].join(':');
  if (viewport !== fittedViewport) {
    fittedViewport = viewport;
    // O zoom pode exibir barras de rolagem; elas não devem recalcular a escala base.
    fitScale = Math.max(.02, Math.min((stage.clientWidth - 60) / image.width, (stage.clientHeight - 60) / image.height, 1));
  }
  const surface = $('.image-surface');
  surface.style.width = `${image.width * fitScale * zoom}px`;
  surface.style.height = `${image.height * fitScale * zoom}px`;
  $('.zoom-readout').textContent = `${Math.round(fitScale * zoom * 100)}%`;
  renderOverlay();
}

function refreshProgress() {
  const scrollLeft = $('.thumbnails').scrollLeft;
  const image = currentImage();
  const count = project.images.filter((item) => item.reviewed).length;
  const percent = Math.round(count / project.images.length * 100);
  $('.progress-heading > span').textContent = `${percent}%`;
  $('.progress-fill').style.setProperty('--progress', `${percent}%`);
  $('.progress-track').setAttribute('aria-valuenow', percent);
  $('.progress-caption').textContent = `${count} de ${project.images.length} ${project.images.length === 1 ? 'imagem concluída' : 'imagens concluídas'}`;
  const button = $('.complete-button');
  button.classList.toggle('done', image.reviewed);
  button.setAttribute('aria-pressed', image.reviewed);
  button.innerHTML = `${icon('checkCircle')}${image.reviewed ? 'Imagem concluída' : 'Concluir imagem'}<kbd>C</kbd>`;
  $('.inspector-footnote').textContent = image.reviewed ? 'Clique para voltar a editar esta imagem.' : 'Tudo certo? Marque como concluída para continuar.';
  const filtered = filteredImages();
  $('.thumbnails').innerHTML = filtered.map(thumbnailMarkup).join('') + (!filtered.length ? '<span class="filmstrip-empty">Nenhuma imagem neste filtro.</span>' : '') + `<button class="add-images" data-action="import-images" title="Importar imagens">${icon('plus')}Adicionar</button>`;
  $('.thumbnails').scrollLeft = scrollLeft;
  $('.batch-controls').outerHTML = batchSelectorMarkup();
  refreshImageSelection();
  updateSources();
}

function thumbnailMarkup(item) {
  return `<div class="thumbnail-item ${selectedImages.has(item.id) ? 'marked' : ''}">${selectingImages ? `<input type="checkbox" class="thumbnail-select" data-select-image="${escapeHTML(item.id)}" aria-label="Selecionar ${escapeHTML(item.name)} para remoção" ${selectedImages.has(item.id) ? 'checked' : ''} />` : ''}<button class="thumbnail ${item.id === imageId ? 'active' : ''}" data-image="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.name)}, ${item.reviewed ? 'concluída' : item.annotations.length ? 'em edição' : 'pendente'}" aria-pressed="${item.id === imageId}"><img ${sourceAttributes(item)} alt="" /><span class="thumbnail-caption"><span class="filename">${escapeHTML(item.name)}</span><span class="thumb-status ${item.reviewed ? 'done' : item.annotations.length ? 'in-progress' : ''}"></span></span></button><button class="thumbnail-delete icon-button" data-action="delete-image" data-id="${escapeHTML(item.id)}" title="Excluir imagem" aria-label="Excluir imagem ${escapeHTML(item.name)}">${icon('trash')}</button></div>`;
}

function imageSelectionMarkup() {
  return selectingImages ? `<div class="image-selection" role="group" aria-label="Remover várias imagens"><span role="status">${selectedImages.size} selecionada(s)</span><button class="button subtle" data-action="select-visible">Selecionar visíveis</button><button class="button subtle" data-action="clear-images">Limpar</button><button class="button danger" data-action="remove-images" ${selectedImages.size ? '' : 'disabled'}>Remover ${selectedImages.size}</button><span class="selection-hint">Seleção neste lote e filtro. Os arquivos originais serão preservados.</span></div>` : '';
}

function refreshImageSelection() {
  const visibleIds = new Set(filteredImages().map((item) => item.id));
  for (const id of selectedImages) if (!visibleIds.has(id)) selectedImages.delete(id);
  const toolbar = $('.image-selection');
  if (toolbar) {
    toolbar.querySelector('[role="status"]').textContent = `${selectedImages.size} selecionada(s)`;
    const remove = toolbar.querySelector('[data-action="remove-images"]');
    remove.textContent = `Remover ${selectedImages.size}`;
    remove.disabled = !selectedImages.size;
  }
  for (const input of document.querySelectorAll('[data-select-image]')) {
    input.checked = selectedImages.has(input.dataset.selectImage);
    input.closest('.thumbnail-item').classList.toggle('marked', input.checked);
  }
}

async function removeSelectedImages() {
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating || importing || exporting) return;
  if (loadingError) { notify('A restauração falhou. Exporte uma cópia e resolva o salvamento antes de remover imagens.', true); return; }
  refreshImageSelection();
  const images = filteredImages().filter((image) => selectedImages.has(image.id));
  if (!images.length) return;
  const annotations = images.reduce((count, image) => count + image.annotations.length, 0);
  if (!confirm(`Remover ${images.length} imagem(ns) e ${annotations} anotação(ões) do projeto? Os arquivos originais serão preservados. Esta remoção não pode ser desfeita.`)) return;
  cancelDrag();
  importing = true;
  showLoading(`Removendo ${images.length} imagem(ns)…`);
  try {
    await paintLoading();
    const next = removeImages(project, images.map((image) => image.id));
    // Só libera as cópias locais depois de confirmar a gravação da remoção.
    clearTimeout(saveTimer);
    await saveChain;
    await saveProject(activeProjectId, next, assistant);
    project = next;
    if (!project.images.some((image) => image.id === imageId)) imageId = project.images[0]?.id;
    selectedId = null;
    history = [];
    future = [];
    batchSelections.clear();
    imageSelections.clear();
    clearImageSelection();
    batchIndex = Math.max(0, Math.floor(project.images.findIndex((image) => image.id === imageId) / BATCH_SIZE));
    revision += 1;
    savedRevision = revision;
    saveError = false;
    render();
    try { await pruneImages([project, ...history, ...future, ...[...sessions.values()].flatMap((session) => [session.project, ...session.history, ...session.future])]); }
    catch (error) { notify(`Imagens removidas. Não foi possível liberar as cópias locais sem uso. ${error.message}`, true); return; }
    notify(`${images.length} imagem(ns) removida(s) do projeto. Arquivos originais preservados.`);
  } catch (error) {
    notify(`Não foi possível concluir a remoção. ${error.message}`, true);
    if (savedRevision < revision && !loadingError) persist();
  } finally { importing = false; hideLoading(); }
}

function batchSelectorMarkup() {
  const groups = batches(project.images);
  return `<div class="batch-controls"><button class="icon-button" data-action="previous-batch" aria-label="Lote anterior" ${batchIndex === 0 ? 'disabled' : ''}>‹</button><select id="batch-select" aria-label="Selecionar lote">${groups.map((group) => `<option value="${group.index}" ${group.index === batchIndex ? 'selected' : ''}>Lote ${group.index + 1}/${groups.length} · ${group.completed}/${group.items.length}${group.completed === group.items.length ? ' · Concluído' : ''}</option>`).join('')}</select><button class="icon-button" data-action="next-batch" aria-label="Próximo lote" ${batchIndex >= groups.length - 1 ? 'disabled' : ''}>›</button></div>`;
}

async function requestImport(folder) {
  if (importing || exporting) return;
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating || importing || exporting) return;
  if (!window.anointFiles) { $(folder ? '#folder-input' : '#image-input').click(); return; }
  cancelDrag();
  importing = true;
  showLoading(folder ? 'Selecionando e verificando imagens da pasta…' : 'Selecionando e verificando imagens…');
  try {
    await paintLoading();
    const result = await window.anointFiles.pick(folder);
    if (!result.images.length && !result.errors.length) return;
    if (project.images.length + result.images.length > MAX_IMAGES) throw new Error(`O projeto suporta ${MAX_IMAGES} imagens. Selecione uma pasta menor.`);
    const seen = new Set(project.images.map((image) => image.src));
    const images = result.images.filter((image) => !seen.has(image.src) && seen.add(image.src));
    const candidate = validateProject({ ...project, images: [...project.images, ...images] });
    if (images.length) {
      clearImageSelection();
      remember();
      project = candidate;
      imageId = images[0].id;
      selectedId = null;
      batchIndex = Math.floor(project.images.findIndex((image) => image.id === imageId) / BATCH_SIZE);
      filter = 'all';
      zoom = 1;
      changed();
      render();
    }
    notify(`${images.length} imagem(ns) adicionada(s). ${result.ignored || 0} ignorada(s). ${result.errors.join('; ')}`, Boolean(result.errors.length));
  } catch (error) { notify(`Não foi possível importar. ${error.message}`, true); }
  finally { importing = false; hideLoading(); }
}

async function deleteImage(id) {
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating || importing || exporting) return;
  const image = project.images.find((item) => item.id === id);
  if (!image) return;
  importing = true;
  showLoading('Removendo imagem…');
  try {
    await paintLoading();
    let sources = [image.src];
    const native = image.src.startsWith('anoint-image://');
    let trashed = false;
    const unavailable = native && window.anointFiles?.available && (await window.anointFiles.available([image.src])).includes(image.src);
    if (native && (unavailable || cache.entries.get(image.src)?.error)) {
      if (!confirm(`O arquivo “${image.name}” está indisponível. Remover somente a referência e suas anotações deste projeto? Os outros projetos serão preservados.`)) return;
    } else if (native) {
      if (!window.anointFiles) throw new Error('Use o aplicativo desktop para gerenciar este arquivo.');
      const records = await listProjects();
      const others = await Promise.all(records.filter((record) => record.id !== activeProjectId).map((record) => loadProject(record.id)));
      const shared = others.some((value) => value?.images.some((item) => item.src === image.src))
        || [...sessions].some(([id, session]) => id !== activeProjectId && [session.project, ...session.history, ...session.future].some((value) => value.images.some((item) => item.src === image.src)));
      if (shared) {
        if (!confirm(`Esta imagem também é usada em outro projeto. Remover “${image.name}” somente deste projeto? O arquivo original e os outros projetos serão preservados.`)) return;
      } else {
        // Capabilities diferentes do mesmo arquivo também são cobertas pelo aviso nativo sobre todas as importações.
        const result = await window.anointFiles.trash(image.src);
        if (!result.deleted) return;
        sources = result.sources || sources;
        trashed = true;
      }
    } else if (!confirm(`Remover “${image.name}” e suas anotações do projeto? O arquivo original e os outros projetos serão preservados. Esta remoção não pode ser desfeita.`)) return;
    cancelDrag();
    const removed = new Set(sources);
    const oldIndex = project.images.findIndex((item) => item.id === imageId);
    project.images = project.images.filter((item) => !removed.has(item.src));
    if (!project.images.some((item) => item.id === imageId)) imageId = project.images[Math.min(oldIndex, project.images.length - 1)]?.id;
    selectedId = null;
    clearImageSelection();
    history = [];
    future = [];
    batchSelections.clear();
    imageSelections.clear();
    batchIndex = Math.max(0, Math.floor(project.images.findIndex((item) => item.id === imageId) / BATCH_SIZE));
    changed();
    render();
    await persist();
    if (!saveError) await pruneImages([project, ...history, ...future, ...[...sessions.values()].flatMap((session) => [session.project, ...session.history, ...session.future])]);
    if (!saveError) notify(trashed ? 'Arquivo enviado à Lixeira e removido do projeto.' : 'Imagem removida somente deste projeto.');
  } catch (error) { notify(`Não foi possível excluir. ${error.message}`, true); }
  finally { importing = false; hideLoading(); }
}

const observer = new ResizeObserver(() => requestAnimationFrame(fitImage));

function renderOverlay(draft = null) {
  const image = currentImage();
  const svg = $('.annotation-layer');
  if (!svg || !image) return;
  const scale = fitScale * zoom;
  svg.innerHTML = image.annotations.map((original) => {
    const annotation = drag?.preview && original.id === selectedId ? drag.preview : original;
    const label = labelFor(annotation.labelId);
    const selected = annotation.id === selectedId;
    const nameWidth = Math.min((label.name.length * 7 + 18) / scale, image.width - annotation.x);
    const tagY = annotation.y >= 24 / scale ? -22 / scale : 0;
    return `<g class="annotation ${selected ? 'is-selected' : ''}" data-annotation="${escapeHTML(annotation.id)}" data-box-color="${label.color}" transform="translate(${annotation.x} ${annotation.y})"><rect class="box" width="${annotation.width}" height="${annotation.height}"/><rect class="box-name" x="0" y="${tagY}" width="${nameWidth}" height="${22 / scale}" rx="${3 / scale}"/><text x="${7 / scale}" y="${tagY + 15 / scale}" font-size="${11 / scale}">${escapeHTML(label.name)}</text>${selected && tool === 'select' ? [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]].map(([handle, x, y]) => `<rect class="resize-handle" data-handle="${handle}" x="${annotation.width * x - 3 / scale}" y="${annotation.height * y - 3 / scale}" width="${6 / scale}" height="${6 / scale}" rx="${1 / scale}"/>`).join('') : ''}</g>`;
  }).join('') + assistantUI.overlay(image, scale) + (draft ? `<rect class="drawing-box" x="${draft.x}" y="${draft.y}" width="${draft.width}" height="${draft.height}"/>` : '');
  svg.querySelectorAll('[data-box-color]').forEach((element) => element.style.setProperty('--box-color', element.dataset.boxColor));
  svg.querySelectorAll('[data-handle]').forEach((element) => { element.style.cursor = `${element.dataset.handle}-resize`; });
}

function point(event) {
  const rect = $('.annotation-layer').getBoundingClientRect();
  const image = currentImage();
  return { x: Math.max(0, Math.min(image.width, (event.clientX - rect.left) / rect.width * image.width)), y: Math.max(0, Math.min(image.height, (event.clientY - rect.top) / rect.height * image.height)) };
}

function pointerDown(event) {
  if (event.button !== 0 || navigating || importing || exporting || !ready || !currentImage() || $('.image-surface').matches('.image-loading, .image-error')) return;
  event.preventDefault();
  document.activeElement?.blur();
  const svg = $('.annotation-layer');
  const origin = point(event);
  const annotation = event.target.closest('[data-annotation]');
  if (tool === 'box') {
    drag = { type: 'draw', start: origin, pointerId: event.pointerId };
  } else if (annotation) {
    selectedId = annotation.dataset.annotation;
    const box = currentBox();
    labelId = box.labelId;
    drag = { type: event.target.dataset.handle ? 'resize' : 'move', handle: event.target.dataset.handle, start: origin, before: { ...box }, pointerId: event.pointerId };
    renderOverlay();
  } else {
    selectedId = null;
    render();
    return;
  }
  svg.setPointerCapture(event.pointerId);
}

function pointerMove(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const end = point(event);
  const image = currentImage();
  if (drag.type === 'draw') {
    renderOverlay(normalizeBox(drag.start, end, image.width, image.height));
    return;
  }
  const dx = end.x - drag.start.x;
  const dy = end.y - drag.start.y;
  if (drag.type === 'move') drag.preview = moveBox(drag.before, dx, dy, image.width, image.height);
  else {
    const before = drag.before;
    const minWidth = Math.min(1, before.width), minHeight = Math.min(1, before.height);
    let left = before.x, top = before.y, right = before.x + before.width, bottom = before.y + before.height;
    if (drag.handle.includes('w')) left = Math.min(right - minWidth, Math.max(0, before.x + dx));
    if (drag.handle.includes('e')) right = Math.max(left + minWidth, Math.min(image.width, before.x + before.width + dx));
    if (drag.handle.includes('n')) top = Math.min(bottom - minHeight, Math.max(0, before.y + dy));
    if (drag.handle.includes('s')) bottom = Math.max(top + minHeight, Math.min(image.height, before.y + before.height + dy));
    drag.preview = clampBox({ ...before, x: left, y: top, width: right - left, height: bottom - top }, image.width, image.height);
  }
  renderOverlay();
}

function pointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  pointerMove(event);
  const operation = drag;
  drag = null;
  const image = currentImage();
  if (operation.type === 'draw') {
    const box = normalizeBox(operation.start, point(event), image.width, image.height);
    if (box) {
      if (image.annotations.length >= MAX_ANNOTATIONS_PER_IMAGE || project.images.reduce((count, item) => count + item.annotations.length, 0) >= MAX_PROJECT_ANNOTATIONS) {
        render();
        notify('Limite de anotações atingido: 10.000 por imagem ou 100.000 por projeto.', true);
        return;
      }
      remember();
      const annotation = { id: uid(), labelId, ...box };
      image.annotations.push(annotation);
      selectedId = annotation.id;
      image.reviewed = false;
      changed();
    }
  } else if (operation.preview && JSON.stringify(operation.preview) !== JSON.stringify(operation.before)) {
    remember();
    Object.assign(currentBox(), operation.preview);
    image.reviewed = false;
    changed();
  }
  render();
}

function cancelDrag() {
  if (!drag) return;
  drag = null;
  render();
}

function selectImage(id) {
  if (importing) return;
  const index = project.images.findIndex((image) => image.id === id);
  if (index < 0) return;
  batchIndex = Math.floor(index / BATCH_SIZE);
  cancelDrag();
  imageSelections.set(imageId, selectedId);
  imageId = id;
  selectedId = imageSelections.get(id) || null;
  if (!currentBox()) selectedId = null;
  zoom = 1;
  render();
  $('#stage').scrollTo(0, 0);
  const thumbnail = document.querySelector('.thumbnail.active');
  thumbnail?.focus({ preventScroll: true });
  thumbnail?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function navigateImage(direction) {
  const images = filteredImages();
  if (!images.length) return;
  const index = images.findIndex((item) => item.id === imageId);
  const next = images[Math.max(0, Math.min(images.length - 1, index + direction))];
  if (next) selectImage(next.id);
}

function deleteAnnotation() {
  if (!currentBox()) return;
  remember();
  const image = currentImage();
  image.annotations = image.annotations.filter((box) => box.id !== selectedId);
  image.reviewed = false;
  selectedId = null;
  changed();
  render();
  notify('Anotação excluída. Ctrl+Z para desfazer.');
}

function completeImage() {
  if (!currentImage()) return;
  remember();
  currentImage().reviewed = !currentImage().reviewed;
  changed();
  render();
  notify(currentImage().reviewed ? 'Imagem concluída. Seu olhar fez a diferença.' : 'Imagem reaberta para edição.');
}

function openClassDialog(id = null) {
  editingLabelId = id;
  const label = id ? labelFor(id) : null;
  $('#class-title').textContent = label ? 'Editar classe' : 'Nova classe';
  $('#class-name').value = label?.name || '';
  $('#class-color').value = label?.color.length === 4 ? `#${[...label.color.slice(1)].map((char) => char + char).join('')}` : label?.color || '#8b5cf6';
  $('#class-error').textContent = '';
  $('#class-form button[type="submit"]').textContent = label ? 'Salvar classe' : 'Criar classe';
  $('#class-removal').hidden = !label;
  const affected = project.images.filter((image) => image.annotations.some((box) => box.labelId === id));
  const count = affected.reduce((total, image) => total + image.annotations.filter((box) => box.labelId === id).length, 0);
  const last = project.labels.length === 1;
  $('#class-impact').textContent = last ? 'Mantenha pelo menos uma classe. Crie outra antes de remover esta.' : `${count} anotação(ões) em ${affected.length} imagem(ns). ${count ? 'Escolha a classe que receberá as caixas; as imagens afetadas voltarão a pendentes.' : 'Esta classe não possui anotações.'} Você pode desfazer a remoção com Ctrl+Z.`;
  $('#class-replacement-field').hidden = !count || last;
  $('#class-replacement').innerHTML = '<option value="">Escolha uma classe</option>' + project.labels.filter((item) => item.id !== id).map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('');
  $('[data-action="delete-class"]').disabled = last;
  $('#class-dialog').showModal();
  $('#class-name').focus();
  $('#class-name').select();
}

function deleteClass() {
  const label = labelFor(editingLabelId);
  if (!label) return;
  try {
    const next = removeClass(project, label.id, $('#class-replacement').value || undefined);
    const count = project.images.reduce((total, image) => total + image.annotations.filter((box) => box.labelId === label.id).length, 0);
    const target = labelFor($('#class-replacement').value);
    if (!confirm(`Remover a classe “${label.name}”? ${count ? `${count} anotação(ões) será(ão) transferida(s) para “${target.name}”.` : 'Nenhuma anotação será alterada.'}`)) return;
    remember();
    project = next;
    if (labelId === label.id) labelId = target?.id || project.labels[0].id;
    changed();
    $('#class-dialog').close();
    render();
    notify('Classe removida. Ctrl+Z para desfazer.');
  } catch (error) { $('#class-error').textContent = error.message; }
}

async function importImages(files, folder = false) {
  if (!files.length || importing || exporting) return;
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (navigating || importing || exporting) return;
  const types = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp' };
  const mime = (file) => /^image\/(png|jpeg|webp|avif|gif|bmp)$/.test(file.type) ? file.type : `image/${types[file.name.split('.').at(-1).toLowerCase()] || ''}`;
  const ignored = folder ? files.filter((file) => mime(file) === 'image/').length : 0;
  if (folder) files = files.filter((file) => mime(file) !== 'image/');
  if (!files.length) { notify('A pasta não contém imagens compatíveis (PNG, JPEG, WebP, AVIF, GIF ou BMP).', true); return; }
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
  files.sort((a, b) => {
    const left = a.webkitRelativePath || a.name;
    const right = b.webkitRelativePath || b.name;
    return collator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
  });
  if (project.images.length >= MAX_IMAGES) { notify('Este projeto suporta até 10000 imagens, em lotes de 100.', true); return; }
  cancelDrag();
  importing = true;
  showLoading(`Importando ${files.length} imagem(ns)…`, 0, files.length);
  await paintLoading();
  const imported = [];
  const errors = [];
  try {
    for (const [index, file] of files.entries()) {
      showLoading(`Importando imagem ${index + 1} de ${files.length}…`, index, files.length);
      if (index % 10 === 0) await paintLoading();
      try {
        if (project.images.length + imported.length >= MAX_IMAGES) throw new Error('limite de 10000 imagens por projeto');
        const name = file.webkitRelativePath || file.name;
        if (name.length > 1024 || /^(\/|[a-z]:)/i.test(name) || name.replaceAll('\\', '/').split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('caminho inválido ou acima de 1024 caracteres');
        if (mime(file) === 'image/') throw new Error('formato não suportado');
        if (file.size > 15 * 1024 * 1024) throw new Error('limite de 15 MB por imagem');
        const blob = file.slice(0, file.size, mime(file));
        const url = URL.createObjectURL(blob);
        const decoded = new Image();
        try {
          decoded.src = url;
          await decoded.decode();
          if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth > 30000 || decoded.naturalHeight > 30000 || decoded.naturalWidth * decoded.naturalHeight > 100_000_000) throw new Error('dimensões não suportadas (máximo de 100 milhões de pixels)');
          const image = { id: uid(), name, src: 'asset:00000000-0000-0000-0000-000000000000', width: decoded.naturalWidth, height: decoded.naturalHeight, annotations: [], reviewed: false };
          validateProject({ ...project, images: [...project.images, ...imported, image] });
          image.src = await storeImage(blob);
          imported.push(image);
        } finally { decoded.src = ''; URL.revokeObjectURL(url); }
      } catch (error) { errors.push(`${file.webkitRelativePath || file.name}: ${error.message}`); }
    }
    if (imported.length) {
      try { validateProject({ ...project, images: [...project.images, ...imported] }); }
      catch (error) { render(); notify(`As imagens não foram adicionadas. ${error.message}`, true); return; }
      remember();
      clearImageSelection();
      project.images.push(...imported);
      imageId = imported[0].id;
      batchIndex = Math.floor(project.images.findIndex((image) => image.id === imageId) / BATCH_SIZE);
      selectedId = null;
      filter = 'all';
      zoom = 1;
      changed();
    }
    render();
    if (errors.length) notify(`${imported.length} imagem(ns) aberta(s). ${errors.join('; ')}`, true);
    else notify(`${imported.length} ${imported.length === 1 ? 'imagem pronta para seu olhar.' : 'imagens prontas para seu olhar.'}${ignored ? ` ${ignored} arquivo(s) de outros formatos ignorado(s).` : ''}`);
  } catch (error) { notify(`Não foi possível importar. ${error.message}`, true); }
  finally { importing = false; hideLoading(); }
}

async function openProject(file) {
  if (!file || importing || exporting) return;
  try { await assistantUI.flush(); } catch (error) { notify(error.message, true); return; }
  if (importing || exporting || navigating) return;
  cancelDrag();
  importing = true;
  showLoading('Abrindo e validando projeto…');
  try {
    await paintLoading();
    if (file.size > 256 * 1024 * 1024) throw new Error('O arquivo excede o limite de 256 MB.');
    const backup = JSON.parse(await file.text());
    let value = validateProject(backup);
    const memory = validateAssistant(backup.assistant);
    if (value.images.some((image) => /^(asset:|anoint-image:)/.test(image.src))) throw new Error('Abra uma cópia JSON portátil com as imagens incorporadas.');
    if (!value.labels.length) throw new Error('O projeto precisa ter pelo menos uma classe.');
    for (const [index, image] of value.images.entries()) {
      showLoading(`Verificando imagem ${index + 1} de ${value.images.length}…`, index, value.images.length);
      const decoded = new Image();
      decoded.src = image.src;
      await decoded.decode();
      if (decoded.naturalWidth !== image.width || decoded.naturalHeight !== image.height) throw new Error(`Dimensões diferentes das originais em ${image.name}.`);
    }
    showLoading('Salvando o projeto importado…');
    await commitEditor();
    const name = file.name.replace(/\.json$/i, '').trim().slice(0, 200) || 'Projeto importado';
    const record = await createLocalProject(name, value, memory);
    library = await listProjects();
    await activateProject(record.id, record);
    notify('Projeto aberto como nova cópia. Seus outros projetos foram preservados.');
  } catch (error) { notify(`Não foi possível abrir o projeto. ${error.message}`, true); }
  finally { importing = false; hideLoading(); }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function openExportDialog() {
  $('#export-class').innerHTML = project.labels.map((label) => `<option value="${escapeHTML(label.id)}">${escapeHTML(label.name)}</option>`).join('');
  $('#export-class').value = labelId;
  $('#export-error').textContent = '';
  updateExportOptions();
  $('#export-dialog').showModal();
}

function updateExportOptions() {
  const format = $('#export-format').value;
  $('#export-class-field').hidden = format !== 'tracknet';
  $('#export-note').textContent = format === 'json'
    ? 'Cópia completa com imagens e anotações para reabrir no Anoint.'
    : 'ZIP com todas as imagens importadas, inclusive pendentes. O exemplo ilustrado fica excluído deste dataset. Imagens sem caixas são exportadas como ausência de objetos.';
}

async function exportProject() {
  if (!ready || exporting || importing || navigating || screen !== 'editor') return;
  try { await assistantUI.flush(); } catch (error) { $('#export-error').textContent = error.message; return; }
  if (exporting || importing || navigating) return;
  cancelDrag();
  exporting = true;
  const submit = $('#export-form button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Preparando…';
  $('#export-error').textContent = '';
  showLoading('Preparando exportação…');
  try {
    await paintLoading();
    const format = $('#export-format').value;
    const value = validateProject(project);
    let blob;
    if (!['json', 'yolo'].includes(format)) throw new Error('TrackNet está temporariamente desabilitado.');
    if (format === 'json') blob = new Blob([JSON.stringify(await portableProject(value, assistant))], { type: 'application/json' });
    else {
      value.images = value.images.filter((image) => image.src !== './assets/demo-street.svg');
      if (!value.images.length) throw new Error('Importe imagens reais antes de exportar um dataset.');
      blob = await exportDataset(value, format, { loadSource: imageBlob });
    }
    download(blob, `anoint-${format === 'json' ? 'projeto' : format}-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'zip'}`);
    $('#export-dialog').close();
    notify(`Exportação ${format.toUpperCase()} iniciada. Confira a janela de salvamento ou a pasta de downloads.`);
  } catch (error) { $('#export-error').textContent = `Não foi possível exportar. ${error.message}`; }
  finally { exporting = false; submit.disabled = false; submit.textContent = 'Exportar'; hideLoading(); }
}

document.addEventListener('click', (event) => {
  if (importing || exporting || navigating) return;
  const close = event.target.closest('[data-close-dialog]');
  if (close) { if (!navigating && !importing && !exporting) close.closest('dialog').close(); return; }
  const element = event.target.closest('[data-action], [data-tool], [data-label], [data-edit-label], [data-box], [data-image]');
  if (!element || !ready) return;
  if (drag) cancelDrag();
  if (element.dataset.tool) { tool = element.dataset.tool; render(); return; }
  if (element.dataset.editLabel) { openClassDialog(element.dataset.editLabel); return; }
  if (element.dataset.label) { labelId = element.dataset.label; selectedId = null; render(); return; }
  if (element.dataset.image) { selectImage(element.dataset.image); return; }
  if (element.dataset.box) { selectedId = element.dataset.box; labelId = currentBox().labelId; tool = 'select'; render(); return; }
  const action = element.dataset.action;
  if (action === 'projects') { showProjects(); return; }
  if (action === 'open-local-project') { openLocalProject(element.dataset.projectId); return; }
  if (action === 'new-project') {
    $('#project-form').reset();
    $('#project-error').textContent = '';
    $('#project-dialog').showModal();
    $('#project-name').focus();
    return;
  }
  if (action === 'retry-library') { start(); return; }
  if (action === 'help') $('#help-dialog').showModal();
  if (action === 'shortcuts') $('#shortcuts-dialog').showModal();
  if (action === 'new-class') openClassDialog();
  if (action === 'edit-class') openClassDialog(labelId);
  if (action === 'delete-class') deleteClass();
  if (action === 'select-images') { selectingImages = !selectingImages; selectedImages.clear(); if (selectingImages) filmstripHidden = false; render(); }
  if (action === 'select-visible') { for (const image of filteredImages()) selectedImages.add(image.id); refreshImageSelection(); }
  if (action === 'clear-images') { selectedImages.clear(); refreshImageSelection(); }
  if (action === 'remove-images') removeSelectedImages();
  if (action === 'import-images') requestImport(false);
  if (action === 'import-folder') requestImport(true);
  if (action === 'open-project') $('#project-input').click();
  if (action === 'export') openExportDialog();
  if (action === 'undo' || action === 'redo') updateHistory(action);
  if (action === 'delete') deleteAnnotation();
  if (action === 'delete-image') deleteImage(element.dataset.id);
  if (action === 'toggle-filmstrip') { filmstripHidden = !filmstripHidden; render(); $('[data-action=toggle-filmstrip]').focus(); }
  if (action === 'previous-batch') selectBatch(batchIndex - 1);
  if (action === 'next-batch') selectBatch(batchIndex + 1);
  if (action === 'complete') completeImage();
  if (action === 'show-all') { clearImageSelection(); filter = 'all'; render(); }
  if (action === 'draw') { tool = 'box'; render(); }
  if (action === 'zoom-in' || action === 'zoom-out') { zoom = Math.min(8, Math.max(.25, zoom * (action === 'zoom-in' ? 1.25 : .8))); fitImage(); }
  if (action === 'fit') { zoom = 1; fitImage(); }
  if (action === 'retry-save' && (saveError || loadingError)) {
    if (loadingError && !confirm('O projeto anterior não pôde ser restaurado. Salvar agora irá substituí-lo. Já exportou a cópia que deseja preservar?')) return;
    loadingError = false;
    persist();
  }
});

document.addEventListener('change', (event) => {
  if (!ready || navigating || importing || exporting) return;
  const target = event.target;
  if (target.dataset.selectImage) {
    if (target.checked) selectedImages.add(target.dataset.selectImage);
    else selectedImages.delete(target.dataset.selectImage);
    refreshImageSelection();
    return;
  }
  if (target.id === 'image-input') { importImages([...target.files]); target.value = ''; return; }
  if (target.id === 'folder-input') { importImages([...target.files], true); target.value = ''; return; }
  if (target.id === 'export-format') { updateExportOptions(); return; }
  if (target.id === 'project-input') { openProject(target.files[0]); target.value = ''; return; }
  if (target.id === 'batch-select') { selectBatch(Number(target.value)); return; }
  if (target.id === 'image-filter') { clearImageSelection(); filter = target.value; render(); return; }
  if (target.id === 'box-class' && currentBox()) {
    remember();
    currentBox().labelId = target.value;
    labelId = target.value;
    currentImage().reviewed = false;
    changed();
    render();
  }
  if (target.dataset.geometry && currentBox()) {
    if (!target.validity.valid || !Number.isFinite(target.valueAsNumber) || (['width', 'height'].includes(target.dataset.geometry) && target.valueAsNumber <= 0)) { notify('Informe uma medida válida dentro dos limites da imagem.', true); target.value = currentBox()[target.dataset.geometry]; return; }
    remember();
    const image = currentImage();
    Object.assign(currentBox(), clampBox({ ...currentBox(), [target.dataset.geometry]: target.valueAsNumber }, image.width, image.height));
    image.reviewed = false;
    changed();
    renderOverlay();
    for (const input of document.querySelectorAll('[data-geometry]')) input.value = currentBox()[input.dataset.geometry];
    refreshProgress();
  }
});

for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel', (event) => { if (navigating || importing || exporting) event.preventDefault(); });

$('#export-form').addEventListener('submit', (event) => {
  event.preventDefault();
  exportProject();
});

$('#class-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!ready || navigating || importing || exporting || screen !== 'editor') return;
  const name = $('#class-name').value.trim();
  const color = $('#class-color').value;
  if (!name) { $('#class-error').textContent = 'Dê um nome à classe.'; return; }
  if (project.labels.some((label) => label.id !== editingLabelId && label.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { $('#class-error').textContent = 'Já existe uma classe com esse nome.'; return; }
  if (!editingLabelId && project.labels.length >= 100) { $('#class-error').textContent = 'O projeto suporta até 100 classes.'; return; }
  try {
    const next = editingLabelId ? updateClass(project, editingLabelId, { name, color }) : null;
    remember();
    if (next) project = next;
    else { labelId = uid(); project.labels.push({ id: labelId, name, color }); }
  } catch (error) { $('#class-error').textContent = error.message; return; }
  changed();
  $('#class-dialog').close();
  render();
});

document.addEventListener('keydown', (event) => {
  if (screen === 'editor' && !navigating && ready && !importing && !exporting && selectingImages && event.key === 'Escape' && !document.querySelector('dialog[open]')) { clearImageSelection(); render(); return; }
  if (!ready || screen !== 'editor' || navigating || importing || exporting || event.target.closest('input, select, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); updateHistory(event.shiftKey ? 'redo' : 'undo'); return; }
  if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); updateHistory('redo'); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') { cancelDrag(); selectedId = null; render(); return; }
  if (drag) return;
  if (key === 'b' || key === 'v') { event.preventDefault(); tool = key === 'b' ? 'box' : 'select'; render(); }
  if (key === 'c') { event.preventDefault(); completeImage(); }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteAnnotation(); }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); navigateImage(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key === '?') $('#shortcuts-dialog').showModal();
});

document.addEventListener('dragover', (event) => { event.preventDefault(); });
document.addEventListener('drop', (event) => {
  event.preventDefault();
  if (ready && screen === 'editor' && !navigating && !document.querySelector('dialog[open]')) importImages([...event.dataTransfer.files]);
});
window.addEventListener('beforeunload', (event) => {
  if (sessionBlocked || (screen === 'projects' && ready && !importing && !navigating)) return;
  if (!ready || navigating || importing || exporting || savedRevision < revision || saveError || loadingError || drag) {
    event.preventDefault();
    event.returnValue = '';
    if (ready && !navigating && !exporting && !loadingError && !drag && !importing) persist();
  }
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!ready || navigating || importing || exporting) return;
  try { await assistantUI.flush(); } catch (error) { $('#project-error').textContent = error.message; return; }
  if (navigating || importing || exporting) return;
  const name = $('#project-name').value.trim();
  if (!name) { $('#project-error').textContent = 'Dê um nome ao projeto.'; $('#project-name').focus(); return; }
  navigating = true;
  const submit = $('#project-form button[type="submit"]');
  submit.disabled = true;
  $('#project-error').textContent = '';
  $('#app').ariaBusy = 'true';
  try {
    await commitEditor();
    const record = await createLocalProject(name, createProject([], demo.labels));
    library = await listProjects();
    await activateProject(record.id, record);
    $('#project-dialog').close();
    $('[data-action=projects]').focus();
    notify('Projeto criado. Importe suas imagens para começar.');
  } catch (error) { $('#project-error').textContent = error.message; }
  finally { navigating = false; submit.disabled = false; $('#app').ariaBusy = 'false'; }
});

async function start() {
  ready = false;
  render();
  showLoading('Carregando projetos…');
  await paintLoading();
  try {
    await initializeProjects(demo);
    library = await listProjects();
    libraryError = '';
  } catch (error) { libraryError = error.message; }
  ready = true;
  render();
  hideLoading();
}

function blockSession(message) {
  hideLoading();
  sessionBlocked = true;
  $('#app').innerHTML = `<main class="empty-inspector"><h1>Seu projeto está protegido.</h1><p>${escapeHTML(message)}</p></main>`;
}

if (navigator.locks) {
  navigator.locks.request('anoint-project', { ifAvailable: true }, async (lock) => {
    if (!lock) { blockSession('O Anoint já está aberto neste navegador. Continue na outra aba para evitar sobrescrever suas anotações.'); return; }
    await start();
    // A trava permanece até fechar a aba para impedir gravações concorrentes.
    await new Promise(() => {});
  }).catch(() => blockSession('Não foi possível proteger o projeto local. Reabra o aplicativo antes de editar.'));
} else blockSession('Este navegador não oferece o bloqueio necessário para proteger suas anotações. Use o aplicativo Electron.');
