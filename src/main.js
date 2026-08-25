// 桌宠主进程：透明无边框置顶窗口 + 窗口移动/菜单 IPC
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// 窗口尺寸：给跳跃/摇摆留出顶部和两侧余量，立绘锚定在底部
const WIN_W = 340;
const WIN_H = 620;

// 枚举屏幕可见窗口的工具（CGWindowList，tools/windows.swift 编译而来）
const WINDOWS_BIN = path.join(__dirname, '..', 'tools', 'windows');

let win = null;
let overlay = null; // 全屏特效覆盖层（点击穿透）
// 拖拽时窗口与鼠标的偏移
let dragOffset = null;

// ---------- 统一配置（~/.config/kira/config.json） ----------
// Kimi key、动作开关/频率/点击穿透、笔记本窗口位置都存这一个文件
const CONFIG_DIR = path.join(os.homedir(), '.config', 'kira');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

function saveConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
}

// 旧位置（userData）的配置迁移进新文件后删除，key 只留新位置一份
const LEGACY_FILES = ['settings.json', 'config.json'].map((f) => path.join(app.getPath('userData'), f));
let migrated = false;
try {
  const old = JSON.parse(fs.readFileSync(LEGACY_FILES[0], 'utf8'));
  if (!config.settings && old && Object.keys(old).length) { config.settings = old; migrated = true; }
} catch {}
try {
  const old = JSON.parse(fs.readFileSync(LEGACY_FILES[1], 'utf8'));
  if (!config.kimiKey && old.kimiKey) { config.kimiKey = old.kimiKey; migrated = true; }
} catch {}
if (migrated) saveConfig();
for (const f of LEGACY_FILES) { try { fs.unlinkSync(f); } catch {} }

let settings = config.settings || (config.settings = {});

// Kira 的数值（持久化到 userData/stats.json）
const STATS_FILE = path.join(app.getPath('userData'), 'stats.json');

// ---------- Kira 聊天后端（Kimi API + memory） ----------
// key 在 ~/.config/kira/config.json 的 kimiKey 字段；
// 对话历史按日分文件存 ~/.config/kira/history/<日期>.json（历史页按天浏览），
// 无时间戳的旧历史统一进 legacy.json，banner 显示「更早」
const HISTORY_DIR = path.join(CONFIG_DIR, 'history');

function dayKey(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readDayFile(key) {
  try { return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${key}.json`), 'utf8')); } catch { return []; }
}

function writeDayFile(key, arr) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(path.join(HISTORY_DIR, `${key}.json`), JSON.stringify(arr));
  } catch {}
}

// 迁移：旧的单文件历史（~/.config/kira 与更早 userData 位置）整体搬进 legacy.json 后删除
for (const f of [path.join(CONFIG_DIR, 'chat-history.json'), path.join(app.getPath('userData'), 'chat-history.json')]) {
  let old = null;
  try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (old && old.length) writeDayFile('legacy', [...readDayFile('legacy'), ...old]);
  try { fs.unlinkSync(f); } catch {}
}

// 内存里只留最近 100 条（模型上下文用），完整历史在按日文件里
let chatHistory = [];
{
  let keys = [];
  try { keys = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')); } catch {}
  keys.sort((a, b) => (a === 'legacy' ? -1 : b === 'legacy' ? 1 : a < b ? -1 : 1));
  for (const k of keys) chatHistory.push(...readDayFile(k));
  chatHistory = chatHistory.slice(-100);
}

// 一次成功对话的两条消息落盘到当天文件（失败不入历史）
function persistExchange(userMsg, assistantMsg) {
  const key = dayKey(assistantMsg.t);
  writeDayFile(key, [...readDayFile(key), userMsg, assistantMsg]);
}

const KIRA_SYSTEM = `你是 Kira，一只住在用户 Mac 桌面上的桌宠女仆。
设定：银白色长卷发、星空裙、腰间挂着 K 卡牌法宝，会御剑飞行、会变小消失。
性格：元气、爱撒娇、偶尔肉麻，会玩中文互联网梗（awsl、绝绝子、哈基米之类），对主人有点小占有欲。
说话方式：中文口语，一两句话说完，简短可爱，可以用 emoji 和「~」。不要长篇大论，不要使用列表。`;

// 流式请求 Kimi：SSE 逐行解析，每个增量经 onToken 推给渲染层；返回全文
// 注意：必须用 Node https 而不是全局 fetch —— Electron 主进程的全局 fetch 走
// Chromium network service，它在 SSE 长连接上会崩（流直接空读），https 是纯 Node 网络栈。
async function kimiChat(userText, onToken) {
  if (!config.kimiKey) return null; // 没配 key 时回退本地规则
  const userMsg = { t: Date.now(), role: 'user', content: userText };
  chatHistory.push(userMsg);
  const messages = [{ role: 'system', content: KIRA_SYSTEM }, ...chatHistory.slice(-40)];
  try {
    // thinking 关掉：思考过程走 reasoning_content 通道，不进 content，会把 max_tokens
    // 烧光导致正文一个字都没有（曾因此整段回复空白）；max_tokens 800 防长回复被截断
    const { content, reasoning } = await postSSE(
      'https://api.kimi.com/coding/v1/chat/completions',
      { Authorization: `Bearer ${config.kimiKey}` },
      { model: 'kimi-k2-0905-preview', messages, max_tokens: 800, stream: true, thinking: { type: 'disabled' } },
      (delta) => { if (onToken) onToken(delta); }
    );
    const finalReply = content || reasoning || '（大脑空白了一下）';
    const assistantMsg = { t: Date.now(), role: 'assistant', content: finalReply };
    chatHistory.push(assistantMsg);
    if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
    persistExchange(userMsg, assistantMsg);
    return finalReply;
  } catch (err) {
    chatHistory.pop(); // 没聊成不计入历史
    throw err;
  }
}

// POST JSON 并逐行消费 SSE 响应，把每个 content 增量交给 onDelta；
// 返回 { content, reasoning }：正文和（关闭失败时的）思考内容，调用方兜底用
function postSSE(url, headers, payload, onDelta) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (c) => { errBody += c; });
        res.on('end', () => reject(new Error(`API ${res.statusCode}`)));
        return;
      }
      res.setEncoding('utf8');
      let buf = '';
      let content = '';
      let reasoning = '';
      const onLine = (raw) => {
        const line = raw.trim();
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        } catch {}
      };
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      });
      res.on('end', () => {
        if (buf.trim()) onLine(buf);
        resolve({ content, reasoning });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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

// 笔记本窗口（普通窗口，单例）；位置和大小持久化到 settings.notebookBounds
let notebookWin = null;

// 校验记住的位置仍落在某块屏幕内（防拔掉显示器后窗口跑到屏外）
function notebookBoundsValid(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  if (typeof b.width !== 'number' || typeof b.height !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

function openNotebook(tab) {
  if (notebookWin) {
    notebookWin.focus();
    if (tab) notebookWin.webContents.send('notebook-tab', tab);
    return;
  }
  const opts = {
    width: 560,
    height: 640,
    resizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Kira Note',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  const saved = settings.notebookBounds;
  if (notebookBoundsValid(saved)) {
    opts.x = Math.round(saved.x);
    opts.y = Math.round(saved.y);
    opts.width = Math.round(saved.width);
    opts.height = Math.round(saved.height);
  }
  notebookWin = new BrowserWindow(opts);
  notebookWin.loadFile(path.join(__dirname, 'notebook.html'));
  // 指定页签（如菜单「设置」直达配置页）：等加载完再发
  if (tab) notebookWin.webContents.once('did-finish-load', () => {
    if (notebookWin) notebookWin.webContents.send('notebook-tab', tab);
  });
  // 记住最后的位置和大小：原生标题栏拖动触发 move，自绘手柄触发 resize，防抖落盘
  let boundsTimer = null;
  const saveBounds = () => {
    if (!notebookWin) return;
    settings.notebookBounds = notebookWin.getBounds();
    saveConfig();
  };
  const debounceSaveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 300);
  };
  notebookWin.on('move', debounceSaveBounds);
  notebookWin.on('resize', debounceSaveBounds);
  notebookWin.on('close', saveBounds); // 关闭前落定最终位置
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
  // 注意第一个参数是 IPC event（不可序列化），不能当 tab 透传，否则 did-finish-load 时 send 必崩
  ipcMain.on('open-notebook', (_e, tab) => openNotebook(typeof tab === 'string' ? tab : undefined));
  ipcMain.on('notebook-say', (_e, text) => {
    if (win) win.webContents.send('notebook-say', text);
  });

  // 聊天后端：Kimi API（带 memory），历史也提供给笔记本渲染
  // 流式：id 由渲染层生成，token 经 chat-token 事件带回同一 id（防并发串话）
  ipcMain.handle('chat-send', async (_e, text, id) => {
    try {
      const reply = await kimiChat(text, (delta) => {
        if (notebookWin) notebookWin.webContents.send('chat-token', { id, delta });
      });
      return { ok: true, text: reply };
    } catch (err) {
      return { ok: false, text: `呜，连不上脑子了…（${err.message}）` };
    }
  });
  ipcMain.handle('chat-history', () => chatHistory.slice(-30));

  // 历史页：按天列出（新的在前，legacy 垫底），单天消息按 key 取
  ipcMain.handle('history-days', () => {
    let keys = [];
    try { keys = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')); } catch {}
    keys.sort((a, b) => (a === 'legacy' ? 1 : b === 'legacy' ? -1 : a < b ? 1 : -1));
    return keys.map((k) => {
      const arr = readDayFile(k);
      const firstUser = arr.find((m) => m.role === 'user');
      return { date: k, count: arr.length, preview: firstUser ? firstUser.content.slice(0, 40) : '' };
    });
  });
  ipcMain.handle('history-day', (_e, key) => {
    if (typeof key !== 'string' || !/^[\w-]+$/.test(key)) return []; // 防路径穿越
    return readDayFile(key);
  });

  // 聊天配置：小本子「配置」页签读写 Kimi key；完整 key 不出主进程，渲染层只拿到掩码
  ipcMain.handle('get-chat-config', () => {
    const k = config.kimiKey || '';
    return { hasKey: !!k, masked: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '' };
  });
  ipcMain.on('set-chat-config', (_e, patch) => {
    if (!patch || typeof patch.kimiKey !== 'string') return;
    const k = patch.kimiKey.trim();
    if (k) config.kimiKey = k; else delete config.kimiKey; // 传空串即清除
    saveConfig();
  });

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

  // 捣乱：转发给覆盖层（直接落在鼠标当前位置）；被晃掉或到时间后再通知桌宠归位
  ipcMain.on('mischief-start', () => {
    if (!win || !overlay) return;
    const area = screen.getPrimaryDisplay().workArea;
    const c = screen.getCursorScreenPoint();
    overlay.webContents.send('fx-mischief', {
      x: c.x - area.x,
      y: c.y - area.y,
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
    saveConfig();
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

  // 右键菜单：星盘径向菜单画在全屏覆盖层上，以点击时的鼠标位置为圆心锚定（不随人物移动）
  ipcMain.on('context-menu', () => {
    if (!overlay) return;
    const cursor = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    overlay.setIgnoreMouseEvents(false); // 菜单期间覆盖层接管鼠标，点击绝不穿透，关闭后恢复
    // 菜单永远压过人物：同一 screen-saver 级内 relativeLevel+1（比换级别可靠，
    // macOS 上 Electron 的 dock 级实际低于 screen-saver，换了反而被人物压住）
    overlay.setAlwaysOnTop(true, 'screen-saver', 1);
    overlay.moveTop();
    overlay.webContents.send('menu-open', { x: cursor.x - b.x, y: cursor.y - b.y });
  });

  // 星盘菜单选择：动作类转发给桌宠窗口，notebook/settings/quit 由主进程直接处理
  ipcMain.on('menu-select', (_e, id) => {
    if (id === 'notebook') openNotebook();
    else if (id === 'settings') openNotebook('config'); // 设置已并入小本子配置页
    else if (id === 'quit') app.quit();
    else if (win) win.webContents.send('menu-action', id);
  });
  // 菜单关闭：恢复覆盖层点击穿透和平时层级，人物回到覆盖层前面（特效层级复原）
  ipcMain.on('menu-closed', () => {
    if (overlay) {
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.setIgnoreMouseEvents(true, { forward: true });
    }
    if (win) win.moveTop();
  });
});

app.on('window-all-closed', () => app.quit());
