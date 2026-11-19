# Anoint

**Anotação de imagens com edição manual e assistência por agente de IA via MCP.**

Descreva o que deseja identificar, oriente o agente com exemplos e revise as anotações em lote pelo seu chat. Use o editor quando precisar corrigir uma caixa manualmente.

Versão **0.4.0** · [Histórico de mudanças](CHANGELOG.md) · [Visão do projeto](docs/VISAO.md) · [Guia MCP](docs/MCP.md)

## O problema

Preparar um dataset exige marcar os mesmos objetos em muitas imagens. Fazer tudo manualmente é repetitivo; revisar cada foto alternando entre editor e chat também interrompe o trabalho.

O Anoint reúne organização local, edição de caixas e automação por um agente externo, mantendo a revisão e a aprovação com o usuário.

## A proposta

Você descreve **o que marcar** e **quantas imagens analisar**. O agente propõe as caixas, recebe suas correções e usa esses exemplos como contexto nas próximas rodadas.

1. **Conecte:** abra um projeto e copie a configuração MCP para seu cliente de chat.
2. **Descreva:** informe o alvo, a classe, as imagens de calibração e o tamanho dos lotes.
3. **Autorize:** confirme o escopo e o acesso às imagens pelo agente.
4. **Revise em conjunto:** veja as sugestões de várias imagens, aceite as boas e corrija ou rejeite as demais.
5. **Aplique:** confirme o conjunto para adicionar somente as caixas aprovadas e salvar o feedback.

Plano, permissões e revisão acontecem no chat externo. Para ajustes manuais, altere as caixas no editor e diga **“este é o correto”** no chat. As caixas existentes são aproveitadas sem duplicação.

Autorizar a geração de sugestões e aprovar sua aplicação são ações separadas. A calibração fornece exemplos e correções ao agente; não treina pesos nem garante precisão.

## Recursos disponíveis

- **Biblioteca de projetos:** projetos independentes, progresso e salvamento automático local.
- **Editor de caixas:** desenhar, mover, redimensionar, ajustar coordenadas, zoom, desfazer e refazer.
- **Classes:** criar, editar nome/cor e remover com transferência das anotações; a última classe é protegida.
- **Imagens e pastas:** importar arquivos e subpastas, navegar em lotes de 100, filtrar e selecionar várias imagens para remoção do projeto.
- **Assistente MCP:** prévias, calibração e revisão de várias imagens por rodada, decisões individuais e confirmação do conjunto.
- **Gestão pelo agente:** criar e renomear classes; remover exige confirmação adicional.
- **Conexão recuperável:** reset de credenciais e retomada autorizada, preservando projeto, calibração e propostas.
- **Exportação:** backup JSON com imagens e memória do assistente, além de dataset YOLO em ZIP.

## Executar localmente

Requer **Node.js 22.12+** e **npm**. Na pasta do repositório:

```sh
npm ci
npm start
```

O aplicativo desktop usa Electron. A instalação com `npm ci` precisa de internet para baixar as dependências e o executável do Electron. Ainda não há instalador com runtime embutido.

Para experimentar o editor no navegador:

```sh
npm run preview
```

Abra <http://127.0.0.1:4173>. A prévia oferece edição manual; a conexão MCP está disponível no desktop. O banco do navegador é separado do Electron e muda conforme a origem/porta.

## Conectar seu agente

O Anoint não inclui modelo de IA, assinatura ou chave de API. Use um cliente MCP com agente de visão e suporte a imagens.

1. Abra o aplicativo desktop, crie um projeto e importe as imagens.
2. Acesse **Conexão MCP → Habilitar MCP**.
3. Copie a configuração para seu cliente e mantenha o Anoint aberto no projeto.
4. Continue a conversa no chat. Por exemplo:

> Quero marcar bolas amarelas nestas 12 imagens. Crie a classe Bola se necessário. Use 3 imagens para calibração e lotes de 3. Mostre as sugestões e peça minha autorização antes de aplicá-las. Se eu corrigir no editor e disser “este é o correto”, use minhas caixas como exemplo.

Por padrão, as confirmações ocorrem pelo chat e dependem de o agente respeitar a resposta explícita do usuário. Formulários nativos são opcionais, conforme o suporte do cliente. Consulte o [contrato MCP e seus limites](docs/MCP.md).

Se houver problema de conexão, use **Resetar conexão MCP**, copie a nova configuração, reinicie o MCP no cliente e peça para **retomar**. A chave anterior é revogada; anotações, exemplos e propostas são preservados. O acesso às imagens exige nova autorização.

## Dados, privacidade e limites

Os projetos são salvos localmente em IndexedDB. No desktop, imagens importadas pelos seletores mantêm referências aos arquivos originais: evite movê-los enquanto anota. Exporte JSON para manter um backup fora do aplicativo.

Ao habilitar o MCP, o agente pode acessar metadados e gerenciar classes. **Imagens autorizadas podem chegar ao cliente e ao provedor externo, inclusive na nuvem.** A configuração contém uma chave privada temporária; não a publique.

| Limite | Valor |
| --- | --- |
| Imagens por projeto | Até 10.000 |
| Importação por arquivo | Até 15 MiB e 100 milhões de pixels |
| Anotações finais | Até 10.000 por imagem e 100.000 por projeto |
| Calibração e rodada MCP | Até 100 imagens cada |
| Propostas MCP por imagem | Até 1.000 caixas |
| Memória do assistente | Até 8 MiB |

PNG, JPEG, WebP, AVIF, GIF e BMP podem ser importados. Ainda não há extração de frames de vídeo. Para analisar GIF pelo MCP ou exportar para YOLO, converta os frames para imagens estáticas.

A remoção múltipla elimina imagens somente do projeto e preserva os originais; não permite desfazer. A exclusão individual de um original vinculado no desktop pode enviá-lo à Lixeira após confirmação e limpa o histórico de desfazer.

## Exportar

Em **Exportar projeto**, escolha:

- **JSON:** backup portátil para reabrir o projeto, incluindo imagens, anotações e trabalho do assistente.
- **YOLO:** ZIP com imagens originais, rótulos normalizados, `classes.txt` e `data.yaml`.

O YOLO inclui todas as imagens importadas, inclusive pendentes; somente anotações finais são exportadas, sem sugestões. Revise o dataset e separe treino/validação antes de treinar. O exemplo SVG fica fora do dataset. TrackNet está temporariamente desabilitado na interface.

## Desenvolvimento e testes

| Comando | Verificação |
| --- | --- |
| `npm test` | Modelo, exportação, persistência, MCP, ponte e IPC |
| `npm run test:ui` | Editor e biblioteca em Electron com perfil temporário |
| `npm run test:agent` | Fluxo Electron/MCP, confirmações, lotes, reset e retomada |
| `npm run test:native` | Importação nativa e Lixeira usando arquivos temporários |
| `npm run fixtures:scenes` | Geração de cenas sintéticas para anotação |
| `npm run test:scenes` | Anotação e exportação das cenas; gere as fixtures antes |

O código do editor fica em `src/`, a integração desktop em `electron/` e o servidor MCP em `mcp/`. Os testes ficam em `tests/` e `scripts/`.

Relatórios: [interface](docs/QA-interface.md), [lotes e arquivos nativos](docs/QA-lotes.md) e [cenas sintéticas](docs/QA-cenas.md).

## Próximas funcionalidades

Evoluções propostas, ainda sem prazo definido:

- Resolver os achados de confiabilidade em retomadas, retries, confirmações e edição durante gravação.
- Oferecer recortes e zoom para o agente analisar objetos pequenos.
- Extrair frames de vídeo por intervalo ou quantidade e revisá-los em lote.
- Distribuir um instalador com o runtime necessário.

Veja o [resumo da visão e dos próximos passos](docs/VISAO.md). A revisão humana e a aprovação explícita continuam orientando as próximas automações.
