const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// A verificação usa outro banco para preservar o projeto aberto pelo usuário.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-ui-'));
app.setPath('userData', testDirectory);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  const page = async (code) => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Falha no renderer: ${code.slice(0, 200)}`, { cause: error }); }
  };
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  const waitFor = async (code) => {
    for (let i = 0; i < 100; i++) { if (await page(code)) return; await pause(50); }
    throw new Error(`Tempo esgotado: ${code}`);
  };
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseUp' ? [] : ['leftbuttondown'] });
  const key = (name, modifiers = []) => { const keyCode = ({ ArrowRight: 'Right', ArrowLeft: 'Left' })[name] || name; win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const bounds = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  const saved = () => waitFor("document.querySelector('.save-status')?.textContent === 'Todas as alterações salvas'");
  const exportedZip = async () => {
    const bytes = Buffer.from(await page('window.__exported.arrayBuffer().then(b=>Array.from(new Uint8Array(b)))'));
    const entries = new Map();
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
      const size = bytes.readUInt32LE(offset + 18);
      const nameSize = bytes.readUInt16LE(offset + 26);
      const extraSize = bytes.readUInt16LE(offset + 28);
      const name = bytes.toString('utf8', offset + 30, offset + 30 + nameSize);
      offset += 30 + nameSize + extraSize;
      entries.set(name, bytes.subarray(offset, offset + size));
      offset += size;
    }
    return entries;
  };
  try {
    await win.loadFile(path.join(__dirname, '..', 'index.html'));
    await waitFor("document.querySelectorAll('.annotation').length === 4");
    await page("document.querySelector('[data-tool=box]').click()");
    const image = await bounds('.image-surface');
    const start = { x: image.x + image.width * .57, y: image.y + image.height * .14 };
    mouse('mouseDown', start.x, start.y);
    await pause(30);
    mouse('mouseMove', start.x + image.width * .09, start.y + image.height * .24);
    await pause(30);
    mouse('mouseUp', start.x + image.width * .09, start.y + image.height * .24);
    await waitFor("document.querySelectorAll('.annotation').length === 5");
    assert.ok(await page("Number(document.querySelector('#box-width').value) > 100"));
    await page("document.querySelector('[data-tool=select]').click()");

    // Alterar uma medida mantém o foco; cancelar o arraste não pode chegar ao disco.
    await page("document.querySelector('#box-x').focus(); document.querySelector('#box-x').value='800'; document.querySelector('#box-x').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await page('document.activeElement.id'), 'box-x');
    key('Tab');
    await waitFor("document.activeElement.id === 'box-y'");
    assert.equal(await page('document.activeElement.id'), 'box-y');
    const box = await bounds('.annotation.is-selected .box');
    mouse('mouseDown', box.x + box.width / 2, box.y + box.height / 2);
    await pause(30);
    mouse('mouseMove', box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
    await pause(550);
    key('Escape');
    await pause(50);
    mouse('mouseUp', box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
    await pause(50);
    await saved();
    const stored = await page("import('./src/storage.js').then(m=>m.loadProject())");
    assert.equal(stored.images[0].annotations.at(-1).x, 800);
    assert.equal(stored.images[0].annotations.length, 5);

    await page("document.querySelectorAll('.annotation-row')[4].click()");
    const handle = await bounds('.annotation.is-selected [data-handle=se]');
    mouse('mouseDown', handle.x + handle.width / 2, handle.y + handle.height / 2);
    await pause(30);
    mouse('mouseMove', handle.x + handle.width / 2 + 20, handle.y + handle.height / 2 + 10);
    await pause(30);
    mouse('mouseUp', handle.x + handle.width / 2 + 20, handle.y + handle.height / 2 + 10);
    await pause(60);
    assert.ok(await page("Number(document.querySelector('#box-width').value) > 140"));
    await page("document.querySelector('[data-action=delete]').click()");
    assert.equal(await page("document.querySelectorAll('.annotation').length"), 4);
    await page("document.querySelector('[data-action=undo]').click()");
    assert.equal(await page("document.querySelectorAll('.annotation').length"), 5);

    const pngBytes = (await win.webContents.capturePage({ x: 0, y: 0, width: 32, height: 24 })).toPNG();
    const png = pngBytes.toString('base64');
    await page(`{ const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0)); const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'verificacao.png',{type:'image/png'})); const input=document.querySelector('#image-input'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await waitFor("document.querySelectorAll('.thumbnail').length === 2");
    assert.equal(await page("document.querySelector('.dimensions').textContent"), `${pngBytes.readUInt32BE(16)} × ${pngBytes.readUInt32BE(20)} px`);
    await page("document.querySelector('[data-action=complete]').click()");
    assert.equal(await page("document.querySelector('.progress-track').getAttribute('aria-valuenow')"), '50');
    await saved();
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await reloaded;
    await waitFor("document.querySelectorAll('.thumbnail').length === 2");
    assert.equal(await page("document.querySelector('.progress-track').getAttribute('aria-valuenow')"), '50');

    await page("document.querySelector('[data-action=new-class]').click(); document.querySelector('#class-name').value='Ônibus'; document.querySelector('#class-form').requestSubmit()");
    assert.equal(await page("document.querySelectorAll('.class-item').length"), 4);
    await page("document.querySelectorAll('[data-edit-label]')[3].click(); document.querySelector('#class-name').value='Veículo'; document.querySelector('#class-form').requestSubmit()");
    assert.equal(await page("document.querySelectorAll('.class-name')[3].textContent"), 'Veículo');
    await saved();

    await page("window.__anchorClick=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){}; window.__makeUrl=URL.createObjectURL; URL.createObjectURL=function(blob){window.__exported=blob;return window.__makeUrl(blob)}; document.querySelector('[data-action=export]').click(); document.querySelector('#export-form').requestSubmit()");
    const exported = JSON.parse(await page('window.__exported.text()'));
    assert.equal(exported.images.length, 2);
    assert.equal(exported.images[0].annotations.length, 5);
    assert.equal(exported.images[1].reviewed, true);
    assert.equal(exported.labels.at(-1).name, 'Veículo');
    await page("{ window.confirm=()=>true; const input=document.querySelector('#project-input'); const transfer=new DataTransfer(); transfer.items.add(new File([window.__exported],'reabertura.json',{type:'application/json'})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }");
    await waitFor("document.querySelector('#toast').textContent.includes('Projeto aberto')");
    assert.equal(await page("document.querySelectorAll('.class-item').length"), 4);
    assert.equal(await page("document.querySelectorAll('.annotation').length"), 5);
    await page("{ HTMLAnchorElement.prototype.click=window.__anchorClick; URL.createObjectURL=window.__makeUrl; window.confirm=()=>true; const input=document.querySelector('#project-input'); const transfer=new DataTransfer(); transfer.items.add(new File([JSON.stringify({version:1,labels:[],images:[]})],'vazio.json',{type:'application/json'})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }");
    await waitFor("document.querySelector('#toast').textContent.includes('pelo menos uma imagem')");
    assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 2);
    await saved();
    await page("window.__database=window.indexedDB; Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new Error('Falha de disco simulada')}}}); document.querySelector('[data-action=complete]').click()");
    assert.equal(await page("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))"), true);
    await waitFor("document.querySelector('.save-status').classList.contains('error')");
    await page("Object.defineProperty(window,'indexedDB',{configurable:true,value:window.__database}); document.querySelector('[data-action=retry-save]').click()");
    await saved();

    // O seletor de pasta recebe subpastas, MIME ausente e arquivos não-imagem.
    assert.equal(await page("document.querySelector('#folder-input').webkitdirectory"), true);
    assert.equal(await page("!!document.querySelector('[data-action=import-folder]')"), true);
    await page(`{ const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0)); const transfer=new DataTransfer(); for(const name of ['lote/seq10/frame10.png','lote/seq2/frame10.png','lote/seq2/frame2.PNG','lote/notas.txt']) { const file=new File([bytes],name.split('/').at(-1)); Object.defineProperty(file,'webkitRelativePath',{value:name}); transfer.items.add(file); } const input=document.querySelector('#folder-input'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await waitFor("document.querySelectorAll('.thumbnail').length === 5");
    assert.equal(await page("document.querySelector('.image-filename').textContent"), 'lote/seq2/frame2.PNG');
    await saved();
    const withFolder = await page("import('./src/storage.js').then(m=>m.loadProject())");
    assert.deepEqual(withFolder.images.slice(2).map(image => image.name), ['lote/seq2/frame2.PNG', 'lote/seq2/frame10.png', 'lote/seq10/frame10.png']);
    assert.match(await page("document.querySelector('#toast').textContent"), /1 arquivo\(s\).*ignorado/);
    await page("document.querySelector('[data-action=undo]').click()");
    assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 2);
    await page("document.querySelector('[data-action=redo]').click()");
    assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 5);
    await saved();
    const folderReload = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await folderReload;
    await waitFor("document.querySelectorAll('.thumbnail').length === 5");
    assert.deepEqual((await page("import('./src/storage.js').then(m=>m.loadProject())")).images.slice(2).map(image => image.name), withFolder.images.slice(2).map(image => image.name));

    await page("window.__nativeAnchorClick=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){}; window.__makeUrl=URL.createObjectURL; URL.createObjectURL=function(blob){window.__exported=blob;return window.__makeUrl(blob)}; document.querySelector('[data-action=export]').click(); document.querySelector('#export-format').value='yolo'; document.querySelector('#export-format').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#export-form').requestSubmit()");
    await waitFor("!document.querySelector('#export-dialog').open");
    const yolo = await exportedZip();
    assert.equal(yolo.size, 10); // Quatro imagens reais, quatro labels e dois metadados.
    assert.ok(yolo.has('images/lote/seq2/frame2.png'));
    assert.equal(yolo.get('labels/lote/seq2/frame2.txt').toString(), '');
    assert.match(yolo.get('data.yaml').toString(), /names:.*Carro/);
    assert.deepEqual(yolo.get('images/lote/seq2/frame2.png'), pngBytes);
    assert.equal([...yolo.keys()].some(name => name.includes('estacionamento')), false);

    await page("document.querySelector('[data-action=export]').click(); document.querySelector('#export-format').value='tracknet'; document.querySelector('#export-format').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#export-class').value='car'; document.querySelector('#export-form').requestSubmit()");
    await waitFor("!document.querySelector('#export-dialog').open");
    const tracknet = await exportedZip();
    assert.equal(tracknet.size, 7);
    assert.equal(tracknet.get('lote/seq2/Label.csv').toString(), 'filename,visibility,x,y,status\nframe2.png,0,0,0,0\nframe10.png,0,0,0,0\n');
    assert.ok(tracknet.has('lote/seq10/Label.csv'));

    // Duas caixas da classe selecionada bloqueiam TrackNet, sem substituir o ZIP anterior.
    await page("document.querySelector('[data-action=export]').click(); document.querySelector('#export-format').value='json'; document.querySelector('#export-format').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#export-form').requestSubmit()");
    await page(`(async()=>{ const value=JSON.parse(await window.__exported.text()); value.images[1].annotations=['a','b'].map(id=>({id:'track-'+id,labelId:'car',x:1,y:1,width:4,height:4})); const transfer=new DataTransfer(); transfer.items.add(new File([JSON.stringify(value)],'caixas.json',{type:'application/json'})); const input=document.querySelector('#project-input'); input.files=transfer.files; window.confirm=()=>true; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await waitFor("document.querySelector('#toast').textContent.includes('Projeto aberto')");
    await page("window.__previousExport=window.__exported; document.querySelector('[data-action=export]').click(); document.querySelector('#export-format').value='tracknet'; document.querySelector('#export-format').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#export-class').value='car'; document.querySelector('#export-form').requestSubmit()");
    await waitFor("document.querySelector('#export-error').textContent.includes('apenas um objeto')");
    assert.equal(await page('window.__previousExport === window.__exported'), true);
    assert.equal(await page("document.querySelector('#export-dialog').open"), true);
    await require('./check-ui-fixtures.cjs')({ win, page, waitFor, mouse, key, bounds, saved, exportedZip, pause, testDirectory });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('UI OK: anotação, persistência, importação PNG/pastas/subpastas, ordem natural, MIME ausente, desfazer/refazer, reload, JSON, ZIP YOLO/TrackNet e rejeição de múltiplos alvos.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (errors.length) console.error(errors.join('\n'));
    try { fs.writeFileSync(path.join(testDirectory, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(`Captura: ${path.join(testDirectory, 'failure.png')}`); } catch {}
    win.destroy();
    app.exit(1);
  }
});
