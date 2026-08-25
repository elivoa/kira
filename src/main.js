// 桌宠主进程：透明无边框置顶窗口 + 窗口移动/菜单 IPC
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// 窗口尺寸：给跳跃/摇摆留出顶部和两侧余量，立绘锚定在底部
const WIN_W = 340;
const WIN_H = 620;

// 枚举屏幕可见窗口的工具（CGWindowList，tools/windows.swift 编译而来）
const WINDOWS_BIN = path.join(__dirname, '..', 'tools', 'windows');

let win = null;
let overlay = null; // 全屏特效覆盖层（点击穿透）
let settingsWin = null;
// 拖拽时窗口与鼠标的偏移
let dragOffset = null;

// ---------- 动作开关设置（持久化到 userData/settings.json） ----------
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}

// Kira 的数值（持久化到 userData/stats.json）
const STATS_FILE = path.join(app.getPath('userData'), 'stats.json');

// ---------- Kira 聊天后端（Kimi API + memory） ----------
// key 放在 userData/config.json（不进仓库）；对话历史持久化到 userData/chat-history.json
const CHAT_CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const CHAT_HISTORY_FILE = path.join(app.getPath('userData'), 'chat-history.json');
let chatConfig = {};
try { chatConfig = JSON.parse(fs.readFileSync(CHAT_CONFIG_FILE, 'utf8')); } catch {}
let chatHistory = [];
try { chatHistory = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')); } catch {}

const KIRA_SYSTEM = `你是 Kira，一只住在用户 Mac 桌面上的桌宠女仆。
设定：银白色长卷发、星空裙、腰间挂着 K 卡牌法宝，会御剑飞行、会变小消失。
性格：元气、爱撒娇、偶尔肉麻，会玩中文互联网梗（awsl、绝绝子、哈基米之类），对主人有点小占有欲。
说话方式：中文口语，一两句话说完，简短可爱，可以用 emoji 和「~」。不要长篇大论，不要使用列表。`;

async function kimiChat(userText) {
  if (!chatConfig.kimiKey) return null; // 没配 key 时回退本地规则
  chatHistory.push({ role: 'user', content: userText });
  const messages = [{ role: 'system', content: KIRA_SYSTEM }, ...chatHistory.slice(-40)];
  const resp = await fetch('https://api.kimi.com/coding/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chatConfig.kimiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'kimi-k2-0905-preview', messages, max_tokens: 300 }),
  });
  if (!resp.ok) {
    chatHistory.pop(); // 没聊成不计入历史
    throw new Error(`API ${resp.status}`);
  }
  const data = await resp.json();
  const reply = (data.choices && data.choices[0] && data.choices[0].message.content) || '（大脑空白了一下）';
  chatHistory.push({ role: 'assistant', content: reply });
  if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
  try { fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatHistory)); } catch {}
  return reply;
}

// 动作/交互日志（持久化到 userData/logs.json，最多留 300 条）
const LOG_FILE = path.join(app.getPath('userData'), 'logs.json');
let logs = [];
try { logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}

function saveLogs() {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(logs)); } catch {}
}

function listWindows() {
  return new Promise((resolve) => {
    execFile(WINDOWS_BIN, [], { maxBuffer: 4 * 1024 * 1024, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([]);
      try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
    });
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(area.width - WIN_W - 100),
    y: Math.round(area.height - WIN_H),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认点击穿透，悬到角色身上时渲染层会切回接管
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// 全屏透明覆盖层：画屎痕等需要脱离桌宠窗口的特效，点击穿透
function createOverlay() {
  const area = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
}

// 设置窗口（普通窗口，单例）
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 420,
    height: 760,
    resizable: true,
    title: '桌宠设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// 笔记本窗口（普通窗口，单例）
let notebookWin = null;
function openNotebook() {
  if (notebookWin) { notebookWin.focus(); return; }
  notebookWin = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Kira 的小本子',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  notebookWin.loadFile(path.join(__dirname, 'notebook.html'));
  notebookWin.on('closed', () => { notebookWin = null; });
}

// 把窗口位置限制在主屏工作区内
function clampToScreen(x, y) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - WIN_W),
    y: Math.min(Math.max(y, area.y), area.y + area.height - WIN_H),
  };
}

app.whenReady().then(() => {
  createWindow();
  createOverlay();

  // 行走等自主移动：按增量移动窗口
  ipcMain.on('move-by', (_e, dx, dy) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    const p = clampToScreen(Math.round(x + dx), Math.round(y + dy));
    win.setPosition(p.x, p.y);
  });

  ipcMain.on('drag-start', () => {
    if (!win) return;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = win.getPosition();
    dragOffset = { dx: cursor.x - x, dy: cursor.y - y };
  });

  ipcMain.on('drag-move', () => {
    if (!win || !dragOffset) return;
    const cursor = screen.getCursorScreenPoint();
    const p = clampToScreen(Math.round(cursor.x - dragOffset.dx), Math.round(cursor.y - dragOffset.dy));
    win.setPosition(p.x, p.y);
  });

  ipcMain.on('drag-end', () => { dragOffset = null; });

  // 点击穿透：渲染层根据光标是否在角色上来回切换
  ipcMain.on('mouse-ignore', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(flag, { forward: true });
  });

  // 桌宠当前窗口位置（渲染层自主移动时的基准）
  ipcMain.handle('get-pos', () => (win ? win.getPosition() : [0, 0]));

  // 屏幕可活动范围（暴走/御剑飞行用）
  ipcMain.handle('get-stage', () => {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      minX: area.x, maxX: area.x + area.width - WIN_W,
      minY: area.y, floorY: area.y + area.height - WIN_H,
    };
  });

  // 扔屎：把桌宠位置换算成覆盖层坐标发过去
  ipcMain.on('poop', () => {
    if (!win || !overlay) return;
    const b = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    overlay.webContents.send('fx-poop', {
      fromX: b.x + b.width / 2 - area.x,
      fromY: b.y + b.height * 0.55 - area.y,
    });
  });

  // 化身成剑：转发给覆盖层；剑飞回来再通知桌宠
  ipcMain.on('sword-start', () => {
    if (!win || !overlay) return;
    const b = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    overlay.webContents.send('fx-sword', {
      x: b.x + b.width / 2 - area.x,
      y: b.y + b.height / 2 - area.y,
    });
  });
  ipcMain.on('sword-done', () => {
    if (win) win.webContents.send('sword-end');
  });

  // 笔记本：打开 + 给桌宠带话
  ipcMain.on('open-notebook', openNotebook);
  ipcMain.on('notebook-say', (_e, text) => {
    if (win) win.webContents.send('notebook-say', text);
  });

  // 聊天后端：Kimi API（带 memory），历史也提供给笔记本渲染
  ipcMain.handle('chat-send', async (_e, text) => {
    try {
      const reply = await kimiChat(text);
      return { ok: true, text: reply };
    } catch (err) {
      return { ok: false, text: `呜，连不上脑子了…（${err.message}）` };
    }
  });
  ipcMain.handle('chat-history', () => chatHistory.slice(-30));

  // 笔记本自绘边框：最小化和自定义拉伸
  ipcMain.on('nb-min', () => { if (notebookWin) notebookWin.minimize(); });
  let nbResize = null;
  ipcMain.on('nb-resize-start', () => {
    if (!notebookWin) return;
    const c = screen.getCursorScreenPoint();
    nbResize = { cx: c.x, cy: c.y, size: notebookWin.getSize() };
  });
  ipcMain.on('nb-resize-move', () => {
    if (!notebookWin || !nbResize) return;
    const c = screen.getCursorScreenPoint();
    const w = Math.max(400, nbResize.size[0] + (c.x - nbResize.cx));
    const h = Math.max(380, nbResize.size[1] + (c.y - nbResize.cy));
    notebookWin.setSize(Math.round(w), Math.round(h));
  });
  ipcMain.on('nb-resize-end', () => { nbResize = null; });

  // 兜风：转发给覆盖层；车回来接她时再通知桌宠
  ipcMain.on('drive-start', () => {
    if (!win || !overlay) return;
    const b = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    overlay.webContents.send('fx-drive', { x: b.x + b.width / 2 - area.x });
  });
  ipcMain.on('drive-done', () => {
    if (win) win.webContents.send('drive-end');
  });

  // 捣乱：转发给覆盖层；被晃掉或到时间后再通知桌宠归位
  ipcMain.on('mischief-start', () => {
    if (!win || !overlay) return;
    const b = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    overlay.webContents.send('fx-mischief', {
      x: b.x + b.width / 2 - area.x,
      y: b.y + b.height / 2 - area.y,
    });
  });
  ipcMain.on('mischief-done', () => {
    if (win) win.webContents.send('mischief-end');
  });
  // 覆盖层的点击捕获开关（捣乱时本子区域拦截点击用）
  ipcMain.on('ov-ignore', (_e, flag) => {
    if (overlay) overlay.setIgnoreMouseEvents(flag, { forward: true });
  });

  // 动作开关设置
  ipcMain.handle('get-settings', () => settings);
  ipcMain.on('set-actions', (_e, patch) => {
    Object.assign(settings, patch);
    saveSettings();
    if (win) win.webContents.send('settings-changed', settings);
  });

  // 数值存取
  ipcMain.handle('get-stats', () => {
    try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { return null; }
  });
  ipcMain.on('save-stats', (_e, s) => {
    try { fs.writeFileSync(STATS_FILE, JSON.stringify(s)); } catch {}
  });

  // 日志：存盘 + 实时推给日志窗口
  ipcMain.on('log-append', (_e, entry) => {
    logs.push(entry);
    if (logs.length > 300) logs = logs.slice(-300);
    saveLogs();
    if (notebookWin) notebookWin.webContents.send('log-new', entry);
  });
  ipcMain.handle('get-logs', () => logs);
  ipcMain.on('clear-logs', () => {
    logs = [];
    saveLogs();
  });

  // 找一块可以站上去的窗台：最前台的普通窗口的上沿
  ipcMain.handle('find-ledge', async () => {
    const wins = await listWindows();
    const area = screen.getPrimaryDisplay().workArea;
    const w = wins.find((w) =>
      w.pid !== process.pid &&       // 排除桌宠自己的窗口
      w.w >= 500 && w.h >= 300 &&
      w.y - WIN_H >= area.y &&       // 窗台上沿上方放得下桌宠
      w.y < area.y + area.height - 100 &&
      w.x + w.w > area.x + WIN_W && w.x < area.x + area.width - WIN_W);
    if (!w) return null;
    // 可走动范围，同时夹在窗口边缘和主屏工作区内
    const minX = Math.round(Math.max(w.x + 20, area.x));
    const maxX = Math.round(Math.min(w.x + w.w - WIN_W - 20, area.x + area.width - WIN_W));
    if (maxX <= minX) return null;
    return { minX, maxX, y: Math.round(w.y), floorY: area.y + area.height - WIN_H };
  });

  // 右键菜单
  ipcMain.on('context-menu', () => {
    if (!win) return;
    const menu = Menu.buildFromTemplate([
      { label: '走一走', click: () => win.webContents.send('menu-action', 'walk') },
      { label: '跳一下', click: () => win.webContents.send('menu-action', 'hop') },
      { label: '转个圈', click: () => win.webContents.send('menu-action', 'spin') },
      { label: '撒个娇', click: () => win.webContents.send('menu-action', 'sway') },
      { label: '走了走了', click: () => win.webContents.send('menu-action', 'leave') },
      { label: '变个身', click: () => win.webContents.send('menu-action', 'morph') },
      { label: '切到姐姐形态', click: () => win.webContents.send('menu-action', 'form-normal') },
      { label: '切到Q版形态', click: () => win.webContents.send('menu-action', 'form-chibi') },
      { label: '去窗台玩', click: () => win.webContents.send('menu-action', 'goledge') },
      { label: '暴走模式', click: () => win.webContents.send('menu-action', 'dash') },
      { label: '御剑飞行', click: () => win.webContents.send('menu-action', 'fly') },
      { label: '你讨厌！', click: () => win.webContents.send('menu-action', 'poop') },
      { label: '化身成剑', click: () => win.webContents.send('menu-action', 'sword') },
      { label: '去兜风', click: () => win.webContents.send('menu-action', 'drive') },
      { label: '捣乱', click: () => win.webContents.send('menu-action', 'mischief') },
      { label: '来张桌子', click: () => win.webContents.send('menu-action', 'desk') },
      { label: '收进法宝', click: () => win.webContents.send('menu-action', 'seal') },
      { type: 'separator' },
      { label: '看看状态', click: () => win.webContents.send('menu-action', 'stats') },
      { label: '小本子', click: openNotebook },
      { label: '设置', click: openSettings },
      { label: '退出', click: () => app.quit() },
    ]);
    menu.popup({ window: win });
  });
});

app.on('window-all-closed', () => app.quit());
