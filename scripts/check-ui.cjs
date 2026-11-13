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
  const page = (code) => win.webContents.executeJavaScript(code, true);
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  const waitFor = async (code) => {
    for (let i = 0; i < 100; i++) { if (await page(code)) return; await pause(50); }
    throw new Error(`Tempo esgotado: ${code}`);
  };
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  const key = (keyCode, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const bounds = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  const saved = () => waitFor("document.querySelector('.save-status')?.textContent === 'Todas as alterações salvas'");
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
    await page('document.activeElement.blur()');
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

    await page("window.__anchorClick=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){}; window.__makeUrl=URL.createObjectURL; URL.createObjectURL=function(blob){window.__exported=blob;return window.__makeUrl(blob)}; document.querySelector('[data-action=export]').click()");
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
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('UI OK: desenho, coordenadas, foco/Tab, arraste cancelado, persistência, resize, exclusão/desfazer, importação PNG, progresso, reload, classes, exportação/reabertura, projeto vazio e recuperação de falha ao salvar.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { fs.writeFileSync(path.join(testDirectory, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(`Captura: ${path.join(testDirectory, 'failure.png')}`); } catch {}
    win.destroy();
    app.exit(1);
  }
});
