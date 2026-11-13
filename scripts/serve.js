import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...['app', 'model', 'storage'].map((name) => [`/src/${name}.js`, [`src/${name}.js`, 'text/javascript; charset=utf-8']]),
  ['/src/styles.css', ['src/styles.css', 'text/css; charset=utf-8']],
  ['/assets/demo-street.svg', ['assets/demo-street.svg', 'image/svg+xml']],
]);

export const server = http.createServer(async (request, response) => {
  const file = files.get(request.url.split('?')[0]);
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Não encontrado');
    return;
  }
  try {
    const content = await readFile(new URL(file[0], root));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500).end('Não foi possível ler o arquivo.');
  }
});

if (typeof process !== 'undefined' && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  server.on('error', (error) => { console.error(`Não foi possível abrir a prévia: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Anoint: http://127.0.0.1:${server.address().port}`));
}
