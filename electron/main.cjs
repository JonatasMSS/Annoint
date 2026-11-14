const electron = require('electron');
const { app, BrowserWindow, dialog, session, protocol } = electron;
const { registerImageScheme, registerNativeFiles } = require('./native-files.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let fileBackend;
let mainWindow;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 760,
    title: 'Anoint',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = undefined;
    fileBackend.close();
    if (process.platform !== 'darwin') app.quit();
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    win.webContents.on(event, (event) => event.preventDefault());
  }
  win.loadFile(path.join(__dirname, '..', 'index.html')).catch((error) => {
    dialog.showErrorBox('Não foi possível abrir o Anoint', error.message);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerImageScheme(protocol);

  app.on('second-instance', () => {
    const win = mainWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    fileBackend = await registerNativeFiles(electron, app.getPath('userData'), pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setDevicePermissionHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  }).catch((error) => {
    dialog.showErrorBox('Falha ao iniciar o Anoint', error.message);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
