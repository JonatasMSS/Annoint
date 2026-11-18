import { validateProject } from './model.js';
import { validateAssistant, imageRevision } from './assistant.js';

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

function projectId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('ID de projeto inválido.');
  return id;
}

async function projectTransaction(names, mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(names, mode);
      let result;
      let failure;
      const run = (callback) => {
        try { callback(); }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || new Error('Não foi possível salvar no banco local. Verifique o espaço disponível.', { cause: transaction.error }));
      run(() => operation(transaction, (value) => { result = value; }, run));
    });
  } finally { db.close(); }
}

export async function initializeProjects(demo) {
  const fallback = validateProject(demo);
  await projectTransaction(['projects', 'settings'], 'readwrite', (transaction, result, run) => {
    const store = transaction.objectStore('projects');
    const settings = transaction.objectStore('settings');
    const request = store.getAll();
    const legacy = store.get('current');
    const marker = settings.get('legacyProjectId');
    const view = settings.get('view');
    view.onsuccess = () => run(() => {
      if (legacy.result !== undefined && !marker.result) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        store.add({ id, name: 'Meu primeiro projeto', createdAt: now, updatedAt: now, project: validateProject(legacy.result) }, id);
        if (view.result !== undefined) settings.put(view.result, `view:${id}`);
        settings.put(id, 'legacyProjectId');
      } else if (!request.result.length) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        store.add({ id, name: 'Projeto de exemplo', createdAt: now, updatedAt: now, project: fallback }, id);
      }
      // O registro current permanece como cópia de segurança da migração.
    });
  });
}

export async function listProjects() {
  return projectTransaction(['projects'], 'readonly', (transaction, result, run) => {
    const request = transaction.objectStore('projects').openCursor();
    const records = [];
    request.onsuccess = () => run(() => {
      const cursor = request.result;
      if (!cursor) { result(records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); return; }
      if (cursor.key !== 'current') {
        const record = cursor.value;
        projectId(record.id);
        if (record.id !== cursor.key || typeof record.name !== 'string' || !record.name.trim() || typeof record.updatedAt !== 'string') throw new Error('Metadados locais inválidos. Os projetos foram preservados.');
        validateProject(record.project);
        records.push({ id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt,
          imageCount: record.project.images.length, completedCount: record.project.images.filter((image) => image.reviewed).length });
      }
      cursor.continue();
    });
  });
}

export async function loadProject(id) {
  projectId(id);
  const record = await accessStore('projects', 'readonly', id);
  return record === undefined ? null : validateProject(record.project);
}

export async function saveProject(id, value, assistant) {
  projectId(id);
  const project = validateProject(value);
  const memory = assistant === undefined ? undefined : validateAssistant(assistant);
  await projectTransaction(memory ? ['projects', 'settings'] : ['projects'], 'readwrite', (transaction, result, run) => {
    const store = transaction.objectStore('projects');
    const request = store.get(id);
    request.onsuccess = () => run(() => {
      if (!request.result) throw new Error('Projeto local não encontrado.');
      store.put({ ...request.result, project, updatedAt: new Date().toISOString() }, id);
      if (memory) transaction.objectStore('settings').put(memory, `assistant:${id}`);
    });
  });
}

export async function createLocalProject(name, value, assistant) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw new Error('Informe um nome com até 200 caracteres.');
  const { project, assets } = await prepareProject(value);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record = { id, name: name.trim(), createdAt: now, updatedAt: now, project };
  const memory = assistant === undefined ? undefined : await relocateAssistant(assistant, value, project);
  await projectTransaction(memory ? ['projects', 'assets', 'settings'] : ['projects', 'assets'], 'readwrite', (transaction) => {
    for (const [src, blob] of assets) transaction.objectStore('assets').add(blob, src);
    transaction.objectStore('projects').add(record, id);
    if (memory) transaction.objectStore('settings').add(memory, `assistant:${id}`);
  });
  return record;
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

async function prepareProject(value) {
  const project = validateProject(value);
  const assets = [];
  for (const image of project.images) {
    if (image.src.startsWith('data:')) {
      const blob = await imageBlob(image.src);
      image.src = `asset:${crypto.randomUUID()}`;
      assets.push([image.src, blob]);
    }
  }
  return { project, assets };
}

export async function externalizeProject(value) {
  const { project, assets } = await prepareProject(value);
  if (assets.length) await projectTransaction(['assets'], 'readwrite', (transaction) => {
    for (const [src, blob] of assets) transaction.objectStore('assets').add(blob, src);
  });
  return project;
}

export async function pruneImages(retainedProjects = []) {
  const sources = new Set(retainedProjects.flatMap((project) => project.images.map((image) => image.src)));
  await projectTransaction(['projects', 'assets'], 'readwrite', (transaction, result, run) => {
    const projects = transaction.objectStore('projects').getAll();
    projects.onsuccess = () => run(() => {
      for (const record of projects.result) for (const image of validateProject(record.project || record).images) sources.add(image.src);
      const request = transaction.objectStore('assets').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!sources.has(cursor.key)) cursor.delete();
        cursor.continue();
      };
    });
  });
}

export async function portableProject(value, assistant) {
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
  const result = validateProject(project);
  if (assistant === undefined) return result;
  const memory = await relocateAssistant(assistant, value, result);
  return memory.task || memory.plan ? { ...result, assistant: memory } : result;
}

async function relocateAssistant(value, before, after) {
  const memory = validateAssistant(value);
  for (const frame of memory.pending?.frames || []) {
    const original = before.images.find(image => image.id === frame.imageId);
    const relocated = after.images.find(image => image.id === frame.imageId);
    // A cópia portátil muda somente a origem; conflitos anteriores continuam conflitos.
    if (original && relocated && frame.revision === await imageRevision(before, original)) frame.revision = await imageRevision(after, relocated);
  }
  return memory;
}

export const loadView = (id) => accessStore('settings', 'readonly', `view:${projectId(id)}`);
export const saveView = (id, value) => accessStore('settings', 'readwrite', `view:${projectId(id)}`, value);
export const loadAssistant = async id => validateAssistant(await accessStore('settings', 'readonly', `assistant:${projectId(id)}`));
