const electron = require('electron');
const { app, BrowserWindow } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { registerImageScheme, registerNativeFiles } = require('../electron/native-files.cjs');

registerImageScheme(electron.protocol);
const root = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'anoint-native-ui-'));
app.setPath('userData', path.join(root, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let win;
  let backend;
  const watchdog = setTimeout(() => { console.error('Tempo esgotado no teste nativo'); win?.destroy(); app.exit(1); }, 120000);
  try {
    const directory = path.join(root, 'frames');
    await fs.mkdir(directory);
    const tiny = await fs.readFile(path.join(__dirname, '../test-images/valid/04-pequena.png'));
    const landscape = await fs.readFile(path.join(__dirname, '../test-images/valid/01-paisagem.png'));
    for (let index = 0; index <= 500; index++) await fs.writeFile(path.join(directory, `frame${index}.png`), index === 500 ? landscape : tiny);
    let confirmation = 0;
    let refuseTrash = false;
    const indexUrl = pathToFileURL(path.join(__dirname, '../index.html')).href;
    backend = await registerNativeFiles({ ...electron, dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [directory] }),
      showMessageBox: async () => ({ response: confirmation }),
    }, shell: { trashItem: async filename => {
      assert.equal(path.dirname(filename), directory);
      if (refuseTrash) throw new Error('Lixeira indisponível (simulado)');
      await electron.shell.trashItem(filename);
    } } }, app.getPath('userData'), indexUrl);
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
    } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const page = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => {
      for (let attempt = 0; attempt < 600; attempt++) { if (await page(code)) return; await pause(50); }
      throw new Error('Tempo esgotado: ' + code);
    };
    const saved = () => wait("document.querySelector('.save-status')?.textContent==='Todas as alterações salvas'&&document.querySelector('#app').ariaBusy!=='true'");
    const reload = async () => {
      const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      win.reload(); await loaded; await require('./project-navigation.cjs')(page, wait); await wait("!!document.querySelector('#batch-select')");
    };
    await win.loadURL(indexUrl);
    await require('./project-navigation.cjs')(page, wait);
    await wait("!!document.querySelector('#batch-select')");
    await page("import('./src/storage.js').then(m=>m.saveProject(document.querySelector('.app-shell').dataset.projectId,{version:1,labels:[{id:'object',name:'Objeto',color:'#2563eb'}],images:[]}))");
    await reload();
    assert.equal(await page("typeof window.anointFiles.pick"), 'function');
    await page("document.querySelector('[data-action=import-folder]').click()");
    await wait("document.querySelector('#batch-select')?.options.length===6"); await saved();
    const original = await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
    assert.equal(original.images.length, 501);
    assert.ok(original.images.every(image => /^anoint-image:\/\//.test(image.src)));
    assert.equal(original.images[2].name, 'frames/frame2.png');
    await page("document.querySelector('[data-action=import-folder]').click()");
    await wait("document.querySelector('#app').ariaBusy!=='true'");
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 501);
    await page("document.querySelector('#batch-select').value='5';document.querySelector('#batch-select').dispatchEvent(new Event('change',{bubbles:true}))");
    await wait("document.querySelector('.image-surface > img')?.naturalWidth===640");
    assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 1);
    const source = original.images.at(-1).src;
    assert.deepEqual(Buffer.from(await page(`fetch(${JSON.stringify(source)}).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))`)), landscape);
    await page("document.querySelector('[data-tool=box]').click()");
    await win.webContents.capturePage();
    const rect = await page("document.querySelector('.image-surface').getBoundingClientRect().toJSON()");
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseUp' ? [] : ['leftbuttondown'] });
    mouse('mouseDown', rect.x + rect.width * .1, rect.y + rect.height * .1); await pause(30);
    mouse('mouseMove', rect.x + rect.width * .3, rect.y + rect.height * .4); await pause(30);
    mouse('mouseUp', rect.x + rect.width * .3, rect.y + rect.height * .4);
    await wait("document.querySelectorAll('.annotation').length===1");
    await page("document.querySelector('.complete-button').click()"); await saved();
    const stale = await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
    const portable = await page("import('./src/storage.js').then(async m=>m.portableProject(await m.loadProject(document.querySelector('.app-shell').dataset.projectId)))");
    assert.equal(portable.images.length, 501);
    assert.equal(portable.images.at(-1).src, 'data:image/png;base64,' + landscape.toString('base64'));
    assert.equal(portable.images.at(-1).annotations.length, 1);
    await page("document.querySelector('[data-action=delete-image]').click()");
    await wait("document.querySelector('#app').ariaBusy!=='true'");
    await fs.access(path.join(directory, 'frame500.png'));
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 501);
    confirmation = 1; refuseTrash = true;
    await page("document.querySelector('[data-action=delete-image]').click()");
    await wait("document.querySelector('#toast').textContent.includes('Não foi possível excluir')");
    await fs.access(path.join(directory, 'frame500.png'));
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 501);
    refuseTrash = false;
    await page("document.querySelector('[data-action=delete-image]').click()");
    await wait("document.querySelector('#batch-select').options.length===5"); await saved();
    await assert.rejects(fs.access(path.join(directory, 'frame500.png')), { code: 'ENOENT' });
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 500);
    assert.equal(await page("document.querySelector('[data-action=undo]').disabled"), true);
    assert.equal(errors.length, 0, errors.join('\n'));
    await backend.store.load();
    await page(`import('./src/storage.js').then(m=>m.saveProject(document.querySelector('.app-shell').dataset.projectId,${JSON.stringify(stale)}))`);
    await reload(); await saved();
    const recovered = await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
    assert.equal(recovered.images.length, 501);
    assert.deepEqual(recovered.images.at(-1).annotations, stale.images.at(-1).annotations);
    assert.equal(recovered.images.some(image => image.src === source), true);
    assert.deepEqual(await page(`window.anointFiles.available([${JSON.stringify(source)}])`), [source]);
    await page("document.querySelector('#batch-select').value='5';document.querySelector('#batch-select').dispatchEvent(new Event('change',{bubbles:true}))");
    await wait("!!document.querySelector('.image-surface.image-error')");
    await page("window.confirm=()=>false;document.querySelector('[data-action=delete-image]').click()");
    await wait("document.querySelector('#app').ariaBusy!=='true'");
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 501);
    await page("window.confirm=()=>true;document.querySelector('[data-action=delete-image]').click()");
    await wait("document.querySelector('#batch-select').options.length===5"); await saved();
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 500);

    // A mesma capability em outro projeto só pode ser removida localmente.
    const ownerId = await page("document.querySelector('.app-shell').dataset.projectId");
    const sharedId = await page(`import('./src/storage.js').then(m=>m.createLocalProject('Compartilhado',${JSON.stringify({ version: 1, labels: original.labels, images: [original.images[0]] })})).then(record=>record.id)`);
    await page("document.querySelector('[data-action=projects]').click()");
    await wait("!!document.querySelector('#projects-screen')");
    await page(`document.querySelector('[data-action=open-local-project][data-project-id="${sharedId}"]').click()`);
    await wait(`document.querySelector('.app-shell')?.dataset.projectId===${JSON.stringify(sharedId)}`);
    await page("window.confirm=message=>{window.__sharedConfirmation=message;return true};document.querySelector('[data-action=delete-image]').click()");
    await wait("!!document.querySelector('.empty-editor')"); await saved();
    assert.match(await page('window.__sharedConfirmation'), /outro projeto/);
    await fs.access(path.join(directory, 'frame0.png'));
    assert.equal((await page(`import('./src/storage.js').then(m=>m.loadProject(${JSON.stringify(ownerId)}))`)).images.length, 500);
    assert.deepEqual(await page(`window.anointFiles.available([${JSON.stringify(original.images[0].src)}])`), []);
    await page("document.querySelector('[data-action=projects]').click()");
    await wait("!!document.querySelector('#projects-screen')");
    await page(`document.querySelector('[data-action=open-local-project][data-project-id="${ownerId}"]').click()`);
    await wait(`document.querySelector('.app-shell')?.dataset.projectId===${JSON.stringify(ownerId)}`);
    // Remoção múltipla é só do projeto, mesmo para referências nativas.
    refuseTrash = true;
    await page("window.confirm=()=>true;document.querySelector('#batch-select').value='0';document.querySelector('#batch-select').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=select-images]').click();document.querySelectorAll('[data-select-image]')[0].click();document.querySelectorAll('[data-select-image]')[1].click();document.querySelector('[data-action=remove-images]').click()");
    await wait("document.querySelector('#app').ariaBusy!=='true'");
    await saved();
    assert.equal((await page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))")).images.length, 498);
    await fs.access(path.join(directory, 'frame0.png'));
    await fs.access(path.join(directory, 'frame1.png'));
    assert.ok(errors.every(message => /404|ERR_FAILED|ERR_FILE_NOT_FOUND/.test(message)), errors.join('\n'));
    console.log('NATIVE UI OK: pasta501, protocolo, anotação, Lixeira, tombstone preservado/removível arquivo compartilhado protegido e remoção múltipla preservando originais');
    clearTimeout(watchdog); backend.close(); win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); console.error('Perfil isolado: ' + root);
    clearTimeout(watchdog); backend?.close(); win?.destroy(); app.exit(1);
  }
});
