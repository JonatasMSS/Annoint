const electron = require('electron');
const { app, BrowserWindow } = electron;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { registerAgent } = require('../electron/agent.cjs');
const { registerImageScheme, registerNativeFiles } = require('../electron/native-files.cjs');
registerImageScheme(electron.protocol);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-agent-ui-'));
app.setPath('userData', path.join(directory, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let win, files, agent, client;
  const watchdog = setTimeout(() => { console.error('Tempo esgotado no teste MCP'); app.exit(1); }, 120000);
  try {
    const index = pathToFileURL(path.join(__dirname, '../index.html')).href;
    files = await registerNativeFiles(electron, app.getPath('userData'), index);
    agent = registerAgent(electron, index);
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
      offscreen: true,
    } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const page = async code => {
      try { return await win.webContents.executeJavaScript(code, true); }
      catch (error) { throw new Error(code.slice(0, 400), { cause: error }); }
    };
    const wait = async code => {
      for (let attempt = 0; attempt < 400; attempt++) { if (await page(code)) return; await pause(30); }
      throw new Error('Tempo esgotado: ' + code);
    };
    const click = async action => { await page(`document.querySelector('[data-assistant="${action}"]').click()`); await pause(80); };
    const memory = () => page("import('./src/storage.js').then(m=>m.loadAssistant(document.querySelector('.app-shell').dataset.projectId))");
    const project = () => page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
    const reopen = async () => {
      await win.loadURL(index);
      await require('./project-navigation.cjs')(page, wait);
      await wait("!!document.querySelector('.agent-card')");
    };
    await reopen();
    await page(`(async()=>{const m=await import('./src/storage.js'); const c=document.createElement('canvas'); c.width=100;c.height=80;c.getContext('2d').fillRect(0,0,100,80);const src=c.toDataURL();
      const p={version:1,labels:[{id:'ball',name:'Bola',color:'#123456'},{id:'other',name:'Outra',color:'#999999'}],images:[1,2,3].map(n=>({id:'frame-'+n,name:'frame-'+n+'.png',src,width:100,height:80,reviewed:true,annotations:n===1?[{id:'manual',labelId:'other',x:1,y:1,width:4,height:4}]:[]}))};
      await m.saveProject(document.querySelector('.app-shell').dataset.projectId,await m.externalizeProject(p));})()`);
    await reopen();
    await click('open'); await click('connect');
    await wait("!!document.querySelector('#assistant-config')");
    assert.equal(await page("document.querySelector('#assistant-connection').open"), false);
    assert.equal(await page("document.querySelector('#assistant-help').open"), false);
    fs.writeFileSync(path.join(directory, 'assistant-ready.png'), (await win.webContents.capturePage()).toPNG());
    const config = JSON.parse(await page("document.querySelector('#assistant-config').value")).mcpServers.anoint;
    const { Client } = await import('@modelcontextprotocol/client');
    const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
    client = new Client({ name: 'anoint-ui-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: 'node', args: config.args, env: config.env }));
    const call = async (name, args = {}, expectError = false) => {
      const result = await client.callTool({ name: 'anoint_' + name, arguments: args });
      if (expectError) { assert.equal(result.isError, true); return result; }
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return name === 'get_image' ? result : JSON.parse(result.content[0].text);
    };
    assert.equal((await call('get_context')).imageCount, 3);
    assert.equal(JSON.stringify(await call('list_images')).includes('asset:'), false);
    await call('get_image', { imageId: 'frame-1' }, true);
    await call('propose_task', { requestId: 'plan-1', description: 'Bola redonda, ignore sombras.', labelId: 'ball', calibrationCount: 1, batchSize: 2, imageIds: ['frame-1', 'frame-2', 'frame-3'] });
    await click('approve-plan');
    await page("document.querySelector('#assistant-manual-note').focus();document.querySelector('#assistant-manual-note').setSelectionRange(0,0)");
    await call('propose_task', { requestId: 'plan-2', description: 'Bola redonda, ignore sombras.', labelId: 'ball', calibrationCount: 1, batchSize: 2, imageIds: ['frame-1', 'frame-2', 'frame-3'] });
    assert.equal(await page("document.activeElement.id"), 'assistant-title');
    await click('approve-plan');
    let context = await call('get_context');
    assert.deepEqual(context.availableImageIds, ['frame-1']);
    const image = await call('get_image', { imageId: 'frame-1' });
    assert.equal(image.content[0].mimeType, 'image/jpeg');
    assert.equal(image.structuredContent.width, 100);
    await call('get_image', { imageId: 'frame-2' }, true);
    const firstProposal = { requestId: 'proposal-1', taskId: context.memory.task.id, frames: [{ imageId: 'frame-1', revision: image.structuredContent.revision, boxes: [{ x: 10, y: 10, width: 20, height: 20 }] }] };
    await page("document.querySelector('#assistant-manual-note').value='Critério manual em elaboração';document.querySelector('#assistant-manual-note').dispatchEvent(new Event('input',{bubbles:true}))");
    await click('close'); await click('open');
    assert.equal(await page("document.querySelector('#assistant-manual-note').value"), 'Critério manual em elaboração');
    assert.equal((await call('get_context')).memory.task.manualNote, undefined);
    await call('submit_proposal', firstProposal, true);
    await page("document.querySelector('#assistant-manual-note').value='';document.querySelector('#assistant-manual-note').dispatchEvent(new Event('input',{bubbles:true}))");
    await click('close'); await click('open');
    await call('submit_proposal', firstProposal);
    assert.equal(await page("document.querySelector('#assistant-geometry').open"), false);
    await pause(80);
    fs.writeFileSync(path.join(directory, 'assistant-review.png'), (await win.webContents.capturePage()).toPNG());
    await page("document.querySelector('#assistant-decision').value='corrected';document.querySelector('#assistant-decision').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await page("document.querySelector('#assistant-geometry').open"), true);
    await click('add-box');
    await page("document.querySelector('[data-assistant=remove-box][data-index=\"1\"]').click()");
    await pause(350);
    assert.equal(await page("document.activeElement.id"), 'assistant-decision');
    assert.equal(await page("document.querySelectorAll('.assistant-box').length"), 1);
    assert.equal((await project()).images[0].annotations.length, 1);
    assert.equal(await page("document.querySelectorAll('.assistant-suggestion').length"), 1);
    await page("document.querySelector('#assistant-note').value='Critério em elaboração';document.querySelector('#assistant-note').dispatchEvent(new Event('input',{bubbles:true}))");
    await pause(350);
    assert.ok((await memory()).pending.frames[0].draft);
    assert.equal((await call('get_context')).memory.pending.frames[0].draft, undefined);
    await page("document.querySelector('#assistant-note').focus();document.querySelector('#assistant-note').setSelectionRange(3,5)");
    await call('submit_proposal', firstProposal);
    assert.deepEqual(await page("[document.activeElement.id,document.activeElement.selectionStart,document.activeElement.selectionEnd]"), ['assistant-note', 3, 5]);
    await page("document.querySelector('#assistant-help').open=true;document.querySelector('#assistant-geometry').open=false;document.querySelector('#assistant-help-title').focus()");
    await call('submit_proposal', firstProposal);
    assert.equal(await page("document.activeElement.id"), 'assistant-help-title');
    assert.equal(await page("document.querySelector('#assistant-help').open"), true);
    assert.equal(await page("document.querySelector('#assistant-geometry').open"), false);
    await page("document.querySelector('#assistant-help').open=false");
    for (const decision of ['rejected', 'accepted', 'absent']) {
      if (!await page("!!document.querySelector('[data-coordinate=width]')")) await click('add-box');
      await page(`document.querySelector('#assistant-decision').value='corrected';document.querySelector('#assistant-decision').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-coordinate=width]').value='';document.querySelector('[data-coordinate=width]').dispatchEvent(new Event('input',{bubbles:true}));void 0`);
      assert.equal(await page("document.querySelector('#assistant-review').checkValidity()"), false);
      await page(`document.querySelector('#assistant-decision').value=${JSON.stringify(decision)};document.querySelector('#assistant-decision').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#assistant-note').value='Teste de troca de decisão';document.querySelector('#assistant-note').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#assistant-geometry').open=false;document.querySelector('#assistant-save-decision').focus()`);
      assert.equal(await page("document.querySelector('#assistant-review').checkValidity()"), true);
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await wait(`document.querySelector('[data-assistant=apply]').disabled===false && document.querySelector('#assistant-decision').value===${JSON.stringify(decision)}`);
      assert.equal((await memory()).pending.frames[0].review.decision, decision);
      assert.deepEqual((await memory()).pending.frames[0].review.boxes, decision === 'accepted' ? firstProposal.frames[0].boxes : []);
      assert.equal(await page("document.activeElement.id"), 'assistant-save-decision');
      await call('submit_proposal', firstProposal);
      assert.equal(await page("document.activeElement.id"), 'assistant-save-decision');
    }
    await click('add-box');
    await page("for(const [key,value] of Object.entries({x:10,y:10,width:20,height:20}))document.querySelector('[data-coordinate='+key+']').value=value");
    await page("document.querySelector('#assistant-decision').value='corrected';document.querySelector('#assistant-box-0-x').value=12;document.querySelector('#assistant-note').value='A borda começa em 12.';document.querySelector('#assistant-review').requestSubmit()");
    await wait("!document.querySelector('[data-assistant=apply]').disabled");
    assert.equal((await memory()).pending.frames[0].review.boxes[0].x, 12);

    // Um abort na transação não publica nem metade das caixas/feedback, e permite retry.
    await page("window.__transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=window.__transaction.apply(this,args);if(Array.isArray(args[0])&&args[0].includes('projects')&&args[0].includes('settings')&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx};window.confirm=()=>true;void 0");
    await click('apply');
    await wait("document.querySelector('#assistant-dialog .field-error').textContent.length>0");
    assert.equal((await project()).images[0].annotations.length, 1);
    assert.equal((await memory()).feedback.length, 0);
    await page('IDBDatabase.prototype.transaction=window.__transaction;void 0');
    await page("window.__assistantCommits=0;IDBDatabase.prototype.transaction=function(...args){const tx=window.__transaction.apply(this,args);if(Array.isArray(args[0])&&args[0].includes('projects')&&args[0].includes('settings')&&args[1]==='readwrite'){window.__assistantCommits++;if(window.__assistantCommits===1)queueMicrotask(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})));}return tx};void 0");
    await click('apply');
    await wait("!document.querySelector('#assistant-review')");
    await pause(400);
    assert.equal(await page('window.__assistantCommits'), 1);
    await page('IDBDatabase.prototype.transaction=window.__transaction;void 0');
    let stored = await project();
    assert.equal(stored.images[0].annotations.length, 2); assert.equal(stored.images[0].annotations[1].x, 12); assert.equal(stored.images[0].reviewed, false);
    context = await call('get_context');
    assert.equal(context.memory.task.phase, 'awaiting_batch'); assert.deepEqual(context.availableImageIds, []);
    const beforeClear = await memory();
    await page("document.querySelector('#assistant-history').open=true;document.querySelector('#assistant-clear-history').focus()");
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait("document.querySelector('#assistant-history-title').textContent==='Histórico (0)'");
    const afterClear = await memory();
    assert.deepEqual(afterClear, { ...beforeClear, historyClearedCount: 1 });
    assert.deepEqual(await project(), stored);
    assert.deepEqual((await call('get_context')).memory.feedback, context.memory.feedback);
    assert.equal(await page("document.querySelector('#assistant-history').open"), true);
    assert.equal(await page("document.activeElement.id"), 'assistant-history-title');
    fs.writeFileSync(path.join(directory, 'assistant-history.png'), (await win.webContents.capturePage()).toPNG());
    await click('close'); await click('open');
    assert.equal(await page("document.querySelector('#assistant-history-title').textContent"), 'Histórico (0)');
    await call('get_image', { imageId: 'frame-2' }, true);
    await click('authorize');
    context = await call('get_context'); assert.deepEqual(context.availableImageIds, ['frame-2', 'frame-3']);
    const frames = [];
    for (const imageId of context.availableImageIds) frames.push({ imageId, revision: (await call('get_image', { imageId })).structuredContent.revision, boxes: [] });
    const batch = { requestId: 'batch-1', taskId: context.memory.task.id, frames };
    await call('submit_proposal', batch);
    await page("document.querySelector('#assistant-decision').value='absent';document.querySelector('#assistant-note').value='Nenhuma bola';document.querySelector('#assistant-review').requestSubmit()");
    await wait("document.querySelector('#assistant-dialog').textContent.includes('1 de 2 imagens com decisão')");
    await page("document.querySelector('#assistant-frame').value='frame-3';document.querySelector('#assistant-frame').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#assistant-decision').value='rejected';document.querySelector('#assistant-note').value='A sombra não é bola';document.querySelector('#assistant-review').requestSubmit()");
    await wait("!document.querySelector('[data-assistant=apply]').disabled");
    await click('apply');
    await call('submit_proposal', batch); // Recibo impede dupla aplicação.
    assert.equal((await memory()).feedback.length, 3); assert.equal((await memory()).task.phase, 'complete');
    assert.equal(await page("document.querySelector('#assistant-history-title').textContent"), 'Histórico (2)');
    await click('close');
    await page("document.querySelector('[data-action=undo]').click()");
    await wait("document.querySelector('.save-status').textContent==='Todas as alterações salvas'");
    assert.equal((await memory()).feedback.length, 1); assert.equal((await memory()).pending.frames.length, 2);
    await client.close(); client = null;

    // Digitar e sair imediatamente precisa drenar o rascunho antes de bloquear navegação.
    await click('open');
    const oldId = await page("document.querySelector('.app-shell').dataset.projectId");
    await page("document.querySelector('#assistant-frame').value='frame-3';document.querySelector('#assistant-frame').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#assistant-note').value='Rascunho persistente';document.querySelector('#assistant-note').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action=projects]').click()");
    await wait("!!document.querySelector('#projects-screen')");
    assert.equal(await page(`import('./src/storage.js').then(m=>m.loadAssistant(${JSON.stringify(oldId)})).then(m=>m.pending.frames[1].draft.note)`), 'Rascunho persistente');
    await require('./project-navigation.cjs')(page, wait);
    await wait("!document.querySelector('#loading-dialog').open");
    await click('open');
    await page("document.querySelector('#assistant-frame').value='frame-3';document.querySelector('#assistant-frame').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await page("document.querySelector('#assistant-note').value"), 'Rascunho persistente');
    assert.equal(await page("document.querySelector('[data-assistant=apply]').disabled"), true);
    await page("document.querySelector('#assistant-review').requestSubmit()");
    await wait("!document.querySelector('[data-assistant=apply]').disabled");

    // Backup contém memória e decisões; YOLO continua usando apenas annotations.
    assert.equal(await page("(async()=>{const m=await import('./src/storage.js');const id=document.querySelector('.app-shell').dataset.projectId;const p=await m.portableProject(await m.loadProject(id),await m.loadAssistant(id));return p.assistant.pending.frames[1].review.decision})()"), 'rejected');
    // Exportar/reimportar muda asset:UUID, mas mantém uma revisão sem conflito aplicável.
    assert.equal(await page("(async()=>{const m=await import('./src/storage.js');const a=await import('./src/assistant.js');const id=document.querySelector('.app-shell').dataset.projectId;const p=await m.portableProject(await m.loadProject(id),await m.loadAssistant(id));const record=await m.createLocalProject('Backup MCP',p,p.assistant);const memory=await m.loadAssistant(record.id);const result=await a.reviewProposal(record.project,memory,memory.pending.frames.map(f=>({imageId:f.imageId,...f.review})));return result.assistant.feedback.length})()"), 3);
    await agent.close();
    await reopen();
    await click('open');
    assert.equal(await page("document.querySelector('#assistant-config')===null"), true);
    assert.equal((await memory()).pending.frames.length, 2);
    await click('connect');
    assert.equal(await page("!!document.querySelector('[data-assistant=resume]')"), true);
    // Retomar preserva decisões, sem aplicar automaticamente.
    await click('resume'); assert.equal((await memory()).feedback.length, 1);
    assert.equal((await project()).images[0].annotations.length, 2);
    await page("document.querySelector('#assistant-history').open=true");
    await click('clear-history');
    const pendingBeforeReload = (await memory()).pending;
    await agent.close();
    await reopen(); await click('open');
    assert.equal(await page("document.querySelector('#assistant-history-title').textContent"), 'Histórico (0)');
    assert.deepEqual((await memory()).pending, pendingBeforeReload);
    await wait("!document.querySelector('#loading-dialog').open");
    assert.equal(await page("document.querySelector('#assistant-dialog').open"), true);
    await pause(500);
    const panelBounds = await page("(()=>{const p=document.querySelector('#assistant-dialog');const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,visible:p.contains(document.elementFromPoint(r.x+30,r.y+30)),display:getComputedStyle(p).display}})()");
    assert.ok(panelBounds.x >= 0 && panelBounds.y >= 0 && panelBounds.width > 300 && panelBounds.height > 100 && panelBounds.visible, JSON.stringify(panelBounds));
    win.setSize(1000, 760);
    await pause(100);
    assert.equal(await page("(()=>{const r=document.querySelector('#assistant-dialog').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.querySelector('#assistant-dialog').scrollWidth<=r.width})()"), true);
    win.setSize(1440, 960);
    await pause(100);
    fs.writeFileSync(path.join(directory, 'assistant.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('MCP UI OK: stdio real, consentimento, imagem raster, calibração/correção, commit atômico/abort/retry, lotes/ausência/rejeição, idempotência, undo, JSON e retomada. Captura: ' + path.join(directory, 'assistant.png'));
    await agent.close(); files.close(); win.destroy(); clearTimeout(watchdog); app.exit(0);
  } catch (error) {
    console.error(error);
    try { fs.writeFileSync(path.join(directory, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(directory); } catch {}
    await client?.close(); await agent?.close(); files?.close(); win?.destroy(); clearTimeout(watchdog); app.exit(1);
  }
});
