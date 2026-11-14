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

- Exemplo ilustrado local para experimentar a anotação.
- Importação de PNG, JPEG, WebP, AVIF, GIF e BMP, por seletor ou arrastar arquivos.
- Importação de pastas pelo botão **Importar pasta**, incluindo subpastas, caminhos preservados e ordem numérica dos nomes (frame2 antes de frame10). Arquivos de outros formatos são ignorados; imagens inválidas são informadas sem descartar as válidas. Novos lotes são adicionados ao projeto e podem ser desfeitos.
- Criação, seleção, movimento e redimensionamento de caixas, com limites da imagem e zoom.
- Edição de classe e coordenadas no inspetor, em pixels da imagem original.
- Criação e edição de nomes e cores das classes.
- Exclusão de anotações, desfazer e refazer (até 30 alterações na sessão).
- Miniaturas, navegação por teclado, filtros e progresso. Imagens sem objetos também podem ser concluídas.
- Autosalvamento em IndexedDB com status de erro e nova tentativa.
- Exportação e reabertura do projeto em JSON, com imagens incorporadas e validação antes da troca.
- Exportação de datasets YOLO e TrackNet em ZIP, com as imagens originais e as anotações.

Atalhos: **B** caixa, **V** selecionar, **←/→** navegar, **C** concluir, **Delete** excluir, **Esc** cancelar, **Ctrl+Z** desfazer e **Ctrl+Y/Ctrl+Shift+Z** refazer. No Mac, use **⌘**. A ajuda e a lista de atalhos também estão na interface.

## Dados e limites

Há um projeto local ativo. Abrir outro pede confirmação antes de substituir o atual. Exporte JSON para guardar outras cópias. Os arquivos permanecem no dispositivo; nenhuma imagem é enviada a um servidor. A cópia local depende do espaço disponível e pode ser apagada ao limpar os dados do aplicativo/navegador.

O Electron mantém uma única instância. No navegador, uma trava por origem impede que outra aba edite o mesmo banco ao mesmo tempo. Use um navegador com Web Locks; a segunda aba informa que o projeto já está aberto e não grava dados.

A importação de imagens pela interface aceita até 100 imagens no projeto, 15 MiB por arquivo, 80 MiB de fontes em base64, 30.000 px por lado e 100 milhões de pixels por imagem. GIFs animados permanecem animados; a anotação é por arquivo, sem extração de frames nesta entrega.

O JSON é um formato próprio, versão 1, com `labels` e `images`. Cada imagem mantém `id`, `name`, `src`, `width`, `height`, `reviewed` e `annotations`. Cada anotação tem `id`, `labelId`, `x`, `y`, `width` e `height`. As coordenadas são absolutas, em pixels naturais. Imagens importadas são incorporadas como data URLs; o exemplo acompanha o aplicativo em `assets/demo-street.svg`.

## Exportar para treino

Clique em **Exportar projeto**, escolha o formato e confirme **Exportar**. JSON guarda o projeto completo para reabrir. Os ZIPs incluem todas as imagens importadas, inclusive pendentes; imagens sem caixas representam ausência de objetos. O exemplo SVG é excluído dos datasets, conforme informado no diálogo, e continua no JSON. Outros SVGs não são aceitos para treino. Revise as imagens antes de exportar.

- **YOLO (detecção):** `images/` e `labels/` espelham as subpastas, com um `.txt` por imagem. Cada linha contém `classe centro_x centro_y largura altura`, com coordenadas normalizadas e classes numeradas a partir de zero na ordem da barra lateral. Inclui `classes.txt` e `data.yaml`. Treino e validação apontam para as mesmas imagens; separe os conjuntos antes de treinar.
- **TrackNet:** escolha a classe a rastrear. Cada pasta recebe as imagens e um `Label.csv` com `filename,visibility,x,y,status`, na ordem numérica dos nomes. Exporta o centro da caixa em pixels originais com visibilidade 1; ausência da classe usa `0,0,0,0`. Outras classes não entram no CSV. Mais de uma caixa da classe escolhida na mesma imagem bloqueia a exportação, sem escolher uma arbitrariamente. `status` é sempre 0, pois não há anotação de eventos. O formato segue a convenção de [posição e visibilidade do CoachAI/TrackNet](https://inoliao.github.io/CoachAI/); variantes de treinamento podem exigir adaptação.

Os nomes dos arquivos exportados são sanitizados para extração segura. Colisões recebem sufixos como `__2`, mantendo o pareamento entre imagem e anotação. Os bytes das imagens originais são preservados e nenhuma dependência nova é necessária. Importar novamente a mesma pasta adiciona outro lote, preservando as anotações existentes. Pastas devem ser abertas pelo seletor; arrastar continua aceitando arquivos individuais.

Para manter a compatibilidade com o [carregador do Ultralytics](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/data/utils.py), pastas internas chamadas `images` são renomeadas para `_images` no ZIP YOLO (com sufixo em caso de colisão). GIF bloqueia a exportação YOLO com mensagem para converter os frames para PNG/JPEG antes de importar; não há omissão silenciosa nem extração automática de frames.

Arquivos JSON têm limite de 256 MiB. O modelo valida IDs, referências de classes, cores hexadecimais, números finitos, caixas dentro da imagem e origens locais. O contrato suporta até 500 imagens, 1.000 classes, 10.000 caixas por imagem e 100.000 por projeto, com até 128 MiB de fontes. A interface exige ao menos uma imagem e uma classe ao reabrir um projeto e confere a decodificação e as dimensões originais antes da troca.

## Verificar

```sh
npm test
npm run test:ui
npm run fixtures
```

Os testes Node cobrem coordenadas, bordas fracionárias, dados inválidos, ida e volta do JSON, limites, commit/abort do IndexedDB, isolamento do Electron, privacidade do servidor local e conteúdo/CRC dos ZIPs YOLO e TrackNet. `test:ui` abre uma janela oculta do Electron com banco temporário separado, verifica os fluxos de anotação, importação de arquivos e pastas, persistência e exportação nos três formatos, e encerra. Ele precisa do executável do Electron instalado.

`test-images/valid` contém dez imagens sintéticas PNG/JPEG para testes manuais. `test-images/invalid` contém quatro arquivos corrompidos e dois formatos não aceitos. `manifest.json` registra dimensões e caixas esperadas em pixels. `npm run fixtures` regenera e verifica esse conjunto sem downloads.

O teste de interface também anota essas imagens por eventos reais de ponteiro, verifica zoom/rolagem, oito alças, classes, atalhos, limites, trava entre janelas e um download real. Gera capturas e resultados em `test-results/`, que fica fora do Git. Veja [o relatório de QA](docs/QA-interface.md) para cobertura, correções e limites da verificação.

## Estrutura

- `src/app.js` e `src/styles.css`: interface DOM/SVG, sem HTML canvas ou canvas infinito.
- `src/model.js`: geometrias e validação do contrato.
- `src/storage.js`: IndexedDB; gravações só são confirmadas após o commit.
- `src/export.js`: conversão YOLO/TrackNet e empacotamento ZIP local.
- `electron/main.cjs`: aplicativo desktop com isolamento, sandbox, CSP no HTML, bloqueio de navegação externa e permissões.
- `scripts/serve.js`: prévia local sem dependências adicionais.

JavaScript nativo e Electron são suficientes nesta etapa. Integração MCP, agentes de anotação, aprendizado de padrões e instalador ficam para próximas entregas.
