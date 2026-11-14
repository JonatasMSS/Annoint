const MAX_SOURCE = 32 * 1024 * 1024;
const MAX_PROJECT_SOURCE = 128 * 1024 * 1024;
export const MAX_ANNOTATIONS_PER_IMAGE = 10_000;
export const MAX_PROJECT_ANNOTATIONS = 100_000;
export const MAX_IMAGES = 10_000;
export const BATCH_SIZE = 100;

function dimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0 && width <= 32768 && height <= 32768
    && width * height <= 100_000_000;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeBox(start, end, width, height) {
  if (!dimensions(width, height) || !start || !end
    || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  const x = clamp(Math.min(start.x, end.x), 0, width);
  const y = clamp(Math.min(start.y, end.y), 0, height);
  const boxWidth = clamp(Math.max(start.x, end.x), 0, width) - x;
  const boxHeight = clamp(Math.max(start.y, end.y), 0, height) - y;
  return boxWidth < 4 || boxHeight < 4 ? null : clampBox({ x, y, width: boxWidth, height: boxHeight }, width, height);
}

export function clampBox(box, width, height) {
  if (!dimensions(width, height) || !box
    || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0) return null;
  const boxWidth = Math.min(box.width, width);
  const boxHeight = Math.min(box.height, height);
  return {
    ...box,
    x: clamp(box.x, 0, width - boxWidth),
    y: clamp(box.y, 0, height - boxHeight),
    width: boxWidth,
    height: boxHeight,
  };
}

export function moveBox(box, dx, dy, width, height) {
  if (!box || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return clampBox({ ...box, x: box.x + dx, y: box.y + dy }, width, height);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function uniqueId(value, ids) {
  check(text(value, 200) && !ids.has(value), 'ID inválido ou duplicado.');
  ids.add(value);
  return value;
}

function validSource(src) {
  if (src === './assets/demo-street.svg') return true;
  if (typeof src === 'string' && /^(asset:|anoint-image:\/\/)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(src)) return true;
  if (typeof src !== 'string' || src.length > MAX_SOURCE) return false;
  const prefix = /^data:image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml);base64,/.exec(src);
  if (!prefix) return false;
  const data = src.slice(prefix[0].length);
  return data.length > 0 && data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)
    && (!data.endsWith('==') || 'AQgw'.includes(data.at(-3)))
    && (!data.endsWith('=') || data.endsWith('==') || 'AEIMQUYcgkosw048'.includes(data.at(-2)));
}

export function validateProject(value) {
  check(value !== null && typeof value === 'object' && value.version === 1, 'Versão de projeto inválida.');
  check(Array.isArray(value.labels) && value.labels.length <= 1000, 'Lista de classes inválida (máximo 1000).');
  check(Array.isArray(value.images) && value.images.length <= MAX_IMAGES, `Lista de imagens inválida (máximo ${MAX_IMAGES}).`);
  const labelIds = new Set();
  const imageIds = new Set();
  const annotationIds = new Set();
  const labels = [];
  const images = [];
  let totalSource = 0;
  let totalAnnotations = 0;
  for (const label of value.labels) {
    check(label && typeof label === 'object', 'Classe inválida.');
    const id = uniqueId(label.id, labelIds);
    check(text(label.name, 200), 'Nome de classe inválido.');
    check(typeof label.color === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(label.color), 'Cor de classe inválida; use hexadecimal #RGB ou #RRGGBB.');
    labels.push({ id, name: label.name, color: label.color });
  }
  for (const image of value.images) {
    check(image && typeof image === 'object', 'Imagem inválida.');
    const id = uniqueId(image.id, imageIds);
    check(text(image.name, 1024), 'Nome de imagem inválido.');
    check(dimensions(image.width, image.height), 'Dimensões de imagem inválidas ou acima do limite seguro.');
    check(validSource(image.src), 'Origem da imagem inválida ou acima de 32 MiB.');
    totalSource += image.src.length;
    check(totalSource <= MAX_PROJECT_SOURCE, 'Projeto excede 128 MiB de imagens em base64.');
    check(typeof image.reviewed === 'boolean', 'Estado de revisão inválido.');
    check(Array.isArray(image.annotations) && image.annotations.length <= MAX_ANNOTATIONS_PER_IMAGE, 'Lista de anotações inválida (máximo 10000 por imagem).');
    totalAnnotations += image.annotations.length;
    check(totalAnnotations <= MAX_PROJECT_ANNOTATIONS, 'Projeto excede 100000 anotações.');
    const annotations = [];
    for (const box of image.annotations) {
      check(box && typeof box === 'object', 'Anotação inválida.');
      const boxId = uniqueId(box.id, annotationIds);
      check(labelIds.has(box.labelId), 'Classe da anotação não existe.');
      check([box.x, box.y, box.width, box.height].every(Number.isFinite)
        && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
        && box.x <= image.width - box.width && box.y <= image.height - box.height,
      'Caixa inválida ou fora dos limites da imagem.');
      annotations.push({ id: boxId, labelId: box.labelId, x: box.x, y: box.y, width: box.width, height: box.height });
    }
    images.push({ id, name: image.name, src: image.src, width: image.width, height: image.height, annotations, reviewed: image.reviewed });
  }
  return { version: 1, labels, images };
}

export function createProject(images, labels) {
  return validateProject({ version: 1, labels, images });
}
