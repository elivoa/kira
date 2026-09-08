// 小本子调试动作页截图：桩 preload + 真实 notebook.html/notebook.js。
// 用法：npx electron tools/notebook_shot.js [out]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const out = process.argv[2] || 'shots/notebook_debug.png';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 620, height: 720, show: false,
    webPreferences: { preload: path.join(__dirname, 'nb_stub_preload.js'), contextIsolation: true },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[page]', msg.slice(0, 200)));
  win.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, String(err).slice(0, 300)));
  win.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', JSON.stringify(d)));
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'notebook.html'));
    await sleep(600);
    // 切到「调试动作」页签
    console.log('diag click', await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="debug"]').click(), 'ok'`));
    await sleep(400);
    console.log('diag btns', await win.webContents.executeJavaScript(`document.querySelectorAll('.dbg-btn').length`));
    // 点一个动作验证触发链
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('.dbg-btn')].find((b) => b.title.startsWith('juggle')).click()`);
    await sleep(200);
    console.log('diag select', await win.webContents.executeJavaScript('document.title'));
    // 切到 kira tab（模拟在线），注入一条 markdown 的 kira 消息和一条用户消息，验证渲染/对齐/背景
    await win.webContents.executeJavaScript(`
      document.getElementById('botTab').classList.remove('hidden');
      document.querySelector('.tab[data-tab="bot"]').click();
    `);
    await sleep(900); // 等 loadBotTab 的空态落定再注入，不然被覆盖
    await win.webContents.executeJavaScript(`
      botMsgs.innerHTML = '';
      botHistory = Array.from({ length: 40 }, (_, i) => ({ t: Date.now(), role: i % 2 ? 'assistant' : 'user', content: '第 ' + (i + 1) + ' 条', id: 'm' + i }));
      botShown = botHistory.length;
      renderBotBatch(false);
      botMsgs.scrollTop = botMsgs.scrollHeight;
    `);
    await sleep(300);
    console.log('diag first-render', await win.webContents.executeJavaScript(`botMsgs.children.length`));
    // 滚到顶，触发动态加载
    await win.webContents.executeJavaScript(`botMsgs.scrollTop = 0; botMsgs.dispatchEvent(new Event('scroll'))`);
    await sleep(300);
    console.log('diag after-scroll', await win.webContents.executeJavaScript(`botMsgs.children.length + ' | first=' + botMsgs.firstElementChild.textContent.slice(0, 20)`));
    await win.capturePage().then((img) => fs.writeFileSync(out.replace('.png', '_bot.png'), img.toPNG()));
  } catch (e) {
    console.log('[shot-error]', String(e).slice(0, 500));
  }
  app.quit();
});
