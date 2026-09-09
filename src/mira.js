// mira 连接器（Mira Tag 子部署，tag.mira.msh.team，MoonGate SSO 后面）：
// WebSocket 上跑 JSON-RPC（文本帧自带边界，不是 yomi 的 4 字节长度前缀帧）。
//
// 鉴权两层（M26/M34 实测）：MoonGate Bearer 只过网关；先 GET /api/auth/providers/moongate/complete
// （带 Bearer，302 响应的 Set-Cookie 里拿 mira_session，30 天有效），之后 REST 和 WS 握手都要
// Bearer + Cookie 双带；401 时自动重换一次，再失败才转粘性鉴权错误。
//
// 协议要点（M26 实测 + tag 前端 bundle 逆向）：
//   订阅  {"id","method":"subscribe","space_id":<space>,"params":{"after_cursor"?}}——space_id 是顶层字段
//         （主部署是 params.project_id，写错返 Invalid stream request）；成功回 {"id","result":{"ok":true}}
//   游标  after_cursor = {per_turn:{"<sessionId>:live:<turnId>":maxSeq}}：seq 是回合内序号，水位按回合记
//   事件  {"method":"agent_event","space_id","session_uuid","params":{"seq,"event":{"type","turnId",...}}}
//         （M35 按真实帧实测修正）用户可见回复只认 tool.call.started 且 name=='source_reply'
//         的 args.text（一次性给全，无需聚合 delta）；assistant.delta 是 agent 内心叙述，
//         不到用户侧，不上屏；feishu_reaction 等其他工具调用、thinking.delta / tool.call.delta /
//         tool.result / agent.status.updated / turn.step.* 全部过滤；user.input = 用户发言；
//         turn.ended 收尾一回合
//   历史  tag 无 REST 历史端点，after_cursor 回放也不可用：只显示连接后的实时消息
//   发言  WS prompt：{"id","method":"prompt","session_uuid","space_id","params":{"session_uuid,"content"}}
//         （tag 没有主部署的 REST inject 端点）
//   space 列表  GET /api/mira/spaces（不是主部署的 /projects）
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
const cursorPerTurn = {};      // 续传水位：{"<sessionId>:live:<turnId>": maxSeq}（seq 是回合内序号）
let cursorSpace = '';          // 水位所属 space：换 space 后旧水位作废，全量回放
let lastSeq = null;            // 最近收到的事件 seq：只作事件 cursor 字段带给 UI
let lastSessionId = '';        // 最近活跃的 sessionId：发言缺省目标 + getState 带给 UI
let permanentError = false;    // 鉴权/配置类永久错误：不再自动重连，等用户改配置 restart
let authRetried = false;       // 本次连接已因 401 重换过 cookie：再 401 就是真鉴权失败
let connGen = 0;               // 连接代际：旧 socket 迟到的事件（close/error/message）按代际丢弃
let lastFrameAt = 0;           // 最近收到任何帧的时间：半开连接靠看门狗发现
let watchdogTimer = null;
let sayWait = null;            // 小本本发言等待 mira 回答的挂起 Promise（带 sessionId + 身份校验，防并发串话）
let restartTimer = null;       // restart() 的延迟启动定时器：stop() 必须能取消它，否则双 socket 泄漏
const MAX_FRAME = 16 * 1024 * 1024; // 单帧上限：超过即断连，防坏对端把内存撑爆

function setStatus(s, err) {
  status = s;
  statusErr = err || '';
  if (deps && deps.onStatus) deps.onStatus({ status, error: statusErr });
}

function init(d) { deps = d; }
function getState() { return { status, error: statusErr, projectId: (deps.getConfig() || {}).projectId || '', sessionId: lastSessionId }; }

// ---------- JSON-RPC ----------
function sendMsg(msg) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

// topLevel：tag 的 subscribe/prompt 要把 space_id/session_uuid 放在顶层（与 params 平级）
function call(method, params, timeoutMs = 15000, topLevel) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const msg = { id, method, ...(topLevel || {}) };
    if (params !== undefined) msg.params = params;
    if (!sendMsg(msg)) {
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
    if (!p) return; // 无主的带 id 消息（迟到的 pong 等）直接吞：对响应回响应是协议噪音
    pending.delete(String(msg.id));
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'));
    else p.resolve(msg.result !== undefined ? msg.result : msg);
    return;
  }
  if (msg.method) onPush(msg.method, msg.params, msg);
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

// user.input 的 input 是 ContentBlock[]（实测）：
//   <system-reminder> 块是服务端内部注入，整块丢弃；
//   <system> 块是来源信封（source_message/from/arrived_by 等元数据行），正文在首个空行之后，
//   可能带 "message: " 前缀；无信封的纯文本块（小本本 prompt 回显）原样保留
function userInputText(raw) {
  if (!raw) return '';
  const blocks = Array.isArray(raw) ? raw : [raw];
  const parts = [];
  for (const b of blocks) {
    let t = typeof b === 'string' ? b : (b && b.type === 'text' ? b.text : '');
    if (!t) continue;
    if (t.startsWith('<system-reminder')) continue;
    if (t.startsWith('<system>')) {
      const i = t.indexOf('\n\n');
      t = i < 0 ? '' : t.slice(i + 2).replace(/^message:\s*/, '');
    }
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}

// 统一出口：{kind, sessionId, role, text, cursor, ts, source:'mira'}（与 M28 约定的事件格式）
// key 是跨回合唯一的去重键（turn:seq）：cursor 只是回合内 seq，跨回合会撞号，UI 去重优先用 key
function emitEvent(kind, sessionId, role, text, id, key) {
  const out = { kind, sessionId: sessionId || '', role: role || '', text: text || '', cursor: lastSeq, ts: Date.now(), source: 'mira' };
  if (id != null) out.id = id;
  if (key != null) out.key = key;
  if (deps.onEvent) deps.onEvent(out);
  if (kind === 'message' && role === 'assistant' && sayWait && sessionId === sayWait.sessionId) {
    const w = sayWait;
    sayWait = null;
    clearTimeout(w.timer);
    w.resolve(text);
  }
}

// stop()/断连时清在途发言 waiter：不清的话旧 waiter 会挡新发言直到 120s 超时
function clearSayWait(err) {
  if (!sayWait) return;
  const w = sayWait;
  sayWait = null;
  clearTimeout(w.timer);
  w.reject(err);
}

// history_complete / mira_team_status 的 agents 快照带 sessions：借此定位最近活跃会话
function learnSessions(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    for (const s of (a && a.sessions) || []) {
      const sid = s && (s.session_uuid || s.session_id || s.id);
      if (sid) lastSessionId = sid;
    }
  }
}

function onPush(method, params, msg) {
  if (method === 'agent_event') return onAgentEvent(params, msg);
  if (method === 'history_complete') {
    if (msg && !msg.space_id) return; // 全局预告帧（无 agents/requests），等 space 级那一帧
    learnSessions(params && params.agents);
    const pendReqs = params && params.pending_requests;
    const n = Array.isArray(pendReqs) ? pendReqs.length : 0;
    emitEvent('history_complete', '', '', n ? `有 ${n} 条待处理请求` : '');
    if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira 历史回放完成${n ? `（${n} 条待处理请求）` : ''}` });
    return;
  }
  if (method === 'mira_team_status') {
    learnSessions(params && params.agents);
    return;
  }
  // control_event / prompt_queue / mira_worklog_update / mira_space_update / mira_product_update /
  // flow_stats_update 等推送：与对话上屏无关，忽略（帧本身已刷新看门狗）
}

function onAgentEvent(p, msg) {
  p = p || {};
  const ev = p.event || p;
  const seq = p.seq ?? p.cursor ?? ev.seq ?? ev.id;
  const sid = (msg && msg.session_uuid) || ev.session_id || ev.sessionId || p.session_id || p.sessionId || '';
  if (sid) lastSessionId = sid; // 记录最近活跃会话：发言缺省目标

  // seq 是回合内序号（续传水位按 per_turn 记），去重键必须带上回合，否则误杀其他回合的同号事件；
  // 缺 turnId 的兜底事件也至少带上 sid，防跨会话撞号。evtKey 随事件传出给 UI 做去重键
  const turnKey = sid && ev.turnId != null ? `${sid}:live:${ev.turnId}` : '';
  let evtKey = null;
  if (seq != null) {
    const k = turnKey ? `${turnKey}:${seq}` : `${sid}:${seq}`;
    if (seenSeq.includes(k)) return;
    seenSeq.push(k);
    if (seenSeq.length > 500) seenSeq.splice(0, 200);
    lastSeq = seq;
    evtKey = k;
    if (turnKey) {
      const n = typeof seq === 'number' ? seq : Number(seq);
      if (Number.isFinite(n) && (cursorPerTurn[turnKey] ?? -1) < n) cursorPerTurn[turnKey] = n;
      const keys = Object.keys(cursorPerTurn);
      if (keys.length > 600) for (const old of keys.slice(0, 200)) delete cursorPerTurn[old];
    }
    cursorSpace = (deps.getConfig() || {}).projectId || '';
  }
  const type = ev.type || p.type || '';

  // 用户输入（mira 侧真人发言，飞书 channel 进来的也算）
  if (type === 'user.input') {
    const text = userInputText(ev.input ?? ev.text ?? ev.content);
    if (text) emitEvent('message', sid, 'user', text, ev.message_id ?? ev.id, evtKey);
    return;
  }

  // 用户可见回复只认 source_reply 工具调用（实测：tool.call.started 一次性给全 args.text）。
  // feishu_reaction 等其他工具一律不上屏；toolCallId 做 id 防重连回放重复上屏
  if (type === 'tool.call.started') {
    if (ev.name === 'source_reply') {
      const text = asText(ev.args && ev.args.text);
      if (text) emitEvent('message', sid, 'assistant', text, ev.toolCallId, evtKey);
    }
    return;
  }

  // 回合收尾：回答已经随 source_reply 上屏，这里只发状态让 UI 收束等待态
  if (type === 'turn.ended') {
    emitEvent('status', sid, '', 'turn.ended', undefined, evtKey);
    return;
  }
  if (type === 'turn.started') {
    emitEvent('status', sid, '', 'turn.started', undefined, evtKey);
    return;
  }

  // 交互提交（审批/问答的回答）：当用户消息上屏
  if (type === 'interactive.submission') {
    const text = asText(ev.text ?? ev.content ?? ev.value ?? ev.submission);
    if (text) emitEvent('message', sid, 'user', text, ev.id, evtKey);
    return;
  }
  // assistant.delta（agent 内心叙述，不到用户侧）/ thinking.delta / tool.call.delta /
  // tool.result / agent.status.updated / turn.step.* 等：全部过滤（游标已在上面记账）
}

// ---------- 连接管理 ----------
async function connectOnce() {
  const cfg = deps.getConfig() || {};
  if (!cfg.enabled || !cfg.wsUrl) { setStatus('off'); return; }
  if (!cfg.projectId) { setStatus('error', '还没配 projectId（space id）'); return; } // 配置缺项重连也不会自愈，不排重试
  const gen = ++connGen; // 本 socket 的代际：之后所有事件处理器先验代，旧代事件直接丢
  setStatus('connecting');
  let cookie = '';
  try {
    cookie = await ensureCookie();
  } catch (e) {
    if (gen !== connGen) return;
    // 换 cookie 就 401/403 或服务端确定性回绝（4xx/SSO 重定向）是粘性错误；网络类失败排重试
    if (e.permanent || /401|403/.test(e.message)) {
      permanentError = true;
      setStatus('error', `鉴权失败：${e.message}`);
      return;
    }
    setStatus('connecting', `cookie 换取失败：${e.message}`);
    scheduleRetry();
    return;
  }
  if (gen !== connGen) return; // 等 cookie 期间已被 stop/restart 换代
  try {
    const headers = {};
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    if (cookie) headers.Cookie = cookie;
    ws = new WebSocket(cfg.wsUrl, { headers });
  } catch (e) {
    // 构造抛错基本是 wsUrl 格式问题，重连也不会自愈：粘性 error，等改配置
    permanentError = true;
    setStatus('error', e.message);
    return;
  }
  ws.on('message', (d) => { if (gen === connGen) onData(d); });
  ws.on('unexpected-response', (_req, res) => {
    if (gen !== connGen) return;
    // 401 先当是 cookie 失效：重换一次再连；还 401 才转粘性 error
    if (res.statusCode === 401 && !authRetried && cfg.token) {
      authRetried = true;
      sessionCookie = '';
      cookieFetchedAt = 0;
      try { ws.close(); } catch {}
      if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: 'mira 握手 401，重换 cookie 后再连' });
      connectOnce();
      return;
    }
    const hint = res.statusCode === 401 ? '（token 不对）' : res.statusCode === 403 ? '（SSO 没放行）' : '';
    // 401/403 是鉴权类永久错误：重连一万次也是这个码，转粘性 error 等改配置
    if (res.statusCode === 401 || res.statusCode === 403) permanentError = true;
    setStatus('error', `握手被拒：HTTP ${res.statusCode}${hint}`);
    ws.close();
  });
  ws.on('error', (e) => { if (gen === connGen && status !== 'error') setStatus('error', e.message); });
  ws.on('close', (code, reason) => {
    if (gen !== connGen) return; // 旧 socket 迟到的 close：别误杀新一代的连接
    // 拒绝所有挂起的 RPC 和在途发言 waiter
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('connection closed')); }
    pending.clear();
    clearSayWait(new Error('mira 连接断了'));
    ws = null;
    stopWatchdog();
    if (!stoppedByUser) {
      if (permanentError) return; // 粘性 error：保持 error 态不重连，等用户改配置触发 restart
      setStatus('connecting', `连接断了（${code}），重连中…`);
      if (deps.onLog && code !== 1000) deps.onLog({ t: Date.now(), type: '系统', text: `mira 连接断开（${code}${reason ? ' ' + String(reason).slice(0, 80) : ''}），重连中` });
      scheduleRetry();
    } else setStatus('off');
  });
  ws.on('open', async () => {
    try {
      // 有水位（且没换 space）就 after_cursor 续传，否则全量回放
      const hasCursor = cursorSpace === cfg.projectId && Object.keys(cursorPerTurn).length > 0;
      const params = {};
      if (hasCursor) params.after_cursor = { per_turn: cursorPerTurn };
      try {
        await call('subscribe', params, 15000, { space_id: cfg.projectId });
      } catch (e) {
        // 水位不被接受（格式不认/部署变了）时清掉全量回放；鉴权类错误直接抛
        if (!hasCursor || /forbidden|unauthorized|401|403/i.test(e.message)) throw e;
        for (const k of Object.keys(cursorPerTurn)) delete cursorPerTurn[k];
        await call('subscribe', {}, 15000, { space_id: cfg.projectId });
      }
      if (gen !== connGen) return; // subscribe 等待期间连接已被换掉
      authRetried = false;
      retryDelay = 3000;
      lastFrameAt = Date.now();
      startWatchdog();
      setStatus('online');
      if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira 连上了（space ${cfg.projectId}）` });
    } catch (e) {
      if (gen !== connGen) return;
      // Forbidden/鉴权类订阅失败是永久错误（非 space 成员、token 没权限），转粘性 error
      if (/forbidden|unauthorized|401|403/i.test(e.message)) {
        permanentError = true;
        if (deps.onLog) deps.onLog({ t: Date.now(), type: '系统', text: `mira ${e.message}：不再自动重连，请检查 token / space 成员资格` });
      }
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
  if (stoppedByUser || retryTimer || permanentError) return;
  // 指数退避 + jitter（±30%），避免固定节奏打桩
  const wait = Math.round(retryDelay * (0.7 + Math.random() * 0.6));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!stoppedByUser && !permanentError) connectOnce();
  }, wait);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

function start() {
  stoppedByUser = false;
  permanentError = false; // 手动 start/restart（改配置后）解除粘性 error，重新尝试
  authRetried = false;
  retryDelay = 3000;
  connectOnce();
}

function stop() {
  stoppedByUser = true;
  connGen++; // 作废旧 socket：它迟到的 close/error/message 全部忽略，防误杀下一代连接
  stopWatchdog();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  clearSayWait(new Error('mira 已断开'));
  if (ws) { try { ws.close(); } catch {} ws = null; }
  setStatus('off');
}

function restart() {
  stop();
  restartTimer = setTimeout(() => { restartTimer = null; start(); }, 300);
}

// ---------- 应用层鉴权：mira_session cookie ----------
// MoonGate Bearer 只过网关；complete 接口换 mira_session（30 天），REST/WS 都 Bearer+Cookie 双带
let sessionCookie = '';
let cookieFetchedAt = 0;
let cookiePromise = null;    // 在途换取：并发调用共享同一个 Promise，防打桩
const COOKIE_TTL = 29 * 24 * 3600 * 1000; // 30 天 Max-Age，提前一天主动重换

// ---------- REST（cookie 换取） ----------
// 注意：必须用 Node https 而不是全局 fetch —— Electron 主进程的全局 fetch 走
// Chromium network service，长连接/大响应上有坑（main.js 的 kimiChat 同款教训）
function restBase() {
  const cfg = deps.getConfig() || {};
  const wsUrl = String(cfg.wsUrl || '');
  if (!wsUrl) throw new Error('还没配 wsUrl');
  // wss://tag.mira.msh.team/api/stream → https://tag.mira.msh.team
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/api\/stream\/?$/, '');
}

// 裸请求：不拦截状态码（complete 的 302 和 401 重试都要读原始响应）
function restRaw(method, url, token, cookie, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = (/^https:/i.test(url) ? https : http).request(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureCookie(force) {
  const cfg = deps.getConfig() || {};
  if (!cfg.token) return ''; // 没 token 就没法换（本地 mock 场景允许裸连）
  if (!force && sessionCookie && Date.now() - cookieFetchedAt < COOKIE_TTL) return sessionCookie;
  if (cookiePromise) return cookiePromise;
  cookiePromise = (async () => {
    const res = await restRaw('GET', `${restBase()}/api/auth/providers/moongate/complete`, cfg.token, '');
    const found = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('mira_session='));
    if (!found.length) {
      const err = new Error(`complete 没发 mira_session（HTTP ${res.status}）`);
      // 服务端明确回了 4xx/3xx 异常（SSO 重定向、部署变了 404）：重试不会自愈，转粘性错误
      err.permanent = res.status < 500;
      throw err;
    }
    sessionCookie = found.join('; ');
    cookieFetchedAt = Date.now();
    return sessionCookie;
  })();
  try { return await cookiePromise; } finally { cookiePromise = null; }
}

// tag 没有 REST 历史端点（replay 实测不可用），after_cursor 回放也不可用：
// mira tab 只显示连接后的实时消息。保留 IPC 契约（main.js mira-history 还挂着），返回空页
async function handleMiraHistory() {
  return { items: [], nextCursor: null, hasMore: false };
}

// 小本本发言：WS prompt 发出并等 mira 的回答（回答经 subscribe 事件流回来）。
// 一次只允许一条在途：第二条直接拒绝，避免两条 waiter 互相顶掉、答非所问
function handleMiraSay(sessionId, text) {
  return new Promise((resolve, reject) => {
    if (status !== 'online') { reject(new Error('mira 还没连上')); return; }
    if (sayWait) { reject(new Error('上一条还没回，等 mira 答完再问')); return; }
    const sid = sessionId || lastSessionId; // 缺省用最近活跃会话（UI 还没从事件流学到 sessionId 时的兜底）
    if (!sid) { reject(new Error('还没定位到 mira 会话：先在飞书里跟 mira 说句话')); return; }
    const w = { resolve, reject, timer: null, sessionId: sid };
    w.timer = setTimeout(() => {
      if (sayWait === w) { sayWait = null; resolve('（发出去了，mira 还没回，稍等去 mira 那边看看吧）'); }
    }, 120000);
    sayWait = w;
    promptSession(sid, text).catch((e) => {
      if (sayWait === w) { clearTimeout(w.timer); sayWait = null; reject(e); }
    });
  });
}

// 发言通道：WS prompt（tag 没有 REST inject）；session_uuid 顶层字段，params 带 session_uuid+content
function promptSession(sessionId, content) {
  if (!sessionId) return Promise.reject(new Error('缺 sessionId'));
  const cfg = deps.getConfig() || {};
  const params = { session_uuid: sessionId, content: String(content).slice(0, 4000) };
  const topLevel = { session_uuid: sessionId };
  if (cfg.projectId) topLevel.space_id = cfg.projectId;
  return call('prompt', params, 20000, topLevel);
}

module.exports = { init, start, stop, restart, getState, handleMiraHistory, handleMiraSay, promptSession };
