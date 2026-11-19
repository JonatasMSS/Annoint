# Assistente MCP do Anoint

O **chat externo conduz todo o trabalho**: instruções, classes, plano, permissões, exemplos, avaliação e aplicação das caixas. No Anoint você obtém a conexão e usa o editor quando quiser corrigir algo manualmente. Não há chat, aprovação de lote ou formulário de revisão no aplicativo.

## Conectar uma vez

1. Instale Node.js 22.12+ e execute `npm ci` e `npm start`.
2. Abra o projeto e importe as imagens que deseja anotar.
3. Abra **Conexão MCP → Habilitar MCP**, copie a configuração e configure seu cliente MCP. Ela contém uma chave privada temporária; não a compartilhe.
4. Continue no chat de um agente com visão e suporte a imagens MCP. Por exemplo:

> Quero marcar bolas amarelas. Crie a classe Bola se necessário. Proponha um plano para estas 12 imagens, com 3 de calibração e lotes de 3. Analise as 3 imagens de cada rodada juntas, mostre as sugestões aqui e peça uma confirmação para revisar o conjunto, permitindo aceitar umas e rejeitar outras. Se eu ajustar no editor e disser “este é o correto”, use as caixas atuais como exemplo. Para remover uma classe, peça uma confirmação adicional.

O agente pode criar classes e renomeá-las preservando IDs e caixas. A conexão disponibiliza metadados e essas operações; **não autoriza automaticamente as imagens nem a aplicação de propostas**. Antes de liberar pixels, o chat apresenta projeto, alvo, classe, escopo, calibração e lote, incluindo o possível envio das imagens ao provedor externo, inclusive na nuvem.

O aplicativo precisa permanecer aberto no projeto conectado. Fechar, recarregar, trocar de projeto ou desconectar revoga a chave. Após reconectar, copie a nova configuração e peça **retomar** no chat. Tarefa, exemplos e propostas persistem; o compartilhamento exige nova autorização.

Para renovar uma conexão com problema, use **Conexão MCP → Resetar conexão MCP**. A ponte é reiniciada com outra chave, a configuração anterior é revogada e as confirmações da conexão antiga são descartadas. O projeto, as anotações, a calibração, o feedback e as propostas continuam salvos. Copie a nova configuração para o cliente, reinicie o MCP nele e peça **retomar** no chat; o acesso às imagens exige nova autorização. Se a reconexão falhar, o painel mostra o erro e permite habilitar o MCP novamente.

## Confirmações no cliente

Por padrão, as confirmações acontecem **pelo chat**, mesmo quando o cliente anuncia suporte a **MCP form elicitation**. Alguns clientes anunciam essa capacidade, mas cancelam formulários automaticamente; declarar a capacidade não garante que a pergunta chegará ao usuário. A configuração copiada pelo Anoint inclui `ANOINT_CONFIRMATION_MODE: "chat"` em `env`. Configurações antigas sem esse campo também usam o chat ao reiniciar o processo MCP com o servidor atualizado.

A ferramenta devolve `confirmation_required`, com mensagem, ID temporário e frase. O agente deve apresentar a pergunta no chat, esperar uma resposta explícita e só então repetir a mesma operação com `confirmation: {id, answer}`. **Nesse modo a confirmação é delegada ao agente: o servidor não autentica quem escreveu a resposta no chat.** Não existe comprovação criptográfica de participação humana; use um cliente confiável. O fluxo não manda o usuário voltar ao Anoint para aprovar.

Para clientes com formulários funcionais, é possível optar por `ANOINT_CONFIRMATION_MODE: "native"` em `env` e reiniciar o processo MCP. Nesse modo, o servidor usa o formulário se o cliente declarar suporte; sem suporte, mantém a confirmação pelo chat. Recusa, cancelamento, resposta inválida ou ausência de resposta não executam a operação nem mudam automaticamente para o chat. Se esse cliente cancela formulários automaticamente, escolha `"chat"` na configuração e reinicie o processo MCP. Valores diferentes de `chat`/`native` impedem a inicialização, em vez de mudar o canal silenciosamente.

Aprovar um lote para geração é separado de aprovar suas caixas finais. A espera não bloqueia o editor nem mantém requisição HTTP aberta.

Cada confirmação é vinculada à conexão, ao projeto, à ação, aos argumentos e à revisão. Alterar o projeto antes de confirmar exige ler o contexto e pedir nova confirmação. Respostas concluídas podem ser repetidas sem reaplicar efeitos enquanto o recibo estiver disponível na sessão.

Para **remover classe**, há duas etapas: primeiro o impacto (quantas caixas/imagens e para qual classe transferir); depois uma confirmação extra com a frase exata **REMOVER Nome da classe**. A primeira resposta nunca remove a classe. A última classe é protegida; classes usadas exigem destino válido e preservam a geometria das caixas. Remover a classe alvo cancela sua tarefa. As escritas entram no Desfazer do editor.

## Revisar e corrigir no chat

O agente envia propostas separadas das anotações finais. `get_image` com `view: "review"` devolve uma prévia para exibir no chat: sugestões pontilhadas e numeradas, anotações existentes contínuas. Somente decisões confirmadas em `review` adicionam caixas. É possível aceitar, corrigir coordenadas, rejeitar explicando o erro ou confirmar ausência do alvo. Rejeitar uma caixa ou receber zero sugestões **não** confirma ausência.

A calibração e os lotes seguintes aceitam várias imagens por rodada: `batchSize` define o tamanho do conjunto, de 1 a 100 imagens. Por exemplo, 6 imagens de calibração com lotes de 3 são analisadas em duas rodadas de 3. O agente envia as caixas de todas as imagens liberadas em uma chamada `submit_proposal`; você vê as prévias, indica quais ficaram boas ou ruins e confirma o conjunto em uma chamada `review`, com decisões diferentes por imagem. Essa confirmação aplica apenas as caixas aceitas/corrigidas e salva as rejeições/ausências como feedback; não exige uma confirmação por foto. Uma proposta já pendente de uma versão anterior mantém seu conjunto até ser revisada ou descartada. Depois da calibração, cada novo lote precisa de autorização no chat. A calibração fornece contexto e feedback ao modelo; não treina pesos nem garante precisão.

Para corrigir manualmente, ajuste ou desenhe as caixas da classe alvo no editor, termine os campos com Tab/Enter e diga no chat **“este é o correto”**. O agente lê a imagem e a revisão atuais. Com proposta pendente, usa decisão `manual` em `review`; sem proposta, usa `manual_example`. As caixas manuais já existentes são registradas como feedback **sem duplicação**. Ausência continua exigindo decisão explícita.

Corrigir um exemplo de calibração já confirmado atualiza sua versão e descarta propostas baseadas no exemplo antigo. Outros conflitos manuais continuam bloqueados. Criar/renomear classes mantém IDs e geometria; o aplicativo adapta apenas hashes de estados anteriores que ainda coincidam exatamente, sem ocultar edições manuais.

Tarefas e rascunhos da versão anterior são preservados. Ao retomar pelo chat, confirme o compartilhamento do escopo e dos rascunhos/decisões salvos. Só depois o contexto inclui esses campos para avaliação no chat. Aprovar plano novo substitui tarefa e exemplos anteriores, com aviso na confirmação.

## Ferramentas

| Ferramenta | Uso |
| --- | --- |
| `anoint_get_context` | Projeto, classes, imagem/classe ativa, fase, feedback, histórico visível e instruções. |
| `anoint_list_images` | Metadados paginados, sem caminhos locais; `offset`, `limit` até 100. |
| `anoint_get_image` | `imageId`, `view: source/review`; imagem JPEG e revisão/escala naturais. |
| `anoint_propose_task` | Plano com `requestId`, descrição, classe, calibração, lote e IDs exatos do escopo. |
| `anoint_submit_proposal` | `requestId`, `taskId`, frames com imagem/revisão/caixas; sem escrever finais. |
| `anoint_control_task` | `plan`, `batch`, `resume`, `cancel`, `discard`, `clear_history`. Use `requestId` do plano/lote e `taskId` vigente. |
| `anoint_review` | `taskId`, `requestId` da proposta, decisões por imagem; confirma/aplica atomicamente. `manual` exige `revision` atual. |
| `anoint_manual_example` | `taskId`, imagem, revisão atual, comentário e `absent` booleano; confirma exemplo manual. |
| `anoint_create_class` | `id`, `name`, `color` hexadecimal; até 100 classes e nomes distintos. |
| `anoint_update_class` | `id`, `name`; preserva ID, cor e caixas. |
| `anoint_remove_class` | `id`, `replacementId` quando usada; duas confirmações e transferência de caixas. |

## Persistência e limites

Projeto, propostas e feedback são gravados em uma única transação. Falha mantém o estado anterior e permite tentar novamente. Propostas têm IDs e revisões; descartar um lote consome seu ID e não permite reinseri-lo por resposta atrasada. O descarte identifica exatamente a proposta vigente.

JSON portátil preserva tarefa, propostas, rascunhos e feedback. YOLO exporta somente `annotations` finais. **Limpar histórico** no chat limpa apenas a lista exibida pelo assistente, preservando calibração, caixas e feedback necessário ao modelo; não apaga a conversa do cliente. O Desfazer do editor restaura também a memória e revoga a autorização anterior.

Uma tarefa e um lote pendente por projeto; calibração/lote até 100 imagens, escopo até 10.000. Até 1.000 propostas por imagem, 1 MiB por chamada e 8 MiB de memória, com toda a calibração e os últimos 100 feedbacks de lote/recibos. Imagens são rasterizadas sem EXIF, lado máximo 4.096; objetos pequenos podem sumir na redução. GIF exige importação de frame estático. Não há extração de vídeo.

O MCP usa SDK oficial 2.4.0 por stdio, com protocolo moderno 2026-07-28 e adaptação legada 2025-11-25 testados. A ponte privada usa loopback, Bearer temporário, Host exato e rejeita Origin; não é MCP HTTP remoto/OAuth. A rede do renderer permanece bloqueada. Localhost não garante inferência local: cliente e provedor externo podem receber as imagens autorizadas.

`npm test` cobre domínio, schemas, elicitation moderna/legada, transporte e IPC. `npm run test:agent` cobre Electron isolado + SDK real: conexão, chat/confirmações, preview, classes, edição manual, conflitos, commit/abort, lotes, remoção dupla e backup/reload. O teste não usa imagens nem perfil reais do usuário.
