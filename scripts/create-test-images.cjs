const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { deflateSync, crc32 } = require('node:zlib');
const { app, nativeImage } = require('electron');

const output = path.resolve(__dirname, '..', 'test-images');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-test-images-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const colors = { red: [239, 68, 68, 255], blue: [37, 99, 235, 255] };
const box = (labelId, x, y, width, height, alpha = 255) => ({ labelId, x, y, width, height, alpha });
const scenes = [
  { path: 'valid/01-paisagem.png', width: 640, height: 360, boxes: [box('red', 32, 24, 128, 80), box('blue', 420, 220, 180, 100)] },
  { path: 'valid/02-retrato.jpg', width: 240, height: 480, boxes: [box('red', 24, 32, 80, 160), box('blue', 128, 300, 88, 144)] },
  { path: 'valid/03-quadrada.png', width: 128, height: 128, boxes: [box('red', 0, 0, 32, 32), box('blue', 96, 96, 32, 32)] },
  { path: 'valid/04-pequena.png', width: 8, height: 8, boxes: [box('red', 2, 2, 4, 4)] },
  { path: 'valid/05-transparência.png', width: 160, height: 96, transparent: true, boxes: [box('red', 12, 12, 40, 32, 128), box('blue', 128, 72, 32, 24)] },
  { path: 'valid/06-compacta.jpg', width: 48, height: 32, boxes: [box('red', 4, 4, 12, 16), box('blue', 28, 12, 16, 16)] },
  { path: 'valid/cenas com espaço/ação – verão 01.png', width: 320, height: 180, boxes: [box('red', 16, 20, 64, 48), box('blue', 240, 100, 64, 64)] },
  { path: 'valid/seq2/frame2.PNG', width: 96, height: 64, boxes: [] },
  { path: 'valid/seq2/frame10.png', width: 96, height: 64, boxes: [box('red', 8, 16, 16, 16)] },
  { path: 'valid/seq10/frame10.png', width: 96, height: 64, boxes: [box('red', 64, 16, 16, 16)] },
];

function pixels(scene) {
  const data = Buffer.alloc(scene.width * scene.height * 4);
  const background = scene.transparent ? [0, 0, 0, 0] : [241, 245, 249, 255];
  for (let i = 0; i < data.length; i += 4) data.set(background, i);
  for (const item of scene.boxes) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.width > 0 && item.height > 0
      && item.x + item.width <= scene.width && item.y + item.height <= scene.height);
    const color = [...colors[item.labelId].slice(0, 3), item.alpha];
    for (let y = item.y; y < item.y + item.height; y++) {
      for (let x = item.x; x < item.x + item.width; x++) data.set(color, (y * scene.width + x) * 4);
    }
  }
  return data;
}

function png(scene, rgba) {
  const chunk = (name, data) => {
    const type = Buffer.from(name);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(scene.width, 0); header.writeUInt32BE(scene.height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(scene.height * (1 + scene.width * 4));
  for (let y = 0; y < scene.height; y++) rgba.copy(rows, y * (1 + scene.width * 4) + 1, y * scene.width * 4, (y + 1) * scene.width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const mimes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain' };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
const compare = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

app.whenReady().then(async () => {
  const entries = [];
  async function writeAndDecode(relative, data, expected) {
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, data);
    const extension = path.extname(relative).slice(1).toLowerCase();
    const mime = mimes[extension];
    const decodedImage = nativeImage.createFromBuffer(fs.readFileSync(filename));
    const decoded = decodedImage.isEmpty() ? null : decodedImage.getSize();
    assert.deepEqual(decoded, expected, relative + ': dimensões/decodificação inesperadas');
    entries.push({ path: relative, mime, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), decoded });
    return entries.at(-1);
  }
  for (const scene of scenes) {
    const rgba = pixels(scene);
    const encodedPng = png(scene, rgba);
    const extension = path.extname(scene.path).toLowerCase();
    const data = extension === '.jpg' ? nativeImage.createFromBuffer(encodedPng).toJPEG(90)
      : encodedPng;
    const entry = await writeAndDecode(scene.path, data, { width: scene.width, height: scene.height });
    Object.assign(entry, { kind: 'valid', expectedImport: { individual: 'accepted', folder: 'accepted' }, boxes: scene.boxes, transparent: !!scene.transparent });
    if (scene.transparent) {
      const bitmap = nativeImage.createFromBuffer(data).toBitmap();
      assert.equal(bitmap[3], 0);
      assert.equal(bitmap[(12 * scene.width + 12) * 4 + 3], 128);
    }
  }
  const corrupt = [
    ['invalid/01-vazio.png', Buffer.alloc(0)],
    ['invalid/02-texto.jpg', Buffer.from('Isto e texto, nao uma imagem JPEG.\n')],
    ['invalid/03-truncado.png', png(scenes[0], pixels(scenes[0])).subarray(0, 33)],
    ['invalid/04-assinatura-falsa.webp', Buffer.from('RIFF\x04\x00\x00\x00WEBP')],
  ];
  for (const [name, data] of corrupt) {
    Object.assign(await writeAndDecode(name, data, null), { kind: 'corrupt', expectedImport: { individual: 'decode-error', folder: 'decode-error' }, boxes: [] });
  }
  Object.assign(await writeAndDecode('invalid/05-nao-imagem.txt', Buffer.from('Arquivo nao-imagem para testar filtro de pasta.\n'), null), {
    kind: 'unsupported', expectedImport: { individual: 'unsupported-format', folder: 'ignored' }, boxes: [],
  });
  Object.assign(await writeAndDecode('invalid/06-vetor.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect x="4" y="4" width="12" height="12" fill="#ef4444"/></svg>\n'), null), {
    declaredDimensions: { width: 40, height: 24 },
    kind: 'unsupported', expectedImport: { individual: 'unsupported-format', folder: 'ignored' }, boxes: [box('red', 4, 4, 12, 12)],
  });
  const scenario = (selectedDirectory, prefix, ignoredDocumentation = 0) => {
    const files = entries.filter(entry => entry.path.startsWith(prefix)).sort((a, b) => compare(a.path, b.path));
    const name = entry => selectedDirectory + '/' + entry.path.slice(prefix.length);
    return {
      selectedDirectory,
      acceptedNamesInOrder: files.filter(entry => entry.expectedImport.folder === 'accepted').map(name),
      rejectedNames: files.filter(entry => entry.expectedImport.folder === 'decode-error').map(name),
      ignoredNames: [...files.filter(entry => entry.expectedImport.folder === 'ignored').map(name), ...(ignoredDocumentation ? ['test-images/README.md', 'test-images/manifest.json'] : [])].sort(compare),
    };
  };
  const manifest = {
    version: 1,
    generator: 'scripts/create-test-images.cjs',
    coordinates: 'Pixels naturais, origem no canto superior esquerdo; caixas {x,y,width,height}, bordas direita/inferior exclusivas.',
    labels: Object.entries(colors).map(([id, color]) => ({ id, name: id === 'red' ? 'Retângulo vermelho' : 'Retângulo azul', color: '#' + color.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('') })),
    verification: { decoder: 'Electron nativeImage.createFromBuffer', electron: process.versions.electron, validDecoded: scenes.length, corruptRejected: corrupt.length, transparentAlphaChecked: true },
    imageAndInvalidBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    importBehavior: {
      source: 'src/app.js: importImages(files, folder = false)',
      recursiveSelection: 'input webkitdirectory inclui subpastas; image.name preserva webkitRelativePath, inclusive o nome da pasta escolhida.',
      order: 'Intl.Collator en, numeric:true, sensitivity:variant; desempate pela string original.',
      missingMime: 'A extensão é usada quando o MIME não é um tipo aceito; .PNG maiúsculo é reconhecido.',
      duplicateBasename: 'Não há deduplicação: subpastas preservam caminhos distintos; seleção avulsa achata nomes e permite dois frame10.png.',
      repeatedImport: 'Importar novamente adiciona novas imagens com novos IDs.',
      initialAnnotations: 'Importação cria annotations:[] e reviewed:false. As caixas abaixo são referências manuais, não são carregadas automaticamente.',
      limits: '100 imagens no projeto (inclui a demonstração), 15 MiB por arquivo, 80 MiB de origens em base64; dimensões até 30000 por lado e 100 milhões de pixels.',
      individualUnsupported: 'Rejeição se fornecido por drop/automação; o seletor pode ocultar extensões fora do accept.',
    },
    folderScenarios: [scenario('valid', 'valid/'), scenario('invalid', 'invalid/'), scenario('test-images', '', 2), scenario('seq2', 'valid/seq2/')],
    files: entries,
  };
  const readme = [
    '# Imagens sintéticas para testar o Anoint',
    '',
    'Conjunto pequeno, sem fotos, downloads ou dependências novas. Gerado com Node padrão e Electron já instalado. Não contém projeto pré-anotado: importe os arquivos e desenhe as caixas indicadas em manifest.json.',
    '',
    '## Uso manual',
    '',
    '1. Em Importar pasta, escolha valid: devem entrar 10 imagens, incluindo todas as subpastas. Os nomes começam com valid/. PNG e JPEG estão presentes. Nenhum arquivo válido deve ser rejeitado.',
    '2. seq2/frame2.PNG vem antes de seq2/frame10.png; a pasta seq2 vem antes de seq10. Ambos os frame10.png são mantidos, com caminhos distintos e retângulos em posições diferentes.',
    '3. O quadro 640×360 testa paisagem; 240×480 testa retrato; 128×128 testa quadrado e objetos nas bordas; 8×8 contém um retângulo de exatamente 4×4; o PNG 160×96 tem fundo transparente e vermelho com alpha 128/255. O nome ação – verão 01.png está dentro de uma pasta com espaços.',
    '4. valid/seq2/frame2.PNG está vazio de objetos e serve como negativo. Teste fit/zoom, navegação, criação/movimento de caixas, desfazer/refazer, conclusão e reabertura.',
    '5. Em Importar pasta, escolha invalid: quatro arquivos com extensões aceitas devem falhar na decodificação; TXT e SVG são ignorados. Nenhuma imagem é adicionada. O SVG é uma imagem válida de 40×24, mas esse formato não é aceito pela importação atual.',
    '6. Ao escolher test-images inteiro, são aceitas 10 imagens, quatro falham e quatro arquivos são ignorados (TXT, SVG, este README e manifest.json). Erros podem aparecer no toast com caminhos, sem abortar as imagens válidas.',
    '',
    'A importação avulsa usa apenas o basename; dois frame10.png podem aparecer com o mesmo nome, mas IDs distintos. Reimportar o lote também duplica as imagens. Confira folderScenarios para os nomes e a ordem exatos. As contagens pressupõem espaço no projeto: a demonstração já conta como uma imagem no limite de 100.',
    '',
    '## Caixas esperadas',
    '',
    'manifest.json lista todos os arquivos, dimensões decodificadas, SHA-256, tamanhos, resultados esperados e caixas em pixels naturais. Vermelho = #ef4444; azul = #2563eb. alpha é uma propriedade da cor do objeto sintético, não um campo da anotação. As caixas seguem o retângulo desenhado antes da compressão; JPEG pode apresentar pequenas bordas de compressão. A imagem não traz textos, sombras ou marcas adicionais.',
    '',
    'A importação sempre inicia com annotations:[] e reviewed:false; o manifesto não é importado como projeto. O conjunto válido usa PNG e JPEG, ambos verificáveis com nativeImage neste ambiente. Não há fixtures acima dos limites de memória/tamanho, BMP, GIF, AVIF, WebP válido ou EXIF.',
    '',
    '## Reprodução e checagem',
    '',
    'No PowerShell, use caminhos absolutos (ajuste somente a raiz se mover o projeto):',
    '',
    '~~~powershell',
    '& "C:\\Users\\gears\\OneDrive\\Desktop\\Anoint\\node_modules\\electron\\dist\\electron.exe" "C:\\Users\\gears\\OneDrive\\Desktop\\Anoint\\scripts\\create-test-images.cjs"',
    '~~~',
    '',
    'O script grava exclusivamente em test-images ao lado de scripts, sobrescreve os arquivos conhecidos e não remove arquivos extras. Ele usa o decodificador real nativeImage do Electron, sem carregar a aplicação, criar renderer ou usar canvas; verifica dimensões dos formatos aceitos, corrupção e alpha. O SVG é um caso de formato não aceito e só tem dimensões declaradas. Usa perfil temporário, não o banco do usuário. O comando retorna código 0 somente se todas as checagens passarem.',
    '',
    'Os bytes são determinísticos para a mesma versão de Node/zlib/Electron; não há sorteio, relógio, caminho absoluto nem metadados de data nos arquivos gerados. JPEG usa o encoder do Electron com qualidade 90. Duas execuções devem produzir os mesmos SHA-256, inclusive do manifesto e deste README. verification registra a versão do Electron usada.',
    '',
    'As expectativas de importação foram extraídas do código atual e dos testes existentes. A checagem do gerador decodifica os arquivos de verdade; não automatiza a UI do Anoint nem altera seus dados. Se incluir arquivos extras aqui, ajuste as contagens de pasta.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'README.md'), readme);
  const total = manifest.imageAndInvalidBytes + Buffer.byteLength(readme) + fs.statSync(path.join(output, 'manifest.json')).size;
  assert.ok(total < 1024 * 1024, 'Conjunto acima de 1 MiB');
  console.log(JSON.stringify({ output, valid: scenes.length, corrupt: corrupt.length, unsupported: 2, files: entries.length + 2, totalBytes: total, electron: process.versions.electron, checks: 'nativeImage decode, dimensões, alpha e limite de tamanho: OK' }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
