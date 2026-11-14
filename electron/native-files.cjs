const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createFileStore, MAX_BYTES } = require('./files.cjs');

function registerImageScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'anoint-image', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
  } }]);
}

// NativeImage não suporta todos os raster nem orientação EXIF; o fallback usa um renderer isolado.
function imageDecoder(api) {
  let decoder;
  let currentUrl = '';
  const decodeInChromium = async filename => {
    if (!decoder || decoder.isDestroyed()) {
      const session = api.session.fromPartition('anoint-decoder-' + randomUUID());
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      session.setDevicePermissionHandler(() => false);
      session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: details.url !== currentUrl && details.url !== 'about:blank' }));
      decoder = new api.BrowserWindow({ show: false, webPreferences: {
        session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
      } });
      decoder.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) decoder.webContents.on(name, event => event.preventDefault());
      const created = decoder;
      created.on('closed', () => { if (decoder === created) decoder = undefined; });
    }
    const win = decoder;
    currentUrl = pathToFileURL(filename).href;
    let timer;
    try {
      return await Promise.race([
        (async () => {
          await win.loadFile(filename);
          return win.webContents.executeJavaScript('(async()=>{ const image=document.images[0]; if(!image || !image.naturalWidth || !image.naturalHeight || image.naturalWidth*image.naturalHeight>100000000) throw new Error("Dimensões inválidas ou acima de 100 milhões de pixels."); await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight}; })()');
        })(),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Tempo esgotado ao decodificar a imagem.')), 15000); }),
      ]);
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw new Error('Não foi possível decodificar a imagem.', { cause: error });
    } finally {
      clearTimeout(timer); currentUrl = '';
      if (!win.isDestroyed()) await win.loadURL('about:blank').catch(() => win.destroy());
    }
  };
  const decode = async (filename, mime) => {
    if (mime === 'image/png' || mime === 'image/jpeg') {
      let buffer;
      let image;
      try {
        const handle = await fs.open(filename, 'r');
        try {
          const stat = await handle.stat();
          if (stat.size > MAX_BYTES) throw new Error('Arquivo acima de 15 MiB.');
          // A leitura é limitada mesmo se outro processo aumentar o arquivo durante o decode.
          const chunks = [];
          for await (const part of handle.createReadStream({ start: 0, end: MAX_BYTES, autoClose: false })) chunks.push(part);
          buffer = Buffer.concat(chunks);
        } finally { await handle.close(); }
        if (buffer.length > MAX_BYTES) throw new Error('Arquivo acima de 15 MiB.');
        if (mime !== 'image/jpeg' || !buffer.includes(Buffer.from('Exif\0\0'))) {
          image = api.nativeImage.createFromBuffer(buffer, { scaleFactor: 1 });
          if (!image.isEmpty()) return image.getSize();
        }
      } finally { image = null; buffer = null; }
    }
    return decodeInChromium(filename);
  };
  return { decode, close() { if (decoder && !decoder.isDestroyed()) decoder.destroy(); } };
}

// Chamado depois de app.ready; api é o módulo Electron real (ou o equivalente isolado dos testes).
async function registerNativeFiles(api, userData, indexUrl) {
  const decoder = imageDecoder(api);
  const store = createFileStore(path.join(userData, 'image-manifest.json'), {
    decode: decoder.decode,
    confirmTrash: async (filename, owner) => {
      const result = await api.dialog.showMessageBox(owner, {
        type: 'warning', title: 'Enviar imagem original à Lixeira?',
        message: 'O arquivo original será enviado à Lixeira do sistema.',
        detail: filename + '\n\nIsso afeta todas as importações deste arquivo no Anoint.',
        buttons: ['Cancelar', 'Enviar à Lixeira'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 1;
    },
    trashItem: filename => api.shell.trashItem(filename),
  });
  try { await store.load(); }
  catch (error) { throw new Error('Não foi possível abrir o manifesto de imagens. Ele foi preservado.', { cause: error }); }
  api.protocol.handle('anoint-image', request => store.response(request));
  const trustedWindow = event => {
    const sender = event?.sender;
    const win = sender && !sender.isDestroyed() && api.BrowserWindow.fromWebContents(sender);
    if (!win || event.senderFrame !== sender.mainFrame || event.senderFrame.url !== indexUrl) throw new Error('Remetente não autorizado para acessar arquivos locais.');
    return win;
  };
  let picking = false;
  api.ipcMain.handle('anoint-files:pick', async (event, folder) => {
    const owner = trustedWindow(event);
    if (typeof folder !== 'boolean') throw new Error('Informe se a seleção é de pasta.');
    if (picking) throw new Error('Já existe uma importação nativa em andamento.');
    picking = true;
    try {
      const result = await api.dialog.showOpenDialog(owner, {
        title: folder ? 'Importar pasta de imagens' : 'Importar imagens',
        properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
        filters: [{ name: 'Imagens raster', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'] }],
      });
      if (result.canceled) return { images: [], errors: [], ignored: 0 };
      return await store.importPaths(result.filePaths, folder);
    } finally { picking = false; }
  });
  api.ipcMain.handle('anoint-files:trash', (event, source) => store.trash(source, trustedWindow(event)));
  api.ipcMain.handle('anoint-files:available', (event, sources) => { trustedWindow(event); return store.available(sources); });
  return { store, close: decoder.close };
}

module.exports = { registerImageScheme, registerNativeFiles };
