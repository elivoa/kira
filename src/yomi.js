// kira 链接器（yomi wire 协议）：WS upgrade（可选 Bearer token）+ 4 字节大端长度前缀 JSON 帧。
// 替代原飞书 SDK 直连：kira daemon 才是飞书机器人本体——SubscribeAll 订阅它的事件流 =
// 同步飞书侧全部对话；SendMessage 到主人私聊 session = 小本本对 kira 说话（kira 的回答回飞书）。
//
// 协议要点（yomi crates/kernel/src/wire + transport）：
//   请求  {type:"request", id, method:{hello:{}} / {subscribe_all:{}} / {send_message:{...}}}
//   响应  {type:"response", id, body:{status:"ok", result} | {status:"err", error}}
//   事件  {type:"event", session_id, event_id, event:{user|agent|internal|model|tool}}
//   心跳  {type:"ping"} → 回 {type:"pong"}
// assistant 文本走 internal.message_added（message.role=assistant, content 是 ContentBlock 数组）。
const WebSocket = require('ws');

let deps = null;
let ws = null;
let status = 'off';      // off | connecting | online | error
let statusErr = '';
let stoppedByUser = true;
let retryTimer = null;
let retryDelay = 3000;
let nextId = 1;
let buf = Buffer.alloc(0);
const pending = new Map();     // id → {resolve, reject, timer}
const seenEvents = [];          // event_id 去重环（SubscribeAll 重连后可能重放）
let lastEventId = null;         // 最近收到的事件 id：重连后按它回放漏掉的事件（会话连续性）
let lastFrameAt = 0;            // 最近收到任何帧的时间：半开连接（对端死了但没 close 事件）靠看门狗发现
let watchdogTimer = null;
let notebookWait = null;        // 小本子发言等待 kira 回答的挂起 Promise（带 sessionId + 身份校验，防并发串话）
let restartTimer = null;        // restart() 的延迟启动定时器：stop() 必须能取消它，否则双 socket 泄漏
const MAX_FRAME = 16 * 1024 * 1024; // 单帧上限：超过即断连，防坏对端/粘包错误把内存撑爆

function setStatus(s, err) {
  status = s;
  statusErr = err || '';
  if (deps && deps.onStatus) deps.onStatus({ status, error: statusErr });
}

function init(d) { deps = d; }
function getState() { return { status, error: statusErr, sessionId: (deps.getConfig() || {}).sessionId || '' }; }

// ---------- 帧编解码 ----------
function sendFrame(msg) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(payload.length);
  ws.send(Buffer.concat([head, payload]));
  return true;
}

function call(method, params, timeoutMs = 15000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    // serde 外部标签枚举：无参变体直接给字符串（"hello"/"subscribe_all"），带参变体给 {方法: 参数}
    if (!sendFrame({ type: 'request', id, method: params === undefined ? method : { [method]: params } })) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('not connected'));
    }
  });
}

function onData(chunk) {
  lastFrameAt = Date.now();
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32BE(0);
    if (len > MAX_FRAME) {
      // 帧长度超限：协议已失同步或对端异常，丢弃缓冲并断连（走重连）
      buf = Buffer.alloc(0);
      if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `kira 帧长度异常（${len} 字节），断开重连` });
      try { ws && ws.terminate(); } catch {}
      return;
    }
    if (buf.length < 4 + len) return;
    const payload = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
    handleMsg(msg);
  }
}

function handleMsg(msg) {
  if (msg.type === 'response') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.body && msg.body.status === 'ok') p.resolve(msg.body.result);
    else p.reject(new Error((msg.body && msg.body.error && msg.body.error.message) || 'rpc error'));
    return;
  }
  if (msg.type === 'ping') { sendFrame({ type: 'pong' }); return; }
  if (msg.type === 'event') onEvent(msg);
}

// ---------- 事件归一化 ----------
// ContentBlock[] → 纯文本（只取 text，thinking/图片等跳过）
function blocksText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
}

// 事件归一化。这个 daemon 版本里：用户消息走 event.user.message，assistant 回复走 event.model.end
// （没有 internal.message_added）。model.end 按模型调用次数触发，工具多的回合会有好几条带文本的，
// 所以先按 session 缓存最新一条，等 agent.lifecycle stopped 了再一次性吐出来，不逐条冒泡
const replyBuf = new Map(); // sessionId → { text, eventId }

function emitMessage(role, content, id, sessionId) {
  const out = { t: Date.now(), role, content, id, source: 'kira', sessionId };
  if (deps.onMessage) deps.onMessage(out);
  if (role === 'assistant' && notebookWait && sessionId === notebookWait.sessionId) {
    const w = notebookWait;
    notebookWait = null;
    clearTimeout(w.timer);
    w.resolve(content);
  }
}

function onEvent(msg) {
  const evId = msg.event_id;
  if (evId) {
    if (seenEvents.includes(evId)) return;
    seenEvents.push(evId);
    if (seenEvents.length > 500) seenEvents.splice(0, 200);
    lastEventId = evId; // 水位：重连后按它回放漏掉的事件
  }
  const ev = msg.event || {};
  const sid = msg.session_id;

  // 用户消息（飞书侧来的，或我们 SendMessage 注入的）
  const um = ev.user && ev.user.message;
  if (um && um.content) {
    const text = blocksText(um.content);
    if (text) emitMessage('user', text, um.message_id || evId, sid);
    return;
  }

  // assistant 回复：model.end 缓存最新一条
  const me = ev.model && ev.model.end;
  if (me && me.content) {
    const text = blocksText(me.content);
    if (text) replyBuf.set(sid, { text, eventId: me.message_id || evId });
    return;
  }

  // 回合结束：把缓存的回复一次性吐出来
  const lc = ev.agent && ev.agent.lifecycle;
  if (lc && lc.state && typeof lc.state === 'object' && lc.state.stopped) {
    const buf = replyBuf.get(sid);
    if (buf) {
      replyBuf.delete(sid);
      emitMessage('assistant', buf.text, buf.eventId, sid);
    }
    return;
  }

  // internal.message_added：别的版本/路径的兜底
  const added = ev.internal && ev.internal.message_added;
  if (added && added.message) {
    const text = blocksText(added.message.content);
    if (text) emitMessage(added.message.role === 'assistant' ? 'assistant' : 'user', text, added.message.id || evId, sid);
  }
}

// ---------- 连接管理 ----------
async function connectOnce() {
  const cfg = deps.getConfig() || {};
  if (!cfg.enabled || !cfg.wsUrl) { setStatus('off'); return; }
  buf = Buffer.alloc(0); // 重连必须清空帧缓冲：旧连接的半帧残留会把新连接的解析打乱
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
    setStatus('error', `握手被拒：HTTP ${res.statusCode}${res.statusCode === 401 ? '（token 不对）' : ''}`);
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
      if (deps.onLog && code !== 1000) deps.onLog({ t: Date.now(), type: '系统', text: `kira 连接断开（${code}${reason ? ' ' + String(reason).slice(0, 80) : ''}），重连中` });
      scheduleRetry();
    } else setStatus('off');
  });
  ws.on('open', async () => {
    try {
      const hello = await call('hello');
      // 先回放漏掉的事件（如果有水位），再挂全量实时订阅
      const cfg2 = deps.getConfig() || {};
      if (cfg2.sessionId && lastEventId) {
        try { await call('subscribe', { session_id: cfg2.sessionId, after_event_id: lastEventId }); } catch {}
      }
      await call('subscribe_all');
      retryDelay = 3000;
      lastFrameAt = Date.now();
      startWatchdog();
      setStatus('online');
      if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `kira 连上了（wire v${(hello && hello.protocol_version) || '?'}）` });
    } catch (e) {
      setStatus('error', `握手失败：${e.message}`);
      try { ws && ws.close(); } catch {}
    }
  });
}

// 心跳保活：60s 发一次 {type:'ping'}（daemon 会回 pong，帧都会刷新 lastFrameAt）；
// 150s 没收到任何帧才判死——daemon 空闲时不推应用帧，单看静默会把好连接误杀（已踩坑）
function startWatchdog() {
  stopWatchdog();
  watchdogTimer = setInterval(() => {
    if (!ws) return;
    if (Date.now() - lastFrameAt > 150000) {
      try { ws.terminate(); } catch {}
      return;
    }
    sendFrame({ type: 'ping' });
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

// 给绑定的 session 发一句话（daemon 会当主人消息处理，kira 的回答进飞书）
async function sayToSession(text) {
  const cfg = deps.getConfig() || {};
  if (!cfg.sessionId) throw new Error('还没配 sessionId');
  return call('send_message', { session_id: cfg.sessionId, blocks: [{ type: 'text', text: String(text).slice(0, 4000) }] }, 20000);
}

// 小本本发言：发出去并等 kira 的回答（回答经 SubscribeAll 回来）。
// 一次只允许一条在途：第二条直接拒绝，避免两条 waiter 互相顶掉、答非所问
function handleNotebook(text) {
  return new Promise((resolve, reject) => {
    if (status !== 'online') { reject(new Error('kira 还没连上')); return; }
    if (notebookWait) { reject(new Error('上一条还没回，等 kira 答完再问')); return; }
    const cfg = deps.getConfig() || {};
    const w = { resolve, timer: null, sessionId: cfg.sessionId || '' };
    w.timer = setTimeout(() => {
      if (notebookWait === w) { notebookWait = null; resolve('（发出去了，kira 还没回，稍等飞书上看吧）'); }
    }, 120000);
    notebookWait = w;
    sayToSession(text).catch((e) => {
      if (notebookWait === w) { clearTimeout(w.timer); notebookWait = null; reject(e); }
    });
  });
}

// 发现会话：列最近 session，供配置页挑选绑定
async function listSessions() {
  return call('list_sessions', { project_id: null, scope: 'all', before: null, limit: 50 }, 20000);
}

// 绑定 session 的历史消息（机器人 tab 初始化用）
async function listMessages() {
  const cfg = deps.getConfig() || {};
  if (!cfg.sessionId) return [];
  const list = await call('list_messages', { session_id: cfg.sessionId }, 20000);
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m.kind !== 'tool') // 工具调用记录不上屏（psql/logcli 原始输出不是对话）
    .map((m) => ({ t: new Date(m.created_at || Date.now()).getTime(), role: m.kind === 'assistant' ? 'assistant' : 'user', content: blocksText(m.content), id: m.id }))
    .filter((m) => m.content);
}

module.exports = { init, start, stop, restart, getState, handleNotebook, listSessions, listMessages, sayToSession };
