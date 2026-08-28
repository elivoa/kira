// 截图工具（Electron 主进程）：加载指定页面，按 spec 执行 JS 后逐张截图
// 用法：SHOT_PAGE=src/menu_test.html node node_modules/electron/cli.js tools/shot.js spec.json
// spec 格式：[{ "name": "menu_root", "js": "...", "wait": 500 }]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const specFile = process.argv[2];
let spec = [{ name: 'page', js: '', wait: 600 }];
if (specFile) spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));

const PAGE = process.env.SHOT_PAGE || 'src/shot.html';
const OUT_DIR = path.join(__dirname, '..', 'shots');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: Number(process.env.SHOT_W || 1280), height: Number(process.env.SHOT_H || 800),
    show: false, frame: false,
    enableLargerThanScreen: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', PAGE));

  // 等页面 READY（title 变化）
  for (let i = 0; i < 100; i++) {
    const t = await win.webContents.executeJavaScript('document.title');
    if (t === 'READY') break;
    if (t && t.startsWith('ERR')) { console.error(t); app.exit(1); }
    await new Promise(r => setTimeout(r, 100));
  }

  for (const step of spec) {
    if (step.js) {
      try {
        await win.webContents.executeJavaScript(step.js);
      } catch (e) {
        console.error('step js error [' + step.name + ']:', e.message || e);
      }
    }
    await new Promise(r => setTimeout(r, step.wait || 300));
    const t = await win.webContents.executeJavaScript('document.title').catch(() => '');
    if (t && t !== 'READY') console.log('[' + step.name + '] title:', t);
    const img = await win.webContents.capturePage();
    const file = path.join(OUT_DIR, step.name + '.png');
    fs.writeFileSync(file, img.toPNG());
    console.log('shot:', file);
  }
  app.exit(0);
});
