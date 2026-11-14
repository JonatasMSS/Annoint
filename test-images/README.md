# Imagens sintéticas para testar o Anoint

Conjunto pequeno, sem fotos, downloads ou dependências novas. Gerado com Node padrão e Electron já instalado. Não contém projeto pré-anotado: importe os arquivos e desenhe as caixas indicadas em manifest.json.

## Uso manual

1. Em Importar pasta, escolha valid: devem entrar 10 imagens, incluindo todas as subpastas. Os nomes começam com valid/. PNG e JPEG estão presentes. Nenhum arquivo válido deve ser rejeitado.
2. seq2/frame2.PNG vem antes de seq2/frame10.png; a pasta seq2 vem antes de seq10. Ambos os frame10.png são mantidos, com caminhos distintos e retângulos em posições diferentes.
3. O quadro 640×360 testa paisagem; 240×480 testa retrato; 128×128 testa quadrado e objetos nas bordas; 8×8 contém um retângulo de exatamente 4×4; o PNG 160×96 tem fundo transparente e vermelho com alpha 128/255. O nome ação – verão 01.png está dentro de uma pasta com espaços.
4. valid/seq2/frame2.PNG está vazio de objetos e serve como negativo. Teste fit/zoom, navegação, criação/movimento de caixas, desfazer/refazer, conclusão e reabertura.
5. Em Importar pasta, escolha invalid: quatro arquivos com extensões aceitas devem falhar na decodificação; TXT e SVG são ignorados. Nenhuma imagem é adicionada. O SVG é uma imagem válida de 40×24, mas esse formato não é aceito pela importação atual.
6. Ao escolher test-images inteiro, são aceitas 10 imagens, quatro falham e quatro arquivos são ignorados (TXT, SVG, este README e manifest.json). Erros podem aparecer no toast com caminhos, sem abortar as imagens válidas.

A importação avulsa usa apenas o basename; dois frame10.png podem aparecer com o mesmo nome, mas IDs distintos. Reimportar o lote também duplica as imagens. Confira folderScenarios para os nomes e a ordem exatos. As contagens pressupõem espaço no projeto: a demonstração já conta como uma imagem no limite de 100.

## Caixas esperadas

manifest.json lista todos os arquivos, dimensões decodificadas, SHA-256, tamanhos, resultados esperados e caixas em pixels naturais. Vermelho = #ef4444; azul = #2563eb. alpha é uma propriedade da cor do objeto sintético, não um campo da anotação. As caixas seguem o retângulo desenhado antes da compressão; JPEG pode apresentar pequenas bordas de compressão. A imagem não traz textos, sombras ou marcas adicionais.

A importação sempre inicia com annotations:[] e reviewed:false; o manifesto não é importado como projeto. O conjunto válido usa PNG e JPEG, ambos verificáveis com nativeImage neste ambiente. Não há fixtures acima dos limites de memória/tamanho, BMP, GIF, AVIF, WebP válido ou EXIF.

## Reprodução e checagem

No PowerShell, use caminhos absolutos (ajuste somente a raiz se mover o projeto):

~~~powershell
& "C:\Users\gears\OneDrive\Desktop\Anoint\node_modules\electron\dist\electron.exe" "C:\Users\gears\OneDrive\Desktop\Anoint\scripts\create-test-images.cjs"
~~~

O script grava exclusivamente em test-images ao lado de scripts, sobrescreve os arquivos conhecidos e não remove arquivos extras. Ele usa o decodificador real nativeImage do Electron, sem carregar a aplicação, criar renderer ou usar canvas; verifica dimensões dos formatos aceitos, corrupção e alpha. O SVG é um caso de formato não aceito e só tem dimensões declaradas. Usa perfil temporário, não o banco do usuário. O comando retorna código 0 somente se todas as checagens passarem.

Os bytes são determinísticos para a mesma versão de Node/zlib/Electron; não há sorteio, relógio, caminho absoluto nem metadados de data nos arquivos gerados. JPEG usa o encoder do Electron com qualidade 90. Duas execuções devem produzir os mesmos SHA-256, inclusive do manifesto e deste README. verification registra a versão do Electron usada.

As expectativas de importação foram extraídas do código atual e dos testes existentes. A checagem do gerador decodifica os arquivos de verdade; não automatiza a UI do Anoint nem altera seus dados. Se incluir arquivos extras aqui, ajuste as contagens de pasta.
