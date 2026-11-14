# Verificação das cenas na interface

Execução em 14/11/2026, Windows e Electron 44.2.0, com perfil temporário separado do projeto do usuário. Interface DOM/SVG real, entrada de ponteiro pelo Electron, formulários e eventos de teclado. A janela de teste usa renderização offscreen e aguarda pintura para capturar a interface atual.

## Resultados

- Importação das 100 PNGs sem anotações prévias; ordem, dimensões e cache de 100 imagens conferidos. Onze classes configuradas: uma inicial no projeto vazio e dez criadas pelo formulário, preservando nomes e cores.
- As 346 caixas foram desenhadas por eventos de ponteiro e ajustadas pelo inspetor para coincidir exatamente com o gabarito. Conferência de classe e geometria de todas as caixas salvas. Inclui cena com zoom e rolagem.
- Movimento, redimensionamento, reatribuição de classe, exclusão de caixa, desfazer/refazer e Esc durante arraste com autosave pendente verificados. Desfazer exclusão recupera a caixa; o teste a seleciona novamente para editar no inspetor.
- Todas as 100 imagens concluídas, incluindo cinco negativas sem objetos. Navegação por setas, filtros pendente/concluída, miniaturas recolhidas, foco no botão e aumento da área do editor conferidos.
- Uma cópia adicional em memória levou a 101 registros, mantendo somente 100 PNGs físicos. Lotes 100+1, conclusão por lote, troca do cache 100→1→100→1 e seleção/progresso após reload conferidos.
- Downloads reais de JSON e ZIP YOLO dos 101 registros. Classes, contagens, CRC do ZIP, hashes das imagens e coordenadas originais/normalizadas comparados. Reabertura do JSON preservou 347 caixas.
- Exclusão da cópia extra do projeto, com histórico limpo: os exports finais voltaram a 100 imagens, 346 caixas e cinco negativos. Os hashes das 100 PNGs originais permaneceram iguais. TrackNet segue desabilitado.
- Nenhum erro de console no ensaio aprovado. Não foi confirmado defeito da aplicação nesses cenários.

A regressão geral de `scripts/check-ui.cjs` também passou no Electron com `--disable-gpu`, incluindo as fixtures anteriores, persistência, exports, seis lotes/501 imagens, limites de anotações e trava de edição entre renderers.

## Reprodução e evidências

```sh
npm run fixtures:scenes
npm run test:scenes
```

O processo encerra com código diferente de zero se uma conferência falhar. Evidências em `test-results/scenes-ui/` (fora do Git):

- `results.json`: resultado, verificações e limites do ensaio.
- `01-carro.png`, `02-zoom-rolagem.png`, `03-segundo-lote.png`, `04-conjunto-concluido.png`: capturas da interface.
- `scenes-101.json` e `scenes-101-yolo.zip`: exportação cruzando os dois lotes.
- `scenes-annotated.json` e `scenes-yolo.zip`: conjunto final de 100 imagens anotadas. O JSON pode ser aberto pela interface; abrir substitui o projeto ativo após confirmação.

## Limites

O seletor recebe arquivos controlados por DataTransfer; o ensaio específico não usa diálogo nativo, preload ou protocolo de originais. Exclui somente a cópia extra no projeto, sem chamar a Lixeira. Não retestou exclusão nativa do Windows nesta rodada.

As caixas são orientadas pelo gabarito para testar a interface. Este resultado não demonstra conexão MCP, reconhecimento por IA, aprendizagem ou generalização para fotografias. A captura de uma única cena com zoom não substitui uma medição de desempenho em arquivos grandes. Nenhuma fonte de produção foi alterada para fazer o ensaio passar.
