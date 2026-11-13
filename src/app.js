import { normalizeBox, clampBox, moveBox, validateProject, createProject } from './model.js';
import { loadProject, saveProject } from './storage.js';

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
let imageId = project.images[0].id;
let selectedId = project.images[0].annotations[0].id;
let labelId = 'car';
let tool = 'select';
let zoom = 1;
let fitScale = 1;
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
let editingLabelId = null;
let ready = false;
const imageSelections = new Map();
const currentImage = () => project.images.find((image) => image.id === imageId) || project.images[0];
const currentBox = () => currentImage()?.annotations.find((box) => box.id === selectedId);
const labelFor = (id) => project.labels.find((label) => label.id === id);
const snapshot = () => ({ ...project, labels: project.labels.map((label) => ({ ...label })), images: project.images.map((image) => ({ ...image, annotations: image.annotations.map((box) => ({ ...box })) })) });

function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3500);
}

function saveStatus() {
  const element = $('.save-status');
  if (!element) return;
  element.textContent = loadingError ? 'Restauração falhou · exporte antes de salvar' : saveError ? 'Falha ao salvar · tentar novamente' : savedRevision < revision ? 'Salvando alterações…' : 'Todas as alterações salvas';
  element.classList.toggle('error', saveError || loadingError);
  element.title = loadingError ? 'O projeto salvo não foi substituído. Exporte uma cópia antes de tentar salvar.' : saveError ? 'Clique para tentar salvar de novo. Você também pode exportar uma cópia.' : 'Salvo localmente neste dispositivo';
}

function persist() {
  clearTimeout(saveTimer);
  const version = revision;
  const value = snapshot();
  saveChain = saveChain.catch(() => {}).then(async () => {
    try {
      await saveProject(value);
      savedRevision = version;
      saveError = false;
    } catch (error) {
      saveError = true;
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
  history.push(snapshot());
  if (history.length > 30) history.shift();
  future = [];
}

function updateHistory(direction) {
  cancelDrag();
  const from = direction === 'undo' ? history : future;
  const to = direction === 'undo' ? future : history;
  if (!from.length) return;
  to.push(snapshot());
  project = from.pop();
  if (!project.images.some((image) => image.id === imageId)) imageId = project.images[0].id;
  if (!labelFor(labelId)) labelId = project.labels[0].id;
  if (!currentBox()) selectedId = null;
  changed();
  render();
}

function render() {
  const focused = document.activeElement;
  const focusKey = ['action', 'tool', 'label', 'editLabel', 'box', 'image'].find((key) => focused?.dataset?.[key]);
  const focusSelector = focused?.id ? `#${CSS.escape(focused.id)}` : focusKey ? `[data-${focusKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${CSS.escape(focused.dataset[focusKey])}"]` : null;
  const scroll = { x: $('#stage')?.scrollLeft || 0, y: $('#stage')?.scrollTop || 0 };
  const image = currentImage();
  const completed = project.images.filter((item) => item.reviewed).length;
  const percent = Math.round(completed / project.images.length * 100);
  const box = currentBox();
  const filtered = project.images.filter((item) => filter === 'all' || (filter === 'done' ? item.reviewed : !item.reviewed));
  $('#app').innerHTML = `<div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">${icon('logo')}</span>anoint<span class="sr-only">Estúdio de anotação</span></div><span class="top-divider"></span><div class="project-crumb">${icon('folder')}<span>Projetos</span>${icon('chevron')}<strong>Meu primeiro projeto</strong><span class="pill">Local</span></div><div class="top-actions"><button class="icon-button" data-action="help" title="Como usar o Anoint" aria-label="Como usar o Anoint">${icon('help')}</button><button class="button" data-action="open-project" title="Abrir projeto JSON">${icon('folder')}<span>Abrir projeto</span></button><button class="button primary" data-action="export">${icon('download')}Exportar projeto</button></div></header>
    <aside class="sidebar" aria-label="Projeto e classes"><div class="workspace-label"><span class="status-dot"></span>Seu espaço de trabalho</div><div class="project-card"><h2>Meu primeiro projeto</h2><p>Um detalhe de cada vez.</p></div><button class="nav-item active" data-action="show-all">${icon('box')}Anotações<span class="count">${project.images.length}</span></button><button class="nav-item" data-action="import-images">${icon('upload')}Importar imagens</button><hr class="sidebar-separator" /><div class="section-label">Classes<button class="icon-button" data-action="new-class" title="Criar classe" aria-label="Criar classe">${icon('plus')}</button></div><div class="classes">${project.labels.map((label) => `<div class="class-item ${label.id === labelId ? 'selected' : ''}" data-color="${label.color}"><button class="class-select" data-label="${escapeHTML(label.id)}" aria-pressed="${label.id === labelId}"><span class="class-dot"></span><span class="class-name">${escapeHTML(label.name)}</span><span class="class-count">${project.images.reduce((count, item) => count + item.annotations.filter((annotation) => annotation.labelId === label.id).length, 0)}</span></button><button class="icon-button edit-class" data-edit-label="${escapeHTML(label.id)}" aria-label="Editar classe ${escapeHTML(label.name)}" title="Editar classe">${icon('edit')}</button></div>`).join('')}</div><p class="sidebar-tip">Escolha uma classe antes de desenhar.<br />Cada objeto, uma nova anotação.</p><div class="sidebar-bottom"><div class="agent-card"><div class="agent-card-heading">${icon('sparkles')}Um assistente para seu olhar</div><p>No futuro, agentes vão ajudar a encontrar e anotar padrões nas suas imagens.</p><span class="coming-soon">EM BREVE · INTEGRAÇÃO MCP</span></div><button class="sidebar-help" data-action="shortcuts">${icon('keyboard')}Atalhos de teclado</button></div></aside>
    <main class="workspace"><div class="workspace-heading"><div><p class="eyebrow">Anotação de imagens</p><h1>O detalhe faz a diferença.</h1><p class="subtitle">Encontre, marque e organize o que importa.</p></div><span class="manual-badge"><span></span>Modo manual</span></div><section class="editor" aria-label="Editor de imagem"><div class="editor-toolbar"><div class="tools" role="group" aria-label="Ferramentas de anotação"><button class="tool ${tool === 'select' ? 'selected' : ''}" data-tool="select" aria-pressed="${tool === 'select'}" title="Selecionar e mover (V)">${icon('cursor')}Selecionar<kbd>V</kbd></button><button class="tool ${tool === 'box' ? 'selected' : ''}" data-tool="box" aria-pressed="${tool === 'box'}" title="Desenhar caixa (B)">${icon('box')}Caixa<kbd>B</kbd></button></div><span class="toolbar-divider"></span><button class="icon-button" data-action="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" ${history.length ? '' : 'disabled'}>${icon('undo')}</button><button class="icon-button" data-action="redo" title="Refazer (Ctrl+Y)" aria-label="Refazer" ${future.length ? '' : 'disabled'}>${icon('redo')}</button><div class="zoom-controls"><button class="icon-button" data-action="zoom-out" title="Diminuir zoom" aria-label="Diminuir zoom">${icon('minus')}</button><span class="zoom-readout" aria-live="polite"></span><button class="icon-button" data-action="zoom-in" title="Aumentar zoom" aria-label="Aumentar zoom">${icon('plus')}</button><span class="toolbar-divider"></span><button class="icon-button" data-action="fit" title="Ajustar imagem à área de edição" aria-label="Ajustar imagem à área de edição">${icon('fit')}</button></div></div><div class="stage" id="stage"><div class="image-space"><div class="image-surface"><img src="${escapeHTML(image.src)}" alt="${escapeHTML(image.name)}" draggable="false" /><svg class="annotation-layer ${tool === 'box' ? 'draw-mode' : ''}" viewBox="0 0 ${image.width} ${image.height}" aria-label="Anotações sobre ${escapeHTML(image.name)}"></svg></div></div></div><div class="editor-infobar">${icon('image')}<span class="image-filename" title="${escapeHTML(image.name)}">${escapeHTML(image.name)}</span><span class="dimensions">${image.width} × ${image.height} px</span><span class="image-badge">${image.id === 'demo-image' ? 'Exemplo ilustrado' : 'Arquivo local'}</span></div></section><div class="editor-hint"><span>${icon('info')}${tool === 'box' ? 'Clique e arraste para criar uma caixa.' : 'Selecione uma caixa para ajustar os detalhes.'}</span><span><kbd>B</kbd>Caixa <kbd>V</kbd>Selecionar <kbd>Esc</kbd>Cancelar</span></div><section class="filmstrip" aria-label="Imagens do projeto"><div class="filmstrip-heading"><h2>Imagens do projeto</h2><span class="number">${project.images.length}</span><select id="image-filter" aria-label="Filtrar imagens"><option value="all" ${filter === 'all' ? 'selected' : ''}>Todas as imagens</option><option value="pending" ${filter === 'pending' ? 'selected' : ''}>Pendentes</option><option value="done" ${filter === 'done' ? 'selected' : ''}>Concluídas</option></select></div><div class="thumbnails">${filtered.map(thumbnailMarkup).join('')}${!filtered.length ? '<span class="filmstrip-empty">Nenhuma imagem neste filtro.</span>' : ''}<button class="add-images" data-action="import-images" title="Importar imagens">${icon('plus')}Adicionar</button></div></section></main>
    <aside class="inspector" aria-label="Anotações e propriedades"><div class="inspector-header"><h2>Anotações</h2><span class="number">${image.annotations.length}</span><button class="icon-button" data-action="draw" title="Criar anotação (B)" aria-label="Criar anotação">${icon('plus')}</button></div><div class="annotation-list">${image.annotations.map((annotation, index) => `<button class="annotation-row ${annotation.id === selectedId ? 'selected' : ''}" data-box="${escapeHTML(annotation.id)}" data-color="${labelFor(annotation.labelId).color}" aria-pressed="${annotation.id === selectedId}"><span class="class-dot"></span><span class="class-name">${escapeHTML(labelFor(annotation.labelId).name)}</span><span class="annotation-id">${String(index + 1).padStart(2, '0')}</span>${icon('box')}</button>`).join('') || '<div class="empty-inspector">Nenhuma anotação ainda.<br />Use <kbd>B</kbd> para criar a primeira.</div>'}</div>${box ? `<section class="inspector-section"><h3>Propriedades da seleção</h3><label class="field-label" for="box-class">Classe</label><select id="box-class">${project.labels.map((label) => `<option value="${escapeHTML(label.id)}" ${box.labelId === label.id ? 'selected' : ''}>${escapeHTML(label.name)}</option>`).join('')}</select><div class="geometry-grid">${[['x', 'Posição X'], ['y', 'Posição Y'], ['width', 'Largura'], ['height', 'Altura']].map(([key, name]) => `<div class="geometry-field"><label class="field-label" for="box-${key}">${name}</label><input type="number" id="box-${key}" data-geometry="${key}" value="${Math.round(box[key] * 100) / 100}" min="${key === 'x' || key === 'y' ? 0 : 1}" max="${key === 'x' || key === 'width' ? image.width : image.height}" step="any" required /><span class="unit">px</span></div>`).join('')}</div><button class="delete-annotation" data-action="delete">${icon('trash')}Excluir anotação<kbd>Del</kbd></button></section>` : '<div class="inspector-section empty-inspector">' + icon('cursor') + '<strong>Um lugar para cada detalhe.</strong><br />Selecione uma anotação para<br />ver e editar suas propriedades.</div>'}<section class="progress-section"><div class="progress-heading"><strong>Seu progresso</strong><span>${percent}%</span></div><div class="progress-track" role="progressbar" aria-label="Imagens concluídas" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill"></div></div><p class="progress-caption">${completed} de ${project.images.length} ${project.images.length === 1 ? 'imagem concluída' : 'imagens concluídas'}</p><button class="button complete-button ${image.reviewed ? 'done' : ''}" data-action="complete" aria-pressed="${image.reviewed}">${icon('checkCircle')}${image.reviewed ? 'Imagem concluída' : 'Concluir imagem'}<kbd>C</kbd></button><p class="inspector-footnote">${image.reviewed ? 'Clique para voltar a editar esta imagem.' : 'Tudo certo? Marque como concluída para continuar.'}</p></section></aside>
    <footer class="statusbar">${icon('checkCircle')}<button class="save-status" data-action="retry-save"></button><div class="statusbar-right"><span>${icon('lock')}Seus dados ficam neste dispositivo</span><button data-action="shortcuts">${icon('keyboard')}Atalhos</button><span>ANOINТ · PRIMEIRA EDIÇÃO</span></div></footer></div>`;
  document.querySelectorAll('[data-color]').forEach((element) => element.style.setProperty('--label-color', element.dataset.color));
  $('.progress-fill').style.setProperty('--progress', `${percent}%`);
  saveStatus();
  $('.annotation-layer').addEventListener('pointerdown', pointerDown);
  $('.annotation-layer').addEventListener('pointermove', pointerMove);
  $('.annotation-layer').addEventListener('pointerup', pointerUp);
  $('.annotation-layer').addEventListener('pointercancel', cancelDrag);
  $('.image-surface > img').addEventListener('error', () => notify(`Não foi possível carregar ${image.name}. Abra uma cópia válida do projeto.`, true));
  observer.disconnect();
  observer.observe($('#stage'));
  fitImage();
  $('#stage').scrollLeft = scroll.x;
  $('#stage').scrollTop = scroll.y;
  if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function fitImage() {
  const image = currentImage();
  const stage = $('#stage');
  if (!stage || !image) return;
  fitScale = Math.min((stage.clientWidth - 60) / image.width, (stage.clientHeight - 60) / image.height, 1);
  fitScale = Math.max(fitScale, .02);
  const surface = $('.image-surface');
  surface.style.width = `${image.width * fitScale * zoom}px`;
  surface.style.height = `${image.height * fitScale * zoom}px`;
  $('.zoom-readout').textContent = `${Math.round(fitScale * zoom * 100)}%`;
  renderOverlay();
}

function refreshProgress() {
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
  const filtered = project.images.filter((item) => filter === 'all' || (filter === 'done' ? item.reviewed : !item.reviewed));
  $('.thumbnails').innerHTML = filtered.map(thumbnailMarkup).join('') + (!filtered.length ? '<span class="filmstrip-empty">Nenhuma imagem neste filtro.</span>' : '') + `<button class="add-images" data-action="import-images" title="Importar imagens">${icon('plus')}Adicionar</button>`;
}

function thumbnailMarkup(item) {
  return `<button class="thumbnail ${item.id === imageId ? 'active' : ''}" data-image="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.name)}, ${item.reviewed ? 'concluída' : item.annotations.length ? 'em edição' : 'pendente'}" aria-pressed="${item.id === imageId}"><img src="${escapeHTML(item.src)}" alt="" loading="lazy" /><span class="thumbnail-caption"><span class="filename">${escapeHTML(item.name)}</span><span class="thumb-status ${item.reviewed ? 'done' : item.annotations.length ? 'in-progress' : ''}"></span></span></button>`;
}

const observer = new ResizeObserver(() => requestAnimationFrame(fitImage));

function renderOverlay(draft = null) {
  const image = currentImage();
  const svg = $('.annotation-layer');
  if (!svg) return;
  const scale = fitScale * zoom;
  svg.innerHTML = image.annotations.map((original) => {
    const annotation = drag?.preview && original.id === selectedId ? drag.preview : original;
    const label = labelFor(annotation.labelId);
    const selected = annotation.id === selectedId;
    const nameWidth = Math.min((label.name.length * 7 + 18) / scale, image.width - annotation.x);
    const tagY = annotation.y >= 24 / scale ? -22 / scale : 0;
    return `<g class="annotation ${selected ? 'is-selected' : ''}" data-annotation="${escapeHTML(annotation.id)}" data-box-color="${label.color}" transform="translate(${annotation.x} ${annotation.y})"><rect class="box" width="${annotation.width}" height="${annotation.height}"/><rect class="box-name" x="0" y="${tagY}" width="${nameWidth}" height="${22 / scale}" rx="${3 / scale}"/><text x="${7 / scale}" y="${tagY + 15 / scale}" font-size="${11 / scale}">${escapeHTML(label.name)}</text>${selected && tool === 'select' ? [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]].map(([handle, x, y]) => `<rect class="resize-handle" data-handle="${handle}" x="${annotation.width * x - 3 / scale}" y="${annotation.height * y - 3 / scale}" width="${6 / scale}" height="${6 / scale}" rx="${1 / scale}"/>`).join('') : ''}</g>`;
  }).join('') + (draft ? `<rect class="drawing-box" x="${draft.x}" y="${draft.y}" width="${draft.width}" height="${draft.height}"/>` : '');
  svg.querySelectorAll('[data-box-color]').forEach((element) => element.style.setProperty('--box-color', element.dataset.boxColor));
  svg.querySelectorAll('[data-handle]').forEach((element) => { element.style.cursor = `${element.dataset.handle}-resize`; });
}

function point(event) {
  const rect = $('.annotation-layer').getBoundingClientRect();
  const image = currentImage();
  return { x: Math.max(0, Math.min(image.width, (event.clientX - rect.left) / rect.width * image.width)), y: Math.max(0, Math.min(image.height, (event.clientY - rect.top) / rect.height * image.height)) };
}

function pointerDown(event) {
  if (event.button !== 0 || importing || !ready) return;
  event.preventDefault();
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
  const images = project.images.filter((item) => filter === 'all' || (filter === 'done' ? item.reviewed : !item.reviewed));
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
  $('#class-dialog').showModal();
  $('#class-name').focus();
}

async function importImages(files) {
  if (!files.length || importing) return;
  if (project.images.length + files.length > 100) { notify('Este projeto suporta até 100 imagens. Importe um lote menor.', true); return; }
  importing = true;
  const imported = [];
  const errors = [];
  const stage = $('#stage');
  const status = document.createElement('div');
  status.className = 'import-status';
  status.setAttribute('role', 'status');
  stage.append(status);
  let projectBytes = project.images.reduce((sum, item) => sum + item.src.length, 0);
  for (const [index, file] of files.entries()) {
    status.textContent = `Abrindo imagem ${index + 1} de ${files.length}…`;
    try {
      if (!/^image\/(png|jpeg|webp|avif|gif|bmp)$/.test(file.type)) throw new Error('formato não suportado');
      if (file.size > 15 * 1024 * 1024) throw new Error('limite de 15 MB por imagem');
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('falha na leitura'));
        reader.readAsDataURL(file);
      });
      if (projectBytes + src.length > 80 * 1024 * 1024) throw new Error('limite de 80 MB por projeto');
      const decoded = new Image();
      decoded.src = src;
      await decoded.decode();
      if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth > 30000 || decoded.naturalHeight > 30000 || decoded.naturalWidth * decoded.naturalHeight > 100_000_000) throw new Error('dimensões não suportadas (máximo de 100 milhões de pixels)');
      imported.push({ id: uid(), name: file.name.slice(0, 200), src, width: decoded.naturalWidth, height: decoded.naturalHeight, annotations: [], reviewed: false });
      projectBytes += src.length;
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  importing = false;
  if (imported.length) {
    try { validateProject({ ...project, images: [...project.images, ...imported] }); }
    catch (error) { render(); notify(`As imagens não foram adicionadas. ${error.message}`, true); return; }
    remember();
    project.images.push(...imported);
    imageId = imported[0].id;
    selectedId = null;
    filter = 'all';
    zoom = 1;
    changed();
  }
  render();
  if (errors.length) notify(`${imported.length} imagem(ns) aberta(s). ${errors.join('; ')}`, true);
  else notify(`${imported.length} ${imported.length === 1 ? 'imagem pronta para seu olhar.' : 'imagens prontas para seu olhar.'}`);
}

async function openProject(file) {
  if (!file || importing) return;
  importing = true;
  try {
    if (file.size > 256 * 1024 * 1024) throw new Error('O arquivo excede o limite de 256 MB.');
    const value = validateProject(JSON.parse(await file.text()));
    if (!value.images.length || !value.labels.length) throw new Error('O projeto precisa ter pelo menos uma imagem e uma classe.');
    for (const image of value.images) {
      const decoded = new Image();
      decoded.src = image.src;
      await decoded.decode();
      if (decoded.naturalWidth !== image.width || decoded.naturalHeight !== image.height) throw new Error(`Dimensões diferentes das originais em ${image.name}.`);
    }
    if (!confirm('Abrir este projeto substituirá o projeto atual. Exporte uma cópia antes se precisar guardá-lo. Continuar?')) return;
    cancelDrag();
    remember();
    project = value;
    imageSelections.clear();
    imageId = project.images[0].id;
    labelId = project.labels[0].id;
    selectedId = null;
    filter = 'all';
    zoom = 1;
    loadingError = false;
    changed();
    render();
    notify('Projeto aberto. Você pode continuar de onde parou.');
  } catch (error) { notify(`Não foi possível abrir o projeto. ${error.message}`, true); }
  finally { importing = false; }
}

function exportProject() {
  cancelDrag();
  try {
    const value = validateProject(project);
    const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anoint-projeto-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify('Exportação JSON iniciada. Confirme o arquivo na janela de salvamento ou na pasta de downloads.');
  } catch (error) { notify(`Não foi possível exportar. ${error.message}`, true); }
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-dialog]');
  if (close) { close.closest('dialog').close(); return; }
  const element = event.target.closest('[data-action], [data-tool], [data-label], [data-edit-label], [data-box], [data-image]');
  if (!element || !ready) return;
  if (importing) { notify('Aguarde a importação terminar.'); return; }
  if (drag) cancelDrag();
  if (element.dataset.tool) { tool = element.dataset.tool; render(); return; }
  if (element.dataset.editLabel) { openClassDialog(element.dataset.editLabel); return; }
  if (element.dataset.label) { labelId = element.dataset.label; render(); return; }
  if (element.dataset.image) { selectImage(element.dataset.image); return; }
  if (element.dataset.box) { selectedId = element.dataset.box; labelId = currentBox().labelId; tool = 'select'; render(); return; }
  const action = element.dataset.action;
  if (action === 'help') $('#help-dialog').showModal();
  if (action === 'shortcuts') $('#shortcuts-dialog').showModal();
  if (action === 'new-class') openClassDialog();
  if (action === 'import-images') $('#image-input').click();
  if (action === 'open-project') $('#project-input').click();
  if (action === 'export') exportProject();
  if (action === 'undo' || action === 'redo') updateHistory(action);
  if (action === 'delete') deleteAnnotation();
  if (action === 'complete') completeImage();
  if (action === 'show-all') { filter = 'all'; render(); }
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
  if (!ready) return;
  const target = event.target;
  if (target.id === 'image-input') { importImages([...target.files]); target.value = ''; return; }
  if (target.id === 'project-input') { openProject(target.files[0]); target.value = ''; return; }
  if (target.id === 'image-filter') { filter = target.value; render(); return; }
  if (target.id === 'box-class' && currentBox()) {
    remember();
    currentBox().labelId = target.value;
    labelId = target.value;
    currentImage().reviewed = false;
    changed();
    render();
  }
  if (target.dataset.geometry && currentBox()) {
    if (!target.validity.valid || !Number.isFinite(target.valueAsNumber)) { notify('Informe uma medida válida dentro dos limites da imagem.', true); target.value = currentBox()[target.dataset.geometry]; return; }
    remember();
    const image = currentImage();
    Object.assign(currentBox(), clampBox({ ...currentBox(), [target.dataset.geometry]: target.valueAsNumber }, image.width, image.height));
    image.reviewed = false;
    changed();
    renderOverlay();
    for (const input of document.querySelectorAll('[data-geometry]')) input.value = Math.round(currentBox()[input.dataset.geometry] * 100) / 100;
    refreshProgress();
  }
});

$('#class-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#class-name').value.trim();
  const color = $('#class-color').value;
  if (!name) { $('#class-error').textContent = 'Dê um nome à classe.'; return; }
  if (project.labels.some((label) => label.id !== editingLabelId && label.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { $('#class-error').textContent = 'Já existe uma classe com esse nome.'; return; }
  if (!editingLabelId && project.labels.length >= 100) { $('#class-error').textContent = 'O projeto suporta até 100 classes.'; return; }
  remember();
  if (editingLabelId) Object.assign(labelFor(editingLabelId), { name, color });
  else { labelId = uid(); project.labels.push({ id: labelId, name, color }); }
  changed();
  $('#class-dialog').close();
  render();
});

document.addEventListener('keydown', (event) => {
  if (!ready || importing || event.target.closest('input, select, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
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
  if (ready && !document.querySelector('dialog[open]')) importImages([...event.dataTransfer.files]);
});
window.addEventListener('beforeunload', (event) => {
  if (!ready || importing || savedRevision < revision || saveError || loadingError || drag) {
    event.preventDefault();
    event.returnValue = '';
    if (!loadingError && !drag && !importing) persist();
  }
});

async function start() {
  try {
    const saved = await loadProject();
    if (saved) {
      const restored = validateProject(saved);
      if (!restored.images.length || !restored.labels.length) throw new Error('Projeto vazio.');
      project = restored;
      imageId = project.images[0].id;
      labelId = project.labels[0].id;
      selectedId = null;
    }
  } catch (error) {
    loadingError = true;
    notify('Não foi possível restaurar o projeto local. A cópia anterior foi preservada; exporte antes de salvar.', true);
  }
  ready = true;
  render();
}

start();
