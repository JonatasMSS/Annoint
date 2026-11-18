const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { startAgentBridge } = require('../mcp/bridge.cjs');

function registerAgent(api, indexUrl) {
  let connection;
  let connecting = false;
  let generation = 0;
  const pending = new Map();
  const trusted = event => {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed() || !api.BrowserWindow.fromWebContents(sender)
      || event.senderFrame !== sender.mainFrame || event.senderFrame.url !== indexUrl) throw new Error('Remetente não autorizado.');
    return sender;
  };
  const close = async () => {
    generation += 1;
    const old = connection;
    connection = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('APP_UNAVAILABLE: conexão encerrada.')); }
    pending.clear();
    if (old) await old.bridge.close();
  };
  api.ipcMain.handle('anoint-agent:connect', async event => {
    const owner = trusted(event);
    if (connecting) throw new Error('Conexão em andamento.');
    connecting = true;
    try {
      await close();
      const startedAt = generation;
      const bridge = await startAgentBridge((name, args) => new Promise((resolve, reject) => {
        if (connection?.owner !== owner || owner.isDestroyed()) return reject(new Error('APP_UNAVAILABLE: abra o projeto novamente.'));
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('APP_UNAVAILABLE: editor não respondeu.')); }, 25000);
        pending.set(id, { resolve, reject, timer, owner });
        owner.send('anoint-agent:request', { id, name, args });
      }));
      if (generation !== startedAt || owner.isDestroyed()) { await bridge.close(); throw new Error('Conexão interrompida.'); }
      connection = { owner, bridge };
      return { mcpServers: { anoint: {
        command: 'node', args: [path.resolve(__dirname, '../mcp/server.js')],
        env: { ANOINT_URL: bridge.url, ANOINT_TOKEN: bridge.token },
      } } };
    } finally { connecting = false; }
  });
  api.ipcMain.handle('anoint-agent:disconnect', async event => {
    const owner = trusted(event);
    if (connection?.owner === owner || connecting) await close();
  });
  api.ipcMain.on('anoint-agent:reply', (event, reply) => {
    let owner;
    try { owner = trusted(event); } catch { return; }
    if (!reply || typeof reply.id !== 'string') return;
    const request = pending.get(reply.id);
    if (!request || request.owner !== owner) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if (typeof reply.error === 'string') request.reject(new Error(reply.error.slice(0, 2000)));
    else request.resolve(reply.result);
  });
  return { close };
}

module.exports = { registerAgent };
