# Lotes, interface compacta e exclusão de imagens

Implementação em Windows/Electron 44.2.0, com perfis temporários separados do projeto normal do usuário. Prumo implementou a integração nativa; Lume revisou os caminhos de cache, migração e restauração sem editar arquivos. Coordenação pela skill [maestri-manager](C:/Users/gears/.agents/skills/maestri-manager/SKILL.md).

## Comportamento

- O cabeçalho acima do editor foi removido. A faixa de miniaturas tem botão para recolher/mostrar, mantendo seleção de lote e navegação acessíveis.
- O projeto aceita até 10.000 imagens. Grupos de até 100 mostram contagem de concluídas e indicam conclusão do lote, inclusive imagens sem objetos.
- Trocar de lote remove os elementos anteriores e revoga suas URLs. O cache carrega sequencialmente e descarta resultados de leituras antigas quando há troca rápida.
- Anotações, classes, progresso e fontes persistentes não dependem do cache. A imagem selecionada, a seleção da caixa e o estado recolhido são restaurados.
- No desktop, os seletores nativos mantêm vínculo com o original. A lixeira na miniatura pede confirmação nativa com o caminho completo e envia o arquivo à Lixeira do sistema. Cancelamento e erro preservam o projeto. O histórico é limpo após excluir para evitar ressuscitar imagens indisponíveis.
- Arquivos importados anteriormente sem caminho recuperável e cópias do navegador só podem ser removidos do projeto. A confirmação informa isso. Para excluir o original, importe pelo seletor do desktop.
- TrackNet fica desabilitado na interface e o envio do formulário rejeita esse formato. O conversor e seus testes existentes foram mantidos.

## Validação executada

`npm test` verifica modelo, fontes, limites, cache, descarte de leituras antigas, transações IndexedDB, segurança da ponte nativa e exportadores. `npm run test:ui` verifica geometria nas imagens reais do conjunto de fixtures e os novos cenários de lotes. `npm run test:native` usa a UI e o preload reais, com seletores/confirmações controlados pelo teste e Lixeira real em cópias temporárias.

Resultado final: **52 testes Node aprovados; interface com 501 arquivos aprovada; integração nativa com 501 arquivos e Lixeira real aprovada**. Os dois arquivos finais de journal e testes foram copiados do staging e validados na raiz.

- Importação de 501 arquivos: seis lotes de tamanhos 100/100/100/100/100/1.
- No máximo 100 URLs de imagens no cache, passando a uma ao selecionar o sexto lote; troca rápida sem reaproveitar leitura antiga.
- Conclusão de um lote de 100, anotação na imagem 501, retorno à seleção anterior, recolhimento e restauração após reabrir.
- Migração abortada entre Blobs e projeto preserva o projeto anterior; migração normal grava ambos na mesma transação.
- JSON e YOLO exportam todos os 501 arquivos, inclusive fora do lote ativo, com bytes e coordenadas conferidos; JSON usa fontes incorporadas, sem IDs nativos nem URLs temporárias.
- Exclusão cancelada, exclusão com falha simulada, limpeza do histórico, mudança de fronteira entre lotes, exclusão da última imagem, JSON vazio e reabertura do estado vazio.
- Preload real, importação nativa de pasta com 501 arquivos, deduplicação por original, protocolo local, anotação e cópia portátil.
- Envio de cópia temporária à Lixeira real, revogação das fontes e recuperação de snapshot antigo do banco sem fazer a imagem excluída voltar.
- Journal durável antes da Lixeira: falha de rename após excluir conserva o registro recuperável, revoga as fontes em memória e reconcilia ao reabrir; cancelamento/falha com original intacto não cria exclusão falsa. Testes também cobrem um arquivo substituído no mesmo caminho, sem tocar na substituição.

## Limites

Não houve teste de estresse com 10.000 imagens grandes, disco cheio real, arquivos de vários GiB, macOS/Linux, toque ou caneta. Os erros de quota/abort e de Lixeira são simulados; a Lixeira também foi exercitada com sucesso no Windows usando cópias temporárias. Os seletores e confirmações nativos não foram clicados manualmente: as respostas são controladas nos testes, mantendo preload, IPC, decodificação, protocolo, armazenamento e shell reais.

JSON portátil mantém limite de 128 MiB de imagens incorporadas e entrada de 256 MiB. YOLO aceita até 3,875 GiB de imagens, reservando espaço para cabeçalhos/anotações do ZIP32; o empacotamento ainda requer RAM proporcional ao export. Esses limites de exportação não limitam o total de arquivos vinculados no projeto.
