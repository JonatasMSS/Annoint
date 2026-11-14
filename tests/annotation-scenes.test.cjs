const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { inflateSync, crc32 } = require('node:zlib');
const { COUNT, SEED, CLASSES, planScene, writeDataset } = require('../scripts/create-annotation-scenes.cjs');

function decodePng(data) {
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const compressed = [];
  let width, height, offset = 8, ended = false;
  while (offset < data.length) {
    const size = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const payload = data.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc32(data.subarray(offset + 4, offset + 8 + size)), data.readUInt32BE(offset + 8 + size));
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0); height = payload.readUInt32BE(4);
      assert.deepEqual([...payload.subarray(8)], [8, 6, 0, 0, 0]);
    } else if (type === 'IDAT') compressed.push(payload);
    else if (type === 'IEND') { assert.equal(size, 0); ended = true; }
    else assert.fail(`Chunk inesperado: ${type}`);
    offset += 12 + size;
  }
  assert.ok(ended);
  const rows = inflateSync(Buffer.concat(compressed));
  assert.equal(rows.length, height * (width * 4 + 1));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    assert.equal(rows[start], 0);
    rows.copy(rgba, y * width * 4, start + 1, start + 1 + width * 4);
  }
  return { width, height, rgba };
}

test('100 PNGs reproduzíveis, gabarito exato, classes e casos de borda', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-scenes-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('anoint-scenes-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const first = path.join(temporary, 'first'), second = path.join(temporary, 'second');
  const manifest = writeDataset(first);
  assert.deepEqual(writeDataset(second), manifest);
  assert.equal(manifest.seed, SEED);
  assert.equal(manifest.imageCount, COUNT);
  assert.equal(manifest.images.length, 100);
  assert.equal(manifest.summary.emptyImages, 5);
  assert.equal(fs.readdirSync(path.join(first, 'images')).length, 100);
  assert.deepEqual(fs.readFileSync(path.join(first, 'manifest.json')), fs.readFileSync(path.join(second, 'manifest.json')));
  const contract = JSON.parse(fs.readFileSync(path.join(first, 'class-contract.json'), 'utf8'));
  assert.deepEqual(Object.keys(contract), ['labels', 'coordinates', 'objectPolicy']);
  assert.deepEqual(contract.labels, manifest.labels);
  assert.deepEqual(fs.readFileSync(path.join(first, 'class-contract.json')), fs.readFileSync(path.join(second, 'class-contract.json')));
  const dimensions = new Set(), labels = new Set(), colors = new Map(), annotationIds = new Set();
  const variations = new Map(CLASSES.map((label) => [label.id, { positions: new Set(), sizes: new Set(), backgrounds: new Set() }]));
  const counts = Object.fromEntries(CLASSES.map((label) => [label.id, 0]));
  const borders = new Set();
  for (const [index, image] of manifest.images.entries()) {
    const data = fs.readFileSync(path.join(first, image.path));
    assert.deepEqual(data, fs.readFileSync(path.join(second, image.path)));
    assert.equal(data.length, image.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), image.sha256);
    const decoded = decodePng(data);
    const background = image.background.slice(1).match(/../g).map((value) => parseInt(value, 16));
    assert.equal(decoded.width, image.width); assert.equal(decoded.height, image.height);
    dimensions.add(Math.sign(image.width - image.height));
    const owners = new Int16Array(image.width * image.height).fill(-1);
    const observed = image.annotations.map(() => ({ left: Infinity, top: Infinity, right: -1, bottom: -1 }));
    for (const [boxIndex, box] of image.annotations.entries()) {
      assert.ok(!annotationIds.has(box.id)); annotationIds.add(box.id);
      labels.add(box.labelId);
      counts[box.labelId]++;
      const variation = variations.get(box.labelId);
      variation.positions.add(`${box.x},${box.y}`); variation.sizes.add(`${box.width},${box.height}`);
      variation.backgrounds.add(image.background);
      assert.ok([box.x, box.y, box.width, box.height].every(Number.isInteger));
      assert.ok(box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
        && box.x + box.width <= image.width && box.y + box.height <= image.height);
      if (box.x === 0) borders.add('left');
      if (box.y === 0) borders.add('top');
      if (box.x + box.width === image.width) borders.add('right');
      if (box.y + box.height === image.height) borders.add('bottom');
      if (box.labelId === 'square' || box.labelId === 'circle') assert.equal(box.width, box.height);
      for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
        assert.equal(owners[y * image.width + x], -1, 'Caixas sobrepostas');
        owners[y * image.width + x] = boxIndex;
      }
    }
    for (let pixel = 0; pixel < owners.length; pixel++) {
      const offset = pixel * 4;
      assert.equal(decoded.rgba[offset + 3], 255);
      if (background.every((channel, i) => decoded.rgba[offset + i] === channel)) continue;
      const owner = owners[pixel];
      assert.ok(owner >= 0, `${image.path}: pixel pintado fora das caixas`);
      const bounds = observed[owner], x = pixel % image.width, y = Math.floor(pixel / image.width);
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
    }
    for (const [i, bounds] of observed.entries()) {
      const box = image.annotations[i];
      assert.deepEqual([box.x, box.y, box.width, box.height],
        [bounds.left, bounds.top, bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1]);
    }
    for (const object of planScene(index).objects) {
      if (!colors.has(object.labelId)) colors.set(object.labelId, new Set());
      colors.get(object.labelId).add(object.color);
    }
  }
  assert.deepEqual(labels, new Set(CLASSES.map((label) => label.id)));
  assert.equal(annotationIds.size, manifest.summary.objects);
  assert.deepEqual(counts, manifest.summary.counts);
  assert.deepEqual(borders, new Set(['left', 'right', 'top', 'bottom']));
  assert.deepEqual(dimensions, new Set([1, -1, 0]));
  for (const label of CLASSES) assert.ok(colors.get(label.id).size > 1, 'Cor não deve identificar a classe');
  for (const variation of variations.values()) {
    assert.ok(variation.positions.size > 1 && variation.sizes.size > 1 && variation.backgrounds.size > 1);
  }
  const { validateProject } = await import('../src/model.js');
  const project = validateProject({ version: 1, labels: manifest.labels, images: manifest.images.map((image) => ({
    id: image.id, name: image.path, width: image.width, height: image.height,
    src: `data:image/png;base64,${fs.readFileSync(path.join(first, image.path)).toString('base64')}`,
    reviewed: false, annotations: image.annotations,
  })) });
  await t.test('101 registros isolados cruzam a fronteira e trocam o cache sem criar outro PNG', async () => {
    const { batches, BatchCache } = await import('../src/batches.js');
    const duplicate = { ...project.images[0], id: 'boundary-copy', name: 'isolated-copy.png',
      annotations: project.images[0].annotations.map((box) => ({ ...box, id: `${box.id}-copy` })) };
    const isolated = validateProject({ ...project, images: [
      ...project.images.map((image) => ({ ...image, reviewed: true })), duplicate,
    ] });
    const groups = batches(isolated.images);
    assert.deepEqual(groups.map((group) => group.items.length), [100, 1]);
    assert.deepEqual(groups.map((group) => group.completed), [100, 0]);
    assert.equal(groups[1].items[0].id, 'boundary-copy');
    assert.equal(groups[1].items[0].src, groups[0].items[0].src);
    assert.notEqual(groups[1].items[0].annotations[0].id, groups[0].items[0].annotations[0].id);
    let serial = 0;
    const revoked = [];
    const cache = new BatchCache(async (src) => new Blob([Buffer.from(src.split(',')[1], 'base64')]), {
      createObjectURL: () => `blob:test-${++serial}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    const snapshot = JSON.stringify(isolated);
    await cache.load(groups[0].items, () => {});
    const firstSize = cache.entries.size;
    assert.ok(firstSize <= 100 && firstSize > 0);
    await cache.load(groups[1].items, () => {});
    assert.equal(cache.entries.size, 1); assert.equal(revoked.length, firstSize);
    await cache.load(groups[0].items, () => {});
    assert.equal(cache.entries.size, firstSize); assert.equal(revoked.length, firstSize + 1);
    assert.equal(JSON.stringify(isolated), snapshot);
    cache.clear();
    assert.equal(cache.entries.size, 0);
    assert.equal(fs.readdirSync(path.join(first, 'images')).length, 100);
  });
  fs.writeFileSync(path.join(first, 'images', 'extra.png'), 'preservar');
  assert.throws(() => writeDataset(first), /arquivos extras/);
  assert.equal(fs.readFileSync(path.join(first, 'images', 'extra.png'), 'utf8'), 'preservar');
});
