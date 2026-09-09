// mira 连接器（StarForge Mira，mira.msh.team，MoonGate SSO 后面）：
// WebSocket 上跑 JSON-RPC（文本帧自带边界，不是 yomi 的 4 字节长度前缀帧），
// Bearer token 鉴权（与 REST 同一个 MOONGATE_ACCESS_TOKEN）；subscribe 订阅项目事件流，
// after_cursor 断线续传（等价 yomi 的 after_event_id）。
//
// 协议要点（M26 实测 + 前端 bundle 逆向）：
//   请求  {"id":"1","method":"ping"/"subscribe"/"prompt", "params":{...}}（无 jsonrpc:"2.0" 字段）
//   响应  {"id":"1","result":...} 或 {"id":"1","error":{"message":"Forbidden"}}；ping 回 {"id":"1","method":"pong"}
//   事件  {"method":"agent_event","params":{seq, session_id, event:{type, ...}}}（envelope 带 seq 即续传游标）
//         另有 history_complete / session_lifecycle / control_event 等推送方法
//   REST  GET  /api/projects/{pid}/sessions/{sid}/history  拉历史（tab 初始化）
//         POST /api/mira/projects/{pid}/inject {type,from,content}  注入事件（发言通道，语义见 finding）
// 订阅按项目成员鉴权，非成员 subscribe 返 Forbidden。
const WebSocket = require('ws');
const https = require('https');
const http = require('http'); // 仅本地 mock/开发环境走 http 时用；线上 wss→https 永远走上面那个

let deps = null;
let ws = null;
let status = 'off';      // off | connecting | online | error
let statusErr = '';
let stoppedByUser = true;
let retryTimer = null;
let retryDelay = 3000;
let nextId = 1;
const pending = new Map();     // id → {resolve, reject, timer}
const seenSeq = [];            // 游标去重环（after_cursor 重连回放可能和已收的交叠）
let lastCursor = null;         // 最近收到的事件 seq：重连后 subscribe 按它续传
let lastCursorPid = '';        // 游标所属 projectId：换项目后旧游标作废，全量回放
let lastFrameAt = 0;           // 最近收到任何帧的时间：半开连接靠看门狗发现
let watchdogTimer = null;
let sayWait = null;            // 小本本发言等待 mira 回答的挂起 Promise（带 sessionId + 身份校验，防并发串话）
let restartTimer = null;       // restart() 的延迟启动定时器：stop() 必须能取消它，否则双 socket 泄漏
const turnBuf = new Map();     // sessionId → {text}：assistant.delta 按回合缓存，turn.ended 一次性吐（同 yomi 的 model.end 教训）
const MAX_FRAME = 16 * 1024 * 1024; // 单帧上限：超过即断连，防坏对端把内存撑爆
const MAX_TURN_TEXT = 200 * 1024;   // 单回合缓存上限：防流式 delta 失控累积

function setStatus(s, err) {
  status = s;
  statusErr = err || '';
  if (deps && deps.onStatus) deps.onStatus({ status, error: statusErr });
}

function init(d) { deps = d; }
function getState() { return { status, error: statusErr, projectId: (deps.getConfig() || {}).projectId || '' }; }

// ---------- JSON-RPC ----------
function sendMsg(msg) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function call(method, params, timeoutMs = 15000) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    if (!sendMsg(params === undefined ? { id, method } : { id, method, params })) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('not connected'));
    }
  });
}

// mira 每条 WS 文本消息就是一个完整 JSON-RPC 消息（ws 库已拼好分片），
// 所以不需要 yomi 的长度前缀帧缓冲；重连要清的是 pending/waiter 等连接态，不是字节缓冲。
function onData(data) {
  lastFrameAt = Date.now();
  let text;
  if (typeof data === 'string') {
    if (Buffer.byteLength(data) > MAX_FRAME) return dropBadFrame(data.length);
    text = data;
  } else {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (buf.length > MAX_FRAME) return dropBadFrame(buf.length);
    text = buf.toString('utf8');
  }
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  handleMsg(msg);
}

function dropBadFrame(len) {
  if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira 帧长度异常（${len} 字节），断开重连` });
  try { ws && ws.terminate(); } catch {}
}

function handleMsg(msg) {
  // 响应优先：ping 的应答也带 method（pong），必须先按 id 认领
  if (msg.id != null) {
    const p = pending.get(String(msg.id));
    if (p) {
      pending.delete(String(msg.id));
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'));
      else p.resolve(msg.result !== undefined ? msg.result : msg);
      return;
    }
    // 服务端主动发来的请求（带 id 要应答的）：本连接器不提供服务端方法，回 error 别让它干等
    if (msg.method) sendMsg({ id: msg.id, error: { message: 'not supported' } });
    return;
  }
  if (msg.method) onPush(msg.method, msg.params);
}

// ---------- 事件归一化 ----------
// content 可能是字符串 / ContentBlock[] / 嵌套对象，统一抠出纯文本
function asText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
  if (typeof v === 'object') return asText(v.text ?? v.content ?? v.delta ?? v.message);
  return '';
}

// 统一出口：{kind, sessionId, role, text, cursor, ts, source:'mira'}（与 M28 约定的事件格式）
function emitEvent(kind, sessionId, role, text, id) {
  const out = { kind, sessionId: sessionId || '', role: role || '', text: text || '', cursor: lastCursor, ts: Date.now(), source: 'mira' };
  if (id != null) out.id = id;
  if (deps.onEvent) deps.onEvent(out);
  if (kind === 'message' && role === 'assistant' && sayWait && sessionId === sayWait.sessionId) {
    const w = sayWait;
    sayWait = null;
    clearTimeout(w.timer);
    w.resolve(text);
  }
}

function onPush(method, params) {
  if (method === 'agent_event') return onAgentEvent(params);
  if (method === 'history_complete') {
    const pending = params && params.pending_requests;
    const n = Array.isArray(pending) ? pending.length : 0;
    emitEvent('history_complete', '', '', n ? `有 ${n} 条待处理请求` : '');
    if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira 历史回放完成${n ? `（${n} 条待处理请求）` : ''}` });
    return;
  }
  if (method === 'session_lifecycle') {
    const p = params || {};
    const sid = p.session_id || p.sessionId || '';
    const state = asText(p.state ?? p.status ?? p.lifecycle ?? p.event) || 'changed';
    // 会话终结前若还有没吐完的回合缓存，先吐出来别丢
    if (/end|close|stop|finish|archive/i.test(state)) flushTurn(sid);
    emitEvent('status', sid, '', `session.${state}`);
    return;
  }
  // control_event / mira_team_status / mira_worklog_update / mira_changes_update /
  // mira_project_update / prompt_queue / flow_stats_update 等推送：与对话上屏无关，忽略（帧本身已刷新看门狗）
}

function onAgentEvent(p) {
  p = p || {};
  const ev = p.event || p;
  const seq = p.seq ?? p.cursor ?? ev.seq ?? ev.id;
  if (seq != null) {
    const k = String(seq);
    if (seenSeq.includes(k)) return;
    seenSeq.push(k);
    if (seenSeq.length > 500) seenSeq.splice(0, 200);
    lastCursor = seq; // 水位：重连后按它续传
    lastCursorPid = (deps.getConfig() || {}).projectId || '';
  }
  const type = ev.type || p.type || '';
  const sid = ev.session_id || ev.sessionId || p.session_id || p.sessionId || '';

  // 用户输入（mira 侧真人发言，或我们 inject 进去的）
  if (type === 'user.input') {
    const text = asText(ev.text ?? ev.content ?? ev.input);
    if (text) emitEvent('message', sid, 'user', text, ev.message_id ?? ev.id);
    return;
  }

  // assistant 流式增量：按回合缓存，不逐条冒泡（一回合几百个 delta，会把 IPC 打爆）
  if (type === 'assistant.delta') {
    const delta = asText(ev.delta ?? ev.text ?? ev.content);
    if (delta) {
      const b = turnBuf.get(sid) || { text: '' };
      b.text += delta;
      if (b.text.length > MAX_TURN_TEXT) b.text = b.text.slice(-MAX_TURN_TEXT);
      turnBuf.set(sid, b);
    }
    return;
  }

  // 回合结束：把缓存的回答一次性吐出来
  if (type === 'turn.ended') {
    flushTurn(sid);
    emitEvent('status', sid, '', 'turn.ended');
    return;
  }
  if (type === 'turn.started') {
    emitEvent('status', sid, '', 'turn.started');
    return;
  }

  // 工具调用：只报开始（delta/progress/result 是噪音/大料，不上屏）
  if (type === 'tool.call.started') {
    const name = asText(ev.name ?? ev.tool ?? ev.tool_name ?? (ev.call && ev.call.name));
    emitEvent('tool', sid, 'assistant', name ? `调用工具：${name}` : '调用工具');
    return;
  }

  // 交互提交（审批/问答的回答）：当用户消息上屏
  if (type === 'interactive.submission') {
    const text = asText(ev.text ?? ev.content ?? ev.value ?? ev.submission);
    if (text) emitEvent('message', sid, 'user', text, ev.id);
    return;
  }
  // thinking.delta / tool.call.delta / tool.progress / tool.result 等：跳过（游标已记账）
}

function flushTurn(sid) {
  const b = turnBuf.get(sid);
  if (b && b.text.trim()) emitEvent('message', sid, 'assistant', b.text.trim());
  turnBuf.delete(sid);
}

// ---------- 连接管理 ----------
async function connectOnce() {
  const cfg = deps.getConfig() || {};
  if (!cfg.enabled || !cfg.wsUrl) { setStatus('off'); return; }
  if (!cfg.projectId) { setStatus('error', '还没配 projectId'); return; } // 配置缺项重连也不会自愈，不排重试
  setStatus('connecting');
  try {
    ws = new WebSocket(cfg.wsUrl, cfg.token ? { headers: { Authorization: `Bearer ${cfg.token}` } } : {});
  } catch (e) {
    setStatus('error', e.message);
    scheduleRetry();
    return;
  }
  ws.on('message', onData);
  ws.on('unexpected-response', (_req, res) => {
    const hint = res.statusCode === 401 ? '（token 不对）' : res.statusCode === 403 ? '（SSO 没放行）' : '';
    setStatus('error', `握手被拒：HTTP ${res.statusCode}${hint}`);
    ws.close();
  });
  ws.on('error', (e) => { if (status !== 'error') setStatus('error', e.message); });
  ws.on('close', (code, reason) => {
    // 拒绝所有挂起的 RPC
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('connection closed')); }
    pending.clear();
    ws = null;
    stopWatchdog();
    if (!stoppedByUser) {
      setStatus('connecting', `连接断了（${code}），重连中…`);
      if (deps.onLog && code !== 1000) deps.onLog({ t: Date.now(), type: '系统', text: `mira 连接断开（${code}${reason ? ' ' + String(reason).slice(0, 80) : ''}），重连中` });
      scheduleRetry();
    } else setStatus('off');
  });
  ws.on('open', async () => {
    try {
      // 有水位（且没换项目）就 after_cursor 续传，否则全量回放
      const params = { project_id: cfg.projectId };
      if (lastCursor != null && lastCursorPid === cfg.projectId) params.after_cursor = lastCursor;
      await call('subscribe', params);
      retryDelay = 3000;
      lastFrameAt = Date.now();
      startWatchdog();
      setStatus('online');
      if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira 连上了（项目 ${cfg.projectId}）` });
    } catch (e) {
      setStatus('error', `订阅失败：${e.message}`);
      try { ws && ws.close(); } catch {}
    }
  });
}

// 心跳保活：60s 发一次 ping（服务端回 pong，任何帧都会刷新 lastFrameAt）；
// 150s 没收到任何帧才判死——空闲时不推事件，单看静默会把好连接误杀（yomi 已踩坑）
function startWatchdog() {
  stopWatchdog();
  watchdogTimer = setInterval(() => {
    if (!ws) return;
    if (Date.now() - lastFrameAt > 150000) {
      try { ws.terminate(); } catch {}
      return;
    }
    call('ping', undefined, 10000).catch(() => {});
  }, 60000);
}
function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

function scheduleRetry() {
  if (stoppedByUser || retryTimer) return;
  // 指数退避 + jitter（±30%），避免固定节奏打桩
  const wait = Math.round(retryDelay * (0.7 + Math.random() * 0.6));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!stoppedByUser) connectOnce();
  }, wait);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

function start() {
  stoppedByUser = false;
  retryDelay = 3000;
  connectOnce();
}

function stop() {
  stoppedByUser = true;
  stopWatchdog();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  setStatus('off');
}

function restart() {
  stop();
  restartTimer = setTimeout(() => { restartTimer = null; start(); }, 300);
}

// ---------- REST（历史回填 + inject 发言） ----------
// 注意：必须用 Node https 而不是全局 fetch —— Electron 主进程的全局 fetch 走
// Chromium network service，长连接/大响应上有坑（main.js 的 kimiChat 同款教训）
function restBase() {
  const cfg = deps.getConfig() || {};
  const wsUrl = String(cfg.wsUrl || '');
  if (!wsUrl) throw new Error('还没配 wsUrl');
  // wss://mira.msh.team/api/stream → https://mira.msh.team
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/api\/stream\/?$/, '');
}

function restJson(method, url, token, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = (/^https:/i.test(url) ? https : http).request(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const hint = res.statusCode === 401 ? '（token 不对）' : res.statusCode === 403 ? '（不是项目成员）' : '';
          reject(new Error(`HTTP ${res.statusCode}${hint}：${raw.slice(0, 120)}`));
          return;
        }
        try { resolve(raw ? JSON.parse(raw) : null); } catch { reject(new Error('响应不是 JSON')); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 历史消息归一化成与实时事件相同的 {kind:'message', ...} 格式，UI 只需要一种渲染路径
function normalizeHistoryItem(m, sessionId) {
  if (!m || typeof m !== 'object') return null;
  const kind = String(m.role || m.kind || m.type || m.from || '');
  let role = '';
  if (/user|human|input|operator/i.test(kind)) role = 'user';
  else if (/assistant|agent|model|mira/i.test(kind)) role = 'assistant';
  else return null; // tool/system/别的事件不上屏
  const text = asText(m.text ?? m.content ?? m.message ?? m.delta);
  if (!text) return null;
  let ts = m.created_at ?? m.ts ?? m.time ?? m.timestamp;
  ts = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts) || Date.now();
  const out = { kind: 'message', sessionId, role, text, cursor: m.seq ?? m.cursor ?? null, ts, source: 'mira' };
  const id = m.id ?? m.message_id;
  if (id != null) out.id = id;
  return out;
}

// tab 初始化：拉绑定 session 的历史（机器人 tab 同款，对应 yomi 的 listMessages）
async function handleMiraHistory(sessionId) {
  const cfg = deps.getConfig() || {};
  if (!cfg.projectId) throw new Error('还没配 projectId');
  if (!sessionId) return [];
  const url = `${restBase()}/api/projects/${encodeURIComponent(cfg.projectId)}/sessions/${encodeURIComponent(sessionId)}/history`;
  const data = await restJson('GET', url, cfg.token);
  const list = Array.isArray(data) ? data : (data && (data.messages || data.history || data.items || data.events || data.data)) || [];
  if (!Array.isArray(list)) return [];
  return list.map((m) => normalizeHistoryItem(m, sessionId)).filter(Boolean).sort((a, b) => a.ts - b.ts);
}

// 小本本发言：inject 注入并等 mira 的回答（回答经 subscribe 事件流回来）。
// 一次只允许一条在途：第二条直接拒绝，避免两条 waiter 互相顶掉、答非所问
function handleMiraSay(sessionId, text) {
  return new Promise((resolve, reject) => {
    if (status !== 'online') { reject(new Error('mira 还没连上')); return; }
    if (sayWait) { reject(new Error('上一条还没回，等 mira 答完再问')); return; }
    const w = { resolve, timer: null, sessionId: sessionId || '' };
    w.timer = setTimeout(() => {
      if (sayWait === w) { sayWait = null; resolve('（发出去了，mira 还没回，稍等去 mira 那边看看吧）'); }
    }, 120000);
    sayWait = w;
    injectEvent(text).catch((e) => {
      if (sayWait === w) { clearTimeout(w.timer); sayWait = null; reject(e); }
    });
  });
}

// inject 通道（M26 逆向：{type,from,content}，供 webhook/CI 注入事件）；
// 语义是否等价「以用户身份发言」未实测确认（高博名下无项目没法试），不行就换 promptSession
async function injectEvent(text) {
  const cfg = deps.getConfig() || {};
  if (!cfg.projectId) throw new Error('还没配 projectId');
  const url = `${restBase()}/api/mira/projects/${encodeURIComponent(cfg.projectId)}/inject`;
  return restJson('POST', url, cfg.token, { type: 'event', from: 'kira-desktop', content: String(text).slice(0, 4000) });
}

// 备用发言通道：WS prompt{session_id,content,model}（bundle 逆向，语义就是给 agent 会话发用户消息）
function promptSession(sessionId, content, model) {
  if (!sessionId) return Promise.reject(new Error('缺 sessionId'));
  const params = { session_id: sessionId, content: String(content).slice(0, 4000) };
  if (model) params.model = model;
  return call('prompt', params, 20000);
}

module.exports = { init, start, stop, restart, getState, handleMiraHistory, handleMiraSay, promptSession };
