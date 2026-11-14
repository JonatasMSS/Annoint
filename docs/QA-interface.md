# Verificação da interface do Anoint

## Atualização e isolamento

A `main` foi atualizada com `origin/main` em `9910f6e`. Os históricos local e remoto divergiam; a integração foi feita por merge, sem conflitos e preservando ambos.

Os testes do aplicativo usam Electron 44.2.0 no Windows e um perfil temporário separado. Nenhuma imagem ou anotação do banco normal do usuário é substituída. Prumo preparou as imagens e Lume realizou a revisão independente; o Maestro integrou as correções e executou os testes.

Resultado: **27 testes Node e 17 grupos de cenários de interface aprovados**.

## Executar novamente

```sh
npm test
npm run test:ui
```

Para regenerar as imagens e conferir dimensões, transparência e corrupção:

```sh
npm run fixtures
```

`test-images/valid` contém dez imagens de teste, e `test-images/invalid` contém quatro arquivos corrompidos e dois formatos não aceitos. O [manifesto](../test-images/manifest.json) registra as caixas esperadas, dimensões, hashes e ordem de importação. As imagens não precisam de downloads.

## Cobertura

| Fluxo | Verificação |
| --- | --- |
| Abrir imagens e pastas | PNG/JPEG reais; retrato, paisagem, quadrado, 8×8, transparência, nomes Unicode e espaços, subpastas e basenames repetidos |
| Lotes inválidos | Arquivos vazios, truncados e com conteúdo falso; a imagem válida continua entrando quando resta uma vaga no limite de 100 |
| Anotação manual | Objetos com coordenadas conhecidas em todas as imagens, incluindo objetos encostados nas bordas e imagem sem objetos |
| Zoom e rolagem | Quatro direções de arraste em duas escalas; coordenadas permanecem em pixels naturais; ajustar e diminuir zoom |
| Ajustar caixas | Oito alças; borda oposta preservada; movimento limitado à imagem; valores inválidos não alteram a anotação |
| Precisão | Edição de medidas subpixel e persistência sem arredondamento destrutivo |
| Classes e histórico | Criar, renomear, rejeitar nome duplicado, reatribuir classe, excluir, desfazer e refazer |
| Teclado e painéis | B/V/C, setas, Delete, Ctrl+Z/Ctrl+Y, Tab no inspetor, Esc, ajuda e atalhos; listas longas preservam rolagem |
| Progresso | Concluir imagem sem objetos, reabrir, filtros de pendentes/concluídas, filtro vazio e seleção ao navegar |
| Persistência | Recarregar; erro de gravação, proteção de saída e nova tentativa; segundo renderer com o mesmo banco bloqueado |
| Limites | Até 100 imagens, 10.000 caixas por imagem e 100.000 por projeto; tentativa excedente não invalida o estado salvo |
| JSON | Reabertura, validação de projeto vazio, preservação de imagens/classes/caixas e download real em disco |
| YOLO | Coordenadas normalizadas exatas de PNG anotada, classes, pares imagem/label, bytes originais, imagens sem objetos, caminhos e CRC nos testes Node |
| TrackNet | Centro em pixels da classe escolhida, visibilidade, tabelas por sequência e rejeição de mais de um alvo da mesma classe |
| Layout | Capturas desktop e em área de 1000×720, sem overflow horizontal |

## Correções encontradas nesta rodada

- O inspetor mantinha o foco depois de iniciar um arraste e impedia Esc de cancelá-lo. O ponteiro agora confirma/desfoca o campo antes de iniciar a operação; o teste não limpa o foco artificialmente.
- A criação podia ultrapassar os limites de caixas e deixar o projeto impossível de salvar/exportar. O limite é verificado antes da mutação e compartilhado com o modelo.
- Instâncias com snapshots antigos podiam sobrescrever o mesmo banco. O Electron impede segunda instância e a interface mantém uma trava Web Locks por origem.
- O fechamento durante o carregamento podia tentar salvar o exemplo antes de restaurar o projeto. A gravação de saída exige inicialização concluída.
- Um lote com imagem válida e imagem corrompida podia ser recusado inteiro quando restava uma vaga. O limite considera somente as imagens já aceitas.
- Renderizar novamente os painéis perdia a rolagem das listas. As posições são preservadas, incluindo a faixa de miniaturas ao editar medidas.
- O inspetor rejeitava dimensões abaixo de um pixel aceitas pelo contrato. Agora aceita valores positivos e exibe/preserva sua precisão.
- As barras de rolagem do zoom podiam recalcular a escala base durante o ajuste. A escala base agora acompanha a imagem e o tamanho externo da área de edição.

## Evidências e limites

A execução bem-sucedida gera [resultados dos cenários](../test-results/ui-results.json), [captura desktop](../test-results/interface-desktop.png) e [captura em 1000×720](../test-results/interface-1000x720.png). Esses arquivos são locais e podem ser regenerados; não entram no Git.

O [projeto anotado de teste](../test-results/annotated-project.json) é a cópia gravada pelo download real. Pode ser aberto no Anoint para inspecionar as dez imagens e suas caixas. Abrir esse arquivo substitui o projeto ativo após confirmação; exporte sua cópia antes.

Os controles de importação recebem bytes reais por automação, com subcaminhos e MIME ausente. Os diálogos nativos do seletor de arquivos/pastas não foram dirigidos manualmente. O download real é gravado em destino temporário e comparado ao projeto esperado.

Não foram testados macOS/Linux, toque/caneta, JPEG com EXIF de orientação nem decodificação real de BMP/GIF/WebP/AVIF. Os formatos e bytes dos exportadores têm cobertura Node, mas o conjunto visual desta rodada usa PNG/JPEG. Não foram gerados arquivos gigantes para estressar RAM ou quota de disco; o erro de gravação é simulado e os limites de dados são testados sem esse custo.
