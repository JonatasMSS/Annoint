import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../scripts/serve.js';

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
    for (const route of ['/package.json', '/.maestri/roles', '/node_modules/electron/index.js', '/..%5Cpackage.json', '/src/../package.json']) {
      assert.equal((await fetch(`${url}${route}`)).status, 404);
    }
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
