const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const tools = new Set([
  'anoint_get_context', 'anoint_list_images', 'anoint_get_image',
  'anoint_propose_task', 'anoint_submit_proposal',
]);

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function readBody(request, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(failure(400, 'JSON inválido.')); }
      }
    };
    const data = chunk => {
      size += chunk.length;
      if (size > maxBytes) finish(failure(413, 'Corpo acima do limite.'));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = error => finish(error);
    const aborted = () => finish(failure(408, 'Leitura interrompida.'));
    request.on('data', data);
    request.once('end', end);
    request.once('error', fail);
    request.once('aborted', aborted);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function startAgentBridge(dispatch, { timeoutMs = 30000, maxBytes = 1048576 } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('Dispatch inválido.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Limites inválidos.');
  const token = randomBytes(32).toString('hex');
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  const active = new Set();
  let closing = false;
  let closePromise;
  let host;

  const send = (response, status, body) => {
    if (response.destroyed || response.writableEnded) return;
    const json = JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close',
    });
    response.end(json);
  };

  const server = http.createServer((request, response) => {
    const deny = (status, error) => send(response, status, { error });
    if (closing) return deny(503, 'Ponte encerrada.');
    if (request.headers.host !== host) return deny(403, 'Host não autorizado.');
    if (Object.hasOwn(request.headers, 'origin')) return deny(403, 'Origin não permitido.');
    const auth = Buffer.from(request.headers.authorization || '');
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) return deny(401, 'Token inválido.');
    if (request.url !== '/call') return deny(404, 'Rota não encontrada.');
    if (request.method !== 'POST') return deny(405, 'Use POST.');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return deny(415, 'Use application/json.');
    if (active.size >= 8) return deny(429, 'Máximo de oito chamadas em andamento.');
    if (Number(request.headers['content-length']) > maxBytes) return deny(413, 'Corpo acima do limite.');
    const controller = new AbortController();
    const pending = { response, controller };
    active.add(pending);
    const timer = setTimeout(() => {
      deny(504, 'Tempo esgotado.');
      controller.abort();
    }, timeoutMs);
    pending.timer = timer;
    (async () => {
      const body = await readBody(request, maxBytes, controller.signal);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => key !== 'name' && key !== 'args')
        || !tools.has(body.name) || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) {
        throw failure(400, 'Ferramenta ou argumentos inválidos.');
      }
      if (!controller.signal.aborted) {
        const result = await dispatch(body.name, body.args);
        send(response, 200, { result: result ?? null });
      }
    })().catch(error => {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      deny(status, error?.message || 'Falha na ponte.');
    }).finally(() => {
      clearTimeout(timer);
      // shortcut: dispatch sem cancelamento mantém vaga até terminar; usar AbortSignal quando o domínio suportar.
      active.delete(pending);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  return {
    url: `http://${host}`,
    token,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const { response, controller, timer } of active) {
        clearTimeout(timer);
        send(response, 503, { error: 'Ponte encerrada.' });
        controller.abort();
      }
      closePromise = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      return closePromise;
    },
  };
}

module.exports = { startAgentBridge };
