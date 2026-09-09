// 敲门截图 harness：桩 preload + 真实 renderer，定时捕捉敲玻璃全程
// （玻璃独立 overlay 层、人物图上不粘玻璃、收尾淡出无残留）。
// 用法：node_modules/.bin/electron tools/knock_shot.js [outPrefix]
//   SHOT_POS='[1100,500]' 让她敲右侧（玻璃镜像到左边），默认 '[100,500]' 敲左侧
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// 独立 profile 目录：避免与残留 shot 实例抢默认 user-data 锁导致启动挂死
app.setPath('userData', require('os').tmpdir() + `/knockshot-${process.pid}`);

const out = process.argv[2] || 'shots/knock';
fs.mkdirSync(path.dirname(out), { recursive: true });
// 时间轴（触发后毫秒）：knockin 0.3s + knockgo ~0.36s → 0.66s 起 knock 循环
// （aim 0.22 / rap 0.16 / recoil 0.34）×3 → 2.82s knockdone 1.4s → 4.22s 回家玻璃淡出
const SHOT_AT = [700, 1000, 1150, 1600, 1900, 2600, 3400, 4600, 5600];

setTimeout(() => { console.error('watchdog: timeout, abort'); app.exit(2); }, 90000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 460, height: 764, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'fly_shot_preload.js'), contextIsolation: true },
  });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg.slice(0, 160)));
  // 深色桌面底色方便看透明窗内容
  await win.loadFile(path.join(__dirname, '..', 'src', 'fly_shot.html'));
  console.log('[loaded]');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  await win.webContents.executeJavaScript('DISPATCH.knock()').catch((e) => console.log('[trigger-error]', String(e).slice(0, 200)));
  console.log('[triggered]');
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
