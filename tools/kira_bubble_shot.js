// kira 消息泡泡截图：桩 preload + 真实 kira_bubble.html。
// 用法：npx electron tools/kira_bubble_shot.js [out]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'shots/kira_bubble.png';

const stub = `
const { contextBridge } = require('electron');
let showFn = null;
contextBridge.exposeInMainWorld('pet', {
  onKiraBubbleShow(fn) { showFn = fn; },
  kiraBubbleDismiss() { document.title = 'DISMISS'; },
  kiraBubbleOpen() { document.title = 'OPEN'; },
  kiraBubbleIgnore() {},
  __fire(text) { if (showFn) showFn({ text }); },
});
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 560, height: 480, show: true, frame: false, transparent: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'kb_stub_preload.js') },
  });
  fs.writeFileSync(path.join(__dirname, 'kb_stub_preload.js'), stub);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg.slice(0, 300)));
  await win.loadFile(path.join(__dirname, '..', 'src', 'kira_bubble.html'));
  await sleep(800);
  const st = await win.webContents.executeJavaScript(`
    window.pet.__fire && window.pet.__fire('**舆情盯梢（9/7 周一）**\\n\\n- **9/2 晚点 LatePost 独家**：月之暗面递表港交所\\n- 同步推进 Pre-IPO 轮\\n\\n一句话：**月底那场发布不只是产品战**');
    ({ hasShow: !!window.__show, cls: document.getElementById('kb').className, op: getComputedStyle(document.getElementById('kb')).opacity, html: document.getElementById('kbText').innerHTML.slice(0, 100) })
  `);
  console.log('diag', JSON.stringify(st));
  await sleep(500);
  await win.webContents.executeJavaScript(`document.body.style.background = '#2b2f3a'`);
  await sleep(100);
  await win.capturePage().then((img) => fs.writeFileSync(out, img.toPNG()));
  console.log('shot ok');
  app.quit();
});
