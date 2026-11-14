import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { exportDataset } from '../src/export.js';

const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==';
const labels = [
  { id: 'ball', name: 'Bola', color: '#f08' },
  { id: 'person', name: 'Pessoa: "A"', color: '#abc' },
];
const box = { id: 'box', labelId: 'ball', x: 10, y: 20, width: 30, height: 40 };
const image = (id, name, annotations = [], extra = {}) => ({
  id, name, src: source, width: 200, height: 100, reviewed: false, annotations, ...extra,
});
const project = images => ({ version: 1, labels: structuredClone(labels), images });
const originalBytes = src => Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');

// Leitura independente: diretório central, cabeçalhos locais, offsets, UTF-8, tamanhos e CRC.
async function unzip(blob) {
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/zip');
  const data = Buffer.from(await blob.arrayBuffer());
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  assert.equal(data.readUInt16LE(end + 4), 0);
  assert.equal(data.readUInt16LE(end + 6), 0);
  const count = data.readUInt16LE(end + 10);
  assert.equal(data.readUInt16LE(end + 8), count);
  assert.equal(data.readUInt16LE(end + 20), 0);
  const start = data.readUInt32LE(end + 16);
  assert.equal(start + data.readUInt32LE(end + 12), end);
  const files = new Map();
  let cursor = start;
  let nextLocal = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50);
    assert.equal(data.readUInt16LE(cursor + 8), 0x800);
    assert.equal(data.readUInt16LE(cursor + 10), 0);
    const size = data.readUInt32LE(cursor + 24);
    assert.equal(data.readUInt32LE(cursor + 20), size);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extra = data.readUInt16LE(cursor + 30);
    const comment = data.readUInt16LE(cursor + 32);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = name.toString('utf8');
    const offset = data.readUInt32LE(cursor + 42);
    assert.equal(offset, nextLocal);
    assert.equal(data.readUInt32LE(offset), 0x04034b50);
    assert.equal(data.readUInt16LE(offset + 6), 0x800);
    assert.equal(data.readUInt16LE(offset + 8), 0);
    assert.equal(data.readUInt16LE(offset + 26), nameLength);
    assert.deepEqual(data.subarray(offset + 30, offset + 30 + nameLength), name);
    const bodyOffset = offset + 30 + nameLength + data.readUInt16LE(offset + 28);
    const body = data.subarray(bodyOffset, bodyOffset + size);
    assert.equal(body.length, size);
    assert.equal(crc32(body), data.readUInt32LE(cursor + 16), path);
    assert.equal(data.readUInt32LE(offset + 14), data.readUInt32LE(cursor + 16));
    assert.equal(data.readUInt32LE(offset + 18), size);
    assert.equal(data.readUInt32LE(offset + 22), size);
    assert.equal(files.has(path), false, path);
    files.set(path, body);
    nextLocal = bodyOffset + size;
    cursor += 46 + nameLength + extra + comment;
  }
  assert.equal(nextLocal, start);
  assert.equal(cursor, end);
  return files;
}

const text = (files, path) => {
  assert.ok(files.has(path), path);
  return files.get(path).toString('utf8');
};

function safePaths(files) {
  const names = [...files.keys()].map(name => name.normalize('NFC').toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.doesNotMatch(name, /^(\/|[a-z]:)|[\\\x00-\x1f<>:"|?*]/);
    const parts = name.split('/');
    assert.ok(parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)));
    for (let i = 1; i < parts.length; i++) assert.ok(!names.includes(parts.slice(0, i).join('/')), name);
  }
}

test('YOLO: classes base zero, caixas normalizadas, pares com mesmo stem e imagens sem anotações', async () => {
  const p = project([
    image('10', 'frames/frame10.png'),
    image('2', 'frames/frame2.png', [box, { ...box, id: 'person-box', labelId: 'person', x: 0, y: 0, width: 200, height: 100 }]),
  ]);
  const before = structuredClone(p);
  const files = await unzip(await exportDataset(p, 'yolo'));
  assert.deepEqual([...files.keys()], [
    'images/frames/frame2.png', 'labels/frames/frame2.txt',
    'images/frames/frame10.png', 'labels/frames/frame10.txt', 'classes.txt', 'data.yaml',
  ]);
  assert.equal(text(files, 'labels/frames/frame2.txt'), '0 0.125 0.4 0.15 0.4\n1 0.5 0.5 1 1\n');
  assert.equal(text(files, 'labels/frames/frame10.txt'), '');
  assert.equal(text(files, 'classes.txt'), 'Bola\nPessoa: "A"\n');
  const yaml = text(files, 'data.yaml');
  assert.match(yaml, /^path: \.\ntrain: images\nval: images\nnc: 2\n/);
  assert.deepEqual(JSON.parse(yaml.split('names: ')[1]), labels.map(label => label.name));
  for (const path of ['images/frames/frame2.png', 'images/frames/frame10.png']) assert.deepEqual(files.get(path), originalBytes(source));
  assert.deepEqual(p, before);
  safePaths(files);
});

test('YOLO preserva precisão de caixas fracionárias nas bordas', async () => {
  const p = project([image('1', 'edge.png', [{ ...box, x: 199.5, y: 99.5, width: 0.5, height: 0.5 }])]);
  const files = await unzip(await exportDataset(p, 'yolo'));
  assert.deepEqual(text(files, 'labels/edge.txt').trim().split(' ').map(Number), [0, 199.75 / 200, 99.75 / 100, 0.5 / 200, 0.5 / 100]);
});

test('TrackNet: uma tabela por sequência, ordem natural, centro original em pixels e ausentes zerados', async () => {
  const p = project([
    image('10', 'game/clip2/frame10.png'),
    image('2', 'game\\clip2\\frame2.png', [
      { ...box, x: 10.25, width: 31, height: 41 },
      { ...box, id: 'other1', labelId: 'person' }, { ...box, id: 'other2', labelId: 'person' },
    ]),
    image('1', 'game/clip1/frame1.png', [{ ...box, id: 'person', labelId: 'person' }]),
    image('solo', 'solo.png', [{ ...box, id: 'solo-box' }]),
  ]);
  const files = await unzip(await exportDataset(p, 'tracknet', { labelId: 'ball' }));
  assert.equal(text(files, 'game/clip2/Label.csv'), 'filename,visibility,x,y,status\nframe2.png,1,25.75,40.5,0\nframe10.png,0,0,0,0\n');
  assert.equal(text(files, 'game/clip1/Label.csv'), 'filename,visibility,x,y,status\nframe1.png,0,0,0,0\n');
  assert.equal(text(files, 'Label.csv'), 'filename,visibility,x,y,status\nsolo.png,1,25,40,0\n');
  assert.equal(files.size, 7);
  for (const [path, bytes] of files) if (!path.endsWith('.csv')) assert.deepEqual(bytes, originalBytes(source));
  safePaths(files);
});

test('TrackNet exige classe explícita existente e rejeita múltiplos objetos da classe escolhida', async () => {
  const p = project([image('1', 'frame.png', [box, { ...box, id: 'second' }])]);
  for (const options of [{}, { labelId: '' }, { labelId: 0 }, { labelId: 'missing' }]) {
    await assert.rejects(exportDataset(p, 'tracknet', options), /options.labelId/);
  }
  await assert.rejects(exportDataset(p, 'tracknet', { labelId: 'ball' }), /apenas um objeto.*frame.png/);
  const files = await unzip(await exportDataset(p, 'tracknet', { labelId: 'person' }));
  assert.equal(text(files, 'Label.csv'), 'filename,visibility,x,y,status\nframe.png,0,0,0,0\n');
});

test('ambos os formatos preservam todas as imagens e resolvem colisões de stems, caixa, Unicode e sanitização', async () => {
  const names = [
    'Frame.png', 'frame.jpg', 'FRAME.PNG', 'frame__2.png', 'frame.png', 'frame.png',
    'á.png', 'a\u0301.png', 'CON.png', 'unsafe:name.png', 'unsafe?name.png',
    'seq/frame.png', 'Seq/frame.png', 'seq?/frame.png', 'seq*/frame.png', 'has space /NUL.png',
  ];
  const p = project(names.map((name, i) => image('i' + i, name, [], {
    src: 'data:image/' + (name.endsWith('.jpg') ? 'jpeg' : 'png') + ';base64,' + Buffer.from([i, 1, 2, 254, 255]).toString('base64'),
  })));
  for (const format of ['yolo', 'tracknet']) {
    const files = await unzip(await exportDataset(p, format, { labelId: 'ball' }));
    safePaths(files);
    const images = [...files].filter(([path]) => /\.(png|jpg)$/i.test(path));
    assert.equal(images.length, names.length);
    assert.deepEqual(images.map(([, bytes]) => bytes.toString('hex')).sort(), p.images.map(item => originalBytes(item.src).toString('hex')).sort());
    if (format === 'yolo') {
      for (const [path] of images) assert.equal(text(files, path.replace(/^images\//, 'labels/').replace(/\.[^.]+$/, '.txt')), '');
    } else {
      let rows = 0;
      for (const [path, bytes] of files) {
        if (!path.endsWith('/Label.csv') && path !== 'Label.csv') continue;
        const parent = path.slice(0, -'Label.csv'.length);
        for (const row of bytes.toString().trim().split('\n').slice(1)) {
          const filename = row.slice(0, row.indexOf(','));
          assert.ok(files.has(parent + filename));
          rows++;
        }
      }
      assert.equal(rows, names.length);
    }
  }
});

test('nomes de arquivos e pastas não colidem nem no espelho labels/ nem com Label.csv', async () => {
  for (const names of [
    ['a.png', 'a.txt/z.png'],
    ['a.txt/z.png', 'a.webp'],
    ['a.png', 'a.png/z.png'],
    ['Label.csv/z.png', 'root.png'],
  ]) {
    const p = project(names.map((name, i) => image('i' + i, name)));
    for (const format of ['yolo', 'tracknet']) {
      const files = await unzip(await exportDataset(p, format, { labelId: 'ball' }));
      safePaths(files);
      assert.equal([...files.keys()].filter(path => /\.(png|webp)$/.test(path)).length, names.length);
    }
  }
});

test('TrackNet escapa vírgulas no CSV e aponta para o nome exportado', async () => {
  const files = await unzip(await exportDataset(project([image('1', 'seq/frame,2.png', [box])]), 'tracknet', { labelId: 'ball' }));
  assert.equal(text(files, 'seq/Label.csv'), 'filename,visibility,x,y,status\n"frame,2.png",1,25,40,0\n');
  assert.ok(files.has('seq/frame,2.png'));
});

test('rejeita caminhos absolutos, travessia e segmentos vazios sem omitir imagens', async () => {
  for (const name of ['../x.png', 'seq/../x.png', './x.png', '/x.png', 'C:\\x.png', 'C:x.png', '\\\\server\\x.png', 'seq//x.png', 'seq/']) {
    const p = project([image('valid', 'valid.png'), image('bad', name)]);
    for (const format of ['yolo', 'tracknet']) {
      await assert.rejects(exportDataset(p, format, { labelId: 'ball' }), /Caminho.*inseguro/);
    }
  }
});

test('SVG de demonstração e SVG base64 produzem erro claro, nunca um ZIP parcial', async () => {
  for (const src of ['./assets/demo-street.svg', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    for (const format of ['yolo', 'tracknet']) {
      await assert.rejects(exportDataset(project([image('good', 'good.png'), image('bad', 'demo.svg', [], { src })]), format, { labelId: 'ball' }), /SVG\/demo.*demo.svg/);
    }
  }
});

test('valida formato, opções e todo o contrato do modelo antes de exportar', async () => {
  const p = project([image('1', 'frame.png', [box])]);
  for (const format of ['coco', 'YOLO', '', null]) await assert.rejects(exportDataset(p, format), /Formato/);
  for (const options of [null, [], 'ball', 1]) await assert.rejects(exportDataset(p, 'yolo', options), /Opções/);
  const changes = [
    value => { value.version = 2; },
    value => { value.labels[0].id = 'person'; },
    value => { value.images[0].width = 0; },
    value => { value.images[0].src = 'https://example.com/frame.png'; },
    value => { value.images[0].src = 'data:image/png;base64,AB=='; },
    value => { value.images[0].annotations[0].labelId = 'missing'; },
    value => { value.images[0].annotations[0].x = -1; },
    value => { value.images[0].annotations[0].width = Infinity; },
  ];
  for (const change of changes) {
    const invalid = structuredClone(p);
    change(invalid);
    for (const format of ['yolo', 'tracknet']) await assert.rejects(exportDataset(invalid, format, { labelId: 'ball' }), Error);
  }
  const multiline = structuredClone(p);
  multiline.labels[0].name = 'Bola\nInjetada';
  await assert.rejects(exportDataset(multiline, 'yolo'), /nomes de classes/);
});

test('mantém bytes originais de todos os tipos raster aceitos e usa extensão compatível com MIME', async () => {
  const types = ['png', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];
  const p = project(types.map((type, i) => image(String(i), type + '.wrong', [], {
    src: 'data:image/' + type + ';base64,' + Buffer.from([i, 0, 1, 255]).toString('base64'),
  })));
  const tracknet = await unzip(await exportDataset(p, 'tracknet', { labelId: 'ball' }));
  const files = await unzip(await exportDataset({ ...p, images: p.images.filter(item => !item.src.startsWith('data:image/gif;')) }, 'yolo'));
  for (const item of p.images) {
    const stem = item.name.split('.')[0];
    const extension = stem === 'jpeg' ? 'jpg' : stem;
    assert.deepEqual(tracknet.get(stem + '.' + extension), originalBytes(item.src));
    if (stem === 'gif') continue;
    assert.deepEqual(files.get('images/' + stem + '.' + extension), originalBytes(item.src));
    assert.equal(text(files, 'labels/' + stem + '.txt'), '');
  }
});

test('YOLO mantém o pareamento Ultralytics com pastas images aninhadas', async () => {
  const p = project(['images/frame.png', 'lote/images/images/frame.png', '_images/frame.png'].map((name, index) => image(String(index), name)));
  const files = await unzip(await exportDataset(p, 'yolo'));
  safePaths(files);
  for (const path of [...files.keys()].filter(name => name.startsWith('images/'))) {
    const absolute = '/dataset/' + path;
    const lastImages = absolute.lastIndexOf('/images/');
    const expected = (absolute.slice(0, lastImages) + '/labels/' + absolute.slice(lastImages + 8)).replace(/\.[^/.]+$/, '.txt');
    assert.ok(files.has(expected.slice('/dataset/'.length)), expected);
  }
});

test('YOLO rejeita GIF sem exportação parcial', async () => {
  await assert.rejects(exportDataset(project([image('png', 'ok.png'), image('gif', 'animacao.gif', [], { src: 'data:image/gif;base64,AQID' })]), 'yolo'), /YOLO.*GIF.*animacao.gif/);
});

test('ZIP determinístico e projetos vazios válidos sem mutação de entrada', async () => {
  const p = project([image('10', 'seq/10.png'), image('2', 'seq/2.png')]);
  for (const format of ['yolo', 'tracknet']) {
    const first = await exportDataset(p, format, { labelId: 'ball' });
    const reordered = { ...p, images: [...p.images].reverse() };
    const second = await exportDataset(reordered, format, { labelId: 'ball' });
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), Buffer.from(await second.arrayBuffer()));
  }
  assert.equal((await unzip(await exportDataset(project([]), 'tracknet', { labelId: 'ball' }))).size, 0);
  const files = await unzip(await exportDataset({ version: 1, labels: [], images: [] }, 'yolo'));
  assert.equal(text(files, 'classes.txt'), '');
  assert.match(text(files, 'data.yaml'), /nc: 0\nnames: \[\]\n$/);
});

