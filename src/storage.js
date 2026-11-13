import { validateProject } from './model.js';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB indisponível; abra o Anoint no Electron ou em um navegador compatível.'));
      return;
    }
    const request = indexedDB.open('anoint', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
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
