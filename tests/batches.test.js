import test from 'node:test';
import assert from 'node:assert/strict';
import { batches, BatchCache } from '../src/batches.js';
import { createProject, MAX_IMAGES } from '../src/model.js';

test('501 imagens formam seis lotes e conclusão inclui imagens sem caixas', () => {
  const images = Array.from({ length: 501 }, (_, index) => ({ id: `${index}`, reviewed: index < 100 }));
  const groups = batches(images);
  assert.deepEqual(groups.map((group) => group.items.length), [100, 100, 100, 100, 100, 1]);
  assert.equal(groups[0].completed, 100);
  assert.equal(groups[1].completed, 0);
  assert.equal(groups[5].items[0].id, '500');
  assert.deepEqual(batches([]), []);
});

test('cache libera lote anterior e ignora leitura antiga na troca rápida A-B-A', async () => {
  const revoked = [];
  let serial = 0;
  let finishOld;
  const cache = new BatchCache(async (src) => src === 'old' ? new Promise((resolve) => { finishOld = resolve; }) : new Blob([src]), {
    createObjectURL: () => `blob:${++serial}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  const images = Array.from({ length: 100 }, (_, index) => ({ src: `${index}` }));
  await cache.load(images, () => {});
  assert.equal(cache.entries.size, 100);
  const stale = cache.load([{ src: 'old' }], () => assert.fail('Leitura antiga não deve atualizar a UI'));
  assert.equal(revoked.length, 100);
  await cache.load([{ src: 'new' }], () => {});
  finishOld(new Blob(['old']));
  await stale;
  assert.deepEqual([...cache.entries.keys()], ['new']);
  cache.clear();
  assert.equal(cache.entries.size, 0);
  assert.equal(revoked.length, 101);
  await assert.rejects(cache.load([...images, { src: 'extra' }], () => {}), /100/);
});

test('cache mantém erro por arquivo e reutiliza fonte duplicada sem vazar URLs', async () => {
  let created = 0;
  const cache = new BatchCache(async (src) => { if (src === 'bad') throw new Error('Arquivo indisponível'); return new Blob(['ok']); }, {
    createObjectURL: () => `blob:${++created}`, revokeObjectURL() {},
  });
  await cache.load([{ src: 'good' }, { src: 'good' }, { src: 'bad' }], () => {});
  assert.equal(created, 1);
  assert.equal(cache.entries.size, 2);
  assert.match(cache.entries.get('bad').error, /indisponível/);
});

test('modelo aceita 501 fontes locais sem incorporar bytes e mantém limites', () => {
  const images = Array.from({ length: 501 }, (_, index) => ({ id: `image-${index}`, name: `${index}.png`, src: `asset:00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, width: 640, height: 360, annotations: [], reviewed: index < 100 }));
  assert.equal(createProject(images, []).images.length, 501);
  assert.throws(() => createProject(Array(MAX_IMAGES + 1).fill(images[0]), []), /10000/);
  assert.throws(() => createProject([{ ...images[0], src: 'anoint-image://../../x' }], []), /Origem/);
});
