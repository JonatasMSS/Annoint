const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { deflateSync, crc32 } = require('node:zlib');

const COUNT = 100;
const SEED = 20261114;
const BACKGROUNDS = [[248, 250, 252, 255], [255, 249, 240, 255], [241, 248, 245, 255], [246, 243, 252, 255]];
const hex = (rgba) => '#' + rgba.slice(0, 3).map((channel) => channel.toString(16).padStart(2, '0')).join('');
const CLASSES = [
  ['square', 'Quadrado', '#2563eb', 1, 1],
  ['rectangle', 'Retângulo', '#16a34a', 1.6, 1],
  ['circle', 'Círculo', '#dc2626', 1, 1],
  ['ellipse', 'Elipse', '#9333ea', 1.7, 1],
  ['triangle', 'Triângulo', '#d97706', 1, 1],
  ['pentagon', 'Pentágono', '#0891b2', 1, 1],
  ['hexagon', 'Hexágono', '#db2777', 1.15, 1],
  ['star', 'Estrela', '#4f46e5', 1, 1],
  ['car', 'Carro', '#0f766e', 1.8, 1],
  ['person', 'Pessoa', '#b45309', 0.55, 1.6],
  ['house', 'Casa', '#be123c', 1, 1.1],
].map(([id, name, color, aspectWidth, aspectHeight]) => ({ id, name, color, aspectWidth, aspectHeight }));
const PALETTE = ['#2563eb', '#e34b43', '#22a36a', '#a352c4', '#e29419', '#169ba6', '#df5694'];
const DIMENSIONS = [[640, 480], [800, 450], [480, 640], [512, 512]];
const DEFAULT_OUTPUT = path.resolve(__dirname, '..', 'test-scenes');
const hash = (data) => createHash('sha256').update(data).digest('hex');

function random(seed) {
  let state = seed >>> 0;
  return (min, max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + Math.floor(state / 4294967296 * (max - min + 1));
  };
}

function planScene(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < COUNT);
  const rng = random(SEED + Math.imul(index, 2654435761));
  const [width, height] = DIMENSIONS[index % DIMENSIONS.length];
  const background = BACKGROUNDS[rng(0, BACKGROUNDS.length - 1)];
  const count = index % 20 === 19 ? 0 : index < CLASSES.length ? 1 : rng(2, 6);
  const objects = [];
  for (let i = 0; i < count; i++) {
    const label = CLASSES[index < CLASSES.length ? index : rng(0, CLASSES.length - 1)];
    const size = rng(42, 84);
    const objectWidth = Math.round(size * label.aspectWidth);
    const objectHeight = Math.round(size * label.aspectHeight);
    let box;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const x = i === 0 && index % 12 === 0 ? 0
        : i === 0 && index % 12 === 3 ? width - objectWidth : rng(8, width - objectWidth - 8);
      const y = i === 0 && index % 12 === 6 ? 0
        : i === 0 && index % 12 === 9 ? height - objectHeight : rng(8, height - objectHeight - 8);
      const candidate = { x, y, width: objectWidth, height: objectHeight };
      if (objects.every((other) => x + objectWidth + 10 <= other.x || other.x + other.width + 10 <= x
        || y + objectHeight + 10 <= other.y || other.y + other.height + 10 <= y)) {
        box = candidate;
        break;
      }
    }
    assert.ok(box, `Não foi possível posicionar objeto na cena ${index + 1}`);
    objects.push({ ...box, labelId: label.id, color: PALETTE[rng(0, PALETTE.length - 1)] });
  }
  return { width, height, background, objects };
}

function renderScene(index) {
  const scene = planScene(index);
  const rgba = Buffer.alloc(scene.width * scene.height * 4);
  rgba.fill(Buffer.from(scene.background));
  const annotations = [];
  for (const [objectIndex, object] of scene.objects.entries()) {
    let left = scene.width, top = scene.height, right = -1, bottom = -1;
    const paint = (inside, color, region = [0, 0, 1, 1]) => {
      const rgb = color.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
      for (let py = Math.max(0, Math.floor(region[1] * object.height)); py < Math.min(object.height, Math.ceil(region[3] * object.height)); py++) {
        for (let px = Math.max(0, Math.floor(region[0] * object.width)); px < Math.min(object.width, Math.ceil(region[2] * object.width)); px++) {
          const u = (px + 0.5) / object.width;
          const v = (py + 0.5) / object.height;
          if (!inside(u, v)) continue;
          const x = object.x + px, y = object.y + py;
          rgba.set([...rgb, 255], (y * scene.width + x) * 4);
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
    };
    const rect = (x, y, w, h, color = object.color) => paint(
      (u, v) => u >= x && u < x + w && v >= y && v < y + h, color, [x, y, x + w, y + h]);
    const ellipse = (x, y, w, h, color = object.color) => paint(
      (u, v) => ((u - x - w / 2) / (w / 2)) ** 2 + ((v - y - h / 2) / (h / 2)) ** 2 <= 1,
      color, [x, y, x + w, y + h]);
    const polygon = (points, color = object.color) => paint((u, v) => {
      let inside = false;
      for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
        const [ax, ay] = points[a], [bx, by] = points[b];
        if ((ay > v) !== (by > v) && u < (bx - ax) * (v - ay) / (by - ay) + ax) inside = !inside;
      }
      return inside;
    }, color);
    const regular = (sides, star = false) => Array.from({ length: sides }, (_, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / sides;
      const radius = star && i % 2 ? 0.22 : 0.5;
      return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius];
    });
    const ink = '#263447', light = '#dceef8';
    switch (object.labelId) {
      case 'square': case 'rectangle': rect(0, 0, 1, 1); break;
      case 'circle': case 'ellipse': ellipse(0, 0, 1, 1); break;
      case 'triangle': polygon([[0.5, 0], [1, 1], [0, 1]]); break;
      case 'pentagon': polygon(regular(5)); break;
      case 'hexagon': polygon(regular(6)); break;
      case 'star': polygon(regular(10, true)); break;
      case 'car':
        polygon([[0.04, 0.42], [0.22, 0.42], [0.34, 0.08], [0.66, 0.08], [0.82, 0.42], [0.98, 0.5], [1, 0.83], [0, 0.83]]);
        polygon([[0.29, 0.42], [0.38, 0.16], [0.48, 0.16], [0.48, 0.42]], light);
        polygon([[0.53, 0.16], [0.63, 0.16], [0.75, 0.42], [0.53, 0.42]], light);
        ellipse(0.12, 0.63, 0.22, 0.37, ink); ellipse(0.66, 0.63, 0.22, 0.37, ink);
        ellipse(0.18, 0.73, 0.1, 0.17, light); ellipse(0.72, 0.73, 0.1, 0.17, light);
        rect(0.93, 0.53, 0.07, 0.12, '#ffe09c');
        break;
      case 'person':
        ellipse(0.27, 0, 0.46, 0.22, '#b97952');
        polygon([[0.3, 0.25], [0.7, 0.25], [1, 0.59], [0.86, 0.65], [0.66, 0.44], [0.66, 0.66], [0.34, 0.66], [0.34, 0.44], [0.14, 0.65], [0, 0.59]]);
        polygon([[0.34, 0.63], [0.66, 0.63], [0.8, 0.96], [0.61, 1], [0.5, 0.76], [0.39, 1], [0.2, 0.96]], ink);
        break;
      case 'house':
        rect(0.12, 0.4, 0.76, 0.6);
        rect(0.7, 0.13, 0.1, 0.24, ink);
        polygon([[0.5, 0], [1, 0.43], [0, 0.43]], ink);
        rect(0.2, 0.53, 0.2, 0.22, light); rect(0.61, 0.53, 0.19, 0.22, light);
        rect(0.44, 0.64, 0.14, 0.36, ink);
        break;
      default: throw new Error(`Classe desconhecida: ${object.labelId}`);
    }
    assert.ok(right >= left && bottom >= top);
    annotations.push({ id: `scene-${String(index + 1).padStart(3, '0')}-object-${objectIndex + 1}`,
      labelId: object.labelId, x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
  }
  return { width: scene.width, height: scene.height, background: scene.background, rgba, annotations };
}

function encodePng(width, height, rgba) {
  const chunk = (name, data) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const stride = width * 4;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function writeDataset(output = DEFAULT_OUTPUT) {
  const imagesDirectory = path.join(output, 'images');
  const names = Array.from({ length: COUNT }, (_, i) => `scene-${String(i + 1).padStart(3, '0')}.png`);
  if (fs.existsSync(imagesDirectory)) {
    const unexpected = fs.readdirSync(imagesDirectory).filter((name) => !names.includes(name));
    assert.equal(unexpected.length, 0, `A pasta de imagens contém arquivos extras; não foram removidos: ${unexpected.join(', ')}`);
  }
  fs.mkdirSync(imagesDirectory, { recursive: true });
  const images = [];
  for (let index = 0; index < COUNT; index++) {
    const scene = renderScene(index);
    const encoded = encodePng(scene.width, scene.height, scene.rgba);
    fs.writeFileSync(path.join(imagesDirectory, names[index]), encoded);
    images.push({ id: `scene-${String(index + 1).padStart(3, '0')}`, path: `images/${names[index]}`,
      width: scene.width, height: scene.height, background: hex(scene.background),
      bytes: encoded.length, sha256: hash(encoded), annotations: scene.annotations });
  }
  const counts = Object.fromEntries(CLASSES.map((label) => [label.id, 0]));
  for (const image of images) for (const box of image.annotations) counts[box.labelId]++;
  const manifest = {
    version: 1, generator: 'scripts/create-annotation-scenes.cjs', seed: SEED,
    imageCount: COUNT, backgrounds: BACKGROUNDS.map(hex),
    coordinates: 'Pixels naturais; origem superior esquerda. Caixa mínima dos pixels visíveis do objeto: x,y,width,height; direita/inferior exclusivas.',
    objectPolicy: 'Sem sobreposição, oclusão ou recorte: todos os objetos inteiros dentro da imagem. Carro, pessoa e casa são uma instância cada: suas partes não recebem classes geométricas separadas. Quadrado e círculo têm classes próprias, distintas de retângulo e elipse. Cores e fundos não determinam classes.',
    labels: CLASSES.map(({ id, name, color }) => ({ id, name, color })),
    summary: { objects: images.reduce((total, image) => total + image.annotations.length, 0),
      emptyImages: images.filter((image) => !image.annotations.length).length, counts },
    images,
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'class-contract.json'), JSON.stringify({
    labels: manifest.labels, coordinates: manifest.coordinates, objectPolicy: manifest.objectPolicy,
  }, null, 2) + '\n');
  return manifest;
}

if (require.main === module) {
  const manifest = writeDataset();
  console.log(JSON.stringify({ output: DEFAULT_OUTPUT, seed: SEED, images: manifest.imageCount,
    ...manifest.summary, bytes: manifest.images.reduce((total, image) => total + image.bytes, 0) }, null, 2));
}

module.exports = { COUNT, SEED, BACKGROUNDS, CLASSES, planScene, renderScene, encodePng, writeDataset };
