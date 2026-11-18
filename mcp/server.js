import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';

const id = z.string().min(1);
const box = z.strictObject({
  x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
});
const definitions = [
  ['anoint_get_context', 'Lê o contexto e feedback do projeto autorizado.', z.strictObject({}), true],
  ['anoint_list_images', 'Lista imagens do projeto autorizado, sem ler arquivos externos.', z.strictObject({
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20),
  }), true],
  ['anoint_get_image', 'Lê uma imagem autorizada para análise visual.', z.strictObject({ imageId: id }), true],
  ['anoint_propose_task', 'Propõe uma tarefa de calibração para aprovação humana no Anoint.', z.strictObject({
    requestId: id, description: z.string().min(1).max(2000), labelId: id,
    calibrationCount: z.number().int().min(1).max(100), batchSize: z.number().int().min(1).max(100),
    imageIds: z.array(id).min(1).max(10000).refine(ids => new Set(ids).size === ids.length, 'IDs de imagens duplicados.'),
  }), false],
  ['anoint_submit_proposal', 'Envia sugestões de caixas; somente o usuário pode aprová-las no Anoint.', z.strictObject({
    requestId: id, taskId: id,
    frames: z.array(z.strictObject({
      imageId: id, revision: z.string(), boxes: z.array(box).max(1000),
    })).min(1).max(100),
    message: z.string().max(2000).optional(),
  }), false],
];

export function createServer(call) {
  if (typeof call !== 'function') throw new TypeError('Call inválido.');
  const server = new McpServer({ name: 'anoint', version: '1.0.0' });
  for (const [name, description, inputSchema, readOnlyHint] of definitions) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: false } }, async args => {
      const result = await call(name, args);
      if (result && typeof result === 'object' && Object.hasOwn(result, 'content')) return result;
      return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
    });
  }
  return server;
}

function bridgeCall(url, token) {
  const match = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(url);
  if (!match || Number(match[1]) > 65535) throw new Error('ANOINT_URL deve ser http://127.0.0.1:porta.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('ANOINT_TOKEN deve conter 64 caracteres hexadecimais.');
  return async (name, args) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/call`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    const body = await response.json();
    if (!response.ok || Object.hasOwn(body, 'error')) throw new Error(typeof body.error === 'string' ? body.error : 'Falha na ponte do Anoint.');
    if (!Object.hasOwn(body, 'result')) throw new Error('Resposta inválida da ponte.');
    return body.result;
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const call = bridgeCall(process.env.ANOINT_URL, process.env.ANOINT_TOKEN);
    await serveStdio(() => createServer(call), { onerror: error => console.error(error.message) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
