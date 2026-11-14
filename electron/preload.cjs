const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anointFiles', Object.freeze({
  pick: folder => ipcRenderer.invoke('anoint-files:pick', folder),
  trash: source => ipcRenderer.invoke('anoint-files:trash', source),
  available: sources => ipcRenderer.invoke('anoint-files:available', sources),
}));
