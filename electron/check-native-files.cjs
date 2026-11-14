// Execute com Electron; usa somente cópias temporárias, nunca arquivos do projeto/usuário.
const electron = require('electron');
const { app, protocol, net } = electron;
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { registerImageScheme, registerNativeFiles } = require('./native-files.cjs');

const directory = syncFs.mkdtempSync(path.join(os.tmpdir(), 'anoint-native-electron-'));
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
registerImageScheme(protocol);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVR42mP4+PXnf3yYgWgF711cUPBAKCDbFwAGBOEBF5GygQAAAABJRU5ErkJggg==', 'base64');

app.whenReady().then(async () => {
  let confirmations = 0;
  const api = {
    protocol, ipcMain: electron.ipcMain, BrowserWindow: electron.BrowserWindow,
    session: electron.session, nativeImage: electron.nativeImage,
    dialog: { async showMessageBox(_owner, options) {
      assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
      assert.ok(options.detail.includes(await fs.realpath(path.join(directory, 'copia.png'))));
      confirmations++; return { response: 1 };
    } },
    shell: { async trashItem(filename) {
      assert.equal(confirmations, 1);
      assert.ok(path.resolve(filename).startsWith(path.resolve(directory) + path.sep));
      return electron.shell.trashItem(filename);
    } },
  };
  const backend = await registerNativeFiles(api, app.getPath('userData'), 'file:///teste-nativo/index.html');
  const filename = path.join(directory, 'copia.png'); await fs.writeFile(filename, png);
  const result = await backend.store.importPaths([filename], false);
  assert.equal(result.errors.length, 0); assert.equal(result.images.length, 1);
  const image = result.images[0]; assert.equal(image.width, 8); assert.equal(image.height, 8);
  const fetched = await net.fetch(image.src);
  assert.equal(fetched.status, 200); assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), png);
  await backend.store.load();
  const restored = await net.fetch(image.src); assert.equal(restored.status, 200); await restored.arrayBuffer();
  console.log('PNG/fetch/reload reais: OK. Enviando somente cópia temporária à Lixeira.');
  let deleted;
  try { deleted = await backend.store.trash(image.src); }
  catch (error) {
    await fs.stat(filename);
    assert.deepEqual(backend.store.available([image.src]), []);
    assert.equal(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'image-manifest.json'))).images.length, 1);
    console.error('Lixeira recusada pelo sistema: arquivo, registry e ausência de tombstone preservados.');
    throw error;
  }
  assert.deepEqual(deleted, { deleted: true, sources: [image.src] });
  await backend.store.load(); assert.deepEqual(backend.store.available([image.src]), [image.src]);
  assert.equal((await net.fetch(image.src)).status, 404);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  backend.close();
  console.log('NATIVO OK: nativeImage PNG 8x8, protocolo/fetch real, reload, shell.trashItem em cópia temporária e tombstone persistido. Diálogo é simulado neste teste; bridge/preload são cobertos pelos testes node:test.');
  console.log('Perfil temporário: ' + directory);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
