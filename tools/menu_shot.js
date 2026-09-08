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

  // 点进「设置」（3 项 ≤8）：圆盘子层（大小/调试动作/设置）
  await ev(`
    [...document.querySelectorAll('.rm-item .rm-label')].find((e) => e.textContent === '设置').closest('button').click()
  `);
  await sleep(900);
  await win.capturePage().then((img) => fs.writeFileSync(`${out}_grid.png`, img.toPNG()));

  // 标记菜单验证：右键按下（不换位置）→ 移动到「大小」扇形上松手 → 应激活
  const st = await ev(`(async () => {
    const st = menuState;
    const sel = st.sectors.find((s) => s.item.label === '大小');
    const ang = sel.angle * Math.PI / 180;
    const r = 98;
    const x = st.cx + Math.cos(ang) * r, y = st.cy + Math.sin(ang) * r;
    document.querySelector('.rm-backdrop').dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: x, clientY: y, bubbles: true }));
    return document.title;
  })()`);
  console.log('diag sector-release', st);
  // 松手后应进入「大小」的档位层（5 项）
  const lv = await ev(`(async () => {
    return { level: menuState.level, items: [...document.querySelectorAll('.rm-item .rm-label')].map((e) => e.textContent).join(',') };
  })()`);
  console.log('diag after-release', JSON.stringify(lv));
  // 在「标准」档位上松手 → 应触发 menuSelect
  const st3 = await ev(`(async () => {
    const st = menuState;
    const sel = st.sectors.find((s) => s.item.label.startsWith('标准'));
    const ang = sel.angle * Math.PI / 180;
    const r = 98;
    const x = st.cx + Math.cos(ang) * r, y = st.cy + Math.sin(ang) * r;
    document.querySelector('.rm-backdrop').dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: x, clientY: y, bubbles: true }));
    return document.title;
  })()`);
  console.log('diag size-release', st3);
  // 圆心松手：不算点击（标题不应变）
  const st2 = await ev(`(async () => {
    const st = menuState;
    document.querySelector('.rm-backdrop').dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: st.cx + 5, clientY: st.cy + 5, bubbles: true }));
    return document.title;
  })()`);
  console.log('diag hub-release', st2);

  app.quit();
});
