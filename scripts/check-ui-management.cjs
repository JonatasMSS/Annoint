const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, page, waitFor, saved, pause }) => {
  const output = path.join(__dirname, '../test-results/management');
  fs.mkdirSync(output, { recursive: true });
  const capture = async name => {
    await win.webContents.capturePage();
    await pause(100);
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const source = fs.readFileSync(path.join(__dirname, '../test-images/valid/04-pequena.png')).toString('base64');
  const value = { version: 1, labels: [
    { id: 'first', name: 'Primeira', color: '#123456' },
    { id: 'second', name: 'Segunda', color: '#abcdef' },
    { id: 'unused', name: 'Sem caixas', color: '#123' },
  ], images: Array.from({ length: 3 }, (_, index) => ({
    id: 'image-' + index, name: index + '.png', src: 'data:image/png;base64,' + source,
    width: 8, height: 8, reviewed: true,
    annotations: [{ id: 'box-' + index, labelId: index === 2 ? 'second' : 'first', x: 1, y: 1, width: 4, height: 4 }],
  })) };
  const open = async () => {
    await page(`{window.confirm=()=>true;const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'gestao.json',{type:'application/json'}));const input=document.querySelector('#project-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await waitFor("!document.querySelector('#loading-dialog').open && document.querySelectorAll('.thumbnail').length===3");
    await saved();
  };
  const stored = () => page("import('./src/storage.js').then(m=>m.loadProject())");
  await open();
  await page("document.querySelector('[data-edit-label=first]').click();document.querySelector('#class-name').value='Renomeada';document.querySelector('#class-color').value='#654321';document.querySelector('#class-form').requestSubmit()");
  await saved();
  assert.equal((await stored()).labels[0].name, 'Renomeada');
  assert.equal((await stored()).labels[0].color, '#654321');
  assert.equal((await stored()).images[0].annotations[0].labelId, 'first');
  await page("document.querySelector('[data-edit-label=first]').click();document.querySelector('[data-action=delete-class]').click()");
  assert.match(await page("document.querySelector('#class-error').textContent"), /destino/);
  assert.match(await page("document.querySelector('#class-impact').textContent"), /2 anotação.*2 imagem/);
  await capture('class-removal');
  await page("window.confirm=()=>false;document.querySelector('#class-replacement').value='second';document.querySelector('[data-action=delete-class]').click()");
  assert.equal(await page("document.querySelectorAll('.class-item').length"), 3);
  await page("window.confirm=()=>true;document.querySelector('[data-action=delete-class]').click()");
  await saved();
  let project = await stored();
  assert.deepEqual(project.images.map(image => image.reviewed), [false, false, true]);
  assert.ok(project.images.every(image => image.annotations[0].labelId === 'second'));
  assert.equal(project.images.reduce((count, image) => count + image.annotations.length, 0), 3);
  await page("document.querySelector('[data-action=undo]').click()");
  assert.equal(await page("document.querySelectorAll('.class-item').length"), 3);
  await page("document.querySelector('[data-action=redo]').click();document.querySelector('[data-edit-label=unused]').click();document.querySelector('[data-action=delete-class]').click();document.querySelector('[data-edit-label=second]').click()");
  assert.equal(await page("document.querySelector('[data-action=delete-class]').disabled"), true);
  await page("document.querySelector('#class-dialog').close()");
  await saved();

  // Editar uma caixa pode tirar a imagem do filtro; ela sai também da seleção.
  await page("document.querySelector('[data-image=image-2]').click();document.querySelector('[data-box=box-2]').click();document.querySelector('#image-filter').value='done';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=select-images]').click();document.querySelector('[data-action=select-visible]').focus();document.querySelector('[data-action=select-visible]').click()");
  assert.equal(await page("document.activeElement.dataset.action"), 'select-visible');
  assert.equal(await page("document.querySelectorAll('[data-select-image]:checked').length"), 1);
  await page("document.querySelector('#box-x').value='2';document.querySelector('#box-x').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 0);
  assert.equal(await page("document.querySelector('[data-action=remove-images]').disabled"), true);
  assert.match(await page("document.querySelector('.image-selection [role=status]').textContent"), /^0 /);
  await page("document.querySelector('#image-filter').value='all';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=complete]').click()");
  await saved();

  // Uma importação lenta deixa o status visível e impede submissões concorrentes.
  await page(`{window.__decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return new Promise(resolve=>{window.__releaseDecode=()=>window.__decode.call(this).then(resolve)})};const bytes=Uint8Array.from(atob(${JSON.stringify(source)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'lenta.png',{type:'image/png'}));const input=document.querySelector('#image-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await waitFor("typeof window.__releaseDecode==='function'");
  assert.equal(await page("document.querySelector('#loading-dialog').open"), true);
  assert.match(await page("document.querySelector('#loading-message').textContent"), /Importando imagem 1 de 1/);
  assert.equal(await page("document.querySelector('#loading-progress').max"), 1);
  await capture('loading');
  await page("document.querySelector('#class-name').value='Não criar';document.querySelector('#class-form').dispatchEvent(new Event('submit',{cancelable:true}));document.querySelector('[data-action=complete]').click();document.querySelector('#loading-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));");
  assert.equal(await page("document.querySelector('#loading-dialog').open"), true);
  assert.equal(await page("document.querySelectorAll('.class-item').length"), 1);
  await page("HTMLImageElement.prototype.decode=window.__decode;window.__releaseDecode()");
  await waitFor("!document.querySelector('#loading-dialog').open && document.querySelectorAll('.thumbnail').length===4");
  await saved();

  await page("window.__readData=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(blob){window.__releaseRead=()=>window.__readData.call(this,blob)};document.querySelector('[data-action=export]').click();document.querySelector('#export-format').value='json';document.querySelector('#export-form').requestSubmit()");
  await waitFor("typeof window.__releaseRead==='function'");
  assert.equal(await page("document.querySelector('#loading-dialog').open"), true);
  assert.match(await page("document.querySelector('#loading-message').textContent"), /exportação/);
  assert.equal(await page("document.querySelector('#export-form button[type=submit]').textContent"), 'Preparando…');
  await page("FileReader.prototype.readAsDataURL=window.__readData;window.__releaseRead()");
  await waitFor("!document.querySelector('#export-dialog').open && !document.querySelector('#loading-dialog').open");

  await page("document.querySelector('[data-action=select-images]').click();document.querySelector('[data-select-image]').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor("document.querySelectorAll('[data-select-image]:checked').length===1");
  assert.equal(await page("document.activeElement.matches('[data-select-image]')"), true);
  await page("document.querySelector('[data-action=select-visible]').click()");
  assert.equal(await page("document.querySelectorAll('[data-select-image]:checked').length"), 4);
  await page("document.querySelector('[data-action=clear-images]').focus();document.querySelector('[data-action=clear-images]').click()");
  assert.equal(await page("document.activeElement.dataset.action"), 'clear-images');
  assert.equal(await page("document.querySelectorAll('[data-select-image]:checked').length"), 0);
  await page("document.querySelector('#image-filter').value='done';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await page("document.querySelectorAll('[data-select-image]').length"), 0);
  await page("document.querySelector('[data-action=select-images]').click();document.querySelector('[data-action=select-visible]').click()");
  assert.equal(await page("document.querySelectorAll('[data-select-image]:checked').length"), 1);
  await page("window.confirm=()=>false;document.querySelector('[data-action=remove-images]').click()");
  assert.equal((await stored()).images.length, 4);
  await page("window.__idb=window.indexedDB;Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new Error('Disco indisponível')}}});window.confirm=()=>true;document.querySelector('[data-action=remove-images]').click()");
  await waitFor("!document.querySelector('#loading-dialog').open && document.querySelector('#toast').textContent.includes('Não foi possível concluir')");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 1);
  assert.equal(await page("document.querySelectorAll('[data-select-image]:checked').length"), 1);
  await page("Object.defineProperty(window,'indexedDB',{configurable:true,value:window.__idb});void 0");
  assert.equal((await stored()).images.length, 4);
  await page("document.querySelector('[data-action=remove-images]').click()");
  await waitFor("!document.querySelector('#loading-dialog').open && document.querySelectorAll('.thumbnail').length===0");
  assert.equal((await stored()).images.length, 3);
  assert.equal(await page("document.querySelector('[data-action=undo]').disabled"), true);
  await page("document.querySelector('#image-filter').value='all';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=select-images]').click();document.querySelector('[data-action=select-visible]').click()");
  await pause(100);
  await capture('selection');
  await page("document.querySelector('[data-action=remove-images]').click()");
  await waitFor("!document.querySelector('#loading-dialog').open && !!document.querySelector('.empty-editor')");
  assert.equal((await stored()).images.length, 0);
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.reload(); await loaded;
  await waitFor("!!document.querySelector('.empty-editor') && !document.querySelector('#loading-dialog').open");
  assert.equal(await page("document.querySelectorAll('.class-item').length"), 1);
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 0);
  console.log('Gestão OK: classes, transferência/undo, loading lento, seleção por teclado/filtro, cancelamento, falha de disco, remoção múltipla e reload vazio.');
};
