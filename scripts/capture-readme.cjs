const electron = require('electron');
const { app, BrowserWindow } = electron;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { registerImageScheme, registerNativeFiles } = require('../electron/native-files.cjs');
const { registerAgent } = require('../electron/agent.cjs');

registerImageScheme(electron.protocol);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anoint-readme-'));
os.homedir = () => path.join(directory, 'client-home');
app.setPath('userData', path.join(directory, 'profile'));
const output = path.resolve(__dirname, '../docs/media');
const artifacts = path.resolve(__dirname, '../test-results/readme');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(artifacts, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let win, encoder, files, agent;
  const watchdog = setTimeout(() => app.exit(1), 120000);
  try {
    const index = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
    files = await registerNativeFiles(electron, app.getPath('userData'), index);
    agent = registerAgent(electron, index);
    win = new BrowserWindow({ show: false, width: 1440, height: 810, useContentSize: true, frame: false, webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
    } });
    const page = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => {
      for (let i = 0; i < 400; i++) { if (await page(code)) return; await pause(30); }
      throw new Error('Capture timeout: ' + code);
    };
    const click = async selector => { await page(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100); };
    await win.loadFile(path.resolve(__dirname, '../index.html'));
    await require('./project-navigation.cjs')(page, wait);
    await wait("document.querySelector('.image-surface > img')?.naturalWidth > 0 && document.querySelectorAll('.annotation').length === 4");
    await click('[data-box="demo-car-1"]');
    await pause(250);
    fs.writeFileSync(path.join(output, 'anoint-app.png'), (await win.webContents.capturePage()).toPNG());

    const raw = path.join(artifacts, 'editor.mp4');
    encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '15', '-i', 'pipe:0',
      '-an', '-vf', 'scale=1440:810', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', raw], { windowsHide: true });
    let encoderError = '';
    encoder.stderr.on('data', chunk => { encoderError += chunk; });
    encoder.stdin.on('error', () => {});
    const encoded = new Promise(resolve => {
      encoder.once('error', resolve);
      encoder.once('exit', code => resolve(code === 0 ? null : new Error(encoderError || 'Encoder failed: ' + code)));
    });
    let frames = 0;
    const hold = async count => {
      const png = (await win.webContents.capturePage()).toPNG();
      for (let i = 0; i < count; i++) {
        if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
        frames++;
      }
    };
    const capture = async name => fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG());
    await hold(75);

    await click('[data-label=car]');
    await click('[data-tool=box]');
    await hold(15);
    const bounds = await page("document.querySelector('.image-surface').getBoundingClientRect().toJSON()");
    const start = { x: bounds.x + bounds.width * 822 / 1440, y: bounds.y + bounds.height * 124 / 900 };
    const end = { x: bounds.x + bounds.width * 941 / 1440, y: bounds.y + bounds.height * 327 / 900 };
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y),
      button: 'left', clickCount: 1, modifiers: type === 'mouseUp' ? [] : ['leftbuttondown'] });
    mouse('mouseDown', start.x, start.y);
    for (let i = 1; i <= 24; i++) {
      mouse('mouseMove', start.x + (end.x - start.x) * i / 24, start.y + (end.y - start.y) * i / 24);
      await pause(35); await hold(1);
    }
    mouse('mouseUp', end.x, end.y);
    await wait("document.querySelectorAll('.annotation').length === 5");
    await hold(36); await capture('draw');

    await click('[data-tool=select]');
    await hold(25);
    await page("{const field=document.querySelector('#box-width');field.focus();field.value='135';field.dispatchEvent(new Event('change',{bubbles:true}));field.blur()}");
    await pause(150); await hold(50); await capture('geometry');

    await click('[data-edit-label=car]');
    await hold(15);
    await page("document.querySelector('#class-name').value='';document.querySelector('#class-name').focus()");
    for (const char of 'Veículo') { await win.webContents.insertText(char); await pause(50); await hold(5); }
    await page("document.querySelector('#class-form').requestSubmit()");
    await wait("!document.querySelector('#class-dialog').open");
    await hold(25); await capture('classes');

    await click('[data-action=export]');
    await hold(75); await capture('export');
    await page("document.querySelector('#export-dialog').close()");
    await click('[data-assistant=open]');
    await hold(50); await capture('mcp');
    await click('[data-assistant=close]');
    await hold(25);
    assert.equal(frames, 450);
    encoder.stdin.end();
    const failure = await encoded;
    if (failure) throw failure;
    fs.writeFileSync(path.join(artifacts, 'capture.json'), JSON.stringify({ source: raw, duration: frames / 15,
      fps: 15, width: 1440, height: 810, profile: 'temporary', scenes: ['editor', 'draw', 'geometry', 'classes', 'export', 'mcp'] }, null, 2) + '\n');
    console.log('Screenshot: ' + path.join(output, 'anoint-app.png'));
    console.log('Source video: ' + raw);
    console.log('Captured 30 seconds from an isolated editor; no MCP credentials were generated.');
    await agent.close(); files.close(); clearTimeout(watchdog); win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); encoder?.kill(); await agent?.close(); files?.close(); win?.destroy(); clearTimeout(watchdog); app.exit(1);
  }
});
