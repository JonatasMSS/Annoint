# Anoint

Estúdio local de anotação de imagens. Primeira entrega: interface clara em português, com anotação manual por bounding boxes. Baseado nas notas e na referência visual conectadas ao projeto no Maestri.

## Abrir

Requer Node.js 22.12+ e npm.

```sh
npm ci
npm start
```

O primeiro início baixa o executável do Electron e precisa de internet. Se esse download for interrompido, execute `npx install-electron --no` e tente novamente.

Para usar a mesma interface no navegador:

```sh
npm run preview
```

Abra <http://127.0.0.1:4173>. O servidor escuta somente no computador local e serve apenas os arquivos da interface. Para outra porta, defina a variável de ambiente `PORT`. O banco do navegador é separado do banco do Electron e muda conforme a origem/porta. Os módulos precisam de HTTP local no navegador.

## O que funciona

- Tela inicial **Projetos** com cartões, nomes, quantidade de imagens e progresso de revisão. Crie um projeto pelo nome, abra um cartão para continuar e use **Projetos** no editor para voltar à biblioteca.
- Vários projetos locais independentes, com navegação e histórico de desfazer separados. Abrir JSON adiciona uma cópia à biblioteca; o projeto anterior continua salvo. A troca aguarda o salvamento e permanece no editor se houver falha.
- Exemplo ilustrado local para experimentar a anotação.
- Importação de PNG, JPEG, WebP, AVIF, GIF e BMP, por seletor ou arrastar arquivos.
- Importação de pastas pelo botão **Importar pasta**, incluindo subpastas, caminhos preservados e ordem numérica dos nomes (frame2 antes de frame10). Arquivos de outros formatos são ignorados; imagens inválidas são informadas sem descartar as válidas. Novos lotes são adicionados ao projeto e podem ser desfeitos.
- Criação, seleção, movimento e redimensionamento de caixas, com limites da imagem e zoom.
- Edição de classe e coordenadas no inspetor, em pixels da imagem original.
- Criação e edição de nomes e cores das classes.
- Exclusão de anotações, desfazer e refazer (até 30 alterações na sessão).
- Lotes de 100 imagens, com conclusão por lote, seleção restaurada ao voltar e miniaturas que podem ser recolhidas. Só o lote ativo fica no cache de URLs; anotações e progresso dos demais permanecem salvos.
- Exclusão de imagens importadas pelo seletor desktop: confirmação nativa e envio do original para a Lixeira. Cópias antigas sem vínculo com a pasta só podem ser removidas do projeto. Excluir uma imagem limpa o histórico para impedir que desfazer ressuscite arquivos excluídos.
- Imagens nativas com a mesma referência em outros projetos são removidas apenas do projeto atual. Arquivos indisponíveis mantêm suas anotações até a remoção explícita da referência; abrir o projeto não descarta esses dados.
- Miniaturas, navegação por teclado, filtros e progresso. Imagens sem objetos também podem ser concluídas.
- Autosalvamento em IndexedDB com status de erro e nova tentativa.
- Exportação e reabertura do projeto em JSON, com imagens incorporadas e validação antes da troca.
- Exportação de datasets YOLO em ZIP (TrackNet temporariamente desabilitado na interface), com as imagens originais e as anotações.

Atalhos: **B** caixa, **V** selecionar, **←/→** navegar, **C** concluir, **Delete** excluir, **Esc** cancelar, **Ctrl+Z** desfazer e **Ctrl+Y/Ctrl+Shift+Z** refazer. No Mac, use **⌘**. A ajuda e a lista de atalhos também estão na interface.

## Dados e limites

Os projetos ficam na biblioteca local deste dispositivo. O projeto existente nas versões anteriores é migrado automaticamente, com imagens, classes, anotações e progresso preservados. Exporte JSON para guardar uma cópia fora do aplicativo. Os arquivos permanecem no dispositivo; nenhuma imagem é enviada a um servidor. A cópia local depende do espaço disponível e pode ser apagada ao limpar os dados do aplicativo/navegador.

O Electron mantém uma única instância. No navegador, uma trava por origem impede que outra aba edite o mesmo banco ao mesmo tempo. Use um navegador com Web Locks; a segunda aba informa que o projeto já está aberto e não grava dados.

A importação aceita até 10.000 imagens no projeto, divididas em lotes de até 100, com 15 MiB por arquivo e 100 milhões de pixels por imagem. No desktop, os seletores mantêm referências aos arquivos originais; não mova os arquivos enquanto anota. No navegador e ao abrir JSON, as imagens ficam como Blobs separados das anotações em IndexedDB. Projetos antigos são migrados sem alterar IDs, classes, caixas ou progresso; falha na migração preserva a gravação anterior. GIFs animados permanecem animados; a anotação é por arquivo, sem extração de frames nesta entrega.

O JSON é um formato próprio, versão 1, com `labels` e `images`. Cada imagem mantém `id`, `name`, `src`, `width`, `height`, `reviewed` e `annotations`. Cada anotação tem `id`, `labelId`, `x`, `y`, `width` e `height`. As coordenadas são absolutas, em pixels naturais. No JSON portátil, imagens são incorporadas como data URLs; no banco local, `src` usa referências `asset:UUID` ou `anoint-image://UUID`, nunca URLs temporárias `blob:`. O registro nativo fica no perfil do Electron, junto ao vínculo com a pasta original; o exemplo acompanha o aplicativo em `assets/demo-street.svg`.

## Exportar para treino

Clique em **Exportar projeto**, escolha o formato e confirme **Exportar**. JSON guarda o projeto completo para reabrir. Os ZIPs incluem todas as imagens importadas, inclusive pendentes; imagens sem caixas representam ausência de objetos. O exemplo SVG é excluído dos datasets, conforme informado no diálogo, e continua no JSON. Outros SVGs não são aceitos para treino. Revise as imagens antes de exportar.

- **YOLO (detecção):** `images/` e `labels/` espelham as subpastas, com um `.txt` por imagem. Cada linha contém `classe centro_x centro_y largura altura`, com coordenadas normalizadas e classes numeradas a partir de zero na ordem da barra lateral. Inclui `classes.txt` e `data.yaml`. Treino e validação apontam para as mesmas imagens; separe os conjuntos antes de treinar.
- **TrackNet:** temporariamente desabilitado. O conversor existente e seus testes permanecem para uma futura reativação.

Os nomes dos arquivos exportados são sanitizados para extração segura. Colisões recebem sufixos como `__2`, mantendo o pareamento entre imagem e anotação. Os bytes das imagens originais são preservados e nenhuma dependência nova é necessária. No seletor desktop, reimportar o mesmo original reutiliza o vínculo e preserva as anotações existentes; o navegador importa novas cópias. Pastas devem ser abertas pelo seletor; arrastar continua aceitando arquivos individuais.

Para manter a compatibilidade com o [carregador do Ultralytics](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/data/utils.py), pastas internas chamadas `images` são renomeadas para `_images` no ZIP YOLO (com sufixo em caso de colisão). GIF bloqueia a exportação YOLO com mensagem para converter os frames para PNG/JPEG antes de importar; não há omissão silenciosa nem extração automática de frames.

Arquivos JSON têm limite de 256 MiB. O modelo valida IDs, referências de classes, cores hexadecimais, números finitos, caixas dentro da imagem e origens locais. O contrato suporta até 10.000 imagens, 1.000 classes, 10.000 caixas por imagem e 100.000 por projeto, com até 128 MiB de fontes incorporadas no JSON portátil. Fontes externas/Blobs não entram nesse limite. O ZIP inclui todos os lotes, exige os arquivos disponíveis e limita as imagens a 3,875 GiB, reservando cabeçalhos/anotações para ZIP32 de até 4 GiB/65.535 arquivos; exportações grandes ainda precisam de RAM para empacotar. Trocar de lote libera as URLs e os elementos de imagem do lote anterior, sem apagar arquivos nem anotações. A interface exige ao menos uma classe ao reabrir um projeto, aceita projetos sem imagens e confere a decodificação e as dimensões originais antes da troca.

## Verificar

```sh
npm test
npm run test:ui
npm run fixtures:scenes
npm run test:scenes
npm run test:native
npm run fixtures
```

Os testes Node cobrem coordenadas, bordas fracionárias, dados inválidos, ida e volta do JSON, limites, commit/abort do IndexedDB, isolamento do Electron, privacidade do servidor local e conteúdo/CRC dos ZIPs YOLO e TrackNet. `test:ui` abre uma janela oculta do Electron com banco temporário separado, verifica os fluxos de anotação, importação de arquivos e pastas, persistência, exportação JSON/YOLO e bloqueio de TrackNet, e encerra. Ele precisa do executável do Electron instalado.

`test-images/valid` contém dez imagens sintéticas PNG/JPEG para testes manuais. `test-images/invalid` contém quatro arquivos corrompidos e dois formatos não aceitos. `manifest.json` registra dimensões e caixas esperadas em pixels. `npm run fixtures` regenera e verifica esse conjunto sem downloads.

`npm run fixtures:scenes` gera **100 cenas determinísticas PNG** em `test-scenes/images`, com formas geométricas e desenhos de carro, pessoa e casa, posições/tamanhos/cores variados e cinco imagens sem objetos. Importe a pasta para anotar; `test-scenes/manifest.json` é o gabarito separado com classes, caixas em pixels e hashes para futuras avaliações de agentes MCP. O gerador usa Node, sem dependências novas. Imagens, manifesto e contrato de classes gerados ficam fora do Git; gere-os antes de executar `test:scenes` em um clone novo. São 100 imagens: a troca entre lotes pode ser testada em um projeto que já contenha outra imagem. Veja [as instruções e limites](test-scenes/README.md).

`npm run test:scenes` verifica esse conjunto na interface real do Electron, com perfil isolado: desenha as 346 caixas usando ponteiro e inspetor, testa lotes/cache, progresso, reload e downloads JSON/YOLO comparados com o gabarito. Capturas, relatório e uma cópia anotada para reabrir ficam em `test-results/scenes-ui/`. Veja [o relatório das cenas](docs/QA-cenas.md).

O teste de interface importa 501 arquivos, troca lotes, confere liberação do cache, progresso, reabertura, exportação de todos os lotes, exclusão até vazio e também anota essas imagens por eventos reais de ponteiro, verifica zoom/rolagem, oito alças, classes, atalhos, limites, trava entre janelas e um download real. Gera capturas e resultados em `test-results/`, que fica fora do Git. Veja [o relatório de QA](docs/QA-interface.md) para cobertura, correções e limites da verificação.

`test:native` verifica o preload e o protocolo reais, importa uma pasta com 501 arquivos e exercita a Lixeira do Windows somente com cópias temporárias. Seletores e confirmações recebem respostas controladas no teste. Veja [a validação de lotes e exclusão](docs/QA-lotes.md).

A verificação de interface também cobre a biblioteca de projetos, migração do banco antigo sem duplicação, criação/importação sem substituir projetos, preservação de imagens entre projetos, troca antes do autosalvamento, falhas de gravação e layout estreito. Capturas da biblioteca ficam em `test-results/projects-home.png` e `test-results/projects-mobile.png`. O teste nativo confere referências compartilhadas e remoção explícita de arquivos indisponíveis.

## Estrutura

- `src/app.js` e `src/styles.css`: interface DOM/SVG, sem HTML canvas ou canvas infinito.
- `src/model.js`: geometrias e validação do contrato.
- `src/batches.js`: grupos de 100 e cache com revogação de URLs ao trocar de lote.
- `src/storage.js`: IndexedDB v2 com anotações e Blobs separados; gravações só são confirmadas após o commit.
- `src/export.js`: conversão YOLO/TrackNet e empacotamento ZIP local.
- `electron/files.cjs`, `electron/native-files.cjs` e `electron/preload.cjs`: seletores, capabilities locais e exclusão confirmada na Lixeira.
- `electron/main.cjs`: aplicativo desktop com isolamento, sandbox, CSP no HTML, bloqueio de navegação externa e permissões.
- `scripts/serve.js`: prévia local sem dependências adicionais.

JavaScript nativo e Electron são suficientes nesta etapa. Integração MCP, agentes de anotação, aprendizado de padrões e instalador ficam para próximas entregas.
