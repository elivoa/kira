// yomi wire 协议探针：WS 连接 daemon → Hello 握手 → ListSessions → SendMessage 验证。
// 用法：node tools/yomi_probe.js <ws-url> [token] [--say "文本"] [--list-sessions]
// 协议（yomi crates/kernel/src/wire + transport）：WS upgrade（可选 Bearer）+ 4 字节大端长度前缀 JSON 帧。
// 帧类型：{type:"request",id,method} / {type:"response",id,body:{status:"ok"|"err"}} / {type:"event"|"noti"|"ping"|"pong"}
const WebSocket = require('ws');

const url = process.argv[2];
const token = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const args = process.argv.slice(token ? 4 : 3);
const sayIdx = args.indexOf('--say');
const SAY = sayIdx >= 0 ? args[sayIdx + 1] : null;
const LIST = args.includes('--list-sessions');

if (!url) {
  console.log('用法: node tools/yomi_probe.js <ws-url> [token] [--say "文本"] [--list-sessions]');
  process.exit(1);
}

let nextId = 1;
const pending = new Map();
let buf = Buffer.alloc(0);

function sendFrame(ws, msg) {
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(payload.length);
  ws.send(Buffer.concat([head, payload]));
}

function call(ws, method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // serde 外部标签枚举：无参变体直接给字符串（"hello"/"subscribe_all"），带参变体给 {方法: 参数}
    sendFrame(ws, { type: 'request', id, method: params === undefined ? method : { [method]: params } });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 15000);
  });
}

function onData(chunk, ws, onEvent) {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32BE(0);
    if (buf.length < 4 + len) return;
    const payload = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
    if (msg.type === 'response') {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.body && msg.body.status === 'ok') p.resolve(msg.body.result);
        else p.reject(new Error((msg.body && msg.body.error && msg.body.error.message) || 'rpc error'));
      }
    } else if (msg.type === 'ping') {
      sendFrame(ws, { type: 'pong' });
    } else if (msg.type === 'event' || msg.type === 'noti') {
      onEvent && onEvent(msg);
    }
  }
}

async function main() {
  const opts = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  const ws = new WebSocket(url, opts);
  ws.on('error', (e) => { console.error('[ws-error]', e.message); process.exit(1); });
  ws.on('close', (c, r) => { console.log('[ws-close]', c, r.toString().slice(0, 200)); });
  ws.on('unexpected-response', (_req, res) => {
    console.error('[unexpected-response]', res.statusCode, res.statusMessage);
    process.exit(1);
  });
  ws.on('message', (data) => onData(data, ws, (ev) => {
    const t = ev.type;
    const inner = ev.event || ev;
    console.log(`[event ${t}]`, JSON.stringify(inner).slice(0, 300));
  }));
  await new Promise((r) => ws.on('open', r));
  console.log('[connected]', url);

  const hello = await call(ws, 'hello');
  console.log('[Hello]', JSON.stringify(hello));

  if (LIST) {
    const sessions = await call(ws, 'list_sessions', { project_id: null, scope: 'all', before: null, limit: 50 });
    console.log('[ListSessions]', JSON.stringify(sessions, null, 1).slice(0, 4000));
  }

  if (SAY) {
    const sid = SAY.match(/^[a-f0-9-]{36}$/i) ? SAY : null;
    if (sid) {
      const r = await call(ws, 'send_message', { session_id: sid, blocks: [{ type: 'text', text: SAY.split('|')[1] || SAY }] });
      console.log('[SendMessage]', JSON.stringify(r).slice(0, 300));
    }
  }

  ws.close();
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
