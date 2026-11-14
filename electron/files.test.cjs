const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { deflateSync, crc32 } = require('node:zlib');
const { runInNewContext } = require('node:vm');
const { createFileStore, MAX_BYTES } = require('./files.cjs');
const { registerImageScheme, registerNativeFiles } = require('./native-files.cjs');

function png(width = 4, height = 3) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y++) rows[y * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anoint-native-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('anoint-native-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const manifest = path.join(directory, 'registry', 'image-manifest.json');
  const options = {
    decode: async filename => {
      const data = await fs.readFile(filename);
      if (data.length < 40) throw new Error('Imagem corrompida.');
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    },
    confirmTrash: async () => true,
    trashItem: async filename => {
      assert.ok(path.resolve(filename).startsWith(path.resolve(directory) + path.sep));
      await fs.unlink(filename);
    },
    ...overrides,
  };
  const store = createFileStore(manifest, options);
  await store.load();
  const write = async (name = 'imagem.png', bytes = png()) => {
    const filename = path.join(directory, name);
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, bytes);
    return filename;
  };
  return { directory, manifest, store, options, write };
}
const request = (url, method = 'GET', origin = 'null') => ({ url, method, headers: new Headers(origin === undefined ? {} : { origin }) });

test('importa recursivamente em ordem natural, ignora outros formatos e não segue symlink', async t => {
  let active = 0, peak = 0;
  const f = await fixture(t, { decode: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { width: 4, height: 3 };
  } });
  await f.write('lote/seq10/frame10.png'); await f.write('lote/seq2/frame10.png');
  await f.write('lote/seq2/frame2.PNG'); await f.write('lote/ação com espaço.png');
  await f.write('lote/notas.txt', Buffer.from('texto'));
  try { await fs.symlink(f.directory, path.join(f.directory, 'lote', 'atalho'), 'junction'); } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
  const result = await f.store.importPaths([path.join(f.directory, 'lote')], true);
  assert.deepEqual(result.images.map(image => image.name), ['lote/ação com espaço.png', 'lote/seq2/frame2.PNG', 'lote/seq2/frame10.png', 'lote/seq10/frame10.png']);
  assert.equal(result.errors.length, 0); assert.ok(result.ignored >= 1); assert.equal(peak, 1);
  for (const image of result.images) {
    assert.match(image.src, /^anoint-image:\/\/[a-f0-9-]{36}$/);
    assert.deepEqual(image.annotations, []); assert.equal(image.reviewed, false);
    assert.equal(image.width, 4); assert.equal(image.height, 3); assert.ok(!('path' in image));
  }
});

test('registra atomicamente, restaura após reload e reutiliza capability sem repetir ID da imagem', async t => {
  let decodes = 0;
  const f = await fixture(t, { decode: async () => { decodes++; return { width: 4, height: 3 }; } });
  const filename = await f.write();
  const first = (await f.store.importPaths([filename], false)).images[0];
  const second = (await f.store.importPaths([filename], false)).images[0];
  assert.equal(first.src, second.src); assert.notEqual(first.id, second.id); assert.equal(decodes, 1);
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 1);
  assert.deepEqual((await fs.readdir(path.dirname(f.manifest))).filter(name => name.endsWith('.tmp')), []);
  const reloaded = createFileStore(f.manifest, f.options); await reloaded.load();
  const response = await reloaded.response(request(first.src));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png());
});

test('protocolo só aceita capability registrada, GET/HEAD e origem local', async t => {
  const f = await fixture(t); const filename = await f.write();
  const image = (await f.store.importPaths([filename], false)).images[0];
  for (const source of [filename, 'file://' + filename, image.src + '/arquivo.png', image.src + '?path=' + filename, image.src + '#x', 'anoint-image://' + randomUUID()]) {
    assert.equal((await f.store.response(request(source))).status, 404);
  }
  assert.equal((await f.store.response(request(image.src, 'POST'))).status, 405);
  assert.equal((await f.store.response(request(image.src, 'GET', 'https://evil.example'))).status, 403);
  const head = await f.store.response(request(image.src + '/', 'HEAD', 'file://'));
  assert.equal(head.status, 200); assert.equal(head.headers.get('access-control-allow-origin'), 'file://');
  assert.equal((await head.arrayBuffer()).byteLength, 0); assert.equal(Number(head.headers.get('content-length')), png().length);
});

test('arquivo temporariamente ausente continua registrado e nunca vira tombstone', async t => {
  const f = await fixture(t); const filename = await f.write();
  const image = (await f.store.importPaths([filename], false)).images[0];
  await fs.rename(filename, filename + '.movido');
  assert.equal((await f.store.response(request(image.src))).status, 404);
  assert.deepEqual(f.store.available([image.src]), []);
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 1);
  await assert.rejects(f.store.trash(image.src));
  await fs.rename(filename + '.movido', filename);
  const response = await f.store.response(request(image.src)); assert.equal(response.status, 200); await response.arrayBuffer();
});

test('cancelamento e falha de lixeira preservam registry e arquivo', async t => {
  let confirmation = false, trashFailure = false;
  const f = await fixture(t, { confirmTrash: async () => confirmation, trashItem: async () => { trashFailure = true; throw new Error('Falha do sistema'); } });
  const filename = await f.write(); const image = (await f.store.importPaths([filename], false)).images[0];
  const before = await fs.readFile(f.manifest, 'utf8');
  assert.deepEqual(await f.store.trash(image.src), { deleted: false, sources: [] }); assert.equal(trashFailure, false);
  confirmation = true;
  await assert.rejects(f.store.trash(image.src), /Não foi possível enviar/); assert.equal(trashFailure, true);
  assert.equal(await fs.readFile(f.manifest, 'utf8'), before);
  assert.deepEqual(f.store.available([image.src]), []); await fs.stat(filename);
});

test('arquivo substituído no mesmo path não pode ser excluído por capability antiga', async t => {
  let confirmations = 0, deleted = false;
  const f = await fixture(t, { confirmTrash: async () => { confirmations++; return true; }, trashItem: async () => { deleted = true; } });
  const filename = await f.write(); const image = (await f.store.importPaths([filename], false)).images[0];
  await fs.rename(filename, filename + '.original'); await fs.writeFile(filename, png(5, 3));
  await assert.rejects(f.store.trash(image.src), /alterado, substituído ou movido/);
  assert.equal(confirmations, 0); assert.equal(deleted, false); assert.deepEqual(f.store.available([image.src]), []);
  assert.deepEqual(await fs.readFile(filename), png(5, 3));
});

test('troca durante confirmação também impede a exclusão', async t => {
  let deleted = false;
  const f = await fixture(t, { confirmTrash: async filename => {
    await fs.rename(filename, filename + '.antes'); await fs.writeFile(filename, png(6, 3)); return true;
  }, trashItem: async () => { deleted = true; } });
  const filename = await f.write(); const image = (await f.store.importPaths([filename], false)).images[0];
  await assert.rejects(f.store.trash(image.src), /alterado, substituído ou movido/); assert.equal(deleted, false);
});

test('trash revoga todas as capabilities do realpath e persiste tombstones para startup', async t => {
  const f = await fixture(t); const filename = await f.write();
  const old = (await f.store.importPaths([filename], false)).images[0];
  await fs.writeFile(filename, png(5, 3));
  const current = (await f.store.importPaths([filename], false)).images[0];
  assert.notEqual(old.src, current.src);
  const result = await f.store.trash(current.src);
  assert.equal(result.deleted, true); assert.deepEqual(new Set(result.sources), new Set([old.src, current.src]));
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  const reloaded = createFileStore(f.manifest, f.options); await reloaded.load();
  assert.deepEqual(reloaded.available([old.src, current.src, old.src, './assets/demo-street.svg']), [old.src, current.src]);
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 0);
  assert.equal((await reloaded.response(request(current.src))).status, 404);
});

test('limites, arquivo não raster e falha de decode geram erros sem publicar capabilities', async t => {
  const f = await fixture(t);
  const empty = await f.write('vazio.png', Buffer.alloc(0));
  const fake = await f.write('svg.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const truncated = await f.write('cortado.png', png().subarray(0, 24));
  const large = await f.write('grande.png'); await fs.truncate(large, MAX_BYTES + 1);
  const header = png().subarray(0, 24); header.writeUInt32BE(100001, 16); header.writeUInt32BE(1000, 20);
  const huge = await f.write('enorme.png', header);
  const result = await f.store.importPaths([empty, fake, truncated, large, huge], false);
  assert.equal(result.images.length, 0); assert.equal(result.errors.length, 5);
  await assert.rejects(fs.stat(f.manifest), { code: 'ENOENT' });
  await assert.rejects(f.store.trash('file:///qualquer-arquivo'), /não registrada/);
  assert.throws(() => f.store.available([123]), /Lista/);
});

test('seleção e inventário acima de 10000 têm erro explícito e nenhum lote parcial', async t => {
  const f = await fixture(t); const filename = await f.write();
  let result = await f.store.importPaths(Array(10001).fill(filename), false);
  assert.deepEqual(result.images, []); assert.match(result.errors[0], /10000/);
  const image = (await f.store.importPaths([filename], false)).images[0];
  const value = JSON.parse(await fs.readFile(f.manifest));
  value.images = Array.from({ length: 10000 }, () => ({ ...value.images[0], id: randomUUID() }));
  await fs.writeFile(f.manifest, JSON.stringify(value)); await f.store.load();
  const other = await f.write('outra.png');
  result = await f.store.importPaths([other], false);
  assert.deepEqual(result.images, []); assert.match(result.errors[0], /Inventário.*10000/);
  assert.deepEqual(f.store.available([image.src]), []);
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 10000);
});

test('falha de persistência não publica importação e é detectada antes de chamar trashItem', async t => {
  let deleted = false;
  const f = await fixture(t, { trashItem: async () => { deleted = true; } });
  const filename = await f.write(); const image = (await f.store.importPaths([filename], false)).images[0];
  const registryDirectory = path.dirname(f.manifest);
  await fs.rename(registryDirectory, registryDirectory + '.guardado'); await fs.writeFile(registryDirectory, 'bloqueio');
  await assert.rejects(f.store.trash(image.src)); assert.equal(deleted, false);
  await assert.rejects(f.store.importPaths([await f.write('nova.png')], false));
  assert.deepEqual(f.store.available([image.src]), []); await fs.stat(filename);
});

test('manifesto corrompido é rejeitado sem sobrescrever o disco', async t => {
  const f = await fixture(t); await fs.mkdir(path.dirname(f.manifest));
  const content = JSON.stringify({ version: 1, images: [], tombstones: ['anoint-image://nao-e-uuid'] });
  await fs.writeFile(f.manifest, content);
  await assert.rejects(f.store.load(), /Tombstone/); assert.equal(await fs.readFile(f.manifest, 'utf8'), content);
});

test('IPC valida remetente/frame/argumentos; confirmação nativa mostra caminho e cancela por padrão', async t => {
  const f = await fixture(t); const filename = await f.write(); const handlers = new Map();
  const indexUrl = 'file:///app/index.html';
  const frame = { url: indexUrl }; const sender = { isDestroyed: () => false, mainFrame: frame };
  const owner = { webContents: sender };
  let confirmation;
  const api = {
    protocol: { handle(name, handler) { assert.equal(name, 'anoint-image'); assert.equal(typeof handler, 'function'); } },
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    BrowserWindow: { fromWebContents: contents => contents === sender ? owner : null },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 4, height: 3 }) }) },
    dialog: {
      async showOpenDialog(window, options) { assert.equal(window, owner); assert.deepEqual(options.properties, ['openFile', 'multiSelections']); return { canceled: false, filePaths: [filename] }; },
      async showMessageBox(window, options) { assert.equal(window, owner); confirmation = options; return { response: 0 }; },
    },
    shell: { trashItem: async () => assert.fail('Cancelado não deve excluir') },
  };
  let scheme;
  registerImageScheme({ registerSchemesAsPrivileged: value => { scheme = value; } });
  assert.equal(scheme[0].privileges.supportFetchAPI, true); assert.equal(scheme[0].privileges.secure, true); assert.equal(scheme[0].privileges.bypassCSP, undefined);
  const backend = await registerNativeFiles(api, path.dirname(f.manifest), indexUrl);
  const event = { sender, senderFrame: frame };
  await assert.rejects(handlers.get('anoint-files:pick')({ ...event, senderFrame: { url: indexUrl } }, false), /Remetente/);
  await assert.rejects(handlers.get('anoint-files:pick')(event, 'pasta'), /Informe/);
  const picked = await handlers.get('anoint-files:pick')(event, false); assert.equal(picked.images.length, 1);
  assert.equal((await handlers.get('anoint-files:trash')(event, picked.images[0].src)).deleted, false);
  assert.ok(confirmation.detail.includes(await fs.realpath(filename))); assert.equal(confirmation.defaultId, 0); assert.equal(confirmation.cancelId, 0);
  assert.deepEqual(handlers.get('anoint-files:available')(event, [picked.images[0].src]), []);
  frame.url = 'https://evil.example';
  assert.throws(() => handlers.get('anoint-files:available')(event, []), /Remetente/);
  backend.close();
});

test('preload sandbox expõe somente três métodos, sem canais arbitrários nem ipcRenderer', async () => {
  let exposed; const calls = [];
  runInNewContext(await fs.readFile(path.join(__dirname, 'preload.cjs'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'anointFiles'); exposed = api; } }, ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve(); } } };
    },
  });
  assert.deepEqual(Object.keys(exposed), ['pick', 'trash', 'available']); assert.equal(Object.isFrozen(exposed), true);
  await exposed.pick(true); await exposed.trash('anoint-image://x'); await exposed.available(['anoint-image://y']);
  assert.equal(calls[0][0], 'anoint-files:pick'); assert.equal(calls[0][1], true);
  assert.equal(calls[1][0], 'anoint-files:trash'); assert.equal(calls[2][0], 'anoint-files:available');
});


test('cabeçalhos JPEG/WebP/GIF/BMP excessivos são rejeitados antes de alocar decoder', async t => {
  let decoded = false;
  const f = await fixture(t, { decode: async () => { decoded = true; return { width: 1, height: 1 }; } });
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 7, 8, 255, 255, 255, 255]);
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(15999, 24, 3); webp.writeUIntLE(15999, 27, 3);
  const gif = Buffer.alloc(13); gif.write('GIF89a'); gif.writeUInt16LE(65535, 6); gif.writeUInt16LE(65535, 8);
  const bmp = Buffer.alloc(54); bmp.write('BM'); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(50000, 18); bmp.writeInt32LE(50000, 22);
  const names = [];
  for (const [name, data] of [['grande.jpg', jpeg], ['grande.webp', webp], ['grande.gif', gif], ['grande.bmp', bmp]]) names.push(await f.write(name, data));
  const result = await f.store.importPaths(names, false);
  assert.equal(result.errors.length, 4); assert.equal(result.images.length, 0); assert.equal(decoded, false);
});

test('main registra scheme antes de ready e instala backend antes do renderer com preload seguro', async () => {
  const order = []; let preferences;
  const app = { requestSingleInstanceLock: () => true, on() {}, getPath: () => '/profile', quit() {}, whenReady() { order.push('ready'); return Promise.resolve(); } };
  const electron = { app, protocol: {}, dialog: { showErrorBox: () => assert.fail('Falha ao iniciar') },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, webRequest: { onBeforeRequest() {} } } },
    BrowserWindow: class { constructor(options) { order.push('window'); preferences = options.webPreferences; this.webContents = { setWindowOpenHandler() {}, on() {} }; } on() {} setMenu() {} loadFile() { return Promise.resolve(); } },
  };
  runInNewContext(await fs.readFile(path.join(__dirname, 'main.cjs'), 'utf8'), {
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:path') return path;
      if (name === 'node:url') return require('node:url');
      assert.equal(name, './native-files.cjs');
      return { registerImageScheme() { order.push('scheme'); }, async registerNativeFiles() { order.push('backend'); return { close() {} }; } };
    },
    __dirname: path.join(os.tmpdir(), 'app', 'electron'), process: { platform: 'win32' },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['scheme', 'ready', 'backend', 'window']);
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.webSecurity, true);
  assert.equal(path.basename(preferences.preload), 'preload.cjs');
});


async function failManifestRename(f, source) {
  const rename = fs.rename;
  let failures = 0;
  fs.rename = async (from, to) => {
    if (to === f.manifest) { failures++; throw Object.assign(new Error('Falha de rename após trash'), { code: 'EIO' }); }
    return rename(from, to);
  };
  try { await assert.rejects(f.store.trash(source), /journal.*preservado/); }
  finally { fs.rename = rename; }
  assert.equal(failures, 1);
}

test('rename após trash falha: memória revoga, journal/snapshot ficam e reload recupera tombstones', async t => {
  const f = await fixture(t); const filename = await f.write();
  const old = (await f.store.importPaths([filename], false)).images[0];
  await fs.writeFile(filename, png(5, 3));
  const current = (await f.store.importPaths([filename], false)).images[0];
  await failManifestRename(f, current.src);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  assert.deepEqual(new Set(f.store.available([old.src, current.src])), new Set([old.src, current.src]));
  assert.equal((await f.store.response(request(current.src))).status, 404);
  const journalPath = f.manifest + '.trash-journal.json';
  const journal = JSON.parse(await fs.readFile(journalPath));
  const snapshotPath = path.join(path.dirname(f.manifest), journal.prepared);
  assert.deepEqual(new Set(journal.sources), new Set([old.src, current.src]));
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 2);
  assert.deepEqual(new Set(JSON.parse(await fs.readFile(snapshotPath)).tombstones), new Set([old.src, current.src]));
  const reloaded = createFileStore(f.manifest, { ...f.options, trashItem: () => assert.fail('Recuperação não pode repetir a exclusão') });
  await reloaded.load();
  assert.deepEqual(new Set(reloaded.available([old.src, current.src])), new Set([old.src, current.src]));
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 0);
  await assert.rejects(fs.stat(journalPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(snapshotPath), { code: 'ENOENT' });
});

test('recuperação reconhece outro arquivo no mesmo path e não toca na substituição', async t => {
  const f = await fixture(t); const filename = await f.write();
  const image = (await f.store.importPaths([filename], false)).images[0];
  await failManifestRename(f, image.src);
  const replacement = png(7, 5); await fs.writeFile(filename, replacement);
  const reloaded = createFileStore(f.manifest, { ...f.options, trashItem: () => assert.fail('Substituição não deve ser excluída') });
  await reloaded.load();
  assert.deepEqual(reloaded.available([image.src]), [image.src]);
  assert.deepEqual(await fs.readFile(filename), replacement);
  const fresh = (await reloaded.importPaths([filename], false)).images[0];
  assert.notEqual(fresh.src, image.src);
});

test('journal preparado sem exclusão não revoga o original que mantém identidade registrada', async t => {
  const f = await fixture(t); const filename = await f.write();
  const image = (await f.store.importPaths([filename], false)).images[0];
  const value = JSON.parse(await fs.readFile(f.manifest)); const entry = value.images[0];
  const prepared = path.basename(f.manifest) + '.' + randomUUID() + '.tmp';
  await fs.writeFile(path.join(path.dirname(f.manifest), prepared), JSON.stringify({ version: 1, images: [], tombstones: [image.src] }));
  await fs.writeFile(f.manifest + '.trash-journal.json', JSON.stringify({ version: 1, path: entry.path, file: entry.file, sources: [image.src], prepared }));
  const reloaded = createFileStore(f.manifest, f.options); await reloaded.load();
  assert.deepEqual(reloaded.available([image.src]), []);
  const response = await reloaded.response(request(image.src)); assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(f.manifest)).tombstones, []);
  await assert.rejects(fs.stat(f.manifest + '.trash-journal.json'), { code: 'ENOENT' });
});

test('trash falha com original igual: journal remanescente por falha de limpeza não cria tombstones no reload', async t => {
  const f = await fixture(t, { trashItem: async () => { throw new Error('Lixeira indisponível'); } });
  const filename = await f.write(); const image = (await f.store.importPaths([filename], false)).images[0];
  const unlink = fs.unlink; const journalPath = f.manifest + '.trash-journal.json';
  fs.unlink = async filename => {
    if (filename === journalPath) throw Object.assign(new Error('Falha de limpeza'), { code: 'EACCES' });
    return unlink(filename);
  };
  try { await assert.rejects(f.store.trash(image.src), /Não foi possível enviar/); }
  finally { fs.unlink = unlink; }
  await fs.stat(journalPath); await fs.stat(filename);
  assert.deepEqual(f.store.available([image.src]), []);
  const reloaded = createFileStore(f.manifest, f.options); await reloaded.load();
  assert.deepEqual(reloaded.available([image.src]), []);
  const response = await reloaded.response(request(image.src)); assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal(JSON.parse(await fs.readFile(f.manifest)).images.length, 1);
  await assert.rejects(fs.stat(journalPath), { code: 'ENOENT' });
});
