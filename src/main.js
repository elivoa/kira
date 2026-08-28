// 桌宠主进程：透明无边框置顶窗口 + 窗口移动/菜单 IPC
const { app, BrowserWindow, ipcMain, screen, powerMonitor, dialog, Tray, Menu, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// 窗口基础尺寸：比立绘（512 高）大一圈，给跳跃/旋转/乱飞等会探出身体的动作留余量
// settings._size 是整体缩放系数（配置页滑块），实际窗口尺寸 = 基础尺寸 × 系数
// 注意：特效/道具坐标都标定在 340×620 逻辑画幅上（底部居中对齐窗口），改尺寸不用动它们
const BASE_W = 460;
const BASE_H = 740;
function sizeK() { return settings._size || 1; }
function winW() { return Math.round(BASE_W * sizeK()); }
function winH() { return Math.round(BASE_H * sizeK()); }

// 枚举屏幕可见窗口的工具（CGWindowList，tools/windows.swift 编译而来）
const WINDOWS_BIN = path.join(__dirname, '..', 'tools', 'windows');
// 方向键全局监听（CGEventTap，tools/keys.swift 编译而来）；需要「输入监控」权限，没权限会自行退出
const KEYS_BIN = path.join(__dirname, '..', 'tools', 'keys');

// 启动自检：这两个二进制是 gitignore 的本机编译产物，新机器上没有就现场编译（要 Xcode 命令行工具的 swiftc）
function ensureTool(bin) {
  return new Promise((resolve) => {
    if (fs.existsSync(bin)) return resolve();
    const src = bin + '.swift';
    execFile('swiftc', ['-O', src, '-o', bin], { timeout: 180000 }, (err) => {
      if (err) mainLog('系统', `编译 ${path.basename(bin)} 失败，相关功能不可用（手动跑：swiftc -O tools/${path.basename(src)} -o tools/${path.basename(bin)}）`);
      else mainLog('系统', `首次启动，自动编译了 tools/${path.basename(bin)}`);
      resolve();
    });
  });
}

let win = null;
let overlay = null; // 全屏特效覆盖层（点击穿透）
let bubbleWin = null; // 气泡独立窗口：可以比人物窗口宽很多，字号有下限
let bubbleAnchor = null; // 人物窗口内局部坐标 {x, y, scale}，桌宠每帧上报
let lastBubbleScale = 1;
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

// ---------- 长期记忆 & 聊天工具（function calling） ----------
const MEMORY_FILE = path.join(CONFIG_DIR, 'memory.json');

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { return []; }
}

// system 提示词 = 人设 + 长期记忆（remember_fact 工具写入，最近 30 条）
function systemPrompt() {
  const mem = loadMemory();
  if (!mem.length) return KIRA_SYSTEM;
  return KIRA_SYSTEM + '\n关于主人的长期记忆：\n' + mem.slice(-30).map((m) => `- ${m.fact}`).join('\n');
}

// 聊天可用工具：schema 尽量精简（每轮请求都占 token）
const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'do_action',
      description: '立刻做一个动作表演给主人看。主人要求表演/互动，或你想展示时调用。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['hop', 'spin', 'sway', 'walk', 'fly', 'sword', 'morph', 'desk', 'drive', 'goledge'],
            description: 'hop跳一下 spin转个圈 sway撒娇 walk走一走 fly御剑飞行 sword化身成剑 morph变个身 desk来张桌子 drive去兜风 goledge去窗台玩',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: '把关于主人的重要信息（喜好、生日、习惯、嘱咐等）记进长期记忆，以后的对话都会带上',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: '要记住的一句话事实' } },
        required: ['fact'],
      },
    },
  },
];

// 执行一个工具调用，结果以字符串喂回模型；失败也走结果通道让模型自我恢复
async function runChatTool(tc) {
  let args = {};
  try { args = JSON.parse(tc.function.arguments || '{}'); } catch { return '参数不是合法 JSON'; }
  if (tc.function.name === 'do_action') {
    if (win) win.webContents.send('menu-action', args.action);
    mainLog('大模型', `调用工具 do_action(${args.action})`);
    return `动作 ${args.action} 已开始表演`;
  }
  if (tc.function.name === 'remember_fact') {
    const fact = String(args.fact || '').trim();
    if (!fact) return 'fact 为空，没记住';
    const mem = loadMemory();
    mem.push({ t: Date.now(), fact });
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem.slice(-50), null, 2)); } catch {}
    mainLog('大模型', `调用工具 remember_fact：${fact.slice(0, 20)}`);
    return '记住啦，以后都会记得';
  }
  return `未知工具 ${tc.function.name}`;
}

// 流式请求 Kimi：SSE 逐行解析，每个增量经 onToken 推给渲染层；返回全文
// 注意：必须用 Node https 而不是全局 fetch —— Electron 主进程的全局 fetch 走
// Chromium network service，它在 SSE 长连接上会崩（流直接空读），https 是纯 Node 网络栈。
async function kimiChat(userText, onToken) {
  if (!config.kimiKey) return null; // 没配 key 时回退本地规则
  const userMsg = { t: Date.now(), role: 'user', content: userText };
  chatHistory.push(userMsg);
  const messages = [{ role: 'system', content: systemPrompt() }, ...chatHistory.slice(-40)];
  try {
    // thinking 关掉：思考过程走 reasoning_content 通道，不进 content，会把 max_tokens
    // 烧光导致正文一个字都没有（曾因此整段回复空白）；max_tokens 800 防长回复被截断。
    // 工具循环：模型发 tool_calls 就本地执行并把结果喂回去，最多 4 轮
    let content = '';
    let reasoning = '';
    for (let round = 0; round < 4; round++) {
      const r = await postSSE(
        'https://api.kimi.com/coding/v1/chat/completions',
        { Authorization: `Bearer ${config.kimiKey}` },
        { model: 'kimi-k2-0905-preview', messages, max_tokens: 800, stream: true, thinking: { type: 'disabled' }, tools: CHAT_TOOLS, tool_choice: 'auto' },
        (delta) => { if (onToken) onToken(delta); }
      );
      content += r.content;
      reasoning += r.reasoning;
      if (!r.toolCalls.length) break;
      messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
      for (const tc of r.toolCalls) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: await runChatTool(tc) });
      }
    }
    const finalReply = content || reasoning || '（大脑空白了一下）';
    const assistantMsg = { t: Date.now(), role: 'assistant', content: finalReply };
    chatHistory.push(assistantMsg);
    if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
    persistExchange(userMsg, assistantMsg);
    mainLog('大模型', `回答主人：${userText.slice(0, 30)}`);
    return finalReply;
  } catch (err) {
    chatHistory.pop(); // 没聊成不计入历史
    throw err;
  }
}

// 主动搭话：以最近 10 条对话为上下文，让她主动开口说一两句；不写历史
async function kimiProactive() {
  if (!config.kimiKey) return null;
  const messages = [
    { role: 'system', content: systemPrompt() },
    ...chatHistory.slice(-10),
    { role: 'user', content: '（主人有一阵子没理你了，主动开口说一两句话：可以撒娇、卖萌、玩梗、分享心情或提醒主人休息。要有新鲜感，别和最近说过的话重复。）' },
  ];
  const { content, reasoning } = await postSSE(
    'https://api.kimi.com/coding/v1/chat/completions',
    { Authorization: `Bearer ${config.kimiKey}` },
    { model: 'kimi-k2-0905-preview', messages, max_tokens: 200, stream: true, thinking: { type: 'disabled' } },
    () => {}
  );
  return content || reasoning || null;
}

// POST JSON 并逐行消费 SSE 响应：content 增量经 onDelta 逐字推出；
// 同时按 OpenAI 规范重组流式 tool_calls（id/name 一次给全，arguments 分片拼接，按 index 归组）。
// 返回 { content, reasoning, toolCalls, finishReason }：正文/思考/工具调用/结束原因
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
      let finishReason = '';
      const toolCalls = {};
      const onLine = (raw) => {
        const line = raw.trim();
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const choice = JSON.parse(data).choices?.[0];
          const delta = choice?.delta;
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (delta?.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          if (delta?.reasoning_content) reasoning += delta.reasoning_content;
          if (delta?.tool_calls) {
            for (const c of delta.tool_calls) {
              const k = c.index ?? 0;
              if (!toolCalls[k]) toolCalls[k] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              if (c.id) toolCalls[k].id += c.id;
              if (c.function?.name) toolCalls[k].function.name += c.function.name;
              if (c.function?.arguments) toolCalls[k].function.arguments += c.function.arguments;
            }
          }
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
        resolve({ content, reasoning, toolCalls: Object.values(toolCalls), finishReason });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 智能决策：待机时让模型从候选动作里挑一个并配台词（动作+台词配套）
// 返回 { action: 'id' | 'none', say }；失败抛错，由调用方兜底回退随机
async function decideAction(ctx) {
  const acts = ctx.actions.map((a) => `${a.id}（${a.name}${a.intrusive ? '，会跑到屏幕中间打扰用户' : ''}）`).join('、');
  const s = ctx.stats || {};
  const prompt = `现在是 ${ctx.time}，你以「${ctx.form === 'chibi' ? 'Q版' : '姐姐'}」形态待在用户桌面上，已经 ${ctx.idleSec} 秒没人和你互动了。
你的数值：精 ${Math.round(s.jing ?? 0)}/100（体力）、气 ${Math.round(s.qi ?? 0)}/100（法力）、神 ${Math.round(s.shen ?? 0)}/100（耐心）、心情 ${Math.round(s.mood ?? 0)}/100、透明 ${Math.round(s.touming ?? 0)}/100（高说明被冷落）。
接下来可以做这些动作：${acts}。
最近做过：${(ctx.recent || []).join('、') || '无'}（别总重复）。
结合此刻的状态和心情挑一个最想做的动作，并配一句贴合动作的台词；不想动就休息。
只输出 JSON：{"action":"动作id或none","say":"一句台词"}，台词一两句、简短可爱。`;
  const { content } = await postSSE(
    'https://api.kimi.com/coding/v1/chat/completions',
    { Authorization: `Bearer ${config.kimiKey}` },
    {
      model: 'kimi-k2-0905-preview',
      messages: [{ role: 'system', content: KIRA_SYSTEM }, { role: 'user', content: prompt }],
      max_tokens: 150,
      stream: true,
      thinking: { type: 'disabled' },
    },
    () => {}
  );
  const m = (content || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('决策返回不是 JSON');
  const d = JSON.parse(m[0]);
  if (typeof d.action !== 'string') throw new Error('决策缺 action');
  return { action: d.action, say: typeof d.say === 'string' ? d.say : '' };
}

// 动作/交互日志（持久化到 userData/logs.json，最多留 300 条）
const LOG_FILE = path.join(app.getPath('userData'), 'logs.json');
let logs = [];
try { logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}

function saveLogs() {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(logs)); } catch {}
}

// 主进程侧记日志（和渲染层的 logEvent 走 log-append 效果一致）
function mainLog(type, text) {
  logs.push({ t: Date.now(), type, text });
  if (logs.length > 300) logs = logs.slice(-300);
  saveLogs();
  if (notebookWin) notebookWin.webContents.send('log-new', { t: Date.now(), type, text });
}

function listWindows() {
  return new Promise((resolve) => {
    execFile(WINDOWS_BIN, [], { maxBuffer: 4 * 1024 * 1024, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([]);
      try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
    });
  });
}

// 启动方向键监听：按一次方向键给桌宠窗口发一个 arrow-key 事件
// 没编译 tools/keys 或没有「输入监控」权限时静默降级（只检测晃鼠标），不影响其它功能
function startKeyMonitor() {
  if (!fs.existsSync(KEYS_BIN)) return;
  let child;
  try {
    child = execFile(KEYS_BIN, [], (err) => {
      if (err) console.log('[keys] 监听进程退出（多半是缺输入监控权限）:', err.message.trim());
    });
  } catch { return; }
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      buf = buf.slice(i + 1);
      if (win) win.webContents.send('arrow-key');
    }
  });
  if (child.stderr) child.stderr.on('data', (c) => console.log('[keys]', String(c).trim()));
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: winW(),
    height: winH(),
    x: Math.round(area.width - winW() - 100),
    y: Math.round(area.height - winH()),
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

// 气泡独立窗口：宽度不受人物窗口限制，底边中点锚定人物头顶
const BUBBLE_W = 560;
const BUBBLE_H = 220;

function createBubble() {
  bubbleWin = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
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
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
}

// 按桌宠上报的头顶锚点（窗口局部坐标）换算屏幕位置，夹在当前显示器工作区内
function placeBubble() {
  if (!bubbleWin || !win || !bubbleAnchor) return;
  const b = win.getBounds();
  const a = petDisplay().workArea;
  const cx = b.x + bubbleAnchor.x;
  const top = b.y + bubbleAnchor.y - 6;
  const x = Math.round(Math.min(Math.max(cx - BUBBLE_W / 2, a.x), Math.max(a.x, a.x + a.width - BUBBLE_W)));
  const y = Math.round(Math.min(Math.max(top - BUBBLE_H, a.y), Math.max(a.y, a.y + a.height - BUBBLE_H)));
  const cur = bubbleWin.getBounds();
  if (cur.x !== x || cur.y !== y) bubbleWin.setBounds({ x, y, width: BUBBLE_W, height: BUBBLE_H });
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

// 桌宠当前所在的显示器：所有屏幕相关计算（夹取/活动范围/窗台/特效坐标）都以它为准，支持多显示器
function petDisplay() {
  if (!win) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}
function petArea() { return petDisplay().workArea; }

// 覆盖层跟随桌宠（或指定显示器）所在屏：特效/菜单只存在于一块屏上
function syncOverlay(dpy) {
  if (!overlay) return;
  const a = (dpy || petDisplay()).workArea;
  const b = overlay.getBounds();
  if (b.x === a.x && b.y === a.y && b.width === a.width && b.height === a.height) return;
  overlay.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
}

// 把窗口位置限制在当前显示器工作区内
// 垂直方向允许高出屏幕顶 winH()-160：攀爬动作要沿高窗爬到顶沿，窗口大部可以出屏，
// 保留 160px 可见（立绘脚部），拖拽/走路也不会把她弄丢
function clampToScreen(x, y) {
  const area = petArea();
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - winW()),
    y: Math.min(Math.max(y, area.y - (winH() - 160)), area.y + area.height - winH()),
  };
}

// 整体缩放变化时重设窗口尺寸，保持右下角锚定并夹回屏幕
function applyWindowSize() {
  if (!win) return;
  const b = win.getBounds();
  const w = winW(), h = winH();
  win.setBounds({ x: Math.round(b.x + b.width - w), y: Math.round(b.y + b.height - h), width: w, height: h });
  const p = clampToScreen(win.getPosition()[0], win.getPosition()[1]);
  win.setPosition(p.x, p.y);
}

app.whenReady().then(async () => {
  await Promise.all([ensureTool(WINDOWS_BIN), ensureTool(KEYS_BIN)]); // 首次启动先补齐编译产物
  createWindow();
  createOverlay();
  createBubble();
  win.on('move', placeBubble); // 拖拽/自主走动时气泡窗口跟着走

  // 显示器增删/ Metrics 变化：覆盖层重对屏，桌宠夹回可见区
  const onDisplaysChanged = () => {
    syncOverlay();
    if (win) {
      const [x, y] = win.getPosition();
      const p = clampToScreen(x, y);
      win.setPosition(p.x, p.y);
    }
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
  startKeyMonitor();

  // 菜单栏托盘图标：快速打开 Kira Note / 聊天，或退出
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.setToolTip('Kira');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Kira Note', click: () => openNotebook() },
    { label: '实时聊天', click: () => openNotebook('chat') },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));

  // 熄屏/锁屏/休眠时通知桌宠暂停自主动作，唤醒恢复
  let screenAsleep = false;
  const notifyPower = (locked) => {
    screenAsleep = locked;
    if (win) win.webContents.send('power-state', { locked });
  };
  powerMonitor.on('lock-screen', () => notifyPower(true));
  powerMonitor.on('unlock-screen', () => notifyPower(false));
  powerMonitor.on('suspend', () => notifyPower(true));
  powerMonitor.on('resume', () => notifyPower(false));
  ipcMain.handle('get-power-state', () => screenAsleep);

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

  ipcMain.on('drag-end', () => {
    dragOffset = null;
    syncOverlay(); // 被拎到别的显示器了，覆盖层跟过去
  });

  // 点击穿透：渲染层根据光标是否在角色上来回切换
  ipcMain.on('mouse-ignore', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(flag, { forward: true });
  });

  // 气泡窗口：台词转发、每帧锚点定位、粘性气泡的点击穿透与关闭回执
  ipcMain.on('bubble-say', (_e, data) => {
    if (bubbleWin) bubbleWin.webContents.send('bubble-say', data);
  });
  ipcMain.on('bubble-anchor', (_e, a) => {
    bubbleAnchor = a;
    placeBubble();
    const s = a.scale || 1;
    if (bubbleWin && Math.abs(s - lastBubbleScale) > 0.005) {
      lastBubbleScale = s;
      bubbleWin.webContents.send('bubble-scale', s);
    }
  });
  ipcMain.on('bubble-ignore', (_e, flag) => {
    if (bubbleWin) bubbleWin.setIgnoreMouseEvents(flag, { forward: true });
  });
  ipcMain.on('bubble-dismissed', () => {
    if (win) win.webContents.send('bubble-dismissed');
  });
  ipcMain.on('bubble-hidden', () => {
    if (win) win.webContents.send('bubble-hidden');
  });

  // 桌宠当前窗口位置（渲染层自主移动时的基准）
  ipcMain.handle('get-pos', () => (win ? win.getPosition() : [0, 0]));

  // 全局光标位置（惊吓检测轮询用，macOS 读光标不需要权限）
  ipcMain.handle('get-cursor', () => screen.getCursorScreenPoint());

  // 屏幕可活动范围（暴走/御剑飞行用）：桌宠当前所在显示器
  ipcMain.handle('get-stage', () => {
    const area = petArea();
    return {
      minX: area.x, maxX: area.x + area.width - winW(),
      minY: area.y, floorY: area.y + area.height - winH(),
    };
  });

  // 扔屎：把桌宠位置换算成覆盖层坐标发过去
  ipcMain.on('poop', () => {
    if (!win || !overlay) return;
    syncOverlay();
    const b = win.getBounds();
    const area = petArea();
    overlay.webContents.send('fx-poop', {
      fromX: b.x + b.width / 2 - area.x,
      fromY: b.y + b.height * 0.55 - area.y,
    });
  });

  // 化身成剑：转发给覆盖层；剑飞回来再通知桌宠
  ipcMain.on('sword-start', () => {
    if (!win || !overlay) return;
    syncOverlay();
    const b = win.getBounds();
    const area = petArea();
    overlay.webContents.send('fx-sword', {
      x: b.x + b.width / 2 - area.x,
      y: b.y + b.height / 2 - area.y,
    });
  });
  ipcMain.on('sword-done', () => {
    if (win) win.webContents.send('sword-end');
  });

  // 暗中观察：巨大的半张脸从屏幕侧边探出；高度对齐她的脸，演完通知桌宠回来
  ipcMain.on('peek-start', () => {
    if (!win || !overlay) return;
    syncOverlay();
    const b = win.getBounds();
    const area = petArea();
    overlay.webContents.send('fx-peek', {
      side: Math.random() < 0.5 ? 'left' : 'right',
      y: b.y + b.height * 0.35 - area.y,
    });
  });
  ipcMain.on('peek-done', () => {
    if (win) win.webContents.send('peek-end');
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
        if (win) win.webContents.send('chat-token', { id, delta }); // 桌宠长按小输入框也要流式
      });
      return { ok: true, text: reply };
    } catch (err) {
      return { ok: false, text: `呜，连不上脑子了…（${err.message}）` };
    }
  });
  // 特殊任务（看腿等）：不走大模型，本地一问一答直接写进聊天历史
  ipcMain.handle('chat-inject', (_e, userText, replyText) => {
    const userMsg = { t: Date.now(), role: 'user', content: String(userText).slice(0, 500) };
    const assistantMsg = { t: Date.now(), role: 'assistant', content: String(replyText).slice(0, 500) };
    chatHistory.push(userMsg, assistantMsg);
    if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100);
    persistExchange(userMsg, assistantMsg);
    return { ok: true };
  });
  ipcMain.handle('chat-history', () => chatHistory.slice(-30));

  // 主动搭话：闲置时她主动开口。带最近对话当上下文但绝不写入历史（区别于正常聊天）
  ipcMain.handle('chat-proactive', async () => {
    try {
      const text = await kimiProactive();
      if (text) mainLog('大模型', '主动开口找主人搭话');
      return { ok: true, text };
    } catch (err) {
      return { ok: false, text: '' };
    }
  });

  // 智能行动决策：待机时渲染层报上下文，模型挑动作+配台词；没配 key/失败都回 !ok，渲染层回退随机
  ipcMain.handle('decide-action', async (_e, ctx) => {
    if (!config.kimiKey || !ctx || !Array.isArray(ctx.actions) || !ctx.actions.length) return { ok: false };
    try {
      const d = await decideAction(ctx);
      mainLog('大模型', `决策动作「${d.action}」${d.say ? '：' + String(d.say).slice(0, 20) : ''}`);
      return { ok: true, action: d.action, say: d.say };
    } catch {
      return { ok: false };
    }
  });

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

  // 聊天配置：小本子「配置」页签读写 Kimi key；key 完整返回给配置页显示
  ipcMain.handle('get-chat-config', () => {
    const k = config.kimiKey || '';
    return { hasKey: !!k, key: k, masked: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : '' };
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
    syncOverlay();
    const b = win.getBounds();
    const area = petArea();
    overlay.webContents.send('fx-drive', { x: b.x + b.width / 2 - area.x });
  });
  ipcMain.on('drive-done', () => {
    if (win) win.webContents.send('drive-end');
  });

  // 捣乱：转发给覆盖层（直接落在鼠标当前位置，覆盖层跟到光标所在屏）；被晃掉或到时间后再通知桌宠归位
  ipcMain.on('mischief-start', () => {
    if (!win || !overlay) return;
    const c = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(c);
    syncOverlay(d);
    const area = d.workArea;
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
    if (patch && patch._size) applyWindowSize(); // 整体缩放变了，窗口跟着变
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

  // 找一块可以站上去的窗台：桌宠当前显示器上最前台的普通窗口的上沿
  ipcMain.handle('find-ledge', async () => {    const wins = await listWindows();
    const area = petArea();
    const w = wins.find((w) =>
      w.pid !== process.pid &&       // 排除桌宠自己的窗口
      w.w >= 500 && w.h >= 300 &&
      w.y - winH() >= area.y &&      // 窗台上沿上方放得下桌宠
      w.y < area.y + area.height - 100 &&
      w.x + w.w > area.x + winW() && w.x < area.x + area.width - winW());
    if (!w) return null;
    // 可走动范围，同时夹在窗口边缘和当前屏工作区内
    const minX = Math.round(Math.max(w.x + 20, area.x));
    const maxX = Math.round(Math.min(w.x + w.w - winW() - 20, area.x + area.width - winW()));
    if (maxX <= minX) return null;
    return { minX, maxX, y: Math.round(w.y), floorY: area.y + area.height - winH() };
  });

  // 当前活跃窗口（最前台的普通窗口）：撞墙模式拿它的左右边沿当墙；限桌宠当前屏
  ipcMain.handle('active-window', async () => {
    const wins = await listWindows();
    const area = petArea();
    const w = wins.find((w) =>
      w.pid !== process.pid && w.w >= 300 && w.h >= 200 &&
      w.x < area.x + area.width && w.x + w.w > area.x && w.y < area.y + area.height && w.y + w.h > area.y);
    if (!w) return null;
    return { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h), owner: w.owner };
  });

  // 右键菜单：星盘径向菜单画在全屏覆盖层上，以点击时的鼠标位置为圆心锚定（不随人物移动）
  // 拖文件夹给她：识别音频 + cue，询问是否切分（uv run musicauto/auto_split_cue.py）
  const AUDIO_EXTS = new Set(['.flac', '.ape', '.wav', '.mp3', '.m4a', '.tak', '.tta', '.aac', '.ogg', '.wma']);
  ipcMain.on('folder-drop', async (_e, droppedPath) => {
    if (!win) return;
    let dir = droppedPath;
    try {
      if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
    } catch { return; }
    const petSay = (t) => win.webContents.send('notebook-say', t);
    petSay('让我看看这是什么…');
    let files = [];
    try { files = fs.readdirSync(dir); } catch { return; }
    const cues = files.filter((f) => f.toLowerCase().endsWith('.cue'));
    const audios = files.filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()));
    const name = path.basename(dir);
    if (!cues.length || !audios.length) {
      petSay('这里面没有能切分的音频哦');
      mainLog('系统', `拖入文件夹 ${name}：不可切分（${audios.length} 音频 / ${cues.length} cue）`);
      return;
    }
    mainLog('交互', `拖入文件夹 ${name}：${audios.length} 个音频 + ${cues.length} 个 cue，询问切分`);
    const r = await dialog.showMessageBox({
      type: 'question',
      message: '发现可切分的音频',
      detail: `${name}\n${audios.length} 个音频文件 + ${cues.length} 个 CUE 文件\n要用 auto_split_cue 切分吗？`,
      buttons: ['切分', '算了'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) {
      petSay('好吧，那先不切了');
      mainLog('系统', `取消切分：${name}`);
      return;
    }
    petSay('好嘞，开始切分！');
    mainLog('系统', `开始切分：${name}`);
    const MUSIC_DIR = path.join(__dirname, '..', 'musicauto');
    execFile('uv', ['run', '--project', MUSIC_DIR, path.join(MUSIC_DIR, 'auto_split_cue.py'), dir],
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          petSay('切分失败了…日志里有原因');
          mainLog('系统', `切分失败：${name}：${String(stderr || err.message).slice(0, 300)}`);
          return;
        }
        petSay('切分完成！');
        mainLog('系统', `切分完成：${name}\n${String(stdout).slice(-500)}`);
      });
  });

  ipcMain.on('context-menu', () => {    if (!overlay) return;
    const cursor = screen.getCursorScreenPoint();
    // 菜单开在光标所在屏：先把覆盖层挪过去，再换算菜单锚点
    syncOverlay(screen.getDisplayNearestPoint(cursor));
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
