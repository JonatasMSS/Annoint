# Histórico do Anoint

## 0.4.0 — 2026-11-19

- Botão Resetar conexão MCP para renovar a chave e revogar a conexão anterior, preservando projeto e trabalho do assistente; retomada continua exigindo autorização no chat.
- Calibração e revisão de várias imagens por rodada, com decisões individuais e uma confirmação explícita para aplicar o conjunto; propostas antigas pendentes preservadas.
- Fluxo do assistente integralmente no chat externo: plano, permissões, prévia, revisão, aplicação, cancelamento e histórico.
- Painel do Anoint restrito à conexão MCP; editor permanece disponível para ajustes manuais.
- Limpeza do histórico pelo chat preserva calibração, feedback e anotações.
- Sincronização local da configuração MCP do Gemini e recuperação da ponte após renovação de credenciais.
- Ferramentas para criar/renomear classes e remover com duas confirmações, transferência de caixas e proteção da última classe.
- Confirmação pelo chat como padrão, inclusive para clientes que anunciam elicitation e cancelam formulários automaticamente; modo nativo moderno/legado disponível por configuração explícita, sem converter cancelamento em autorização.
- Exemplos “este é o correto” usam caixas manuais sem duplicação; atualização de calibração invalida propostas antigas.
- Confirmações vinculadas a ação/escopo/revisão e descarte restrito ao ID exato da proposta.

## 0.3.0 — 2026-11-17

- Servidor MCP stdio para agentes externos, com contexto, imagens autorizadas, plano e propostas de caixas.
- Painel de consentimento por projeto, calibração sequencial e autorização de cada novo lote.
- Sugestões pontilhadas separadas das anotações finais; aceitar, corrigir, rejeitar, confirmar ausência e usar exemplos manuais.
- Rascunhos persistidos, aplicação atômica com feedback, retries idempotentes, Desfazer e retomada explícita.
- Memória do assistente no backup JSON; YOLO continua exportando somente caixas finais.
- Ponte loopback autenticada e IPC restrito, sem liberar a rede do renderer.
- Testes de domínio, transporte/IPC e integração Electron/MCP com perfil temporário.
- Electron atualizado para 44.11.3 e dependências sem alertas no npm audit.

## 0.2.0 — 2026-11-17

- Edição de nomes e cores das classes e remoção com transferência de caixas.
- Acesso explícito a **Editar classe selecionada** e área maior para clicar no lápis.
- Seleção do nome ao abrir o editor de classe, para facilitar a digitação.
- Escolher uma classe de desenho limpa a seleção de caixa anterior, evitando exclusões acidentais com Delete.
- Botão **Excluir caixa selecionada** no cabeçalho do inspetor, com desfazer.
- Seleção e remoção de várias imagens do projeto, preservando os arquivos originais.
- Loading na importação, abertura, exportação e remoção; progresso de importação e indicador de salvamento.
- Seleção reconciliada com o filtro e tratamento de falhas de gravação na remoção múltipla.
- Versão visível na barra inferior do aplicativo.

## 0.1.0

- Primeira versão do anotador local: caixas, classes, autosalvamento e navegação.
- Importação de imagens e pastas, lotes de 100, cache e exclusão nativa com Lixeira.
- Exportação de projetos JSON e datasets YOLO, com testes de interface e cenas sintéticas.

Para cada entrega, atualize a versão em `package.json`, `package-lock.json` e na meta `application-version` de `index.html`, e registre as mudanças aqui. Use o último número para correções e o número do meio para novos recursos. Os testes verificam a consistência dessas versões. A versão do formato de dados JSON continua independente da versão do aplicativo.
