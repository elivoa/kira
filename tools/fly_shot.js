// 御剑飞行截图 harness：桩 preload + 真实 renderer，定时捕捉窗内画面（验证新素材不被窗口裁掉）。
// 用法：npx electron tools/fly_shot.js [outPrefix]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'shots/fly';
const SHOT_AT = [1200, 2500, 4000, 5500, 7000, 9000, 12000]; // 触发后毫秒数

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 460, height: 764, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'fly_shot_preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg.slice(0, 160)));
  // 深色桌面底色方便看透明窗内容
  await win.loadFile(path.join(__dirname, '..', 'src', 'fly_shot.html'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  await win.webContents.executeJavaScript('DISPATCH.fly()').catch((e) => console.log('[trigger-error]', String(e).slice(0, 200)));
  const t0 = Date.now();
  for (const at of SHOT_AT) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const img = await win.capturePage();
    fs.writeFileSync(`${out}_${at}ms.png`, img.toPNG());
    console.log('[shot]', at);
  }
  app.quit();
});
