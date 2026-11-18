# Assistente MCP do Anoint

O chat fica no cliente MCP que você escolher. O Anoint não inclui modelo, assinatura ou chave de API. Use um agente com visão que consiga receber conteúdo de imagem nas ferramentas MCP. O servidor usa o SDK oficial TypeScript/JavaScript 2.4.0 por **stdio**; os testes verificam o cliente SDK 2.4.0 e o protocolo legado 2025-11-25. A compatibilidade da interface de configuração depende do cliente escolhido.

## Conectar

1. Instale Node.js 22.12+ e execute `npm ci` e `npm start` neste repositório.
2. Abra um projeto, importe as imagens e crie a classe que deseja identificar, por exemplo **Bola**.
3. Abra **Abrir assistente → Habilitar MCP**. Leia o aviso de compartilhamento.
4. Abra **Conexão MCP** e copie a configuração para o cliente MCP. Ela contém o caminho absoluto de `mcp/server.js`, a porta local e uma chave temporária. Se seu cliente recebe comando, argumentos e variáveis separadamente, use os mesmos valores.
5. Inicie a conversa no cliente. Um exemplo:

> Quero marcar bolas amarelas. Ignore reflexos e sombras. Proponha um plano para 12 imagens, usando as primeiras 3 para calibração e lotes de 3 depois. Leia o contexto do Anoint, liste as imagens e use a classe Bola. Aguarde minhas autorizações no aplicativo. Analise as imagens autorizadas e envie caixas em pixels naturais. Consulte minhas correções antes de continuar.

O agente deve consultar as ferramentas; colar uma descrição no chat por si só não executa inferência no Anoint. Não existe ferramenta para o agente se aprovar ou aplicar caixas finais.

O aplicativo precisa continuar aberto no projeto conectado. Fechar, recarregar, trocar de projeto ou desconectar revoga a conexão. Copie a nova configuração ao reconectar. Uma tarefa salva exige **Retomar e autorizar** antes de liberar imagens novamente. O navegador de prévia continua com edição manual; este MCP conecta ao aplicativo desktop.

## Calibrar e revisar

O agente envia um plano com descrição, classe, IDs exatos do escopo, número de amostras e tamanho do lote. Confira as imagens no painel e autorize. A calibração libera **uma imagem por vez**, até completar o número combinado.

As caixas pontilhadas com rótulo **Sugestão** ficam separadas das anotações finais. Abra a imagem no editor e volte ao assistente para aceitar, corrigir as medidas, adicionar uma caixa faltante, rejeitar explicando o erro ou confirmar ausência do alvo. As medidas do painel são pixels da imagem original. Salve a decisão de cada imagem e confirme a revisão. Somente caixas aceitas ou corrigidas são adicionadas, preservando as existentes; verifique possíveis sobreposições. Imagens alteradas voltam a pendentes. **Concluir imagem** continua sendo uma ação humana independente.

Você também pode desenhar as primeiras caixas manualmente e usar **Usar minhas caixas**. O botão usa apenas a classe alvo na próxima amostra. Ausência precisa de confirmação explícita e não é permitida se essa classe já tiver caixas na imagem. Rejeitar uma hipótese ou receber zero caixas não significa que o objeto esteja ausente.

Depois da calibração, autorize cada próximo lote. O agente recebe a descrição, os exemplos e as correções versionadas pelo `anoint_get_context`. Isso orienta a inferência seguinte; não treina pesos nem garante acurácia. O usuário pode mudar quantidades e critérios no chat, solicitando um novo plano. Autorizar um plano novo substitui a tarefa e os exemplos anteriores daquele projeto.

## Persistência, conflitos e Desfazer

Plano, sugestões, rascunhos de revisão, decisões e feedback ficam em um registro separado por projeto no IndexedDB. Aplicar caixas e registrar o feedback usa uma única transação. Uma falha preserva o projeto anterior e a proposta para nova tentativa. Chamadas repetidas com o mesmo ID e conteúdo não duplicam caixas.

Os rascunhos das sugestões são salvos automaticamente; alterar uma decisão salva exige **Salvar decisão** novamente antes de aplicar. A aplicação e os exemplos manuais entram no histórico de **Desfazer**, junto com a memória do agente. Desfazer/Refazer troca o identificador da tarefa; consulte o novo contexto e autorize a retomada antes de novas leituras. O histórico de Desfazer, como nas demais ferramentas, dura a sessão.

O painel mostra a etapa atual; **Conexão MCP**, **Histórico** e **Como funciona** ficam recolhidos. **Limpar histórico** oculta os registros atuais da lista, inclusive após reabrir o projeto. Preserva exemplos, calibração, decisões, recibos e caixas; novos registros aparecem normalmente. Essa preferência acompanha a memória nos backups e no Desfazer. O chat externo não é alterado.

O Anoint responde às chamadas do agente e entrega feedback confirmado por `anoint_get_context`. Esta integração não inicia turnos nem envia mensagens espontâneas ao chat externo: o cliente controla quando executar o modelo. Isso mantém o chat no agente escolhido, sem configurar um provedor de modelo dentro do Anoint. Não é uma restrição geral do MCP; iniciar trabalho a partir do aplicativo exigiria uma integração própria com o cliente ou provedor.

Uma edição manual posterior à proposta impede a aplicação das caixas daquela imagem. Descarte o lote e peça outra proposta. Alterar exemplos já usados na calibração exige recalibrar com um novo plano. O agente nunca sobrescreve caixas manualmente nem remove arquivos ou classes.

Descartar um lote consome seu ID: uma resposta atrasada ou um retry não traz a mesma proposta de volta. O agente precisa usar um novo `requestId`. Rascunhos e decisões intermediárias não são compartilhados pelo contexto MCP; somente a revisão confirmada produz feedback para o agente.

O JSON portátil inclui um campo opcional `assistant` com tarefa, decisões e feedback. A cópia preserva os IDs e adapta as revisões quando somente a referência da imagem muda no transporte. Conflitos que já existiam continuam bloqueados. YOLO exporta apenas as caixas finais de `annotations`; sugestões e feedback ficam fora do dataset.

## Ferramentas

| Ferramenta | Uso |
| --- | --- |
| `anoint_get_context` | Projeto, classes, tarefa, imagens liberadas e feedback; sem caminhos locais. |
| `anoint_list_images` | Metadados paginados; `offset` e `limit` (máximo 100). |
| `anoint_get_image` | Uma imagem autorizada em JPEG, com dimensões, escalas e revisão. |
| `anoint_propose_task` | `requestId`, `description`, `labelId`, `calibrationCount`, `batchSize`, `imageIds`. Aguarda autorização humana. |
| `anoint_submit_proposal` | `requestId`, `taskId`, `frames` com `imageId`, `revision` e `boxes` (`x`, `y`, `width`, `height`); `message` opcional. Aguarda revisão humana. |

Envie exatamente os IDs liberados naquela rodada. `boxes: []` representa uma hipótese sem detecções, que ainda precisa de revisão humana. IDs de requisição não podem ser reutilizados com conteúdo diferente. Propostas com revisão antiga, geometrias inválidas ou fora do escopo são recusadas.

## Limites e privacidade

- Uma tarefa ativa por projeto; um lote pendente. Calibração e lote: 1–100 imagens; escopo: até 10.000. Até 1.000 sugestões por imagem e corpo de chamada de 1 MiB. Lotes muito densos devem ser menores. As quotas finais do projeto continuam válidas.
- Memória de até 8 MiB: até 100 exemplos de calibração, últimos 100 feedbacks de lote e últimos 100 recibos; progresso completo do escopo é preservado.
- O preview enviado é rasterizado sem EXIF, com lado máximo de 4.096 pixels. Use `scaleX`/`scaleY` para converter o preview para pixels naturais. Objetos pequenos podem sumir nessa redução; não conclua ausência por isso. GIF é recusado: importe um frame estático. Não há extração de frames de vídeo.
- A ponte privada usa HTTP somente em `127.0.0.1`, porta temporária, Bearer aleatório, Host exato e rejeição de Origin. A ponte não é um servidor MCP remoto nem OAuth. O MCP usa stdio e lê a configuração pelo ambiente. A rede do renderer continua bloqueada.
- Nomes, classes e anotações são liberados ao habilitar a conexão. Pixels são liberados apenas depois da autorização do plano/escopo. O cliente ou provedor externo pode receber essas imagens na nuvem. Localhost não garante inferência local.
- A chave temporária protege a conexão; não compartilhe a configuração. Não é uma barreira contra programas maliciosos rodando como o mesmo usuário. Não há ferramentas de shell, arquivo arbitrário, URL externa, exclusão ou aprovação remota.
- A execução pelo repositório exige Node instalado. Um instalador com runtime embutido não faz parte desta entrega.

## Validação

`npm test` verifica domínio, cotas, revisões, fases, retries, schemas, IPC e ponte HTTP/stdio com SDK real. `npm run test:agent` executa Electron com perfil e imagens temporários: autorização, imagem raster, correção, falha/abort e retry atômico, lote misto, Desfazer, JSON e retomada. Os testes não usam o perfil ou arquivos originais do usuário.
