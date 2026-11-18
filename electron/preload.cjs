const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anointFiles', Object.freeze({
  pick: folder => ipcRenderer.invoke('anoint-files:pick', folder),
  trash: source => ipcRenderer.invoke('anoint-files:trash', source),
  available: sources => ipcRenderer.invoke('anoint-files:available', sources),
}));

contextBridge.exposeInMainWorld('anointAgent', Object.freeze({
  connect: () => ipcRenderer.invoke('anoint-agent:connect'),
  disconnect: () => ipcRenderer.invoke('anoint-agent:disconnect'),
  onRequest: handler => {
    ipcRenderer.on('anoint-agent:request', (_event, request) => {
      Promise.resolve().then(() => handler(request.name, request.args)).then(
        result => ipcRenderer.send('anoint-agent:reply', { id: request.id, result }),
        error => ipcRenderer.send('anoint-agent:reply', { id: request.id, error: error?.message || 'Falha no editor.' }),
      );
    });
  },
}));
