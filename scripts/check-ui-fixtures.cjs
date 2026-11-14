const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkFixtures({ win, page, waitFor, mouse, key, bounds, saved, exportedZip, pause, testDirectory }) {
  const fixtureRoot = path.join(__dirname, '..', 'test-images');
  const output = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(output, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  const results = [];
  const passed = (name) => { results.push(name); console.log(`OK: ${name}`); };
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push({ relative: path.relative(fixtureRoot, file).replaceAll('\\', '/'), file });
    }
  }
  walk(fixtureRoot);
  const valid = files.filter((item) => item.relative.startsWith('valid/') && types[path.extname(item.file).slice(1).toLowerCase()]);
  assert.equal(valid.length, 10);
  const payload = (item) => ({ name: `test-images/${item.relative}`, type: types[path.extname(item.file).slice(1).toLowerCase()] || '', bytes: fs.readFileSync(item.file).toString('base64') });
  const openValue = async (value) => {
    await page(`{ document.querySelectorAll('dialog[open]').forEach(d=>d.close()); window.confirm=()=>true; const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'qa.json',{type:'application/json'})); const input=document.querySelector('#project-input'); input.files=transfer.files; document.querySelector('#toast').textContent=''; input.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await waitFor("document.querySelector('#toast').textContent.includes('Projeto aberto')");
  };
  const upload = (id, list) => page(`{ const transfer=new DataTransfer(); for(const [index,item] of ${JSON.stringify(list)}.entries()){const bytes=Uint8Array.from(atob(item.bytes),c=>c.charCodeAt(0)); const file=new File([bytes],item.name.split('/').at(-1),{type:index%2?item.type:''}); Object.defineProperty(file,'webkitRelativePath',{value:item.name}); transfer.items.add(file);} const input=document.querySelector(${JSON.stringify(id)}); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }`);
  const disk = () => page("import('./src/storage.js').then(m=>m.loadProject())");
  const geometry = () => page("Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(document.querySelector('#box-'+k).value)]))");
  const exactGeometry = (box) => page(`{ const box=${JSON.stringify(box)}; for(const key of ['width','height','x','y']){const input=document.querySelector('#box-'+key);input.value=box[key];input.dispatchEvent(new Event('change',{bubbles:true}));} }`);
  const select = async (id) => { await page(`document.querySelector('[data-image="${id}"]').click()`); await pause(100); };
  const drag = async (start, end) => {
    mouse('mouseDown', start.x, start.y); await pause(30);
    mouse('mouseMove', end.x, end.y); await pause(30);
    mouse('mouseUp', end.x, end.y); await pause(100);
  };
  const draw = async (box, width, height, reverseX = false, reverseY = false) => {
    await page("document.querySelector('[data-tool=box]').click()");
    await pause(100);
    const rect = await bounds('.image-surface');
    const start = { x: rect.x + (box.x + (reverseX ? box.width : 0)) / width * rect.width, y: rect.y + (box.y + (reverseY ? box.height : 0)) / height * rect.height };
    const end = { x: rect.x + (box.x + (reverseX ? 0 : box.width)) / width * rect.width, y: rect.y + (box.y + (reverseY ? 0 : box.height)) / height * rect.height };
    await win.webContents.capturePage();
    await drag(start, end);
    const actual = await geometry();
    const tolerance = 2 / (rect.width / width) + .02;
    for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[field] - box[field]) <= tolerance, `${field}: ${actual[field]} ≠ ${box[field]}`);
  };
  const capture = async (name) => fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
  const exportAs = async (format) => {
    await page(`document.querySelector('[data-action=export]').click(); document.querySelector('#export-format').value=${JSON.stringify(format)};document.querySelector('#export-format').dispatchEvent(new Event('change',{bubbles:true}));if(${JSON.stringify(format)}==='tracknet')document.querySelector('#export-class').value='red';document.querySelector('#export-form').requestSubmit()`);
    await waitFor("!document.querySelector('#export-dialog').open");
  };

  const landscapeFile = valid.find((item) => item.relative === 'valid/01-paisagem.png');
  const first = payload(landscapeFile);
  const labels = [{ id: 'red', name: 'Vermelho', color: '#ef4444' }, { id: 'blue', name: 'Azul', color: '#2563eb' }];
  await openValue({ version: 1, labels, images: [{ id: 'qa-landscape', name: first.name, src: `data:${first.type};base64,${first.bytes}`, width: 640, height: 360, reviewed: false, annotations: [] }] });
  const invalid = files.filter((item) => item.relative.startsWith('invalid/'));
  await upload('#folder-input', [...valid.filter((item) => item !== landscapeFile), ...invalid].map(payload));
  await waitFor("document.querySelectorAll('.thumbnail').length === 10");
  await saved();
  const imported = await disk();
  assert.equal(imported.images.length, 10);
  assert.equal(new Set(imported.images.map((image) => image.id)).size, 10);
  assert.equal(imported.images.filter((image) => image.name.endsWith('/frame10.png')).length, 2);
  passed('Pasta real de fixtures: formatos, subpastas, nomes repetidos, Unicode, MIME ausente e arquivos inválidos');

  // As posições esperadas vêm do gerador, não das funções de geometria da aplicação.
  const scenes = manifest.files.filter((file) => file.kind === 'valid').map((file) => ({ ...file, ...file.decoded }));
  assert.ok(Array.isArray(scenes), 'O manifesto deve conter as imagens válidas e suas caixas esperadas.');
  for (const scene of scenes) {
    console.log(`Imagem: ${scene.path}`);
    const image = imported.images.find((item) => item.name === `test-images/${scene.path}`);
    assert.ok(image, scene.path);
    assert.deepEqual([image.width, image.height], [scene.width, scene.height]);
    await select(image.id);
    if (scene.width < 16) {
      await page("for(let i=0;i<12;i++)document.querySelector('[data-action=zoom-in]').click()");
      await pause(60);
    }
    for (const box of scene.boxes) {
      await page(`document.querySelector('[data-label="${box.labelId}"]').click()`);
      await draw(box, image.width, image.height);
      await exactGeometry(box);
      assert.deepEqual(await geometry(), { x: box.x, y: box.y, width: box.width, height: box.height });
      assert.equal(await page("document.querySelector('#box-class').value"), box.labelId);
    }
    assert.equal(await page("document.querySelectorAll('.annotation').length"), scene.boxes.length);
    await page("document.querySelector('[data-action=complete]').click()");
  }
  await saved();
  assert.equal(await page("document.querySelector('.progress-track').getAttribute('aria-valuenow')"), '100');
  passed('Todas as imagens: dimensões, caixas conhecidas, classes corretas, transparência, imagem pequena e conclusão sem objetos');

  await select('qa-landscape');
  key('B'); await pause(40);
  assert.equal(await page("document.querySelector('[data-tool=box]').getAttribute('aria-pressed')"), 'true');
  key('V'); await pause(40);
  assert.equal(await page("document.querySelector('[data-tool=select]').getAttribute('aria-pressed')"), 'true');
  key('ArrowRight'); await pause(70);
  assert.match(await page("document.querySelector('.image-filename').textContent"), /02-retrato.jpg$/);
  key('ArrowLeft'); await pause(70);
  assert.match(await page("document.querySelector('.image-filename').textContent"), /01-paisagem.png$/);
  key('C'); await pause(40);
  assert.equal(await page("document.querySelector('.complete-button').getAttribute('aria-pressed')"), 'false');
  key('C'); await pause(40);
  const fittedWidth = (await bounds('.image-surface')).width;
  await page("document.querySelector('[data-action=zoom-out]').click()");
  assert.ok(Math.abs((await bounds('.image-surface')).width / fittedWidth - .8) < .01);
  await page("document.querySelector('[data-action=fit]').click()");
  passed('Atalhos B/V/C, navegação por setas, diminuir zoom e ajustar à área');
  for (const clicks of [0, 8]) {
    await page(`{ document.querySelector('[data-action=fit]').click(); for(let i=0;i<${clicks};i++)document.querySelector('[data-action=zoom-in]').click(); const stage=document.querySelector('#stage');stage.scrollTo((stage.scrollWidth-stage.clientWidth)/2,(stage.scrollHeight-stage.clientHeight)/2); }`);
    await pause(70);
    for (const [reverseX, reverseY] of [[false, false], [true, false], [false, true], [true, true]]) {
      await draw({ x: 640 * .47, y: 360 * .47, width: 640 * .06, height: 360 * .06 }, 640, 360, reverseX, reverseY);
      assert.equal(await page("document.querySelectorAll('.annotation').length"), 3);
      await page("document.querySelector('[data-action=undo]').click()");
      assert.equal(await page("document.querySelectorAll('.annotation').length"), 2);
    }
  }
  passed('Desenho nas quatro direções, com zoom alto e rolagem, mantém pixels originais');

  await page("document.querySelector('[data-action=fit]').click(); document.querySelector('.annotation-row').click()");
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const before = await geometry();
    const rect = await bounds(`[data-handle=${handle}]`);
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await drag(start, { x: start.x + (handle.includes('w') ? -12 : handle.includes('e') ? 12 : 0), y: start.y + (handle.includes('n') ? -12 : handle.includes('s') ? 12 : 0) });
    const after = await geometry();
    assert.ok(after.width > 0 && after.height > 0 && after.x >= 0 && after.y >= 0);
    assert.ok(after.x + after.width <= 640.02 && after.y + after.height <= 360.02);
    if (handle.includes('w')) { assert.ok(after.x < before.x); assert.ok(Math.abs(after.x + after.width - before.x - before.width) < .03); }
    if (handle.includes('e')) { assert.ok(after.width > before.width); assert.ok(Math.abs(after.x - before.x) < .02); }
    if (handle.includes('n')) { assert.ok(after.y < before.y); assert.ok(Math.abs(after.y + after.height - before.y - before.height) < .03); }
    if (handle.includes('s')) { assert.ok(after.height > before.height); assert.ok(Math.abs(after.y - before.y) < .02); }
    await page("document.querySelector('[data-action=undo]').click()");
  }
  passed('As oito alças redimensionam a borda certa e preservam a borda oposta');

  const body = await bounds('.annotation.is-selected .box');
  const imageBounds = await bounds('.image-surface');
  await drag({ x: body.x + body.width / 2, y: body.y + body.height / 2 }, { x: imageBounds.right + 30, y: imageBounds.bottom + 30 });
  const moved = await geometry();
  assert.ok(Math.abs(moved.x + moved.width - 640) < .03 && Math.abs(moved.y + moved.height - 360) < .03);
  await page("document.querySelector('[data-action=undo]').click()");
  const beforeInvalid = await geometry();
  for (const [field, value] of [['x', '-1'], ['y', '99999'], ['width', '0'], ['height', '']]) {
    await page(`{const input=document.querySelector('#box-${field}'); input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.deepEqual(await geometry(), beforeInvalid);
  }
  passed('Mover até fora da imagem respeita limites; medidas inválidas preservam a caixa');

  await page("document.querySelector('#box-class').value='blue';document.querySelector('#box-class').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await page("document.querySelector('.annotation-row.selected .class-name').textContent"), 'Azul');
  await page("document.querySelector('[data-action=undo]').click()");
  const selected = await page("document.querySelector('.annotation.is-selected').dataset.annotation");
  await select(imported.images.find((image) => image.id !== 'qa-landscape').id);
  await select('qa-landscape');
  assert.equal(await page("document.querySelector('.annotation.is-selected').dataset.annotation"), selected);
  key('Delete'); await pause(60);
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 1);
  key('z', ['control']); await pause(60);
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 2);
  key('y', ['control']); await pause(60);
  assert.equal(await page("document.querySelectorAll('.annotation').length"), 1);
  key('z', ['control']); await pause(60);
  passed('Troca de classe, seleção por imagem e atalhos Delete/desfazer/refazer');

  await page("document.querySelector('[data-action=new-class]').click();document.querySelector('#class-name').value='vermelho';document.querySelector('#class-form').requestSubmit()");
  assert.equal(await page("document.querySelector('#class-dialog').open"), true);
  assert.match(await page("document.querySelector('#class-error').textContent"), /Já existe/);
  key('Escape'); await pause(50);
  assert.equal(await page("document.querySelector('#class-dialog').open"), false);
  for (const action of ['help', 'shortcuts']) {
    await page(`document.querySelector('[data-action=${action}]').click()`);
    assert.equal(await page('document.querySelectorAll("dialog[open]").length'), 1);
    key('Escape'); await pause(50);
    assert.equal(await page('document.querySelectorAll("dialog[open]").length'), 0);
  }
  await page("if(document.querySelector('.complete-button').getAttribute('aria-pressed')!=='true')document.querySelector('[data-action=complete]').click(); document.querySelector('#image-filter').value='done';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 10);
  await page("document.querySelector('#image-filter').value='pending';document.querySelector('#image-filter').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 0);
  key('ArrowRight'); await pause(40);
  await page("document.querySelector('[data-action=show-all]').click()");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 10);
  passed('Classes duplicadas, fechamento de ajuda/atalhos, filtros vazios e progresso');

  await saved();
  const finalProject = await disk();
  await page(`{ const bytes=Uint8Array.from(atob(${JSON.stringify(first.bytes)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'solto.png',{type:'image/png'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})); }`);
  await waitFor("document.querySelectorAll('.thumbnail').length === 11");
  await saved();
  assert.equal((await disk()).images.at(-1).name, 'solto.png');
  await page("document.querySelector('[data-action=undo]').click()");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 10);
  passed('Soltar arquivo na interface adiciona a imagem e permite desfazer o lote');
  await exportAs('json');
  assert.deepEqual(JSON.parse(await page('window.__exported.text()')), finalProject);
  await exportAs('tracknet');
  const tracked = await exportedZip();
  assert.ok([...tracked.keys()].some((name) => name.endsWith('Label.csv')));
  await exportAs('yolo');
  const yolo = await exportedZip();
  assert.equal([...yolo.keys()].filter((name) => name.startsWith('labels/')).length, 10);
  const labelFile = [...yolo.keys()].find((name) => name.startsWith('labels/') && name.endsWith('/01-paisagem.txt'));
  const expectedRows = ['0 0.15 0.17777777777777778 0.2 0.2222222222222222', '1 0.796875 0.75 0.28125 0.2777777777777778'];
  assert.deepEqual(yolo.get(labelFile).toString().trim().split('\n'), expectedRows);
  assert.deepEqual(yolo.get(labelFile.replace(/^labels\//, 'images/').replace(/\.txt$/, '.png')), fs.readFileSync(landscapeFile.file));
  const csvPath = [...tracked.keys()].find((name) => name.endsWith('/valid/Label.csv'));
  assert.match(tracked.get(csvPath).toString(), /01-paisagem.png,1,96,64,0/);
  passed('JSON preserva o projeto; YOLO contém caixas exatas e bytes originais; TrackNet exporta os centros corretos');

  const template = { ...finalProject.images[0], annotations: [], reviewed: false };
  const nearLimit = { version: 1, labels, images: Array.from({ length: 99 }, (_, index) => ({ ...template, id: `capacity-${index}`, name: `capacity-${index}.png` })) };
  await openValue(nearLimit);
  await upload('#folder-input', [{ name: 'mix/1-corrompida.png', type: 'image/png', bytes: '' }, { ...first, name: 'mix/2-valida.png' }]);
  await waitFor("document.querySelectorAll('.thumbnail').length === 100");
  await saved();
  assert.equal((await disk()).images.at(-1).name, 'mix/2-valida.png');
  await upload('#image-input', [{ ...first, name: 'sem-espaco.png' }]);
  await waitFor("document.querySelector('#toast').textContent.includes('até 100 imagens')");
  assert.equal(await page("document.querySelectorAll('.thumbnail').length"), 100);
  passed('No limite de 100 imagens, o lote misto mantém a válida e rejeita a corrompida e o excesso');

  const tiny = { ...template, id: 'subpixel', annotations: [{ id: 'tiny-box', labelId: 'red', x: 0, y: 0, width: .5, height: .5 }] };
  await openValue({ version: 1, labels, images: [tiny] });
  await page("document.querySelector('.annotation-row').click();const input=document.querySelector('#box-width');input.value='.75';input.dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal((await geometry()).width, .75);
  await saved();
  assert.equal((await disk()).images[0].annotations[0].width, .75);
  passed('O inspetor edita e salva medidas subpixel sem arredondamento destrutivo');

  const longProject = {
    version: 1,
    labels: [...labels, ...Array.from({ length: 70 }, (_, index) => ({ id: `label-${index}`, name: `Classe ${index}`, color: '#558899' }))],
    images: [{ ...template, id: 'long-list', annotations: Array.from({ length: 80 }, (_, index) => ({ id: `box-${index}`, labelId: 'red', x: 32, y: 24, width: 128, height: 80 })) }],
  };
  await openValue(longProject);
  await page("document.querySelector('.sidebar').scrollTop=99999;document.querySelector('.annotation-list').scrollTop=99999");
  const beforeScroll = await page("({sidebar:document.querySelector('.sidebar').scrollTop,list:document.querySelector('.annotation-list').scrollTop})");
  await page("document.querySelectorAll('.annotation-row')[79].click()");
  const afterScroll = await page("({sidebar:document.querySelector('.sidebar').scrollTop,list:document.querySelector('.annotation-list').scrollTop})");
  assert.ok(beforeScroll.sidebar > 0 && beforeScroll.list > 0);
  assert.deepEqual(afterScroll, beforeScroll);
  passed('Listas longas de classes e caixas preservam a posição ao selecionar');

  const baseBox = { labelId: 'red', x: 0, y: 0, width: 4, height: 4 };
  const annotations = (prefix) => Array.from({ length: 10000 }, (_, index) => ({ ...baseBox, id: `${prefix}-${index}` }));
  for (const total of [false, true]) {
    const value = { version: 1, labels, images: total
      ? [{ ...template, id: 'limit-target' }, ...Array.from({ length: 10 }, (_, index) => ({ ...template, id: `limit-image-${index}`, annotations: annotations(`total-${index}`) }))]
      : [{ ...template, id: 'limit-target', annotations: annotations('per-image') }] };
    await openValue(value);
    await page("document.querySelector('[data-tool=box]').click()");
    await pause(80);
    const rect = await bounds('.image-surface');
    await drag({ x: rect.x + rect.width * .45, y: rect.y + rect.height * .4 }, { x: rect.x + rect.width * .6, y: rect.y + rect.height * .65 });
    await waitFor("document.querySelector('#toast').textContent.includes('Limite de anotações')");
    await saved();
    const stored = await disk();
    assert.equal(stored.images.reduce((count, image) => count + image.annotations.length, 0), total ? 100000 : 10000);
  }
  passed('Limites de 10.000 caixas por imagem e 100.000 por projeto bloqueiam a criação antes de invalidar o estado');

  await openValue(finalProject);
  await saved();
  const { BrowserWindow } = require('electron');
  const secondWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await secondWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    let blocked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      blocked = await secondWindow.webContents.executeJavaScript("document.body.textContent.includes('outra aba')");
      if (blocked) break;
      await pause(50);
    }
    assert.equal(blocked, true);
    assert.equal(await secondWindow.webContents.executeJavaScript("document.querySelectorAll('.annotation-layer').length"), 0);
    assert.deepEqual(await disk(), finalProject);
  } finally { secondWindow.destroy(); }
  passed('Um segundo renderer com o mesmo banco fica bloqueado e não pode sobrescrever o projeto');

  await select('qa-landscape');
  await page("document.querySelector('.annotation-row').click();document.querySelector('#toast').hidden=true");
  win.setContentSize(1440, 900);
  await pause(150);
  await capture('interface-desktop.png');
  win.setContentSize(1000, 720);
  await pause(100);
  assert.ok(await page('document.documentElement.scrollWidth <= innerWidth'));
  await capture('interface-1000x720.png');
  win.setContentSize(1440, 900);
  await pause(80);
  passed('Layout desktop e janela mínima sem overflow horizontal');

  const downloadPath = path.join(testDirectory, 'anoint-export-real.json');
  const finished = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event, item) => {
    item.setSavePath(downloadPath);
    item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(`Download: ${state}`)));
  }));
  await page('HTMLAnchorElement.prototype.click=window.__nativeAnchorClick; void 0');
  await exportAs('json');
  await Promise.race([finished, pause(5000).then(() => { throw new Error('O download real não terminou.'); })]);
  assert.deepEqual(JSON.parse(fs.readFileSync(downloadPath, 'utf8')), finalProject);
  fs.copyFileSync(downloadPath, path.join(output, 'annotated-project.json'));
  passed('Download real grava um JSON íntegro no disco');
  fs.writeFileSync(path.join(output, 'ui-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), platform: process.platform, fixtures: valid.length, passed: results }, null, 2));
};
