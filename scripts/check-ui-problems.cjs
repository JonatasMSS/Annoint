const assert = require('node:assert/strict');

module.exports = async ({ win, page, waitFor, saved, pause }) => {
  const key = (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const click = async selector => {
    const rect = await page(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
    await pause(50);
  };
  const value = { version: 1, labels: [
    { id: 'car', name: 'Carro', color: '#123456' },
    { id: 'tree', name: 'Árvore', color: '#299680' },
  ], images: [{ id: 'example', name: 'exemplo.svg', src: './assets/demo-street.svg', width: 1440, height: 900, reviewed: true,
    annotations: [{ id: 'tree-box', labelId: 'tree', x: 20, y: 20, width: 200, height: 200 }] }] };
  await page(`{window.confirm=()=>true;const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'problemas.json',{type:'application/json'}));const input=document.querySelector('#project-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await waitFor("document.querySelector('[data-label=tree]') && !document.querySelector('#loading-dialog').open");
  await saved();
  for (const [id, name] of [['tree', 'Árvore revisada'], ['car', 'Carro revisado']]) {
    await click(`[data-label=${id}]`);
    await click(`[data-edit-label=${id}]`);
    assert.equal(await page("document.querySelector('#class-dialog').open"), true);
    assert.equal(await page('document.activeElement.id'), 'class-name');
    key('A', ['control']);
    for (const keyCode of name) {
      const physicalKey = keyCode === ' ' ? 'Space' : keyCode;
      if (/^[a-z ]$/i.test(keyCode)) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: physicalKey });
      win.webContents.sendInputEvent({ type: 'char', keyCode });
      if (/^[a-z ]$/i.test(keyCode)) win.webContents.sendInputEvent({ type: 'keyUp', keyCode: physicalKey });
    }
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'X' });
    key('Backspace');
    await waitFor(`document.querySelector('#class-name').value===${JSON.stringify(name)}`);
    await click('#class-form button[type=submit]');
    await waitFor("!document.querySelector('#class-dialog').open");
    await saved();
    assert.equal(await page(`document.querySelector('[data-label=${id}] .class-name').textContent`), name);
  }
  await click('[data-label=tree]');
  await click('[data-action=edit-class]');
  assert.equal(await page("document.querySelector('#class-name').value"), 'Árvore revisada');
  await page("document.querySelector('#class-dialog').close()");
  await page("document.querySelector('[data-edit-label=tree]').click();document.querySelector('#class-replacement').value='car';document.querySelector('[data-action=delete-class]').click()");
  await saved();
  assert.equal(await page("document.querySelectorAll('.class-item').length"), 1);
  const project = await page("import('./src/storage.js').then(m=>m.loadProject())");
  assert.equal(project.images[0].annotations[0].labelId, 'car');
  await page("document.querySelector('[data-action=undo]').click()");
  await saved();
  await page("document.querySelector('[data-tool=select]').click()");
  await waitFor("document.querySelector('.image-surface > img')?.naturalWidth > 0 && !document.querySelector('.image-surface').matches('.image-loading, .image-error')");
  await click('.annotation .box');
  assert.equal(await page("!!document.querySelector('.annotation.is-selected')"), true);
  await click('[data-label=car]');
  key('Delete');
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 1);
  assert.equal(await page("document.querySelector('.delete-box').disabled"), true);
  await waitFor("!document.querySelector('.image-surface').matches('.image-loading, .image-error')");
  await click('.annotation .box');
  const size = win.getContentSize();
  win.setContentSize(1000, 760);
  await pause(100);
  assert.equal(await page("(()=>{const r=document.querySelector('.delete-box').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()"), true);
  assert.equal(await page("document.documentElement.scrollWidth<=innerWidth"), true);
  assert.equal(await page("document.querySelector('.delete-box').disabled"), false);
  await click('.delete-box');
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 0);
  assert.equal(await page("document.querySelector('.delete-box').disabled"), true);
  await page("document.querySelector('[data-action=undo]').click()");
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 1);
  assert.equal(await page("document.querySelector('.app-version').textContent"), 'ANOINT · v0.2.0');
  win.setContentSize(...size);
  console.log('Problemas OK: cliques reais em Árvore/Carro, digitação por teclado, salvar/remover classe e excluir caixa pelo botão com desfazer.');
};
