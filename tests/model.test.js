import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBox, clampBox, moveBox, validateProject, createProject, updateClass, removeClass, removeImages } from '../src/model.js';
import { loadProject, saveProject } from '../src/storage.js';

const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==';
const label = { id: 'person', name: 'Pessoa', color: '#f08' };
const box = { id: 'box-1', labelId: 'person', x: 10, y: 20, width: 30, height: 40 };
const image = { id: 'image-1', name: 'foto.png', src: source, width: 100, height: 100, annotations: [box], reviewed: false };
const project = () => createProject([image], [label]);

function editingProject() {
  return createProject([
    { ...image, reviewed: true, annotations: [box, { ...box, id: 'car-1', labelId: 'car' }] },
    { ...image, id: 'image-2', reviewed: true, annotations: [{ ...box, id: 'box-2' }] },
    { ...image, id: 'image-3', reviewed: true, annotations: [{ ...box, id: 'car-3', labelId: 'car' }] },
    { ...image, id: 'image-4', reviewed: false, annotations: [] },
  ], [label, { id: 'car', name: 'Carro', color: '#123456' }]);
}

test('edita nome e/ou cor preservando IDs, caixas e original', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  for (const changes of [{ name: 'Pedestre' }, { color: '#AbC' }, { name: 'Pessoa nova', color: '#ABCDEF' }]) {
    const result = updateClass(original, 'person', changes);
    assert.deepEqual(result, { ...original, labels: [{ ...label, ...changes }, original.labels[1]] });
    assert.deepEqual(validateProject(result), result);
    result.images[0].annotations[0].x = 0;
  }
  assert.deepEqual(original, snapshot);
});

test('rejeita alterações inválidas sem mutação parcial', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  for (const changes of [null, undefined, [], 'nome', {}, { id: 'novo' }, { name: 'Ok', extra: true },
    { name: '' }, { name: ' ' }, { name: 1 }, { name: 'x'.repeat(201) },
    { color: null }, { color: 'red' }, { color: '#12' }, { color: '#12345678' }, { name: 'Ok', color: '#xyz' }]) {
    assert.throws(() => updateClass(original, 'person', changes), Error);
  }
  for (const id of [null, undefined, 1, '', ' ', 'x'.repeat(201), 'missing']) {
    assert.throws(() => updateClass(original, id, { name: 'Ok' }), Error);
    assert.throws(() => removeClass(original, id, 'car'), Error);
  }
  assert.deepEqual(original, snapshot);
});

test('remove classe transferindo caixas e desmarcando só imagens afetadas', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  const result = removeClass(original, 'person', 'car');
  assert.deepEqual(result.labels, [original.labels[1]]);
  assert.deepEqual(result.images, original.images.map((image, index) => index < 2
    ? { ...image, reviewed: false, annotations: image.annotations.map(box => ({ ...box, labelId: 'car' })) }
    : image));
  assert.deepEqual(validateProject(result), result);
  result.images[0].annotations[0].x = 0;
  assert.deepEqual(original, snapshot);
});

test('classe usada exige destino distinto válido e última classe nunca é removida', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  for (const replacementId of [undefined, null, 1, '', ' ', 'x'.repeat(201), 'missing', 'person']) {
    assert.throws(() => removeClass(original, 'person', replacementId), Error);
  }
  assert.throws(() => removeClass(project(), 'person', 'car'), /última classe/);
  assert.throws(() => removeClass(createProject([], [label]), 'person'), /última classe/);
  assert.deepEqual(original, snapshot);
});

test('classe sem caixas dispensa destino e preserva revisão das imagens', () => {
  const original = editingProject();
  const unused = createProject(original.images, [...original.labels, { id: 'unused', name: 'Vazia', color: '#000' }]);
  const snapshot = structuredClone(unused);
  assert.deepEqual(removeClass(unused, 'unused'), original);
  assert.deepEqual(removeClass(unused, 'unused', 'car'), original);
  assert.throws(() => removeClass(unused, 'unused', 'missing'), /destino/);
  assert.deepEqual(unused, snapshot);
});

test('remove múltiplas imagens com caixas, aceitando duplicatas e lista vazia', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  const result = removeImages(original, ['image-3', 'image-1', 'image-1']);
  assert.deepEqual(result, { ...original, images: [original.images[1], original.images[3]] });
  assert.deepEqual(validateProject(result), result);
  assert.deepEqual(removeImages(original, []), original);
  assert.deepEqual(removeImages(original, original.images.map(image => image.id)), { ...original, images: [] });
  result.images[0].annotations[0].x = 0;
  result.labels[0].name = 'Outra';
  assert.deepEqual(original, snapshot);
});

test('rejeita lista inválida ou imagem inexistente sem remoção parcial', () => {
  const original = editingProject();
  const snapshot = structuredClone(original);
  for (const ids of [null, undefined, 'image-1', {}, [null], [1], [''], [' '], ['x'.repeat(201)],
    ['image-1', 'missing'], ['image-1', null], new Array(1)]) {
    assert.throws(() => removeImages(original, ids), Error);
  }
  assert.deepEqual(original, snapshot);
});

test('operações validam projetos antes de editar ou remover', () => {
  for (const original of [null, { ...editingProject(), version: 2 }, { ...editingProject(), labels: [label] }]) {
    assert.throws(() => updateClass(original, 'person', { name: 'Outra' }), Error);
    assert.throws(() => removeClass(original, 'person', 'car'), Error);
    assert.throws(() => removeImages(original, ['image-1']), Error);
  }
});

test('normaliza arrasto nas quatro direções em pixels naturais', () => {
  for (const [start, end] of [
    [{ x: 10, y: 20 }, { x: 40, y: 60 }],
    [{ x: 40, y: 60 }, { x: 10, y: 20 }],
    [{ x: 10, y: 60 }, { x: 40, y: 20 }],
    [{ x: 40, y: 20 }, { x: 10, y: 60 }],
  ]) assert.deepEqual(normalizeBox(start, end, 100, 100), { x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(normalizeBox({ x: -10, y: -20 }, { x: 200, y: 300 }, 100, 80), { x: 0, y: 0, width: 100, height: 80 });
});

test('descarta caixas menores que 4px após recorte e entradas não finitas', () => {
  assert.equal(normalizeBox({ x: 0, y: 0 }, { x: 3.99, y: 20 }, 100, 100), null);
  assert.equal(normalizeBox({ x: 0, y: 0 }, { x: 20, y: 3 }, 100, 100), null);
  assert.equal(normalizeBox({ x: -20, y: 0 }, { x: 2, y: 20 }, 100, 100), null);
  assert.deepEqual(normalizeBox({ x: 0, y: 0 }, { x: 4, y: 4 }, 100, 100), { x: 0, y: 0, width: 4, height: 4 });
  for (const width of [0, -1, NaN, Infinity, '100', 32769]) assert.equal(normalizeBox({ x: 0, y: 0 }, { x: 20, y: 20 }, width, 100), null);
  assert.equal(normalizeBox(null, { x: 20, y: 20 }, 100, 100), null);
  assert.equal(normalizeBox({ x: NaN, y: 0 }, { x: 20, y: 20 }, 100, 100), null);
});

test('clamp e movimento preservam IDs, dimensões e objeto original', () => {
  assert.deepEqual(clampBox({ ...box, x: -20, y: 99 }, 100, 100), { ...box, x: 0, y: 60 });
  assert.deepEqual(moveBox(box, 1000, -1000, 100, 100), { ...box, x: 70, y: 0 });
  assert.deepEqual(moveBox(box, 0.5, 0.25, 100, 100), { ...box, x: 10.5, y: 20.25 });
  assert.deepEqual(clampBox({ ...box, width: 200, height: 200 }, 100, 80), { ...box, x: 0, y: 0, width: 100, height: 80 });
  assert.equal(box.x, 10);
  assert.equal(clampBox({ ...box, width: 0 }, 100, 100), null);
  assert.equal(clampBox({ ...box, x: Infinity }, 100, 100), null);
  assert.equal(moveBox(box, NaN, 0, 100, 100), null);
  assert.equal(moveBox(null, 0, 0, 100, 100), null);
});

test('caixas nas bordas com coordenadas fracionárias continuam válidas ao salvar', () => {
  for (const x of [0.1, 0.3, 0.7, 1.1, 23.7]) {
    const bounds = normalizeBox({ x, y: x }, { x: 100, y: 100 }, 100, 100);
    assert.doesNotThrow(() => createProject([{ ...image, annotations: [{ ...box, ...bounds }] }], [label]));
  }
});

test('criação e ida e volta de JSON validam e copiam somente o contrato', () => {
  const original = project();
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(original))), original);
  assert.deepEqual(createProject([], []), { version: 1, labels: [], images: [] });
  original.images[0].annotations[0].x = 0;
  original.labels[0].name = 'Alterada';
  assert.equal(box.x, 10);
  assert.equal(label.name, 'Pessoa');
  const clean = validateProject({ ...project(), extra: 'ignorado' });
  assert.equal('extra' in clean, false);
  const tiny = project();
  tiny.images[0].annotations[0] = { ...box, x: 99.5, y: 99.5, width: 0.5, height: 0.5 };
  assert.deepEqual(validateProject(tiny), tiny);
});

test('aceita apenas as origens locais autorizadas e base64 canônico', () => {
  for (const src of ['./assets/demo-street.svg', ...['png', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg+xml'].map(type => 'data:image/' + type + ';base64,AQID')]) {
    assert.equal(createProject([{ ...image, src }], [label]).images[0].src, src);
  }
  for (const src of ['https://example.com/foto.png', 'file:///tmp/a.png', '../assets/demo-street.svg', './assets/outro.svg', 'javascript:alert(1)', 'data:text/html;base64,AQID', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,', 'data:image/png;base64,A===', 'data:image/png;base64,AB==', 'data:image/png;base64,AA=A', 'data:image/png;base64,AQID\n']) {
    assert.throws(() => createProject([{ ...image, src }], [label]), /Origem/);
  }
});

test('rejeita versões, campos, IDs e referências inválidos', () => {
  for (const value of [null, {}, { ...project(), version: 2 }, { ...project(), labels: null }, { ...project(), images: {} }]) assert.throws(() => validateProject(value), Error);
  const changes = [
    p => p.labels.push({ ...p.labels[0] }),
    p => p.images.push({ ...p.images[0] }),
    p => p.images[0].annotations.push({ ...box }),
    p => p.images.push({ ...p.images[0], id: 'other-image' }),
    p => { p.labels[0].id = ''; },
    p => { p.labels[0].name = ' '; },
    p => { p.labels[0].color = 'red'; },
    p => { p.images[0].annotations[0].labelId = 'missing'; },
    p => { p.images[0].reviewed = 1; },
    p => { p.images[0].name = ''; },
    p => { p.images[0].annotations = null; },
    p => { p.images = new Array(1); },
    p => { p.labels = new Array(1); },
  ];
  for (const change of changes) {
    const p = project(); change(p);
    assert.throws(() => validateProject(p), Error);
  }
});

test('rejeita dimensões e caixas inválidas sem corrigir importação silenciosamente', () => {
  for (const width of [0, -1, Infinity, NaN, '100', 32769, 1e100]) assert.throws(() => createProject([{ ...image, width }], [label]), /Dimensões/);
  assert.throws(() => createProject([{ ...image, width: 20000, height: 20000 }], [label]), /Dimensões/);
  for (const patch of [{ x: -1 }, { y: -1 }, { width: 0 }, { height: -1 }, { x: 90 }, { y: 90 }, { x: NaN }, { width: Infinity }, { width: '30' }]) {
    assert.throws(() => createProject([{ ...image, annotations: [{ ...box, ...patch }] }], [label]), /Caixa/);
  }
});

test('limita tamanho de fontes e quantidade de entidades antes de copiar', () => {
  assert.throws(() => createProject(Array(10001).fill(image), [label]), /10000/);
  assert.throws(() => createProject([], Array(1001).fill(label)), /1000/);
  assert.throws(() => createProject([{ ...image, annotations: Array(10001).fill(box) }], [label]), /10000/);
  assert.throws(() => createProject([{ ...image, src: 'data:image/png;base64,' + 'A'.repeat(32 * 1024 * 1024) }], [label]), /32 MiB/);
  const largeSource = 'data:image/png;base64,' + 'A'.repeat(31 * 1024 * 1024);
  assert.throws(() => createProject(Array.from({ length: 5 }, (_, i) => ({ ...image, id: 'large-' + i, src: largeSource, annotations: [] })), [label]), /128 MiB/);
});

test('IndexedDB só resolve após commit, valida leitura/escrita e propaga abortos', async () => {
  const previous = globalThis.indexedDB;
  let stored;
  let current;
  const handles = [];
  const factory = { open() {
    const db = {
      close() { this.closed = true; },
      transaction(name, mode) {
        assert.equal(name, 'projects');
        const request = { result: undefined, error: null };
        const tx = { error: null, objectStore(storeName) {
          assert.equal(storeName, 'projects');
          return {
            get(key) { assert.equal(key, 'current'); request.result = stored; return request; },
            put(value, key) { assert.equal(key, 'current'); tx.pending = value; return request; },
          };
        } };
        current = { db, tx, request, mode };
        return tx;
      },
    };
    handles.push(db);
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  const waitForTransaction = async () => {
    current = undefined;
    while (!current) await new Promise(resolve => setImmediate(resolve));
    return current;
  };
  try {
    globalThis.indexedDB = factory;
    let resolved = false;
    const saving = saveProject(project()).then(() => { resolved = true; });
    let operation = await waitForTransaction();
    assert.equal(operation.mode, 'readwrite');
    assert.equal(resolved, false);
    stored = operation.tx.pending;
    operation.tx.oncomplete();
    await saving;
    assert.equal(resolved, true);
    assert.equal(operation.db.closed, true);

    const loading = loadProject();
    operation = await waitForTransaction();
    operation.tx.oncomplete();
    assert.deepEqual(await loading, project());

    const failed = saveProject(project());
    const rejected = assert.rejects(failed, /banco local/);
    operation = await waitForTransaction();
    operation.tx.error = new Error('QuotaExceededError');
    operation.tx.onabort();
    await rejected;
    assert.equal(operation.db.closed, true);
    assert.deepEqual(stored, project());

    stored = undefined;
    const empty = loadProject();
    operation = await waitForTransaction(); operation.tx.oncomplete();
    assert.equal(await empty, null);

    stored = { version: 999 };
    const corrupt = loadProject();
    const corruptRejected = assert.rejects(corrupt, /Versão/);
    operation = await waitForTransaction(); operation.tx.oncomplete();
    await corruptRejected;

    const openedBefore = handles.length;
    await assert.rejects(saveProject({ version: 999 }), /Versão/);
    assert.equal(handles.length, openedBefore);
    globalThis.indexedDB = undefined;
    await assert.rejects(loadProject(), /IndexedDB indisponível/);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});


test('Electron carrega index.html com isolamento e bloqueia permissões e navegação', async () => {
  const { runInNewContext } = await import('node:vm');
  const { default: path } = await import('node:path');
  const handlers = {};
  const session = {};
  let options;
  let loaded;
  let windowOpen;
  let permissionRequest;
  let permissionCheck;
  let devicePermission;
  let network;
  session.setPermissionRequestHandler = fn => { permissionRequest = fn; };
  session.setPermissionCheckHandler = fn => { permissionCheck = fn; };
  session.setDevicePermissionHandler = fn => { devicePermission = fn; };
  session.webRequest = { onBeforeRequest(filter, fn) { assert.ok(filter.urls.includes('https://*/*')); network = fn; } };
  class Window {
    constructor(value) {
      options = value;
      this.webContents = {
        on(name, fn) { handlers[name] = fn; },
        setWindowOpenHandler(fn) { windowOpen = fn; },
      };
    }
    on() {}
    setMenu(value) { assert.equal(value, null); }
    loadFile(value) { loaded = value; return Promise.resolve(); }
  }
  const ready = Promise.resolve();
  runInNewContext(await (await import('node:fs/promises')).readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:url') return { pathToFileURL: value => ({ href: 'file://' + value }) };
      if (name === './native-files.cjs') return { registerImageScheme() {}, registerNativeFiles: async () => ({ close() {} }) };
      assert.equal(name, 'electron');
      return { BrowserWindow: Window, session: { defaultSession: session }, app: { getPath: () => '/anoint/profile', requestSingleInstanceLock: () => true, whenReady: () => ready, on() {}, quit() { assert.fail('Inicialização falhou'); } }, dialog: { showErrorBox() { assert.fail('Erro inesperado'); } } };
    },
    __dirname: '/anoint/electron',
    process: { platform: 'win32' },
  });
  await ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded, path.join('/anoint/electron', '..', 'index.html'));
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.preload, path.join('/anoint/electron', 'preload.cjs'));
  assert.equal(windowOpen().action, 'deny');
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let blocked = false;
    handlers[name]({ preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
  }
  permissionRequest(null, 'camera', allowed => assert.equal(allowed, false));
  assert.equal(permissionCheck(), false);
  assert.equal(devicePermission(), false);
  network({}, result => assert.equal(result.cancel, true));
});

test('uma segunda instância do Electron encerra antes de abrir o projeto', async () => {
  const { runInNewContext } = await import('node:vm');
  const { default: path } = await import('node:path');
  let quit = false;
  runInNewContext(await (await import('node:fs/promises')).readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require(name) {
      if (name === 'node:path') return path;
      return { app: { requestSingleInstanceLock: () => false, quit() { quit = true; }, whenReady() { assert.fail('Não deve abrir outra instância'); } } };
    },
    __dirname: '/anoint/electron',
  });
  assert.equal(quit, true);
});
