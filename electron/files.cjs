const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 10_000;
const MAX_MANIFEST = 64 * 1024 * 1024;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const ID = new RegExp('^' + UUID + '$');
const SOURCE = new RegExp('^anoint-image://(' + UUID + ')/?$');
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.bmp']);
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/bmp']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
const compare = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const sourceFor = id => 'anoint-image://' + id;
const dimensions = size => size && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)
  && size.width > 0 && size.height > 0 && size.width * size.height <= 100_000_000;
const fingerprint = stat => ({ dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs) });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;

function identify(header) {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))) return 'image/gif';
  if (header.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (header.toString('ascii', 4, 8) === 'ftyp') {
    const length = Math.min(header.length, header.readUInt32BE(0));
    for (let i = 8; i + 4 <= length; i += 4) {
      if (i !== 12 && ['avif', 'avis'].includes(header.toString('ascii', i, i + 4))) return 'image/avif';
    }
  }
  throw new Error('Conteúdo não é uma imagem raster compatível.');
}

// Evita alocar bitmaps obviamente excessivos antes do decoder quando o cabeçalho informa o tamanho.
function checkHeader(header, mime) {
  let size;
  if (mime === 'image/png' && header.length >= 24) size = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  if (mime === 'image/gif' && header.length >= 10) size = { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
  if (mime === 'image/bmp' && header.length >= 26 && header.readUInt32LE(14) >= 40) size = { width: header.readInt32LE(18), height: Math.abs(header.readInt32LE(22)) };
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 <= header.length) {
      if (header[offset] !== 255) break;
      while (header[offset] === 255) offset++;
      const marker = header[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > header.length) break;
      const length = header.readUInt16BE(offset);
      if (length < 2) throw new Error('Cabeçalho JPEG inválido.');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7 && offset + 7 <= header.length) {
        size = { width: header.readUInt16BE(offset + 5), height: header.readUInt16BE(offset + 3) }; break;
      }
      offset += length;
    }
  }
  if (mime === 'image/webp') {
    const type = header.toString('ascii', 12, 16);
    if (type === 'VP8X' && header.length >= 30) size = { width: header.readUIntLE(24, 3) + 1, height: header.readUIntLE(27, 3) + 1 };
    if (type === 'VP8L' && header.length >= 25 && header[20] === 0x2f) {
      const bits = header.readUInt32LE(21); size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (type === 'VP8 ' && header.length >= 30 && header.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) size = { width: header.readUInt16LE(26) & 0x3fff, height: header.readUInt16LE(28) & 0x3fff };
  }
  if (size && !dimensions(size)) throw new Error('Dimensões inválidas ou acima de 100 milhões de pixels.');
}

async function inspect(filename) {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Somente arquivos regulares, sem links simbólicos, são permitidos.');
  if (stat.size <= 0n || stat.size > BigInt(MAX_BYTES)) throw new Error('Arquivo vazio ou acima de 15 MiB.');
  const realpath = await fs.realpath(filename);
  return { path: realpath, file: fingerprint(stat) };
}

function createFileStore(manifestPath, { decode, confirmTrash, trashItem }) {
  const journalPath = manifestPath + '.trash-journal.json';
  let entries = new Map();
  let tombstones = new Set();
  let pending = Promise.resolve();
  const exclusive = action => {
    const task = pending.then(action);
    pending = task.catch(() => {});
    return task;
  };

  async function prepareContent(value) {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > MAX_MANIFEST) throw new Error('Manifesto de imagens excede o limite seguro de 64 MiB.');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const temporary = manifestPath + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close(); handle = undefined;
      return temporary;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      throw new Error('Não foi possível preparar o manifesto de imagens.', { cause: error });
    }
  }

  const prepare = (next, deleted) => prepareContent({ version: 1, images: [...next.values()], tombstones: [...deleted] });

  async function readJournal() {
    let value;
    try {
      if ((await fs.stat(journalPath)).size > MAX_MANIFEST) throw new Error('Journal acima do limite seguro.');
      value = JSON.parse(await fs.readFile(journalPath, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const prefix = path.basename(manifestPath) + '.';
    if (value?.version !== 1 || typeof value.path !== 'string' || !path.isAbsolute(value.path) || value.path.length > 4096
      || !value.file || !['dev', 'ino', 'mtimeNs'].every(key => typeof value.file[key] === 'string' && /^-?\d{1,30}$/.test(value.file[key]))
      || !Number.isSafeInteger(value.file.size) || value.file.size <= 0 || value.file.size > MAX_BYTES
      || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > MAX_IMAGES
      || new Set(value.sources).size !== value.sources.length || value.sources.some(source => typeof source !== 'string' || !ID.test(source.slice(15)) || source !== sourceFor(source.slice(15)))
      || typeof value.prepared !== 'string' || !value.prepared.startsWith(prefix) || !value.prepared.endsWith('.tmp') || !ID.test(value.prepared.slice(prefix.length, -4))) throw new Error('Journal de Lixeira inválido; recuperação preservada para inspeção.');
    return value;
  }

  async function originalUnchanged(journal) {
    try {
      const stat = await fs.lstat(journal.path, { bigint: true });
      return stat.isFile() && sameFile(fingerprint(stat), journal.file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  }

  async function reconcileTrash() {
    const journal = await readJournal();
    if (!journal) return;
    if (!await originalUnchanged(journal)) {
      const next = new Map(entries);
      const deleted = new Set(tombstones);
      for (const source of journal.sources) { next.delete(source.slice(15)); deleted.add(source); }
      entries = next; tombstones = deleted;
      const temporary = await prepare(next, deleted);
      try { await commit(temporary, next, deleted); }
      finally { await fs.unlink(temporary).catch(() => {}); }
    }
    await fs.unlink(journalPath);
    await fs.unlink(path.join(path.dirname(manifestPath), journal.prepared)).catch(() => {});
  }

  async function finishPendingTrash() {
    try { await fs.access(journalPath); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    // Recarrega a base persistida antes de reconciliar, inclusive se o arquivo original ainda existir.
    await load();
  }

  async function commit(temporary, next, deleted) {
    try { await fs.rename(temporary, manifestPath); }
    catch (error) { throw new Error('Não foi possível salvar o manifesto de imagens.', { cause: error }); }
    entries = next; tombstones = deleted;
  }

  async function load() {
    let content;
    try {
      if ((await fs.stat(manifestPath)).size > MAX_MANIFEST) throw new Error('Manifesto acima de 64 MiB.');
      content = await fs.readFile(manifestPath, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') { await reconcileTrash(); return; } throw error; }
    const value = JSON.parse(content);
    if (value?.version !== 1 || !Array.isArray(value.images) || value.images.length > MAX_IMAGES || !Array.isArray(value.tombstones)) throw new Error('Manifesto de imagens inválido.');
    const loaded = new Map();
    const deleted = new Set();
    for (const source of value.tombstones) {
      if (typeof source !== 'string' || !ID.test(source.slice(15)) || source !== sourceFor(source.slice(15)) || deleted.has(source)) throw new Error('Tombstone inválido no manifesto.');
      deleted.add(source);
    }
    for (const item of value.images) {
      if (!item || typeof item.id !== 'string' || !ID.test(item.id) || loaded.has(item.id) || deleted.has(sourceFor(item.id))
        || typeof item.path !== 'string' || item.path.length > 4096 || !path.isAbsolute(item.path) || !EXTENSIONS.has(path.extname(item.path).toLowerCase())
        || typeof item.name !== 'string' || !item.name || item.name.length > 1024 || !dimensions(item) || !MIMES.has(item.mime)
        || !item.file || !['dev', 'ino', 'mtimeNs'].every(key => typeof item.file[key] === 'string' && /^-?\d{1,30}$/.test(item.file[key]))
        || !Number.isSafeInteger(item.file.size) || item.file.size <= 0 || item.file.size > MAX_BYTES) throw new Error('Registro inválido no manifesto de imagens.');
      loaded.set(item.id, item);
    }
    entries = loaded; tombstones = deleted;
    await reconcileTrash();
  }

  async function checked(item) {
    const current = await inspect(item.path);
    if (current.path !== item.path || !sameFile(current.file, item.file)) throw new Error('O arquivo foi alterado, substituído ou movido. Importe-o novamente antes de prosseguir.');
    return current;
  }

  function importPaths(paths, folder) {
    return exclusive(async () => {
      await finishPendingTrash();
      if (!Array.isArray(paths) || paths.some(filename => typeof filename !== 'string' || !path.isAbsolute(filename)) || typeof folder !== 'boolean' || (folder && paths.length !== 1)) throw new Error('Seleção nativa inválida.');
      const errors = [];
      let ignored = 0;
      const candidates = [];
      let overflow = false;
      const root = folder ? paths[0] : null;
      const displayName = filename => root ? (path.basename(root) || 'imagens') + '/' + path.relative(root, filename).split(path.sep).join('/') : path.basename(filename);
      const add = filename => {
        if (!EXTENSIONS.has(path.extname(filename).toLowerCase())) { ignored++; return; }
        if (candidates.length === MAX_IMAGES) { overflow = true; return; }
        candidates.push({ path: filename, name: displayName(filename) });
      };
      async function walk(directory) {
        if (overflow) return;
        try {
          const dir = await fs.opendir(directory);
          for await (const item of dir) {
            if (overflow) break;
            const filename = path.join(directory, item.name);
            if (item.isSymbolicLink()) ignored++;
            else if (item.isDirectory()) await walk(filename);
            else if (item.isFile()) add(filename);
            else ignored++;
          }
        } catch (error) { errors.push(displayName(directory) + ': não foi possível ler a pasta (' + error.message + ').'); }
      }
      if (folder) {
        const stat = await fs.lstat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Selecione uma pasta regular, sem link simbólico.');
        await walk(root);
      } else for (const filename of paths) { add(filename); if (overflow) break; }
      if (overflow) return { images: [], errors: [...errors, 'Seleção excede 10000 imagens. Escolha um lote menor.'], ignored };
      candidates.sort((a, b) => compare(a.name, b.name));
      const next = new Map(entries);
      const byPath = new Map();
      for (const item of next.values()) byPath.set(item.path, item);
      const images = [];
      for (const candidate of candidates) {
        try {
          if (candidate.path.length > 4096 || candidate.name.length > 1024) throw new Error('Caminho ou nome acima do limite seguro.');
          const current = await inspect(candidate.path);
          let item = byPath.get(current.path);
          if (!item || !sameFile(item.file, current.file)) {
            if (next.size >= MAX_IMAGES) return { images: [], errors: [...errors, 'Inventário excederia 10000 imagens registradas. Nenhuma imagem deste lote foi adicionada.'], ignored };
            const handle = await fs.open(current.path, 'r');
            let header;
            try {
              const data = Buffer.alloc(65536);
              const read = await handle.read(data, 0, data.length, 0);
              header = data.subarray(0, read.bytesRead);
            } finally { await handle.close(); }
            const mime = identify(header);
            checkHeader(header, mime);
            const size = await decode(current.path, mime);
            if (!dimensions(size)) throw new Error('Dimensões inválidas ou acima de 100 milhões de pixels.');
            const after = await inspect(current.path);
            if (after.path !== current.path || !sameFile(after.file, current.file)) throw new Error('Arquivo alterado durante a importação.');
            item = { id: randomUUID(), path: current.path, name: candidate.name, mime, width: size.width, height: size.height, file: current.file };
            next.set(item.id, item); byPath.set(item.path, item);
          }
          images.push({ id: randomUUID(), name: candidate.name, src: sourceFor(item.id), width: item.width, height: item.height, annotations: [], reviewed: false });
        } catch (error) { errors.push(candidate.name + ': ' + error.message); }
      }
      if (next.size !== entries.size) {
        const temporary = await prepare(next, tombstones);
        try { await commit(temporary, next, tombstones); }
        finally { await fs.unlink(temporary).catch(() => {}); }
      }
      return { images, errors, ignored };
    });
  }

  async function response(request) {
    const origin = request.headers.get('origin');
    const headers = { 'Access-Control-Allow-Origin': origin === 'file://' ? 'file://' : 'null', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin && origin !== 'null' && origin !== 'file://') return new Response(null, { status: 403 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    const id = typeof request.url === 'string' && SOURCE.exec(request.url)?.[1];
    const item = entries.get(id);
    if (!item) return new Response(null, { status: 404, headers });
    let handle;
    try {
      await checked(item);
      handle = await fs.open(item.path, 'r');
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || !sameFile(fingerprint(stat), item.file)) throw new Error('Arquivo substituído.');
      headers['Content-Type'] = item.mime; headers['Content-Length'] = String(item.file.size);
      if (request.method === 'HEAD') { await handle.close(); return new Response(null, { headers }); }
      const stream = handle.createReadStream({ autoClose: true, start: 0, end: item.file.size - 1 });
      handle = undefined;
      return new Response(Readable.toWeb(stream), { headers });
    } catch {
      if (handle) await handle.close().catch(() => {});
      return new Response(null, { status: 404, headers });
    }
  }

  function trash(source, owner) {
    return exclusive(async () => {
      await finishPendingTrash();
      const match = typeof source === 'string' && SOURCE.exec(source);
      const item = match && source === sourceFor(match[1]) && entries.get(match[1]);
      if (!item) throw new Error('Imagem não registrada ou capability inválida.');
      await checked(item);
      if (!await confirmTrash(item.path, owner)) return { deleted: false, sources: [] };
      await checked(item);
      const next = new Map(entries);
      const deleted = new Set(tombstones);
      const sources = [];
      for (const entry of entries.values()) if (entry.path === item.path) {
        const src = sourceFor(entry.id); sources.push(src); deleted.add(src); next.delete(entry.id);
      }
      const temporary = await prepare(next, deleted);
      const journal = { version: 1, path: item.path, file: item.file, sources, prepared: path.basename(temporary) };
      let journalTemporary;
      let journalWritten = false;
      let attempted = false;
      let trashed = false;
      try {
        journalTemporary = await prepareContent(journal);
        await fs.rename(journalTemporary, journalPath);
        journalTemporary = undefined; journalWritten = true;
        await checked(item);
        attempted = true;
        await trashItem(item.path); trashed = true;
        entries = next; tombstones = deleted;
        await commit(temporary, next, deleted);
        await fs.unlink(journalPath); journalWritten = false;
      } catch (error) {
        if (!trashed && journalWritten && (!attempted || await originalUnchanged(journal).catch(() => false))) {
          try { await fs.unlink(journalPath); journalWritten = false; } catch {}
        }
        throw new Error(trashed ? 'Arquivo enviado à Lixeira e fontes revogadas, mas o manifesto não pôde ser concluído. O journal foi preservado para recuperação ao abrir novamente.' : 'Não foi possível enviar o arquivo à Lixeira.', { cause: error });
      } finally {
        if (journalTemporary) await fs.unlink(journalTemporary).catch(() => {});
        if (!journalWritten) await fs.unlink(temporary).catch(() => {});
      }
      return { deleted: true, sources };
    });
  }

  function available(sources) {
    if (!Array.isArray(sources) || sources.length > MAX_IMAGES || sources.some(source => typeof source !== 'string')) throw new Error('Lista de fontes inválida (máximo 10000).');
    return [...new Set(sources.filter(source => tombstones.has(source)))];
  }

  return { load, importPaths, response, trash, available };
}

module.exports = { createFileStore, MAX_BYTES, MAX_IMAGES };
