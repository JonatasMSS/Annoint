import { validateProject } from './model.js';

const encoder = new TextEncoder();
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
const compare = (a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const key = name => name.normalize('NFC').toLowerCase();
const extensions = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'], gif: ['gif'], avif: ['avif'], bmp: ['bmp'] };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function segment(name) {
  let safe = name.normalize('NFC').replace(/[<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') safe = '_';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = '_' + safe;
  return safe;
}

function planImages(images, tracknet, sourceTypes) {
  const directories = new Map([['', '']]);
  const paths = new Set(tracknet ? ['label.csv'] : []);
  const stems = new Set();
  function reserve(parent, name, extension = '', image = false) {
    let candidate;
    let stem;
    let suffix = 1;
    do {
      stem = parent + name + (suffix === 1 ? '' : '__' + suffix);
      candidate = stem + extension;
      suffix++;
    } while (paths.has(key(candidate)) || (image && (stems.has(key(stem)) || (!tracknet && paths.has(key(stem + '.txt'))))));
    paths.add(key(candidate));
    if (image) {
      stems.add(key(stem));
      if (!tracknet) paths.add(key(stem + '.txt'));
    }
    return candidate;
  }
  return [...images].sort((a, b) => compare(a.name.replaceAll('\\', '/'), b.name.replaceAll('\\', '/')) || compare(a.id, b.id)).map(image => {
    const name = image.name.replaceAll('\\', '/');
    const parts = name.split('/');
    if (/^(\/|[a-z]:)/i.test(name) || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error('Caminho de imagem inseguro: ' + image.name);
    }
    const file = parts.pop();
    let original = '';
    let parent = '';
    for (const part of parts) {
      original += part + '/';
      if (!directories.has(original)) {
        const safe = segment(part);
        // Ultralytics procura labels substituindo a última pasta chamada images.
        const directory = reserve(parent, !tracknet && key(safe) === 'images' ? '_images' : safe);
        directories.set(original, directory + '/');
        if (tracknet) paths.add(key(directory + '/Label.csv'));
      }
      parent = directories.get(original);
    }
    const type = sourceTypes.get(image.src) || /^data:image\/([^;]+);base64,/.exec(image.src)?.[1];
    if (!extensions[type]) throw new Error('Imagem SVG/demo não suportada na exportação: ' + image.name + '. Importe uma imagem raster original.');
    if (!tracknet && type === 'gif') throw new Error('YOLO não aceita GIF para treino: ' + image.name + '. Converta os frames para PNG ou JPEG antes de importar.');
    const dot = file.lastIndexOf('.');
    const extension = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
    const outputExtension = extensions[type].includes(extension) ? extension : extensions[type][0];
    const path = reserve(parent, segment(dot > 0 ? file.slice(0, dot) : file), '.' + outputExtension, true);
    return { image, path, parent };
  });
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const [path, value] of entries) {
    const name = encoder.encode(path);
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    if (offset + bytes.length + 1024 > 0xffffffff || entries.length > 65535) throw new Error('Dataset excede o limite ZIP de 4 GiB/65535 arquivos. Exporte um projeto menor.');
    const crc = crc32(bytes);
    const header = new Uint8Array(30);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true);
    const directory = new Uint8Array(46);
    const d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, bytes.length, true);
    d.setUint32(24, bytes.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    local.push(header, name, bytes);
    central.push(directory, name);
    offset += header.length + name.length + bytes.length;
    centralSize += directory.length + name.length;
  }
  // shortcut: ZIP STORE de 32 bits, adicionar ZIP64 se os limites de validateProject ultrapassarem 4 GiB/65535 entradas.
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}

const csv = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;

/**
 * Exporta o contrato de model.js em ZIP, sem alterar o projeto.
 * YOLO: classes na ordem de project.labels, índices a partir de zero.
 * TrackNet: options.labelId obrigatório; um Label.csv junto às imagens de cada pasta.
 * visibility=1 para caixas, 0 para ausentes; status=0 (o modelo não possui eventos).
 */
export async function exportDataset(project, format, options = {}) {
  if (format !== 'yolo' && format !== 'tracknet') throw new Error('Formato inválido; use yolo ou tracknet.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Opções de exportação inválidas.');
  const data = validateProject(project);
  if (format === 'tracknet' && !data.labels.some(label => label.id === options.labelId)) {
    throw new Error('TrackNet exige options.labelId de uma classe existente.');
  }
  if (format === 'yolo' && data.labels.some(label => /[\x00-\x1f\x7f\u0085\u2028\u2029]/.test(label.name))) {
    throw new Error('YOLO exige nomes de classes sem quebras de linha ou caracteres de controle.');
  }
  const sources = new Map();
  const sourceTypes = new Map();
  let sourceBytes = 0;
  for (const image of data.images) {
    if (/^(asset:|anoint-image:\/\/)/.test(image.src)) {
      if (typeof options.loadSource !== 'function') throw new Error('Leitor local necessário para exportar as imagens.');
      const blob = await options.loadSource(image.src);
      sources.set(image.src, blob);
      sourceTypes.set(image.src, blob.type.replace('image/', ''));
      sourceBytes += blob.size;
    } else {
      const payload = image.src.slice(image.src.indexOf(',') + 1);
      sourceBytes += payload.length * .75;
    }
    // Reserva cabeçalhos e labels antes de materializar os buffers ZIP32.
    if (sourceBytes > 0xf8000000) throw new Error('Dataset excede o limite seguro de 3,875 GiB de imagens para ZIP. Divida o projeto antes de exportar.');
  }
  const images = planImages(data.images, format === 'tracknet', sourceTypes);
  const labelIndexes = new Map(data.labels.map((label, index) => [label.id, index]));
  const entries = [];
  const sequences = new Map();
  for (const { image, path, parent } of images) {
    let bytes;
    if (sources.has(image.src)) bytes = new Uint8Array(await sources.get(image.src).arrayBuffer());
    else {
      const binary = atob(image.src.slice(image.src.indexOf(',') + 1));
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    }
    if (format === 'yolo') {
      entries.push(['images/' + path, bytes]);
      const lines = image.annotations.map(box => [
        labelIndexes.get(box.labelId),
        (box.x + box.width / 2) / image.width,
        (box.y + box.height / 2) / image.height,
        box.width / image.width, box.height / image.height,
      ].join(' '));
      entries.push(['labels/' + path.replace(/\.[^/.]+$/, '.txt'), lines.length ? lines.join('\n') + '\n' : '']);
    } else {
      const boxes = image.annotations.filter(box => box.labelId === options.labelId);
      if (boxes.length > 1) throw new Error('TrackNet aceita apenas um objeto da classe por imagem: ' + image.name);
      entries.push([path, bytes]);
      if (!sequences.has(parent)) sequences.set(parent, ['filename,visibility,x,y,status']);
      const box = boxes[0];
      sequences.get(parent).push([csv(path.slice(parent.length)), ...(box ? [1, box.x + box.width / 2, box.y + box.height / 2, 0] : [0, 0, 0, 0])].join(','));
    }
  }
  if (format === 'yolo') {
    entries.push(['classes.txt', data.labels.map(label => label.name).join('\n') + (data.labels.length ? '\n' : '')]);
    entries.push(['data.yaml', 'path: .\ntrain: images\nval: images\nnc: ' + data.labels.length + '\nnames: ' + JSON.stringify(data.labels.map(label => label.name)) + '\n']);
  } else {
    for (const [parent, lines] of sequences) entries.push([parent + 'Label.csv', lines.join('\n') + '\n']);
  }
  return zip(entries);
}

