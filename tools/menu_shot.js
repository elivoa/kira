// 菜单截图工具：加载 src/menu_test.html（stub + 真实 overlay.js），展开星盘菜单截图。
// 用法：npx electron tools/menu_shot.js [outPrefix]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'shots/menu';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: false });
  await win.loadFile(path.join(__dirname, '..', 'src', 'menu_test.html'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (code) => win.webContents.executeJavaScript(code);

  console.log('diag', await ev(`innerWidth + 'x' + innerHeight`));

  // 一级：圆盘（10 项）
  await ev('window.__openMenu({x: 640, y: 400})');
  await sleep(900);
  console.log('diag hub', await ev(`(document.querySelector('.rm-hub')||{}).style?.left + ',' + (document.querySelector('.rm-hub')||{}).style?.top`));
  console.log('diag items', await ev(`
    [...document.querySelectorAll('.rm-item')].map((it) =>
      (it.querySelector('.rm-label')||{}).textContent + '@' + it.style.left + ',' + it.style.top +
      ' op=' + it.style.opacity + ' tf=' + it.style.transform).join(' | ')
  `));
  await win.capturePage().then((img) => fs.writeFileSync(`${out}_circle.png`, img.toPNG()));

  // 点进「杂耍」（10 项 >8）：网格列表
  await ev(`
    [...document.querySelectorAll('.rm-item .rm-label')].find((e) => e.textContent === '杂耍').closest('button').click()
  `);
  await sleep(900);
  await win.capturePage().then((img) => fs.writeFileSync(`${out}_grid.png`, img.toPNG()));

  app.quit();
});
