// 桌宠主进程：透明无边框置顶窗口 + 窗口移动/菜单 IPC
const { app, BrowserWindow, ipcMain, screen, powerMonitor, dialog, Tray, Menu, nativeImage } = require('electron');
const { execFile } = require('child_process');
const updater = require('./updater');
const feishu = require('./feishu');
const yomi = require('./yomi');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// 窗口基础尺寸：比立绘（512 高）大一圈，给跳跃/旋转/乱飞等会探出身体的动作留余量
// 实际窗口尺寸 = 基础尺寸 × 屏幕自适应基数（人物不超屏 1/5，见 refreshScreenK）× settings._size 滑块
// 注意：特效/道具坐标都标定在 340×620 逻辑画幅上（底部居中对齐窗口），改尺寸不用动它们
const BASE_W = 460;
const BASE_H = 740;
// 窗口底部比内容多出的固定高度：装立绘 drop-shadow(0 6px 14px) 的向下衰减（约 20px）。
// winH() 仍是「内容高度」（脚底 = 窗口底往上 SHADOW_PAD），所有贴底/夹取公式语义不变；
// 只有真正设置窗口像素高度的地方要 + SHADOW_PAD。阴影像素不随 _size 缩放，所以是固定值
const SHADOW_PAD = 24;
// 屏幕自适应基数：人物（340×512 逻辑画幅）高/宽不超过所在屏工作区的 1/5，取较小的约束——
// 大屏大、小屏小。窗口创建/applyWindowSize 时刷新缓存（跨屏拖拽途中不重算，避免窗口尺寸抖动）
let screenKCache = null;
function refreshScreenK() {
  const a = win ? petArea() : screen.getPrimaryDisplay().workArea;
  screenKCache = Math.min(a.height / 5 / 512, a.width / 5 / 340);
}
// 实际缩放 = 屏幕基数 × settings._size（配置页滑块仍是用户微调）
function sizeK() { return (screenKCache || 1) * (settings._size || 1); }
function winW() { return Math.round(BASE_W * sizeK()); }
function winH() { return Math.round(BASE_H * sizeK()); }

// tools 二进制位置：打包后内置在 app.asar.unpacked（只读），缺失时编译到 userData/tools
const TOOLS_SRC_DIR = path.join(__dirname, '..', 'tools');
const TOOLS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'tools') : TOOLS_SRC_DIR;
const TOOLS_BUILD_DIR = app.isPackaged ? path.join(app.getPath('userData'), 'tools') : TOOLS_SRC_DIR;
// 枚举屏幕可见窗口的工具（CGWindowList，tools/windows.swift 编译而来）
let WINDOWS_BIN = path.join(TOOLS_DIR, 'windows');
// 方向键全局监听（CGEventTap，tools/keys.swift 编译而来）；需要「输入监控」权限，没权限会自行退出
let KEYS_BIN = path.join(TOOLS_DIR, 'keys');
// 读一次当前输入光标（AXUIElement，tools/caret.swift 编译而来）：一次性进程，stdout 一行 JSON
let CARET_BIN = path.join(TOOLS_DIR, 'caret');

// 启动自检：这几个二进制是 gitignore 的本机编译产物，新机器上没有就现场编译（要 Xcode 命令行工具的 swiftc）
// 返回实际可用的二进制路径（内置的优先，否则是 TOOLS_BUILD_DIR 下的编译产物）
function ensureTool(name) {
  return new Promise((resolve) => {
    const bundled = path.join(TOOLS_DIR, name);
    if (fs.existsSync(bundled)) return resolve(bundled);
    const out = path.join(TOOLS_BUILD_DIR, name);
    if (fs.existsSync(out)) return resolve(out);
    fs.mkdirSync(TOOLS_BUILD_DIR, { recursive: true });
    const src = path.join(TOOLS_SRC_DIR, name + '.swift');
    execFile('swiftc', ['-O', src, '-o', out], { timeout: 180000 }, (err) => {
      if (err) mainLog('系统', `编译 ${name} 失败，相关功能不可用（手动跑：swiftc -O tools/${name}.swift -o tools/${name}）`);
      else mainLog('系统', `首次启动，自动编译了 tools/${name}`);
      resolve(err ? bundled : out);
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
// 最近一次键盘输入时间（keys 子进程的 "key" 行更新），判断用户是否正在打字
let lastTypeAt = 0;
// 输入光标查询缓存：AX 查询有开销，400ms 内复用上次结果（null 也缓存）
let caretCache = null;

// ---------- 统一配置（~/.config/kira/config.json） ----------
// Kimi key、动作开关/频率/点击穿透、笔记本窗口位置都存这一个文件
const CONFIG_DIR = path.join(os.homedir(), '.config', 'kira');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

function saveConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // 先写临时文件再改名：进程被强杀时不会留下 0 字节的半截配置（踩过，整个配置被截空）
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    // 改名前把上一份好的配置留成 .bak，写坏/误清还有得救
    try { if (fs.statSync(CONFIG_FILE).size > 2) fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch {}
    fs.renameSync(tmp, CONFIG_FILE);
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
            enum: ['hop', 'sway', 'walk', 'walkfar', 'fly', 'sword', 'morph', 'desk', 'drive', 'goledge'],
            description: 'hop跳一下 sway撒娇 walk走一走 walkfar走到另一边 fly御剑飞行 sword化身成剑 morph变个身 desk来张桌子 drive去兜风 goledge去窗台玩',
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

// 桌宠当前显示器上最前台的普通窗口（排除自己），active-window / input-context 共用
async function activeWindow() {
  const wins = await listWindows();
  const area = petArea();
  const w = wins.find((w) =>
    w.pid !== process.pid && w.w >= 300 && w.h >= 200 &&
    w.x < area.x + area.width && w.x + w.w > area.x && w.y < area.y + area.height && w.y + w.h > area.y);
  if (!w) return null;
  return { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h), owner: w.owner };
}

// 启动全局键盘监听：方向键（"arrow" 行）给桌宠窗口发 arrow-key 事件；
// 任何按键（"key" 行）只刷新 lastTypeAt，供 input-context 判断打字中
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
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'key') lastTypeAt = Date.now();
      else if (win) win.webContents.send('arrow-key'); // "arrow" 行（旧版 keys 只有这一种输出）
    }
  });
  if (child.stderr) child.stderr.on('data', (c) => console.log('[keys]', String(c).trim()));
}

// 读一次输入光标位置（屏幕坐标 {x,y,width,height}）；失败/超时/无输出都回 null，400ms 内走缓存
function getCaret() {
  if (caretCache && Date.now() - caretCache.t < 400) return Promise.resolve(caretCache.v);
  return new Promise((resolve) => {
    execFile(CARET_BIN, [], { timeout: 500 }, (err, stdout) => {
      let v = null;
      if (!err) {
        try {
          const c = JSON.parse(String(stdout).trim().split('\n')[0]);
          if (typeof c.x === 'number' && typeof c.y === 'number') v = c;
        } catch {}
      }
      caretCache = { t: Date.now(), v };
      resolve(v);
    });
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  refreshScreenK();
  win = new BrowserWindow({
    width: winW(),
    height: winH() + SHADOW_PAD,
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
      backgroundThrottling: false, // 被遮挡时也要照常跑 rAF 状态机，不然整只宠冻住
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认点击穿透，悬到角色身上时渲染层会切回接管
  win.setIgnoreMouseEvents(true, { forward: true });
  // KIRA_TEST_PAGE：验收测试页开关（如 ext_test.html），替代默认桌宠页
  win.loadFile(path.join(__dirname, process.env.KIRA_TEST_PAGE || 'index.html'));
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
      // 全屏透明窗在 macOS 上容易被判定为「被遮挡」而停掉 rAF——特效帧循环全挂 rAF 上，
      // 一停就永远卡死（剑飞一半冻住、回不来的根因）
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
}

// 气泡独立窗口：宽度不受人物窗口限制，底边中点锚定人物头顶
const BUBBLE_W = 560;
const BUBBLE_H = 254; // 气泡 bottom 从 10 加到 44（装阴影），窗口同步加高 34 保住上方余量

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

// ---------- kira 消息泡泡（独立窗口，UI 同主动搭话粘性气泡） ----------
// 与气泡窗的区别：初始位置定在人物头顶后就不再跟随人物移动；框边缘可拖动；内容可选中；双击直达 kira tab
const KB_W = 560, KB_H = 480;
let kiraBubbleWin = null;
let kbAnchored = false; // 初始位置定过没有（定过就锁死，不再跟着人物动）

function createKiraBubble() {
  kiraBubbleWin = new BrowserWindow({
    width: KB_W,
    height: KB_H,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  kiraBubbleWin.setAlwaysOnTop(true, 'screen-saver');
  kiraBubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  kiraBubbleWin.setIgnoreMouseEvents(true, { forward: true });
  kiraBubbleWin.loadFile(path.join(__dirname, 'kira_bubble.html'));
}

// 初始位置：人物头顶上方居中，夹在人物所在屏工作区内；只定这一次，之后人物怎么动都不影响它
function anchorKiraBubble() {
  if (kbAnchored || !kiraBubbleWin || !win) return;
  const b = win.getBounds();
  const a = petDisplay().workArea;
  const x = Math.round(Math.min(Math.max(b.x + b.width / 2 - KB_W / 2, a.x), Math.max(a.x, a.x + a.width - KB_W)));
  const y = Math.round(Math.max(b.y - KB_H - 8, a.y));
  kiraBubbleWin.setBounds({ x, y, width: KB_W, height: KB_H });
  kbAnchored = true;
}

function showKiraBubble(text) {
  if (!kiraBubbleWin) return;
  anchorKiraBubble(); // 只有第一次会真正锚定
  kiraBubbleWin.webContents.send('kira-bubble-show', { text });
  if (!kiraBubbleWin.isVisible()) kiraBubbleWin.showInactive();
}

// 按桌宠上报的头顶锚点（窗口局部坐标）换算屏幕位置，夹在当前显示器工作区内
function placeBubble() {
  if (!bubbleWin || !win || !bubbleAnchor) return;
  const b = win.getBounds();
  const a = petDisplay().workArea;
  const cx = b.x + bubbleAnchor.x;
  const top = b.y + bubbleAnchor.y + 28; // 窗口底边下移 34（原 -6），抵消气泡 bottom 加大，尾巴尖屏幕位置不变
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
  // 桌宠/气泡/覆盖层窗口全是 skipTaskbar，Electron 会把整个 app 降成 UIElement 后台代理
  //（没有 Dock 图标、Cmd+Tab 切不到、系统不当普通 app）。小本子打开期间亮出 Dock 图标，
  // 让它成为一个能被系统识别的正常窗口；关掉后恢复纯托盘形态
  if (process.platform === 'darwin') app.dock.show();
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
  notebookWin.on('closed', () => {
    notebookWin = null;
    if (process.platform === 'darwin') app.dock.hide();
  });
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

// 把窗口位置限制在某块显示器（默认桌宠当前所在屏）的工作区内
// 垂直方向允许高出屏幕顶 winH()-160：攀爬动作要沿高窗爬到顶沿，窗口大部可以出屏，
// 保留 160px 可见（立绘脚部），拖拽/走路也不会把她弄丢
function clampToScreen(x, y, dpy) {
  const area = (dpy || petDisplay()).workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - winW()),
    y: Math.min(Math.max(y, area.y - (winH() - 160)), area.y + area.height - winH()),
  };
}

// 一块屏的四条边外侧是否还接着别的屏（工作区在该方向越界且另一轴有交叠）
function displayNeighbors(d) {
  const a = d.workArea;
  const n = { left: false, right: false, top: false, bottom: false };
  for (const e of screen.getAllDisplays()) {
    if (e.id === d.id) continue;
    const b = e.workArea;
    const vOverlap = b.y < a.y + a.height && b.y + b.height > a.y;
    const hOverlap = b.x < a.x + a.width && b.x + b.width > a.x;
    if (vOverlap && b.x < a.x) n.left = true;
    if (vOverlap && b.x + b.width > a.x + a.width) n.right = true;
    if (hOverlap && b.y < a.y) n.top = true;
    if (hOverlap && b.y + b.height > a.y + a.height) n.bottom = true;
  }
  return n;
}

// 拖拽专用夹取：以「光标所在的屏」为准，且接着别的屏的那一侧完全不夹，
// 人物才能跨过屏幕交界（光标始终落在窗口内，所以不会被拖丢）；
// 桌面外沿（没有邻屏的那侧）仍按工作区夹住，不让她掉出屏幕
function clampToDrag(x, y, cursor) {
  const d = screen.getDisplayNearestPoint(cursor);
  const a = d.workArea, w = winW(), h = winH();
  const n = displayNeighbors(d);
  if (!n.left) x = Math.max(x, a.x);
  if (!n.right) x = Math.min(x, a.x + a.width - w);
  if (!n.top) y = Math.max(y, a.y - (h - 160));
  if (!n.bottom) y = Math.min(y, a.y + a.height - h);
  return { x, y };
}

// 整体缩放变化时重设窗口尺寸，保持右下角锚定并夹回屏幕
function applyWindowSize() {
  if (!win) return;
  refreshScreenK();
  const b = win.getBounds();
  const w = winW(), h = winH() + SHADOW_PAD;
  win.setBounds({ x: Math.round(b.x + b.width - w), y: Math.round(b.y + b.height - h), width: w, height: h });
  const p = clampToScreen(win.getPosition()[0], win.getPosition()[1]);
  win.setPosition(p.x, p.y);
}

// 跨屏 resize 的「duang duang」弹性动画：阻尼振荡 ~0.75s（两三次回弹）从旧尺寸弹到新尺寸。
// 窗口和渲染层同步弹（_screenK 每帧广播），锚定方式与 applyWindowSize 一致（右下），收尾无跳变
let resizeAnim = null;
function animateWindowResize() {
  if (!win) return;
  if (resizeAnim) clearInterval(resizeAnim);
  const fromK = win.getBounds().width / BASE_W;
  refreshScreenK();
  const toK = sizeK();
  if (Math.abs(toK - fromK) < 0.01) { applyWindowSize(); return; }
  const userK = settings._size || 1;
  const t0 = Date.now();
  resizeAnim = setInterval(() => {
    if (!win) { clearInterval(resizeAnim); resizeAnim = null; return; }
    const t = (Date.now() - t0) / 750;
    if (t >= 1) {
      clearInterval(resizeAnim);
      resizeAnim = null;
      applyWindowSize(); // 坐实精确尺寸
      win.webContents.send('settings-changed', { ...settings, _screenK: screenKCache || 1 });
      return;
    }
    // 振幅指数衰减的余弦：k 绕 toK 弹两三次后收拢
    const k = toK + (fromK - toK) * Math.exp(-6 * t) * Math.cos(12 * t);
    const b = win.getBounds();
    const w = Math.round(BASE_W * k), h = Math.round(BASE_H * k) + SHADOW_PAD;
    win.setBounds({ x: Math.round(b.x + b.width - w), y: Math.round(b.y + b.height - h), width: w, height: h });
    win.webContents.send('settings-changed', { ...settings, _screenK: k / userK });
  }, 33);
}

app.whenReady().then(async () => {
  [WINDOWS_BIN, KEYS_BIN, CARET_BIN] = await Promise.all([ensureTool('windows'), ensureTool('keys'), ensureTool('caret')]); // 首次启动先补齐编译产物
  createWindow();
  createOverlay();
  createBubble();
  createKiraBubble();
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
  const rebuildTray = (upState) => {
    const items = [
      { label: `Kira v${app.getVersion()}`, enabled: false },
      { label: '打开 Kira Note', click: () => openNotebook() },
      { label: '实时聊天', click: () => openNotebook('chat') },
      { type: 'separator' },
    ];
    if (upState && upState.phase === 'ready') {
      items.push({ label: `重启更新到 v${upState.version}`, click: () => updater.applyUpdate() });
    } else {
      items.push({ label: '检查更新…', click: () => updater.checkForUpdates(true) });
    }
    items.push({ type: 'separator' }, { label: '退出', click: () => app.quit() });
    tray.setContextMenu(Menu.buildFromTemplate(items));
  };
  rebuildTray(null);
  // 自动更新：启动 30s 后静默检查一次；发现新版会自动下载，完了气泡+弹窗问要不要重启
  updater.init({
    log: mainLog,
    say: (t) => { if (win) win.webContents.send('notebook-say', t); },
    onState: rebuildTray,
  });
  setTimeout(() => updater.checkForUpdates(false), 30000);
  ipcMain.handle('check-update', () => updater.checkForUpdates(true));

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

  // 所在屏变化检测：换屏（含拖拽跨屏）时重算屏幕基数并 resize 窗口。
  // 行走途中节流 500ms 一查；拖拽途中只记标记不动窗口（跟手优先），松手落定后统一应用
  let curDisplayId = null;
  let pendingDispResize = false;
  let dispCheckT = 0;
  function displayMaybeChanged(force) {
    if (!win) return;
    const now = Date.now();
    if (!force && now - dispCheckT < 500) return;
    dispCheckT = now;
    const d = petDisplay();
    if (curDisplayId === null) { curDisplayId = d.id; return; }
    if (d.id === curDisplayId && !pendingDispResize) return;
    curDisplayId = d.id;
    if (dragOffset) { pendingDispResize = true; return; }
    pendingDispResize = false;
    // 「duang duang」弹性动画换新尺寸（内部 refreshScreenK + 每帧广播 _screenK + 收尾坐实）
    animateWindowResize();
    syncOverlay();
  }

  // 行走等自主移动：按增量移动窗口
  ipcMain.on('move-by', (_e, dx, dy) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    const p = clampToScreen(Math.round(x + dx), Math.round(y + dy));
    win.setPosition(p.x, p.y);
    displayMaybeChanged(false);
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
    const p = clampToDrag(Math.round(cursor.x - dragOffset.dx), Math.round(cursor.y - dragOffset.dy), cursor);
    win.setPosition(p.x, p.y);
    displayMaybeChanged(false); // 跨屏拖拽：先记 pendingDispResize，松手再 resize
  });

  ipcMain.on('drag-end', () => {
    // 落点归到光标所在那块屏：跨屏时松手可能还半截跨在交界上，
    // 先坐实到一块屏，免得之后自主走动被 clampToScreen 猛地拽回去
    if (win && dragOffset) {
      const [x, y] = win.getPosition();
      const p = clampToScreen(x, y, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
      if (p.x !== x || p.y !== y) win.setPosition(p.x, p.y);
    }
    dragOffset = null;
    syncOverlay(); // 被拎到别的显示器了，覆盖层跟过去
    displayMaybeChanged(true); // 跨屏落定：应用拖拽途中记下的尺寸调整
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
      fromY: b.y + (b.height - SHADOW_PAD) * 0.55 - area.y, // 按内容高度取点，底部阴影余量不算身体
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
      y: b.y + (b.height - SHADOW_PAD) / 2 - area.y,
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
      y: b.y + (b.height - SHADOW_PAD) * 0.35 - area.y,
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
    // 「@kira」前缀或「kira，」：转给 kira 机器人（yomi wire），kira 的回答经事件流回小本子机器人 tab
    // 不带 @ 的「kira 你好」（空格）仍留给她本人——@ 才是机器人的意思
    const m = String(text || '').match(/^(?:@kira|kira[，,：:])\s*(.+)$/is);
    if (m) {
      const payload = m[1].replace(/^[，,：:\s]+/, '');
      if (!payload) return { ok: false, text: '想说啥？「kira，」后面带上内容哦' };
      try {
        const reply = await yomi.handleNotebook(payload);
        return { ok: true, text: reply };
      } catch (err) {
        return { ok: false, text: `kira 还没连上（${err.message}）` };
      }
    }
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

  // 飞书机器人：配置存 config.feishu；消息经长连接进来后复用 kimiChat 回复，
  // 所以飞书对话和小本子聊天是同一份历史/记忆。
  // 事件可能被同应用的其他后端消费，所以同步以主动拉为准：handshake 拿会话 id，
  // listHistory 全量 + 30s 轮询增量；事件到了只当实时加速
  const dispatchFeishuMsg = (m) => {
    if (notebookWin) notebookWin.webContents.send('feishu-msg', m);
    // 人物冒泡只提醒飞书侧来的回答；小本子自己发的回答就在眼前，不冒
    if (m.role === 'assistant' && m.source !== 'notebook' && win) {
      win.webContents.send('feishu-incoming', { text: m.content.slice(0, 60) });
    }
  };
  feishu.init({
    getConfig: () => config.feishu || {},
    kimiChat: (text) => kimiChat(text),
    persistChatId: (id) => {
      const f = config.feishu || (config.feishu = {});
      f.lastChatId = id;
      saveConfig();
    },
    onStatus: (s) => { if (notebookWin) notebookWin.webContents.send('feishu-status', s); },
    onMessage: dispatchFeishuMsg,
    onLog: (entry) => {
      const tag = { p2p: '私聊', group: '群聊', notebook: '小本子' }[entry.chatType] || '飞书';
      mainLog('交互', `飞书${tag}：${entry.userText.slice(0, 30)}`);
    },
  });
  // 飞书同步先整体隐藏（卡片正文 API 拿不到，体验不可用）：后台连接和轮询都不启动，
  // 配置保留。恢复：FEISHU_LIVE 置 true，并恢复 notebook.html 两个飞书 cfg-sec 的
  // display:none 和 notebook.js updateBotTab 的强制隐藏
  const FEISHU_LIVE = false;
  if (FEISHU_LIVE) {
    feishu.start();
    // 轮询兜底：事件被消费也能同步全部消息
    setInterval(async () => {
      try { (await feishu.pollNew()).forEach(dispatchFeishuMsg); } catch {}
    }, 30000);
  }
  ipcMain.handle('get-feishu-config', () => {
    const f = config.feishu || {};
    return { appId: f.appId || '', appSecret: f.appSecret || '', ownerEmail: f.ownerEmail || '', enabled: !!f.enabled, replyBot: !!f.replyBot, ...feishu.getState() };
  });
  ipcMain.on('set-feishu-config', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return;
    const f = config.feishu || (config.feishu = {});
    if (typeof patch.appId === 'string') f.appId = patch.appId.trim();
    if (typeof patch.appSecret === 'string') f.appSecret = patch.appSecret.trim();
    if (typeof patch.ownerEmail === 'string') f.ownerEmail = patch.ownerEmail.trim();
    if (typeof patch.enabled === 'boolean') f.enabled = patch.enabled;
    if (typeof patch.replyBot === 'boolean') f.replyBot = patch.replyBot;
    saveConfig();
    feishu.restart();
  });
  ipcMain.handle('get-feishu-log', () => feishu.getState().mirror);
  ipcMain.handle('feishu-handshake', () => feishu.handshake());
  // 小本子机器人 tab：发言走飞书机器人通道回答（回答同步进飞书会话），历史直接拉飞书会话
  ipcMain.handle('feishu-send', async (_e, text) => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false };
    const reply = await feishu.handleNotebook(text.trim().slice(0, 2000));
    return { ok: true, reply };
  });
  ipcMain.handle('feishu-history', () => feishu.listHistory());

  // ---------- kira 链接（yomi wire 协议，替代飞书 SDK 直连） ----------
  // daemon 事件流经 SubscribeAll 进来：kira 的回答 → 机器人 tab 上屏 + kira 消息泡泡（独立窗口）
  const dispatchYomiMsg = (m) => {
    if (notebookWin) notebookWin.webContents.send('feishu-msg', m);
    if (m.role === 'assistant') showKiraBubble(m.content.slice(0, 800));
  };
  yomi.init({
    getConfig: () => config.yomi || {},
    onStatus: (s) => {
      if (notebookWin) {
        notebookWin.webContents.send('yomi-status', s);
        notebookWin.webContents.send('feishu-status', s); // 机器人 tab 沿用旧通道
      }
    },
    onMessage: dispatchYomiMsg,
    onLog: (entry) => mainLog(entry.type || '系统', entry.text || ''),
  });
  if (config.yomi && config.yomi.enabled) yomi.start();
  ipcMain.handle('get-yomi-config', () => {
    const y = config.yomi || {};
    return { wsUrl: y.wsUrl || '', token: y.token || '', sessionId: y.sessionId || '', enabled: !!y.enabled, unlocked: !!y.unlocked, ...yomi.getState() };
  });
  ipcMain.on('set-yomi-config', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return;
    const y = config.yomi || (config.yomi = {});
    if (typeof patch.wsUrl === 'string') y.wsUrl = patch.wsUrl.trim();
    if (typeof patch.token === 'string') y.token = patch.token.trim();
    if (typeof patch.sessionId === 'string') y.sessionId = patch.sessionId.trim();
    if (typeof patch.enabled === 'boolean') y.enabled = patch.enabled;
    if (typeof patch.unlocked === 'boolean') y.unlocked = patch.unlocked;
    saveConfig();
    yomi.restart();
  });
  ipcMain.handle('yomi-send', async (_e, text) => {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '空消息' };
    try {
      const reply = await yomi.handleNotebook(text.trim().slice(0, 2000));
      return { ok: true, reply };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('yomi-list-sessions', () => yomi.listSessions());
  ipcMain.handle('yomi-history', () => yomi.listMessages());
  // kira 消息泡泡：关闭/双击直达/点击穿透开关
  ipcMain.on('kira-bubble-dismiss', () => { if (kiraBubbleWin) kiraBubbleWin.hide(); });
  ipcMain.on('kira-bubble-open', () => {
    if (kiraBubbleWin) kiraBubbleWin.hide();
    openNotebook('bot');
  });
  ipcMain.on('kb-ignore', (_e, flag) => {
    if (kiraBubbleWin) kiraBubbleWin.setIgnoreMouseEvents(flag, { forward: true });
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
  // 攀爬安全绳：桌宠报屏幕绝对坐标，换算成覆盖层坐标转发（纯特效，覆盖层保持穿透）
  ipcMain.on('rope-start', (_e, d) => {
    if (!win || !overlay) return;
    syncOverlay();
    const area = petArea();
    overlay.webContents.send('rope-update', {
      start: true,
      ax: d.ax - area.x, ay: d.ay - area.y,
      wx: d.wx - area.x, wy: d.wy - area.y,
    });
  });
  ipcMain.on('rope-move', (_e, d) => {
    if (!win || !overlay) return;
    const area = petArea();
    overlay.webContents.send('rope-update', { wx: d.wx - area.x, wy: d.wy - area.y });
  });
  ipcMain.on('rope-end', () => {
    if (overlay) overlay.webContents.send('rope-clear');
  });
  // 扩展特效通用中转：以后新 overlay 特效只走 fx-ext，不再加专用 IPC。
  // 约定的屏幕绝对坐标字段（data.x/data.y）减工作区原点，转发覆盖层；特效结束回报桌宠收尾
  ipcMain.on('fx-ext', (_e, kind, data) => {
    if (!win || !overlay) return;
    syncOverlay();
    const area = petArea();
    const d = data ? { ...data } : {};
    if (typeof d.x === 'number') d.x -= area.x;
    if (typeof d.y === 'number') d.y -= area.y;
    overlay.webContents.send('fx-ext', kind, d);
  });
  ipcMain.on('fx-ext-done', (_e, kind, seq) => {
    if (win) win.webContents.send('fx-ext-done', kind, seq);
  });
  // 覆盖层的点击捕获开关（捣乱时本子区域拦截点击用）
  ipcMain.on('ov-ignore', (_e, flag) => {
    if (overlay) overlay.setIgnoreMouseEvents(flag, { forward: true });
  });

  // 动作开关设置
  ipcMain.handle('get-settings', () => ({ ...settings, _screenK: screenKCache || 1 }));
  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.on('set-actions', (_e, patch) => {
    Object.assign(settings, patch);
    saveConfig();
    if (patch && patch._size) applyWindowSize(); // 整体缩放变了，窗口跟着变
    if (win) win.webContents.send('settings-changed', { ...settings, _screenK: screenKCache || 1 });
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
  ipcMain.handle('active-window', () => activeWindow());

  // 输入上下文：打字中标记 + 输入光标位置 + 活跃窗口，渲染层用来决定贴谁说话
  ipcMain.handle('input-context', async () => {
    const typing = Date.now() - lastTypeAt < 2500;
    const [caret, active] = await Promise.all([
      typing ? getCaret() : Promise.resolve(null), // 不在打字就不必查光标
      activeWindow(),
    ]);
    return { typing, caret, active };
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

  // 星盘菜单选择：动作类转发给桌宠窗口，notebook/settings/quit/大小档位由主进程直接处理
  ipcMain.on('menu-select', (_e, id) => {
    if (typeof id === 'string' && id.startsWith('size:')) {
      // 大小档位：与配置页滑块同一套 _size 语义（0.6/0.8/1/1.25/1.5）
      const v = parseFloat(id.slice(5));
      if (v > 0) {
        settings._size = v;
        saveConfig();
        applyWindowSize();
        if (win) win.webContents.send('settings-changed', { ...settings, _screenK: screenKCache || 1 });
      }
      return;
    }
    if (id === 'notebook') openNotebook();
    else if (id === 'kira') openNotebook('bot'); // 跟 kira 的对话直达
    else if (id === 'debug') openNotebook('debug'); // 调试动作页直达
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
