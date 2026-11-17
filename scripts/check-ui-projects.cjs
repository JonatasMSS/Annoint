const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, page, waitFor, pause, key }) => {
  const idle = "document.querySelector('#app').ariaBusy!=='true' && !document.querySelector('#loading-dialog')?.open";
  const list = () => page("import('./src/storage.js').then(m=>m.listProjects())");
  const home = async () => {
    await page("document.querySelector('[data-action=projects]').click()");
    await waitFor("!!document.querySelector('#projects-screen') && document.querySelector('#app').ariaBusy!=='true'");
  };
  const open = async id => {
    await page(`document.querySelector('[data-action=open-local-project][data-project-id="${id}"]').click()`);
    await waitFor(`document.querySelector('.app-shell')?.dataset.projectId===${JSON.stringify(id)} && ${idle}`);
  };
  await waitFor("!!document.querySelector('#projects-screen') && !!document.querySelector('[data-action=open-local-project]') && " + idle);
  const initial = await list();
  assert.equal(initial.length, 1);
  const demoId = initial[0].id;
  const demo = await page(`import('./src/storage.js').then(m=>m.loadProject(${JSON.stringify(demoId)}))`);

  // Trocar antes do debounce salva o projeto certo; uma falha bloqueia a saída.
  await open(demoId);
  await page("document.querySelector('[data-action=complete]').click();document.querySelector('[data-action=projects]').click()");
  await waitFor("!!document.querySelector('#projects-screen') && " + idle);
  assert.equal((await list()).find(item => item.id === demoId).completedCount, 1);
  await open(demoId);
  await page("window.__projectDatabase=window.indexedDB;Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new Error('Disco indisponível (teste)')}}});document.querySelector('[data-action=complete]').click();document.querySelector('[data-action=projects]').click()");
  await waitFor("!!document.querySelector('.save-status.error') && " + idle);
  assert.equal(await page("!!document.querySelector('#projects-screen')"), false);
  await page("Object.defineProperty(window,'indexedDB',{configurable:true,value:window.__projectDatabase});document.querySelector('[data-action=retry-save]').click()");
  await waitFor("document.querySelector('.save-status')?.textContent==='Todas as alterações salvas'");
  assert.equal(await page("document.querySelector('.operation-error').hidden"), true);
  await home();

  await page("document.querySelector('[data-action=new-project]').click()");
  assert.equal(await page('document.activeElement.id'), 'project-name');
  await page("document.querySelector('#project-name').value='   ';document.querySelector('#project-form').requestSubmit()");
  await waitFor("!!document.querySelector('#project-error').textContent");
  assert.equal((await list()).length, 1);
  await page("document.querySelector('#project-name').value='Pesquisa <local>';document.querySelector('#project-form').requestSubmit();document.querySelector('#project-form').requestSubmit()");
  await waitFor("!!document.querySelector('.app-shell[data-project-id]') && !document.querySelector('#project-dialog').open && " + idle);
  const emptyId = await page("document.querySelector('.app-shell').dataset.projectId");
  assert.equal(await page('document.activeElement.dataset.action'), 'projects');
  assert.notEqual(emptyId, demoId);
  assert.equal(await page("document.querySelector('[data-action=undo]').disabled"), true);
  assert.equal(await page("document.querySelector('.project-card h2').textContent"), 'Pesquisa <local>');
  assert.equal((await list()).length, 2);
  await home();
  key('z', ['control']);
  await pause(30);
  assert.equal(await page("!!document.querySelector('#projects-screen')"), true);
  assert.equal((await list()).find(item => item.id === emptyId).imageCount, 0);

  const source = fs.readFileSync(path.join(__dirname, '../test-images/valid/04-pequena.png')).toString('base64');
  const imported = { version: 1, labels: [{ id: 'object', name: 'Objeto', color: '#123456' }], images: [{ id: 'one', name: 'uma.png', width: 8, height: 8, src: 'data:image/png;base64,' + source, reviewed: false, annotations: [] }] };
  await page(`{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(imported))}],'Coleção.json',{type:'application/json'}));const input=document.querySelector('#project-input');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await waitFor("!!document.querySelector('.app-shell[data-project-id]') && !!document.querySelector('.thumbnail') && " + idle);
  const importedId = await page("document.querySelector('.app-shell').dataset.projectId");
  assert.equal((await list()).length, 3);
  await home();
  await open(demoId);
  await page("document.querySelector('[data-action=undo]').click()");
  await home();
  const preserved = await page(`import('./src/storage.js').then(async m=>{await m.pruneImages();const value=await m.loadProject(${JSON.stringify(importedId)});return {value,bytes:(await m.imageBlob(value.images[0].src)).size}})`);
  assert.ok(preserved.value.images[0].src.startsWith('asset:'));
  assert.equal(preserved.bytes, Buffer.from(source, 'base64').length);
  assert.deepEqual(preserved.value.labels, imported.labels);
  await open(importedId);
  await waitFor("document.querySelector('.image-surface > img')?.naturalWidth===8");
  await page("document.querySelector('[data-action=complete]').click()");
  await home();
  assert.equal((await list()).find(item => item.id === importedId).completedCount, 1);

  // Falha no commit não publica projeto nem assets parciais.
  const beforeAbort = await list();
  const abort = await page(`(async()=>{const m=await import('./src/storage.js');const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('projects'))queueMicrotask(()=>tx.abort());return tx};try{await m.createLocalProject('Falha',${JSON.stringify(imported)});return false}catch{return true}finally{IDBDatabase.prototype.transaction=original}})()`);
  assert.equal(abort, true);
  assert.deepEqual(await list(), beforeAbort);

  const output = path.join(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  fs.writeFileSync(path.join(output, 'projects-home.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(390, 844);
  await pause(100);
  assert.equal(await page('document.documentElement.scrollWidth <= innerWidth'), true);
  fs.writeFileSync(path.join(output, 'projects-mobile.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(1440, 960);

  // Perfil descartável: simula banco legado para testar migração real/idempotente.
  await page(`new Promise((resolve,reject)=>{const r=indexedDB.open('anoint');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['projects','settings'],'readwrite');tx.objectStore('projects').clear();tx.objectStore('settings').clear();tx.objectStore('projects').put(${JSON.stringify(demo)},'current');tx.objectStore('settings').put({imageId:'demo-image',filmstripHidden:true},'view');tx.oncomplete=()=>{db.close();resolve(true)};tx.onabort=()=>{db.close();reject(tx.error)}}})`);
  const reload = async () => {
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.reload(); await loaded;
    await waitFor("!!document.querySelector('#projects-screen') && !!document.querySelector('[data-action=open-local-project]') && " + idle);
  };
  await reload();
  const migrated = await list();
  assert.equal(migrated.length, 1);
  assert.deepEqual(await page(`import('./src/storage.js').then(m=>m.loadProject(${JSON.stringify(migrated[0].id)}))`), demo);
  assert.equal(await page(`import('./src/storage.js').then(m=>m.loadView(${JSON.stringify(migrated[0].id)})).then(v=>v.filmstripHidden)`), true);
  await reload();
  assert.deepEqual((await list()).map(item => item.id), migrated.map(item => item.id));
  await open(migrated[0].id);
  await page("document.querySelector('[data-action=toggle-filmstrip]').click()");
  await home();
  console.log('Projetos OK: migração, criação, JSON como cópia, navegação, isolamento, falha de save/commit, assets e responsividade.');
};
