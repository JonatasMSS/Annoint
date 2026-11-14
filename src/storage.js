import { validateProject } from './model.js';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB indisponível; abra o Anoint no Electron ou em um navegador compatível.'));
      return;
    }
    const request = indexedDB.open('anoint', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of ['projects', 'assets', 'settings']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onerror = () => reject(new Error('Não foi possível abrir o banco local.', { cause: request.error }));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Banco local bloqueado. Feche outras janelas do Anoint e tente novamente.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
  });
}

async function accessProject(mode, project) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', mode);
      const store = transaction.objectStore('projects');
      const request = mode === 'readonly' ? store.get('current') : store.put(project, 'current');
      transaction.oncomplete = () => resolve(mode === 'readonly' ? request.result : undefined);
      transaction.onabort = () => reject(new Error('Não foi possível concluir a operação no banco local. Verifique o espaço disponível.', { cause: transaction.error || request.error }));
    });
  } finally {
    db.close();
  }
}

export async function loadProject() {
  const project = await accessProject('readonly');
  return project === undefined ? null : validateProject(project);
}

export async function saveProject(project) {
  await accessProject('readwrite', validateProject(project));
}

async function accessStore(name, mode, key, value) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(name, mode);
      const store = transaction.objectStore(name);
      const request = mode === 'readonly' ? store.get(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error('Falha no armazenamento local.', { cause: transaction.error || request.error }));
    });
  } finally { db.close(); }
}

export async function storeImage(blob) {
  const src = `asset:${crypto.randomUUID()}`;
  await accessStore('assets', 'readwrite', src, blob);
  return src;
}

export async function imageBlob(src) {
  if (src.startsWith('asset:')) {
    const blob = await accessStore('assets', 'readonly', src);
    if (!(blob instanceof Blob)) throw new Error('A cópia local da imagem não foi encontrada.');
    return blob;
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error('Arquivo indisponível. Verifique se foi movido ou excluído.');
  return response.blob();
}

export async function externalizeProject(value, { commit = false } = {}) {
  const project = validateProject(value);
  const assets = [];
  for (const image of project.images) {
    if (image.src.startsWith('data:')) {
      const blob = await imageBlob(image.src);
      image.src = `asset:${crypto.randomUUID()}`;
      assets.push([image.src, blob]);
    }
  }
  if (!assets.length) return project;
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(commit ? ['assets', 'projects'] : ['assets'], 'readwrite');
      for (const [src, blob] of assets) transaction.objectStore('assets').put(blob, src);
      if (commit) transaction.objectStore('projects').put(project, 'current');
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(new Error('A migração não foi salva; o projeto anterior foi preservado.', { cause: transaction.error }));
    });
  } finally { db.close(); }
  return project;
}

export async function pruneImages(project) {
  const sources = new Set(project.images.map((image) => image.src));
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      const request = transaction.objectStore('assets').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!sources.has(cursor.key)) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(new Error('Não foi possível liberar cópias locais sem uso.', { cause: transaction.error }));
    });
  } finally { db.close(); }
}

export async function portableProject(value) {
  const project = validateProject(value);
  let bytes = 0;
  for (const image of project.images) {
    if (image.src !== './assets/demo-street.svg') {
      const blob = await imageBlob(image.src);
      bytes += Math.ceil(blob.size / 3) * 4;
      if (bytes > 128 * 1024 * 1024) throw new Error('JSON portátil limitado a 128 MiB de imagens. Use YOLO para datasets maiores.');
      image.src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler uma imagem para exportar.'));
        reader.readAsDataURL(blob);
      });
    }
  }
  return validateProject(project);
}

export const loadView = () => accessStore('settings', 'readonly', 'view');
export const saveView = (value) => accessStore('settings', 'readwrite', 'view', value);
