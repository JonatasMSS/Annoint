const electron = require('electron');
const { app, BrowserWindow } = electron;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { registerAgent } = require('../electron/agent.cjs');
const isolatedMcpArgs = require('./mcp-test-args.cjs');
const { registerImageScheme, registerNativeFiles } = require('../electron/native-files.cjs');
registerImageScheme(electron.protocol);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-agent-chat-'));
// Isola também a sincronização da configuração do cliente, além do banco do Electron.
os.homedir = () => path.join(directory, 'client-home');
app.setPath('userData', path.join(directory, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let win, files, agent;
  const clients = [];
  const watchdog = setTimeout(() => { console.error('Tempo esgotado no teste MCP'); app.exit(1); }, 120000);
  try {
    const index = pathToFileURL(path.join(__dirname, '../index.html')).href;
    files = await registerNativeFiles(electron, app.getPath('userData'), index);
    agent = registerAgent(electron, index);
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true,
    } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const page = async code => {
      try { return await win.webContents.executeJavaScript(code, true); }
      catch (error) { throw new Error(code.slice(0, 300), { cause: error }); }
    };
    const wait = async code => {
      for (let attempt = 0; attempt < 400; attempt++) { if (await page(code)) return; await pause(30); }
      throw new Error('Tempo esgotado: ' + code);
    };
    const click = async action => { await page(`document.querySelector('[data-assistant="${action}"]').click()`); await pause(80); };
    const memory = () => page("import('./src/storage.js').then(m=>m.loadAssistant(document.querySelector('.app-shell').dataset.projectId))");
    const project = () => page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
    const reopen = async () => { await win.loadURL(index); await require('./project-navigation.cjs')(page, wait); await wait("!!document.querySelector('.agent-card')"); };
    await reopen();
    await page(`(async()=>{const m=await import('./src/storage.js');const c=document.createElement('canvas');c.width=100;c.height=80;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,100,80);const src=c.toDataURL();
      const p={version:1,labels:[{id:'other',name:'Outra',color:'#999999'}],images:[1,2,3].map(n=>({id:'frame-'+n,name:'frame-'+n+'.png',src,width:100,height:80,reviewed:true,annotations:n===1?[{id:'manual',labelId:'other',x:1,y:1,width:4,height:4},{id:'keep-other',labelId:'other',x:70,y:50,width:10,height:10}]:[]}))};
      await m.saveProject(document.querySelector('.app-shell').dataset.projectId,await m.externalizeProject(p));})()`);
    await reopen(); await click('open'); await click('connect');
    let config = JSON.parse(await page("document.querySelector('#assistant-config').value")).mcpServers.anoint;
    assert.equal(await page("document.querySelectorAll('[data-assistant=approve-plan],#assistant-review,[data-assistant=apply]').length"), 0);
    await click('close');
    const { Client } = await import('@modelcontextprotocol/client');
    const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
    const prompts = [];
    let answer = async () => ({ action: 'accept', content: { confirm: true } });
    const connect = async (native, confirmationMode = native ? 'native' : config.env.ANOINT_CONFIRMATION_MODE) => {
      const client = new Client({ name: 'anoint-chat-test', version: '1.0.0' }, {
        capabilities: native ? { elicitation: { form: {} } } : {}, versionNegotiation: { mode: { pin: '2026-07-28' } },
      });
      if (native) client.setRequestHandler('elicitation/create', async request => { prompts.push(request.params); return answer(request.params); });
      await client.connect(new StdioClientTransport({ command: 'node', args: isolatedMcpArgs(config.args), env: { ...config.env, ANOINT_CONFIRMATION_MODE: confirmationMode } }));
      clients.push(client); return client;
    };
    const native = await connect(true);
    const call = async (name, args = {}, expectError = false, client = native) => {
      const result = await client.callTool({ name: 'anoint_' + name, arguments: args });
      if (expectError) { assert.equal(result.isError, true, JSON.stringify(result)); return result; }
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return name === 'get_image' ? result : JSON.parse(result.content[0].text);
    };
    assert.equal((await native.listTools()).tools.length, 11);
    await call('create_class', { id: 'ball', name: 'Bola', color: '#123456' });
    await call('create_class', { id: 'ball', name: 'Bola', color: '#123456' });
    await call('create_class', { id: 'duplicate', name: 'bola', color: '#123456' }, true);
    await call('update_class', { id: 'ball', name: 'Bola amarela' });
    assert.equal((await project()).labels.find(label => label.id === 'ball').name, 'Bola amarela');
    await call('get_image', { imageId: 'frame-1' }, true);
    const plan = { requestId: 'plan-1', description: 'Bola redonda, ignore sombras.', labelId: 'ball', calibrationCount: 1, batchSize: 2, imageIds: ['frame-1', 'frame-2', 'frame-3'] };
    await call('propose_task', plan);
    answer = async () => { assert.equal((await memory()).task, null); return { action: 'decline' }; };
    assert.equal((await call('control_task', { action: 'plan', requestId: plan.requestId })).status, 'declined');
    await call('get_image', { imageId: 'frame-1' }, true);
    answer = async () => ({ action: 'accept', content: { confirm: true } });
    await call('control_task', { action: 'plan', requestId: plan.requestId });
    assert.ok(prompts.at(-1).message.includes('nuvem'));
    let context = await call('get_context');
    let taskId = context.memory.task.id;
    assert.deepEqual(context.availableImageIds, ['frame-1']);
    const source = await call('get_image', { imageId: 'frame-1' });
    const first = { requestId: 'proposal-1', taskId, frames: [{ imageId: 'frame-1', revision: source.structuredContent.revision, boxes: [{ x: 10, y: 10, width: 20, height: 20 }] }] };
    await call('submit_proposal', first);
    const preview = await call('get_image', { imageId: 'frame-1', view: 'review' });
    assert.notEqual(preview.content[0].data, source.content[0].data);
    assert.equal(preview.structuredContent.proposalId, 'proposal-1');
    assert.equal((await project()).images[0].annotations.length, 2);
    await page("document.querySelector('[data-box=manual]').click();document.querySelector('#box-x').value=''");
    await call('get_context', {}, true);
    await page("document.querySelector('#box-x').value='1'");
    const changeBox = async (key, value) => {
      await page(`document.querySelector('[data-box="manual"]').click();document.querySelector('#box-${key}').value=${JSON.stringify(String(value))};document.querySelector('#box-${key}').dispatchEvent(new Event('change',{bubbles:true}))`);
      await wait("document.querySelector('.save-status').textContent==='Todas as alterações salvas'");
    };
    const review = { taskId, requestId: 'proposal-1', decisions: [{ imageId: 'frame-1', decision: 'accepted', note: 'Boa' }] };
    answer = async () => { await changeBox('x', 2); return { action: 'accept', content: { confirm: true } }; };
    await call('review', review, true);
    assert.equal((await memory()).feedback.length, 0);
    await page("document.querySelector('[data-box=manual]').click();document.querySelector('#box-class').value='ball';document.querySelector('#box-class').dispatchEvent(new Event('change',{bubbles:true}))");
    for (const [key, value] of Object.entries({ x: 12, y: 10, width: 20, height: 20 })) await changeBox(key, value);
    const manualImage = await call('get_image', { imageId: 'frame-1' });
    answer = async () => ({ action: 'accept', content: { confirm: true } });
    await call('review', { taskId, requestId: 'proposal-1', decisions: [{ imageId: 'frame-1', decision: 'manual', note: 'Este é o correto', revision: manualImage.structuredContent.revision }] });
    assert.equal((await project()).images[0].annotations.length, 2);
    assert.equal((await project()).images[0].annotations[0].id, 'manual');
    assert.equal((await memory()).feedback[0].decision, 'manual');
    assert.equal((await memory()).task.phase, 'awaiting_batch');
    await call('update_class', { id: 'ball', name: 'Bola' });
    assert.equal((await call('get_context')).examplesStale, false);
    const makeBatch = async requestId => {
      await call('control_task', { action: 'batch', taskId });
      const frames = [];
      for (const imageId of ['frame-2', 'frame-3']) frames.push({ imageId, revision: (await call('get_image', { imageId })).structuredContent.revision,
        boxes: imageId === 'frame-2' ? [{ x: 10, y: 10, width: 20, height: 20 }] : [] });
      await call('submit_proposal', { requestId, taskId, frames });
    };
    await makeBatch('batch-old');
    await changeBox('x', 9);
    assert.equal((await call('get_context')).examplesStale, true);
    const correctedExample = await call('get_image', { imageId: 'frame-1' });
    await call('manual_example', { taskId, imageId: 'frame-1', revision: correctedExample.structuredContent.revision, note: 'Este é o correto' });
    assert.equal((await memory()).pending, null);
    assert.equal((await memory()).feedback.length, 1);
    assert.equal((await memory()).feedback[0].final[0].x, 9);
    await makeBatch('batch-2');
    const batchReview = { taskId, requestId: 'batch-2', decisions: [
      { imageId: 'frame-2', decision: 'corrected', boxes: [{ x: 15, y: 10, width: 20, height: 20 }], note: 'Ajuste à esquerda' },
      { imageId: 'frame-3', decision: 'absent', note: 'Nenhuma bola' },
    ] };
    await page("window.__transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=window.__transaction.apply(this,args);if(Array.isArray(args[0])&&args[0].includes('projects')&&args[0].includes('settings')&&args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx};void 0");
    await call('review', batchReview, true);
    assert.equal((await project()).images[1].annotations.length, 0);
    assert.equal((await memory()).feedback.length, 1);
    await page('IDBDatabase.prototype.transaction=window.__transaction;void 0');
    await call('review', batchReview);
    assert.equal((await memory()).task.phase, 'complete');
    assert.equal((await project()).images[1].annotations.length, 1);
    assert.equal((await project()).images[1].annotations[0].x, 15);
    await call('control_task', { action: 'clear_history', taskId });
    context = await call('get_context'); assert.equal(context.history.length, 0); assert.equal(context.memory.feedback.length, 3);
    // A recusa da confirmação EXTRA não remove a classe usada.
    answer = async params => params.requestedSchema.properties.answer ? { action: 'decline' } : { action: 'accept', content: { confirm: true } };
    assert.equal((await call('remove_class', { id: 'other', replacementId: 'ball' })).status, 'declined');
    assert.ok((await project()).labels.some(label => label.id === 'other'));
    const fallback = await connect(false);
    const removal = { id: 'other', replacementId: 'ball' };
    const firstConfirmation = await call('remove_class', removal, false, fallback);
    assert.equal(firstConfirmation.status, 'confirmation_required'); assert.equal(firstConfirmation.confirmation.extra, false);
    assert.ok(firstConfirmation.confirmation.message.includes('1 caixa(s) em 1 imagem(ns)'));
    await call('remove_class', { ...removal, confirmation: { id: 'inventada', answer: 'CONFIRMAR' } }, true, fallback);
    const second = await call('remove_class', { ...removal, confirmation: { id: firstConfirmation.confirmation.id, answer: firstConfirmation.confirmation.phrase } }, false, fallback);
    assert.equal(second.confirmation.extra, true);
    assert.equal(second.confirmation.phrase, 'REMOVER Outra');
    assert.ok((await project()).labels.some(label => label.id === 'other'));
    await call('remove_class', { ...removal, confirmation: { id: second.confirmation.id, answer: 'sim' } }, true, fallback);
    const confirmed = { ...removal, confirmation: { id: second.confirmation.id, answer: second.confirmation.phrase } };
    await call('remove_class', confirmed, false, fallback);
    const afterRemoval = await project();
    assert.deepEqual(afterRemoval.labels.map(label => label.id), ['ball']);
    assert.equal(afterRemoval.images[0].annotations.find(box => box.id === 'keep-other').labelId, 'ball');
    await call('remove_class', confirmed, false, fallback); assert.deepEqual(await project(), afterRemoval);
    await call('remove_class', { id: 'ball' }, true, fallback);
    // Backup preserva o trabalho. Reconectar retoma no CHAT, sem painel de revisão.
    assert.equal(await page("(async()=>{const m=await import('./src/storage.js');const id=document.querySelector('.app-shell').dataset.projectId;const p=await m.portableProject(await m.loadProject(id),await m.loadAssistant(id));return p.assistant.feedback.length})()"), 3);
    for (const client of clients) await client.close(); clients.length = 0;
    await agent.close(); await reopen(); await click('open');
    assert.equal((await memory()).feedback.length, 3);
    assert.equal(await page("document.querySelector('#assistant-review')===null"), true);
    await click('connect');
    // Só a conexão é obtida no aplicativo; a configuração antiga foi revogada.
    const newConfig = JSON.parse(await page("document.querySelector('#assistant-config').value")).mcpServers.anoint;
    assert.notEqual(newConfig.env.ANOINT_TOKEN, config.env.ANOINT_TOKEN);
    config = newConfig;
    answer = async () => ({ action: 'accept', content: { confirm: true } });
    const resumed = await connect(true);
    const previousTaskId = (await memory()).task.id;
    const resumedTask = await call('control_task', { action: 'resume', taskId: previousTaskId }, false, resumed);
    assert.notEqual(resumedTask.taskId, previousTaskId);
    assert.equal((await call('get_context', {}, false, resumed)).memory.feedback.length, 3);
    await call('get_image', { imageId: 'frame-1' }, false, resumed);
    // Calibração conjunta: várias caixas/imagens, decisões mistas e uma confirmação por conjunto.
    const groupPlan = { ...plan, requestId: 'group-plan', calibrationCount: 3, batchSize: 3 };
    await call('propose_task', groupPlan, false, resumed);
    await call('control_task', { action: 'plan', requestId: groupPlan.requestId }, false, resumed);
    const groupContext = await call('get_context', {}, false, resumed);
    assert.deepEqual(groupContext.availableImageIds, ['frame-1', 'frame-2', 'frame-3']);
    const groupFrames = await Promise.all(groupContext.availableImageIds.map(async imageId => ({ imageId,
      revision: (await call('get_image', { imageId }, false, resumed)).structuredContent.revision,
      boxes: [{ x: 30, y: 30, width: 8, height: 8 }, { x: 50, y: 20, width: 8, height: 8 }],
    })));
    const beforeGroup = await project();
    await call('submit_proposal', { requestId: 'group-proposal', taskId: groupContext.memory.task.id, frames: groupFrames }, false, resumed);
    assert.equal((await memory()).pending.frames.length, 3);
    assert.deepEqual(await project(), beforeGroup);
    for (const imageId of groupContext.availableImageIds) {
      assert.equal((await call('get_image', { imageId, view: 'review' }, false, resumed)).structuredContent.proposalId, 'group-proposal');
    }
    const groupReview = { taskId: groupContext.memory.task.id, requestId: 'group-proposal', decisions: [
      { imageId: 'frame-1', decision: 'accepted' },
      { imageId: 'frame-2', decision: 'corrected', boxes: [{ x: 32, y: 31, width: 9, height: 9 }], note: 'Ajustei esta imagem' },
      { imageId: 'frame-3', decision: 'rejected', note: 'Não é o alvo' },
    ] };
    let promptCount = prompts.length;
    answer = async params => { assert.ok(params.message.includes('3 imagem(ns)')); return { action: 'decline' }; };
    assert.equal((await call('review', groupReview, false, resumed)).status, 'declined');
    assert.equal(prompts.length, promptCount + 1);
    assert.deepEqual(await project(), beforeGroup);
    assert.equal((await memory()).feedback.length, 0);
    assert.equal((await memory()).pending.frames.length, 3);
    promptCount = prompts.length;
    answer = async () => ({ action: 'accept', content: { confirm: true } });
    await call('review', groupReview, false, resumed);
    assert.equal(prompts.length, promptCount + 1);
    const afterGroup = await project();
    assert.deepEqual(afterGroup.images.map((image, i) => image.annotations.length - beforeGroup.images[i].annotations.length), [2, 1, 0]);
    assert.deepEqual((await memory()).feedback.map(item => item.decision), ['accepted', 'corrected', 'rejected']);
    assert.equal((await memory()).task.phase, 'complete');
    // Cliente anuncia form, mas cancela automaticamente: configuração copiada usa o chat.
    assert.equal(config.env.ANOINT_CONFIRMATION_MODE, 'chat');
    const chat = await connect(true, config.env.ANOINT_CONFIRMATION_MODE);
    answer = async () => ({ action: 'cancel' });
    promptCount = prompts.length;
    const chatPlan = { ...groupPlan, requestId: 'chat-mode-plan' };
    await call('propose_task', chatPlan, false, chat);
    const chatBefore = await memory();
    const ask = await call('control_task', { action: 'plan', requestId: chatPlan.requestId }, false, chat);
    assert.equal(ask.status, 'confirmation_required');
    assert.deepEqual(await memory(), chatBefore);
    assert.equal(prompts.length, promptCount);
    await call('control_task', { action: 'plan', requestId: chatPlan.requestId,
      confirmation: { id: ask.confirmation.id, answer: ask.confirmation.phrase } }, false, chat);
    assert.equal((await memory()).task.requestId, chatPlan.requestId);
    assert.equal(prompts.length, promptCount);
    assert.deepEqual(await project(), afterGroup);
    // Reset pelo teclado renova credenciais sem perder proposta ou aceitar confirmação antiga.
    const resetTaskId = (await memory()).task.id;
    const resetFrames = await Promise.all(chatPlan.imageIds.map(async imageId => ({ imageId,
      revision: (await call('get_image', { imageId }, false, chat)).structuredContent.revision,
      boxes: [{ x: 20, y: 20, width: 10, height: 10 }],
    })));
    await call('submit_proposal', { taskId: resetTaskId, requestId: 'reset-pending', frames: resetFrames }, false, chat);
    const resetReview = { taskId: resetTaskId, requestId: 'reset-pending', decisions: resetFrames.map(frame => ({ imageId: frame.imageId, decision: 'accepted' })) };
    const oldAsk = await call('review', resetReview, false, chat);
    const resetMemory = await memory(), resetProject = await project(), oldConfig = config;
    await page("window.__beforeResetConfig=document.querySelector('#assistant-config').value;document.querySelector('#assistant-reset').focus();void 0");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait("document.querySelector('#assistant-config')?.value!==window.__beforeResetConfig && document.activeElement.id==='assistant-reset' && !document.activeElement.disabled");
    config = JSON.parse(await page("document.querySelector('#assistant-config').value")).mcpServers.anoint;
    assert.ok(config.env.ANOINT_TOKEN !== oldConfig.env.ANOINT_TOKEN);
    assert.equal(await page("document.querySelector('#assistant-dialog').open && document.querySelector('#assistant-status').textContent.includes('retome no chat')"), true);
    assert.deepEqual(await memory(), resetMemory);
    assert.deepEqual(await project(), resetProject);
    await call('get_context', {}, true, chat);
    const resetClient = await connect(false);
    assert.deepEqual((await call('get_context', {}, false, resetClient)).availableImageIds, []);
    await call('review', { ...resetReview, confirmation: { id: oldAsk.confirmation.id, answer: oldAsk.confirmation.phrase } }, true, resetClient);
    const resumeAsk = await call('control_task', { action: 'resume', taskId: resetTaskId }, false, resetClient);
    await call('control_task', { action: 'resume', taskId: resetTaskId,
      confirmation: { id: resumeAsk.confirmation.id, answer: resumeAsk.confirmation.phrase } }, false, resetClient);
    const afterReset = await call('get_context', {}, false, resetClient);
    assert.notEqual(afterReset.memory.task.id, resetTaskId);
    assert.equal(afterReset.memory.pending.requestId, 'reset-pending');
    assert.deepEqual(afterReset.availableImageIds, chatPlan.imageIds);
    assert.deepEqual(await project(), resetProject);
    win.setSize(1000, 760); await pause(100);
    assert.equal(await page("(()=>{const p=document.querySelector('#assistant-dialog'),r=p.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&p.scrollWidth<=r.width})()"), true);
    await page("document.querySelector('#assistant-config').value='Configuração privada ocultada na captura de teste.'");
    fs.writeFileSync(path.join(directory, 'connection.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('MCP CHAT OK: conexão única no app; 11 tools; permissões nativas e fallback; preview; classes; correção manual sem duplicação; conflitos; commit/abort; calibração conjunta e decisões mistas; lotes; remoção dupla; backup/reload; reset por teclado, revogação e retomada. Captura: ' + path.join(directory, 'connection.png'));
    for (const client of clients) await client.close(); clients.length = 0;
    await agent.close(); files.close(); win.destroy(); clearTimeout(watchdog); app.exit(0);
  } catch (error) {
    console.error(error);
    try { fs.writeFileSync(path.join(directory, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(directory); } catch {}
    for (const client of clients) await client.close(); await agent?.close(); files?.close(); win?.destroy(); clearTimeout(watchdog); app.exit(1);
  }
});
