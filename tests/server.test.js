import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../scripts/serve.js';
import { readFile } from 'node:fs/promises';

test('versão exibida, manifesto e histórico permanecem consistentes', async () => {
  const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
  const manifest = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  const html = await read('index.html');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(/name="application-version" content="([^"]+)"/.exec(html)?.[1], manifest.version);
  assert.ok((await read('CHANGELOG.md')).includes('## ' + manifest.version));
});

test('a prévia serve a interface e mantém os arquivos do workspace privados', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Estúdio de anotação/);
    const script = await fetch(`${url}/src/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const exporter = await fetch(`${url}/src/export.js`);
    assert.equal(exporter.status, 200);
    assert.match(await exporter.text(), /export async function exportDataset/);
    for (const route of ['/package.json', '/.maestri/roles', '/node_modules/electron/index.js', '/..%5Cpackage.json', '/src/../package.json']) {
      assert.equal((await fetch(`${url}${route}`)).status, 404);
    }
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
