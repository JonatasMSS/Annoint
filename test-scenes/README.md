# Cenas determinísticas para anotação

100 imagens PNG geradas por código, sem downloads, IA generativa, HTML canvas ou dependências novas. Posições, tamanhos, cores, fundos claros e quantidades variam com semente fixa **20261114**. Os desenhos de carro, pessoa e casa são ilustrações simbólicas, não fotografias.

Os arquivos gerados (`images/`, `manifest.json` e `class-contract.json`) não são versionados. Em um clone novo, execute `npm run fixtures:scenes` antes de importar as imagens ou rodar `npm run test:scenes`. O gerador, os testes e estas instruções ficam no repositório.

## Usar no Anoint

1. Importe a pasta **test-scenes/images** para começar sem anotações. Há exatamente 100 PNGs; o manifesto não é um projeto para abrir na interface.
2. Crie as 11 classes de `manifest.json`: Quadrado, Retângulo, Círculo, Elipse, Triângulo, Pentágono, Hexágono, Estrela, Carro, Pessoa e Casa. As cores das classes no manifesto são sugestões para a interface; as cores dos desenhos variam e não determinam a classe.
3. Anote, mova/redimensione caixas, troque classes e use zoom. Compare geometria e contagens com o gabarito em pixels naturais.
4. Conclua imagens, incluindo as cinco sem objetos (`020`, `040`, `060`, `080`, `100`). Salve/reabra e confira progresso e seleção. As primeiras 11 imagens mostram uma classe por imagem; as demais cenas com objetos misturam classes e podem repetir a mesma classe.
5. Exporte JSON/YOLO e compare classes, contagens e coordenadas. IDs gerados pelo aplicativo podem ser diferentes: compare pelo nome do arquivo, classe e geometria. Para anotações aproximadas, use uma tolerância de pixels ou IoU definida pelo teste.

As caixas do gabarito são os limites exatos dos pixels pintados, incluindo rodas, membros e telhado: `[x,x+width)` e `[y,y+height)`. Um carro, uma pessoa e uma casa contam como um objeto cada; círculos das rodas e triângulo do telhado não são instâncias separadas. Quadrado não deve ser contado novamente como retângulo; círculo não deve ser contado novamente como elipse. Objetos ficam inteiros dentro da imagem, sem sobreposição, oclusão ou recorte; há exemplos tocando as bordas e imagens em paisagem, retrato e quadradas.

## Lotes de 100

Este conjunto preenche **um lote completo** em um projeto vazio. Para testar a passagem para o próximo lote sem gerar mais de 100 imagens, importe o conjunto em um projeto que já contenha outra imagem (por exemplo, o demo): serão 101 imagens, com lotes de 100 e 1. A divisão segue a ordem real do projeto, incluindo imagens anteriores. Teste voltar ao primeiro lote, seleção, cache, progresso e exclusão perto da fronteira.

Esta pasta, sozinha, não testa vários lotes completos. No desktop, reimportar os mesmos originais pode reutilizar os vínculos existentes; não use essa operação para presumir que duplicará o conjunto. O teste automatizado cria 101 registros somente em memória, reutilizando um PNG com novos IDs de imagem/caixas, e verifica lotes 100+1, progresso e liberação/releitura do cache. A pasta continua com 100 PNGs.

## Gabarito para futuros agentes MCP

`manifest.json` contém semente, classes, contagens totais/por classe, caminho, dimensões, SHA-256, tamanho e caixas esperadas de cada PNG. As imagens não contêm nomes de classes, caixas desenhadas por cima nem respostas em texto. O manifesto fica fora de `images` para permitir avaliação sem mostrá-lo ao agente.

Em um teste de reconhecimento, entregue somente `images/` e **class-contract.json** (classes, coordenadas e convenções, sem respostas por imagem). Mantenha `manifest.json` e o gerador fora do contexto e das ferramentas que o agente pode consultar; estar em outro diretório, sozinho, não impede leitura por um agente com acesso ao repositório inteiro. Compare a resposta pelo nome, classe e correspondência de caixas por IoU; a conexão MCP precisa de um teste próprio de protocolo/leitura/gravação. Ter este conjunto não comprova que MCP está implementado, nem mede a qualidade em fotografias reais.

## Reproduzir

```sh
npm run fixtures:scenes
node --test tests/annotation-scenes.test.cjs
npm run test:scenes
```

O gerador roda em Node.js 22.12+ e escreve somente os 100 nomes conhecidos em `images`, `manifest.json` e `class-contract.json`. Preserva este README e recusa arquivos extras na pasta `images`; não apaga arquivos. Não usa relógio, rede ou `Math.random`. Bytes PNG são reproduzíveis com a mesma versão de Node/zlib; o planejamento e as caixas usam a semente fixa. Não altera as fixtures antigas de `test-images`. Os testes decodificam PNG/CRC e percorrem o raster independentemente das fórmulas de desenho, conferindo caixas mínimas, pixels fora de caixas, negativos, contagens e determinismo de todos os arquivos gerados.

Para testar exclusão para a Lixeira, importe **cópias descartáveis** das imagens. Regenere com o aplicativo fechado: regravar originais já vinculados pode invalidar a identidade registrada pelo Electron. Os testes automáticos do gerador usam pastas temporárias e não tocam o projeto salvo no aplicativo.

`test:scenes` abre a interface real do Electron em janela oculta e perfil isolado. Importa as 100 PNGs por seletor controlado, cria classes, desenha as 346 caixas com eventos de ponteiro e ajusta os pixels pelo inspetor usando o gabarito. Confere zoom/rolagem, edição, undo/redo/Esc, negativos, progresso, filtros, miniaturas, cache/lotes 100+1 e reload. Faz downloads reais JSON/YOLO, compara hashes/classes/coordenadas de todos os lotes, reabre JSON e remove só a cópia extra do projeto. Relatório, capturas e exports ficam em `test-results/scenes-ui/`. Este teste não usa o seletor nativo/preload, não move originais para a Lixeira e não avalia reconhecimento por agentes.
