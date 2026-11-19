const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// O MCP dos testes não deve consultar configurações reais do cliente após uma falha.
module.exports = serverArgs => {
  const home = join(tmpdir(), 'anoint-mcp-unconfigured-' + randomUUID());
  const setup = `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => ${JSON.stringify(home)}; syncBuiltinESMExports();`;
  return ['--import', 'data:text/javascript,' + encodeURIComponent(setup), ...serverArgs];
};
