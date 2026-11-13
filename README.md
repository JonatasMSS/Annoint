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
- Criação, seleção, movimento e redimensionamento de caixas, com limites da imagem e zoom.
- Edição de classe e coordenadas no inspetor, em pixels da imagem original.
- Criação e edição de nomes e cores das classes.
- Exclusão de anotações, desfazer e refazer (até 30 alterações na sessão).
- Miniaturas, navegação por teclado, filtros e progresso. Imagens sem objetos também podem ser concluídas.
- Autosalvamento em IndexedDB com status de erro e nova tentativa.
- Exportação e reabertura do projeto em JSON, com imagens incorporadas e validação antes da troca.

Atalhos: **B** caixa, **V** selecionar, **←/→** navegar, **C** concluir, **Delete** excluir, **Esc** cancelar, **Ctrl+Z** desfazer e **Ctrl+Y/Ctrl+Shift+Z** refazer. No Mac, use **⌘**. A ajuda e a lista de atalhos também estão na interface.

## Dados e limites

Há um projeto local ativo. Abrir outro pede confirmação antes de substituir o atual. Exporte JSON para guardar outras cópias. Os arquivos permanecem no dispositivo; nenhuma imagem é enviada a um servidor. A cópia local depende do espaço disponível e pode ser apagada ao limpar os dados do aplicativo/navegador.

A importação de imagens pela interface aceita até 100 imagens no projeto, 15 MiB por arquivo, 80 MiB de fontes em base64, 30.000 px por lado e 100 milhões de pixels por imagem. GIFs animados permanecem animados; a anotação é por arquivo, sem extração de frames nesta entrega.

O JSON é um formato próprio, versão 1, com `labels` e `images`. Cada imagem mantém `id`, `name`, `src`, `width`, `height`, `reviewed` e `annotations`. Cada anotação tem `id`, `labelId`, `x`, `y`, `width` e `height`. As coordenadas são absolutas, em pixels naturais. Imagens importadas são incorporadas como data URLs; o exemplo acompanha o aplicativo em `assets/demo-street.svg`.

Arquivos JSON têm limite de 256 MiB. O modelo valida IDs, referências de classes, cores hexadecimais, números finitos, caixas dentro da imagem e origens locais. O contrato suporta até 500 imagens, 1.000 classes, 10.000 caixas por imagem e 100.000 por projeto, com até 128 MiB de fontes. A interface exige ao menos uma imagem e uma classe ao reabrir um projeto e confere a decodificação e as dimensões originais antes da troca.

## Verificar

```sh
npm test
npm run test:ui
```

Os testes Node cobrem coordenadas, bordas fracionárias, dados inválidos, ida e volta do JSON, limites, commit/abort do IndexedDB, isolamento do Electron e privacidade do servidor local. `test:ui` abre uma janela oculta do Electron com banco temporário separado, verifica os fluxos de anotação, importação, persistência e exportação, e encerra. Ele precisa do executável do Electron instalado.

## Estrutura

- `src/app.js` e `src/styles.css`: interface DOM/SVG, sem HTML canvas ou canvas infinito.
- `src/model.js`: geometrias e validação do contrato.
- `src/storage.js`: IndexedDB; gravações só são confirmadas após o commit.
- `electron/main.cjs`: aplicativo desktop com isolamento, sandbox, CSP no HTML, bloqueio de navegação externa e permissões.
- `scripts/serve.js`: prévia local sem dependências adicionais.

JavaScript nativo e Electron são suficientes nesta etapa. Integração MCP, agentes de anotação, aprendizado de padrões, exportação para formatos de treino e instalador ficam para próximas entregas.
