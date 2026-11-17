const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'scenes-ui');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-scenes-ui-'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'test-scenes', 'manifest.json'), 'utf8'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const passed = name => { checks.push(name); console.log('OK: ' + name); };
const geometry = box => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, box[key]]));
const sha = data => createHash('sha256').update(data).digest('hex');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true,
  } });
  let operation = 'startup';
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const report = (success, error) => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
    success, checks, error: error?.stack, operation, electron: process.versions.electron,
    inputImages: manifest.images.length, expectedObjects: manifest.summary.objects, emptyImages: manifest.summary.emptyImages,
    profile, consoleErrors: errors,
    limits: ['Seletor de arquivos controlado por DataTransfer; sem diálogo nativo/preload.',
      'Caixas orientadas pelo gabarito: teste de interface, não reconhecimento por IA/MCP.',
      'Exclusão da cópia no projeto; nenhuma chamada à Lixeira e nenhum original alterado.'],
  }, null, 2));
  const watchdog = setTimeout(() => {
    report(false, new Error('Tempo máximo de cinco minutos')); win.destroy(); app.exit(1);
  }, 300000);
  const page = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error('Comando do teste: ' + code.slice(0, 180), { cause: error }); }
  };
  const wait = async code => {
    for (let i = 0; i < 600; i++) { if (await page(code)) return; await pause(30); }
    throw new Error(`Tempo esgotado: ${code}`);
  };
  const click = selector => page(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const change = (selector, value) => page(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`);
  const saved = () => wait("document.querySelector('.save-status')?.textContent==='Todas as alterações salvas'&&document.querySelector('#app').ariaBusy!=='true'");
  const disk = () => page("import('./src/storage.js').then(m=>m.loadProject(document.querySelector('.app-shell').dataset.projectId))");
  const bounds = selector => page(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  const measures = () => page("Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(document.querySelector('#box-'+k).value)]))");
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y),
    button: 'left', clickCount: 1, modifiers: type === 'mouseUp' ? [] : ['leftbuttondown'] });
  const key = (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const drag = async (start, end) => {
    mouse('mouseDown', start.x, start.y); await pause(20);
    mouse('mouseMove', end.x, end.y); await pause(20);
    mouse('mouseUp', end.x, end.y); await pause(20);
  };
  const capture = async name => {
    win.webContents.invalidate();
    await page('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    await pause(120);
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  };
  const exact = async box => {
    for (const field of ['width', 'height', 'x', 'y']) await change('#box-' + field, box[field]);
    assert.deepEqual(await measures(), geometry(box));
  };
  const open = async value => {
    await page(`{window.confirm=()=>true;const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'teste.json',{type:'application/json'}));const input=document.querySelector('#project-input');input.files=t.files;document.querySelector('#toast').textContent='';input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await wait("document.querySelector('#toast').textContent.includes('Projeto aberto')"); await saved();
  };
  const reload = async () => {
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.reload(); await loaded; await require('./project-navigation.cjs')(page, wait); await wait("!!document.querySelector('#batch-select')"); await saved();
  };
  const expectedName = image => image.path;
  const select = async image => {
    await page(`Array.from(document.querySelectorAll('.thumbnail')).find(e=>e.getAttribute('aria-label').startsWith(${JSON.stringify(expectedName(image) + ',')})).click()`);
    await wait(`document.querySelector('.image-surface > img')?.complete&&document.querySelector('.image-surface > img').naturalWidth===${image.width}&&document.querySelector('.image-filename').textContent===${JSON.stringify(expectedName(image))}`);
    await click('[data-action=fit]'); await pause(25);
  };
  const focusBox = box => page(`{const box=${JSON.stringify(box)};const stage=document.querySelector('#stage');const s=stage.getBoundingClientRect();const r=document.querySelector('.image-surface').getBoundingClientRect();stage.scrollLeft+=r.x+(box.x+box.width/2)*r.width/${box.imageWidth}-s.x-stage.clientWidth/2;stage.scrollTop+=r.y+(box.y+box.height/2)*r.height/${box.imageHeight}-s.y-stage.clientHeight/2;}`);
  const draw = async (image, box, labelId, before) => {
    await click(`[data-label="${labelId}"]`); await click('[data-tool=box]');
    await focusBox({ ...box, imageWidth: image.width, imageHeight: image.height }); await pause(20);
    const rect = await bounds('.image-surface'), stage = await bounds('#stage');
    const sx = rect.width / image.width, sy = rect.height / image.height;
    const start = { x: Math.ceil(rect.x + box.x * sx + .2), y: Math.ceil(rect.y + box.y * sy + .2) };
    const end = { x: Math.floor(rect.x + (box.x + box.width) * sx - .2), y: Math.floor(rect.y + (box.y + box.height) * sy - .2) };
    assert.ok(start.x >= stage.x && start.y >= stage.y && end.x < stage.right && end.y < stage.bottom, 'Caixa deve estar visível para o ponteiro');
    await drag(start, end);
    await wait(`document.querySelectorAll('.annotation').length===${before + 1}`);
    const actual = await measures();
    for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[field] - box[field]) <= 3 / Math.min(sx, sy), `Desenho: ${field}`);
    await exact(box);
    assert.equal(await page("document.querySelector('#box-class').value"), labelId);
  };
  const exportFile = async (format, name) => {
    const target = path.join(output, name);
    let timer;
    const download = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Download não concluiu: ' + name)), 20000);
      win.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(target);
        item.once('done', (_event, state) => state === 'completed' ? resolve(target) : reject(new Error(state)));
      });
    });
    download.catch(() => {});
    try {
      await click('[data-action=export]'); await change('#export-format', format);
      await page("document.querySelector('#export-form').requestSubmit()");
      await download; await wait("!document.querySelector('#export-dialog').open");
      return fs.readFileSync(target);
    } finally { clearTimeout(timer); }
  };
  const zipEntries = data => {
    const entries = new Map();
    for (let offset = 0; data.readUInt32LE(offset) === 0x04034b50;) {
      assert.equal(data.readUInt16LE(offset + 8), 0);
      const size = data.readUInt32LE(offset + 18), names = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28);
      const name = data.toString('utf8', offset + 30, offset + 30 + names);
      const start = offset + 30 + names + extra, bytes = data.subarray(start, start + size);
      assert.equal(crc32(bytes), data.readUInt32LE(offset + 14));
      entries.set(name, bytes); offset = start + size;
    }
    return entries;
  };
  try {
    operation = 'Importação e classes';
    await win.loadFile(path.join(root, 'index.html'));
    await require('./project-navigation.cjs')(page, wait);
    await wait("!!document.querySelector('#project-input')&&!!document.querySelector('.thumbnail')");
    await open({ version: 1, labels: [manifest.labels[0]], images: [] });
    for (const label of manifest.labels.slice(1)) {
      await click('[data-action=new-class]');
      await page(`document.querySelector('#class-name').value=${JSON.stringify(label.name)};document.querySelector('#class-color').value=${JSON.stringify(label.color)};document.querySelector('#class-form').requestSubmit()`);
    }
    await saved();
    const labels = (await disk()).labels;
    assert.deepEqual(labels.map(({ name, color }) => ({ name, color })), manifest.labels.map(({ name, color }) => ({ name, color })));
    const labelId = Object.fromEntries(manifest.labels.map((label, index) => [label.id, labels[index].id]));
    await page("window.__liveImages=new Set();window.__create=URL.createObjectURL;window.__revoke=URL.revokeObjectURL;URL.createObjectURL=function(blob){const url=window.__create(blob);if(blob.type.startsWith('image/'))window.__liveImages.add(url);return url};URL.revokeObjectURL=function(url){window.__liveImages.delete(url);window.__revoke(url)};void 0");
    const payload = manifest.images.map(image => ({ name: image.path, bytes: fs.readFileSync(path.join(root, 'test-scenes', image.path)).toString('base64') }));
    await page(`{const t=new DataTransfer();for(const item of ${JSON.stringify(payload)}){const f=new File([Uint8Array.from(atob(item.bytes),c=>c.charCodeAt(0))],item.name.split('/').at(-1),{type:'image/png'});Object.defineProperty(f,'webkitRelativePath',{value:item.name});t.items.add(f)}const input=document.querySelector('#folder-input');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await wait("document.querySelectorAll('.thumbnail').length===100&&document.querySelectorAll('.thumbnail.image-loading').length===0"); await saved();
    const imported = await disk();
    assert.equal(imported.images.length, 100);
    assert.ok(imported.images.every(image => image.annotations.length === 0 && !image.reviewed));
    assert.deepEqual(imported.images.map(image => [image.name, image.width, image.height]), manifest.images.map(image => [image.path, image.width, image.height]));
    assert.equal(await page('window.__liveImages.size'), 100);
    passed('100 PNGs importadas sem caixas, dimensões/ordem corretas e 11 classes criadas pela interface');

    operation = 'Desenho das 346 caixas';
    for (const [index, image] of manifest.images.entries()) {
      await select(image);
      if (index === 11) { for (let n = 0; n < 5; n++) await click('[data-action=zoom-in]'); }
      for (const [boxIndex, box] of image.annotations.entries()) await draw(image, box, labelId[box.labelId], boxIndex);
      if (index === 0) {
        assert.match(await page("document.querySelector('.thumbnail.active').getAttribute('aria-label')"), /em edição$/);
        await click('.annotation-row');
        const original = await measures();
        const rect = await bounds('.annotation.is-selected .box'), surface = await bounds('.image-surface');
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        await drag(start, { x: start.x + 18 * surface.width / image.width, y: start.y + 12 * surface.height / image.height });
        assert.ok((await measures()).x > original.x + 15);
        await click('[data-action=undo]'); assert.deepEqual(await measures(), original);
        await click('[data-action=redo]'); assert.ok((await measures()).x > original.x + 15);
        await click('[data-action=undo]');
        const handle = await bounds('[data-handle=se]');
        await drag({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
          { x: handle.x + handle.width / 2 + 20, y: handle.y + handle.height / 2 + 12 });
        assert.ok((await measures()).width > original.width);
        await click('[data-action=undo]'); assert.deepEqual(await measures(), original);
        await change('#box-class', labelId.house);
        assert.equal(await page("document.querySelector('.annotation.is-selected text').textContent"), 'Casa');
        await click('[data-action=undo]');
        await click('[data-action=delete]'); assert.equal(await page("document.querySelectorAll('.annotation').length"), 0);
        await click('[data-action=undo]');
        assert.equal(await page("document.querySelectorAll('.annotation').length"), 1);
        await click('.annotation-row'); assert.deepEqual(await measures(), original);
        const selected = await bounds('.annotation.is-selected .box');
        mouse('mouseDown', selected.x + selected.width / 2, selected.y + selected.height / 2); await pause(20);
        mouse('mouseMove', selected.x + selected.width / 2 + 35, selected.y + selected.height / 2 + 20); await pause(550);
        key('Escape'); await pause(20); mouse('mouseUp', selected.x + selected.width / 2 + 35, selected.y + selected.height / 2 + 20);
        await saved(); assert.deepEqual(geometry((await disk()).images[0].annotations[0]), original);
        passed('Mover, resize, classe, excluir, desfazer/refazer e Esc preservam geometria e gravação');
      }
      if (index === 8) await capture('01-carro.png');
      if (index === 11) {
        assert.ok(await page("document.querySelector('#stage').scrollTop>0||document.querySelector('#stage').scrollLeft>0"));
        await capture('02-zoom-rolagem.png');
      }
      await click('[data-action=complete]');
      assert.equal(await page("document.querySelector('.complete-button').getAttribute('aria-pressed')"), 'true');
      if ((index + 1) % 20 === 0) console.log(`Cenas: ${index + 1}/100 concluídas`);
    }
    await saved();
    const completed = await disk();
    assert.equal(completed.images.filter(image => image.reviewed).length, 100);
    assert.equal(completed.images.reduce((sum, image) => sum + image.annotations.length, 0), 346);
    for (const [index, image] of completed.images.entries()) {
      assert.deepEqual(image.annotations.map(box => ({ ...geometry(box), labelId: box.labelId })),
        manifest.images[index].annotations.map(box => ({ ...geometry(box), labelId: labelId[box.labelId] })));
    }
    assert.match(await page("document.querySelector('#batch-select').selectedOptions[0].textContent"), /100\/100.*Concluído/);
    passed('346 caixas desenhadas por ponteiro e ajustadas no inspetor; 100 concluídas, incluindo cinco negativas');
    await page("document.querySelector('.save-status').focus()"); key('Left');
    await wait("document.querySelector('.image-filename').textContent.endsWith('scene-099.png')"); key('Right');
    await wait("document.querySelector('.image-filename').textContent.endsWith('scene-100.png')");
    await change('#image-filter', 'pending'); assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 0);
    await change('#image-filter', 'done'); assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 100);
    await change('#image-filter', 'all');
    const stageHeight = await page("document.querySelector('#stage').clientHeight");
    await click('[data-action=toggle-filmstrip]');
    assert.equal(await page("document.activeElement.dataset.action"), 'toggle-filmstrip');
    assert.equal(await page("document.querySelector('[data-action=toggle-filmstrip]').getAttribute('aria-expanded')"), 'false');
    assert.ok(await page("document.querySelector('#stage').clientHeight") > stageHeight);
    await click('[data-action=toggle-filmstrip]');
    passed('Navegação por teclado, filtros e recolhimento de miniaturas funcionam');

    operation = 'Lotes 100+1, cache e reload';
    await page(`{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob(${JSON.stringify(payload[0].bytes)}),c=>c.charCodeAt(0))],'boundary-extra.png',{type:'image/png'}));const input=document.querySelector('#image-input');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await wait("document.querySelector('#batch-select')?.value==='1'&&document.querySelectorAll('.thumbnail.image-loading').length===0");
    assert.equal(await page('window.__liveImages.size'), 1);
    assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 1);
    await draw(manifest.images[0], manifest.images[0].annotations[0], labelId.square, 0);
    await click('[data-action=complete]'); await saved();
    await click('[data-action=previous-batch]');
    await wait("document.querySelectorAll('.thumbnail.image-loading').length===0");
    assert.equal(await page('window.__liveImages.size'), 100);
    assert.match(await page("document.querySelector('.image-filename').textContent"), /scene-100.png$/);
    await click('[data-action=next-batch]');
    await wait("document.querySelectorAll('.thumbnail.image-loading').length===0");
    assert.equal(await page('window.__liveImages.size'), 1);
    const selected = await page("document.querySelector('.thumbnail.active').dataset.image");
    await pause(150); await reload();
    await wait("document.querySelector('.thumbnail.active')?.dataset.image===" + JSON.stringify(selected));
    assert.equal(await page("document.querySelector('#batch-select').value"), '1');
    assert.equal((await disk()).images.filter(image => image.reviewed).length, 101);
    await capture('03-segundo-lote.png');
    passed('101 registros com 100 PNGs físicos: lotes 100+1, cache 100→1→100→1, seleção e progresso após reload');

    operation = 'Exportação e reabertura reais';
    const portable = JSON.parse(await exportFile('json', 'scenes-101.json'));
    assert.equal(portable.images.length, 101);
    assert.ok(portable.images.every(image => image.reviewed));
    const verifyZip = (bytes, images) => {
      const entries = zipEntries(bytes);
      assert.equal(entries.size, images.length * 2 + 2);
      assert.equal(entries.get('classes.txt').toString().trim(), labels.map(label => label.name).join('\n'));
      for (const [index, image] of images.entries()) {
        const basename = image.name.split('/').at(-1);
        const pngName = [...entries.keys()].find(name => name.startsWith('images/') && name.endsWith('/' + basename));
        assert.ok(pngName, basename);
        assert.equal(sha(entries.get(pngName)), manifest.images[index < 100 ? index : 0].sha256);
        const lines = entries.get(pngName.replace(/^images\//, 'labels/').replace(/\.png$/, '.txt')).toString().trim();
        const rows = lines ? lines.split('\n').map(line => line.split(' ').map(Number)) : [];
        assert.equal(rows.length, image.annotations.length);
        for (const [boxIndex, box] of image.annotations.entries()) {
          const expected = [labels.findIndex(label => label.id === box.labelId), (box.x + box.width / 2) / image.width,
            (box.y + box.height / 2) / image.height, box.width / image.width, box.height / image.height];
          assert.equal(rows[boxIndex].length, 5);
          expected.forEach((value, column) => assert.ok(Math.abs(rows[boxIndex][column] - value) < 1e-6));
        }
      }
    };
    const annotated = await disk();
    for (const [index, image] of portable.images.entries()) {
      assert.deepEqual(image.annotations, annotated.images[index].annotations);
      assert.equal(sha(Buffer.from(image.src.split(',')[1], 'base64')), manifest.images[index < 100 ? index : 0].sha256);
    }
    verifyZip(await exportFile('yolo', 'scenes-101-yolo.zip'), annotated.images);
    await open(portable);
    assert.equal((await disk()).images.reduce((sum, image) => sum + image.annotations.length, 0), 347);
    await change('#batch-select', '1');
    await wait("document.querySelector('.image-filename').textContent==='boundary-extra.png'");
    await click('[data-action=delete-image]');
    await wait("document.querySelector('#batch-select')?.options.length===1"); await saved();
    assert.equal((await disk()).images.length, 100);
    assert.equal(await page("document.querySelector('[data-action=undo]').disabled"), true);
    const final = JSON.parse(await exportFile('json', 'scenes-annotated.json'));
    assert.equal(final.images.length, 100);
    assert.equal(final.images.reduce((sum, image) => sum + image.annotations.length, 0), 346);
    verifyZip(await exportFile('yolo', 'scenes-yolo.zip'), final.images);
    assert.equal(await page("document.querySelector('#export-format option[value=tracknet]').disabled"), true);
    await capture('04-conjunto-concluido.png');
    for (const image of manifest.images) assert.equal(sha(fs.readFileSync(path.join(root, 'test-scenes', image.path))), image.sha256);
    passed('Downloads reais JSON/YOLO de todos os lotes: hashes, classes e coordenadas exatas; reabertura e exclusão da cópia extra');
    assert.deepEqual(errors, []);
    passed('Nenhum erro de console e nenhum PNG original alterado');
    operation = 'concluído'; report(true);
    clearTimeout(watchdog); win.destroy(); app.exit(0);
  } catch (error) {
    console.error('FALHA em ' + operation, error);
    report(false, error);
    try { await capture('failure.png'); } catch {}
    clearTimeout(watchdog); win.destroy(); app.exit(1);
  }
});
