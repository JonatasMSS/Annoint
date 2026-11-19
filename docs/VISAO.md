# Anoint: problema, proposta e próximos passos

## Problema

Anotar muitas imagens manualmente exige repetir o mesmo trabalho e revisar erros. Alternar entre o editor e o chat para autorizar cada foto também interrompe o fluxo. O usuário precisa explicar o alvo, orientar o agente com exemplos e manter o controle sobre o resultado.

## Proposta

O Anoint organiza as imagens e oferece um editor de caixas conectado ao agente externo por MCP. O usuário copia a conexão uma vez e conduz o trabalho no chat:

1. Descreve o alvo e combina quantas imagens usar na calibração e em cada lote.
2. Autoriza o escopo; o agente propõe anotações para várias imagens juntas.
3. Avalia quais ficaram boas, corrige ou rejeita as demais e confirma a aplicação do conjunto.
4. Quando precisar ajustar manualmente, usa o editor e informa no chat: **“este é o correto”**.

O agente usa exemplos e correções para orientar as próximas sugestões. Essa calibração fornece contexto; não significa treinamento de pesos nem garante precisão. Autorizar a geração e aprovar a aplicação são decisões separadas.

## Já disponível na versão 0.4.0

- Fluxo no chat, calibração e revisão em lote, prévias e feedback por imagem.
- Criação e renomeação de classes; remoção com confirmação adicional e transferência das caixas.
- Correção manual sem duplicar anotações, salvamento local, backup JSON e exportação YOLO.
- Reset da conexão sem apagar o trabalho, com nova autorização para retomar.

Detalhes de conexão e limites: [contrato MCP](MCP.md).

## Evoluções propostas

Estas são candidatas a próximas entregas, sem prazo definido:

- **Confiabilidade primeiro:** resolver os achados de revisão sobre retomada, retries, confirmações, edição durante gravação e limites de memória/imagens.
- **Objetos pequenos:** oferecer recortes e zoom para o agente analisar detalhes que se perdem na redução da imagem.
- **Vídeos:** extrair e selecionar frames por intervalo ou quantidade, mantendo a revisão em lote.
- **Instalação simples:** distribuir um instalador com runtime necessário, reduzindo a configuração manual.

As próximas automações devem preservar a aprovação explícita e a possibilidade de correção humana.
