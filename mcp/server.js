import { McpServer, inputRequired, inputResponse, acceptedContent, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { pathToFileURL } from 'node:url';

const id = z.string().min(1).max(200);
const confirmation = z.strictObject({ id, answer: z.string().min(1).max(2000) }).optional();
const confirmationModes = z.enum(['chat', 'native'], { error: 'ANOINT_CONFIRMATION_MODE deve ser chat ou native.' });
const box = z.strictObject({
  x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
});
const definitions = [
  ['anoint_get_context', 'Lê o contexto e feedback do projeto autorizado.', z.strictObject({}), true],
  ['anoint_list_images', 'Lista imagens do projeto autorizado, sem ler arquivos externos.', z.strictObject({
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20),
  }), true],
  ['anoint_get_image', 'Lê uma imagem autorizada: source original ou review com sugestões.', z.strictObject({
    imageId: id, view: z.enum(['source', 'review']).optional(),
  }), true],
  ['anoint_propose_task', 'Propõe uma tarefa de calibração para revisão no chat externo.', z.strictObject({
    requestId: id, description: z.string().min(1).max(2000), labelId: id,
    calibrationCount: z.number().int().min(1).max(100), batchSize: z.number().int().min(1).max(100).describe('Imagens por rodada, tanto na calibração quanto nos lotes seguintes; use mais de 1 para revisão conjunta.'),
    imageIds: z.array(id).min(1).max(10000).refine(ids => new Set(ids).size === ids.length, 'IDs de imagens duplicados.'),
  }), false],
  ['anoint_submit_proposal', 'Envia em uma chamada as sugestões de todas as imagens liberadas na rodada, inclusive na calibração, sem aplicá-las.', z.strictObject({
    requestId: id, taskId: id,
    frames: z.array(z.strictObject({
      imageId: id, revision: id, boxes: z.array(box).max(1000),
    })).min(1).max(100),
    message: z.string().max(2000).optional(),
  }), false],
  ['anoint_control_task', 'Controla plano, lotes, retomada, cancelamento, descarte e limpeza de histórico.', z.strictObject({
    action: z.enum(['plan', 'batch', 'resume', 'cancel', 'discard', 'clear_history']),
    taskId: id.optional(), requestId: id.optional(), confirmation,
  }), false],
  ['anoint_review', 'Revisa todas as imagens da proposta em uma chamada, com decisões diferentes por imagem e uma confirmação explícita para aplicar o conjunto.', z.strictObject({
    taskId: id, requestId: id,
    decisions: z.array(z.strictObject({
      imageId: id, decision: z.enum(['accepted', 'corrected', 'rejected', 'absent', 'manual']),
      note: z.string().max(2000).default(''), boxes: z.array(box).max(1000).optional(), revision: id.optional(),
    })).min(1).max(100), confirmation,
  }), false],
  ['anoint_manual_example', 'Usa anotação manual ou ausência explícita como exemplo de calibração.', z.strictObject({
    taskId: id, imageId: id, revision: id, note: z.string().max(2000).default(''), absent: z.boolean().default(false), confirmation,
  }), false],
  ['anoint_create_class', 'Cria uma classe no projeto autorizado.', z.strictObject({
    id, name: z.string().trim().min(1).max(200), color: z.string().regex(/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i),
  }), false],
  ['anoint_update_class', 'Renomeia uma classe existente.', z.strictObject({ id, name: z.string().trim().min(1).max(200) }), false],
  ['anoint_remove_class', 'Remove uma classe com confirmação extra e destino para suas caixas quando necessário.', z.strictObject({
    id, replacementId: id.optional(), confirmation,
  }), false],
];

const checkpoint = z.strictObject({ id, message: z.string().min(1).max(8000), phrase: z.string().min(1).max(2000), extra: z.boolean() });
const nativeAnswer = extra => extra ? z.strictObject({ answer: z.string().max(2000) }) : z.strictObject({ confirm: z.boolean() });
const asResult = result => result && typeof result === 'object' && Object.hasOwn(result, 'content')
  ? result : { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };

export function createServer(call, { confirmationMode = 'chat' } = {}) {
  if (typeof call !== 'function') throw new TypeError('Call inválido.');
  const useNative = confirmationModes.parse(confirmationMode) === 'native';
  const server = new McpServer({ name: 'anoint', version: '1.0.0' }, {
    instructions: 'Todo o fluxo ocorre neste chat. Por padrão, confirmações são feitas pelo chat, mesmo se o cliente declarar elicitation; formulários nativos dependem da configuração explícita ANOINT_CONFIRMATION_MODE=native. Se uma tool retornar confirmation_required, mostre o pedido e a frase ao usuário e aguarde resposta explícita antes de repetir a mesma chamada com confirmation:{id,answer}. Não invente aceite nem alegue comprovação humana: a confirmação no chat é delegada ao agente. Recusa ou cancelamento não autorizam execução.',
  });
  const pending = new Map();
  const formSupported = ctx => {
    if (!useNative) return false;
    const capabilities = ctx.mcpReq.envelope
      ? ctx.mcpReq.envelope[CLIENT_CAPABILITIES_META_KEY] : server.server.getClientCapabilities();
    const elicitation = capabilities?.elicitation;
    return !!elicitation && (elicitation.form !== undefined || Object.keys(elicitation).length === 0);
  };
  const prompt = (name, args, result) => {
    const challenge = checkpoint.parse(result.confirmation);
    if (pending.size >= 100) throw new Error('Há muitas confirmações pendentes. Aguarde ou tente novamente após expirarem.');
    const nonce = randomBytes(32).toString('hex');
    pending.set(nonce, { name, args: structuredClone(args), challenge, expiresAt: Date.now() + 600000 });
    return inputRequired({
      requestState: nonce,
      inputRequests: { confirm: inputRequired.elicit({
        mode: 'form', message: challenge.extra ? `${challenge.message}\nDigite exatamente: ${challenge.phrase}` : challenge.message,
        requestedSchema: challenge.extra
          ? { type: 'object', properties: { answer: { type: 'string', maxLength: 2000 } }, required: ['answer'] }
          : { type: 'object', properties: { confirm: { type: 'boolean', default: false } }, required: ['confirm'] },
      }) },
    });
  };
  for (const [name, description, inputSchema, readOnlyHint] of definitions) {
    server.registerTool(name, {
      description, inputSchema, annotations: { readOnlyHint, destructiveHint: name === 'anoint_remove_class' || name === 'anoint_control_task' },
    }, async (args, ctx) => {
      for (const [nonce, entry] of pending) if (entry.expiresAt <= Date.now()) pending.delete(nonce);
      const state = ctx.mcpReq.requestState();
      let result;
      if (state !== undefined) {
        const entry = pending.get(state);
        if (!entry || entry.name !== name || JSON.stringify(entry.args) !== JSON.stringify(args)) {
          throw new Error('Confirmação expirada, consumida ou associada a outra chamada.');
        }
        pending.delete(state);
        const response = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
        if (response.kind !== 'elicit') return asResult({ status: 'confirmation_invalid' });
        if (response.action !== 'accept') return asResult({ status: response.action === 'cancel' ? 'cancelled' : 'declined' });
        const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', nativeAnswer(entry.challenge.extra));
        if (!answer) return asResult({ status: 'confirmation_invalid' });
        if (entry.challenge.extra ? answer.answer !== entry.challenge.phrase : answer.confirm !== true) {
          return asResult({ status: 'declined' });
        }
        result = await call(name, { ...args, confirmation: { id: entry.challenge.id, answer: entry.challenge.phrase } });
      } else {
        if (ctx.mcpReq.inputResponses) throw new Error('Resposta de confirmação sem pedido correspondente.');
        const forwarded = { ...args };
        if (formSupported(ctx)) delete forwarded.confirmation;
        result = await call(name, forwarded);
      }
      if (result?.status === 'confirmation_required') {
        checkpoint.parse(result.confirmation);
        return formSupported(ctx) ? prompt(name, args, result) : asResult(result);
      }
      return asResult(result);
    });
  }
  return server;
}

function validateEndpoint(url, token) {
  const match = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(url);
  if (!match || Number(match[1]) > 65535) throw new Error('ANOINT_URL deve ser http://127.0.0.1:porta.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('ANOINT_TOKEN deve conter 64 caracteres hexadecimais.');
  return { url: url.replace(/\/$/, ''), token };
}

function readConfigEndpoint() {
  try {
    const raw = readFileSync(join(homedir(), '.gemini', 'config', 'mcp_config.json'), 'utf8');
    const env = JSON.parse(raw)?.mcpServers?.anoint?.env;
    return validateEndpoint(env?.ANOINT_URL, env?.ANOINT_TOKEN);
  } catch {
    return null;
  }
}

function bridgeCall(url, token) {
  let current = validateEndpoint(url, token);
  const invoke = async ({ url: baseUrl, token: authToken }, name, args) => {
    const response = await fetch(`${baseUrl}/call`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    const body = await response.json();
    if (!response.ok || Object.hasOwn(body, 'error')) throw new Error(typeof body.error === 'string' ? body.error : 'Falha na ponte do Anoint.');
    if (!Object.hasOwn(body, 'result')) throw new Error('Resposta inválida da ponte.');
    return body.result;
  };
  return async (name, args) => {
    try {
      return await invoke(current, name, args);
    } catch (error) {
      const fallback = readConfigEndpoint();
      if (fallback && (fallback.url !== current.url || fallback.token !== current.token)) {
        const result = await invoke(fallback, name, args);
        current = fallback;
        return result;
      }
      throw error;
    }
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const call = bridgeCall(process.env.ANOINT_URL, process.env.ANOINT_TOKEN);
    const confirmationMode = confirmationModes.parse(process.env.ANOINT_CONFIRMATION_MODE ?? 'chat');
    await serveStdio(() => createServer(call, { confirmationMode }), { onerror: error => console.error(error.message) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
