// Electron real + preload real; picker/confirm são simulados, shell.trashItem é real apenas em cópias temporárias.
const electron = require('electron');
const { app, BrowserWindow, protocol } = electron;
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { registerImageScheme, registerNativeFiles } = require('./native-files.cjs');

const directory = syncFs.mkdtempSync(path.join(os.tmpdir(), 'anoint-native-bridge-'));
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
registerImageScheme(protocol);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVR42mP4+PXnf3yYgWgF711cUPBAKCDbFwAGBOEBF5GygQAAAABJRU5ErkJggg==', 'base64');

app.whenReady().then(async () => {
  const lote = path.join(directory, 'lote');
  const paths = ['seq2/frame2.PNG', 'seq2/frame10.png', 'seq10/frame10.png'];
  for (const name of paths) { const filename = path.join(lote, name); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, png); }
  await fs.writeFile(path.join(lote, 'corrompida.png'), Buffer.alloc(0));
  await fs.writeFile(path.join(lote, 'notas.txt'), 'ignorar');
  const index = path.join(directory, 'index.html');
  await fs.writeFile(index, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src anoint-image:; connect-src anoint-image:"><title>Teste nativo isolado</title>');
  const indexUrl = pathToFileURL(index).href;
  const target = await fs.realpath(path.join(lote, 'seq2/frame2.PNG'));
  let confirmations = 0;
  const api = {
    protocol, ipcMain: electron.ipcMain, BrowserWindow, session: electron.session, nativeImage: electron.nativeImage,
    dialog: {
      async showOpenDialog(_owner, options) { assert.deepEqual(options.properties, ['openDirectory']); return { canceled: false, filePaths: [lote] }; },
      async showMessageBox(_owner, options) { assert.ok(options.detail.includes(target)); assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); confirmations++; return { response: 1 }; },
    },
    shell: { async trashItem(filename) {
      assert.equal(filename, target); assert.equal(confirmations, 1);
      assert.ok(path.resolve(filename).startsWith(path.resolve(directory) + path.sep));
      return electron.shell.trashItem(filename);
    } },
  };
  const backend = await registerNativeFiles(api, app.getPath('userData'), indexUrl);
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  const page = code => win.webContents.executeJavaScript(code);
  await win.loadFile(index);
  assert.deepEqual(await page('Object.keys(window.anointFiles)'), ['pick', 'trash', 'available']);
  assert.equal(await page('typeof require'), 'undefined');
  const picked = await page('window.anointFiles.pick(true)');
  assert.deepEqual(picked.images.map(image => image.name), paths.map(name => 'lote/' + name));
  assert.equal(picked.errors.length, 1); assert.equal(picked.ignored, 1);
  const first = picked.images[0];
  const again = await page('window.anointFiles.pick(true)');
  assert.equal(again.images[0].src, first.src); assert.notEqual(again.images[0].id, first.id);
  const fetchSource = src => page('(async()=>{const response=await fetch(' + JSON.stringify(src) + ');return {status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};})()');
  const fetched = await fetchSource(first.src); assert.equal(fetched.status, 200); assert.deepEqual(Buffer.from(fetched.bytes), png);
  const size = await page('(async()=>{const image=new Image();image.src=' + JSON.stringify(first.src) + ';await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()');
  assert.deepEqual(size, { width: 8, height: 8 });
  const available = () => page('window.anointFiles.available(' + JSON.stringify(picked.images.map(image => image.src)) + ')');
  assert.deepEqual(await available(), []);
  const unavailable = path.join(lote, 'seq2/frame10.png');
  await fs.rename(unavailable, unavailable + '.movido');
  assert.equal((await fetchSource(picked.images[1].src)).status, 404); assert.deepEqual(await available(), []);
  await fs.rename(unavailable + '.movido', unavailable);
  console.log('PRELOAD/IPC/FETCH/IMAGE reais: OK. Enviando somente a cópia temporária ' + target + ' à Lixeira.');
  const deleted = await page('window.anointFiles.trash(' + JSON.stringify(first.src) + ')');
  assert.equal(deleted.deleted, true); assert.deepEqual(deleted.sources, [first.src]);
  await backend.store.load();
  await win.loadFile(index);
  assert.deepEqual(await available(), [first.src]); assert.equal((await fetchSource(first.src)).status, 404);
  assert.equal((await fetchSource(picked.images[1].src)).status, 200);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  win.destroy(); backend.close();
  console.log('BRIDGE OK: preload sandbox, picker IPC, ordem/subpastas, deduplicação, fetch/Imagem, indisponibilidade temporária, Lixeira real e tombstones após reload. Diálogos simulados somente no teste.');
  console.log('Perfil temporário: ' + directory);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
