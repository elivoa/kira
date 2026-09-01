// 飞书机器人连接器：官方 SDK WebSocket 长连接收消息（不需要公网回调地址），
// 回复走 OpenAPI。消息统一交给 main.js 注入的 kimiChat，和小本子共用同一个大脑。
//
// 同步策略：事件推送可能被同应用的其他后端消费掉，所以会话历史以「主动拉」为准——
// 握手（按主人邮箱发一条消息）拿到私聊 chat_id 后，listHistory 全量拉、pollNew 轮询增量，
// 事件到了只当实时加速。所有消息统一成 {t, role, content, id, source} 经 onMessage 上报。
const Lark = require('@larksuiteoapi/node-sdk');

let deps = null;
let wsClient = null; // 长连接
let client = null;   // OpenAPI 客户端（回消息/拉历史用）
let status = 'off';  // off | connecting | online | error
let statusErr = '';
let botName = '';    // 连上后从 bot/v3/info 拿，给笔记本的动态 tab 命名用
let lastChatId = ''; // 私聊会话 id（持久化到 config）
let lastSyncSec = 0; // 轮询水位（秒）：0 = 还没初始化，首轮只记水位不播报
const seen = [];      // message_id 去重环（飞书事件会重投）
const lastMsgIds = new Set(); // 已上报过的消息 id（事件+轮询+自己发的），防重复上屏
const mirror = [];    // 对话镜像（最近 100 条，拉不到飞书历史时的兜底）

function setStatus(s, err) {
  status = s;
  statusErr = err || '';
  if (deps && deps.onStatus) deps.onStatus({ status, error: statusErr, botName });
}

function init(d) { deps = d; }

function getState() { return { status, error: statusErr, botName, hasChat: !!lastChatId, mirror }; }

// 上报一条归一化消息，并记账防重
function emit(m) {
  if (m.id && !String(m.id).startsWith('local-')) {
    if (lastMsgIds.has(m.id)) return;
    lastMsgIds.add(m.id);
    if (lastMsgIds.size > 1000) lastMsgIds.clear(); // 有轮询水位兜底，清了也不会重报
  }
  const sec = Math.floor(m.t / 1000);
  if (sec > lastSyncSec) lastSyncSec = sec;
  if (deps.onMessage) deps.onMessage(m);
}

// 连上后查一次机器人信息（bot/v3/info），拿到名字好让笔记本 tab 用它命名；查不到不碍事
async function fetchBotName() {
  try {
    const res = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' });
    const name = res && ((res.bot && res.bot.app_name) || (res.data && res.data.bot && res.data.bot.app_name));
    if (name && name !== botName) {
      botName = name;
      setStatus(status); // 状态没变，只是补发一次带上 botName
    }
  } catch {}
}

// 统一回答通道：飞书消息和小本子发言都走这一个 kimiChat，回答一致
async function answer(text) {
  try {
    const r = await deps.kimiChat(text);
    return r == null ? '主人还没给我配 Kimi key，我现在脑子不在线，先去小本子配置页配上吧~' : r;
  } catch (err) {
    return `呜，连不上脑子了…（${err.message}）`;
  }
}

// 记录一条镜像（兜底历史用）
function logMirror(chatType, userText, replyText) {
  mirror.push({ t: Date.now(), chatType, userText, replyText });
  if (mirror.length > 100) mirror.shift();
  if (deps.onLog) deps.onLog({ t: Date.now(), chatType, userText, replyText });
}

// 事件到达：主人在飞书里发的消息
async function handleMessage(data) {
  const msg = data && data.message;
  if (!msg || msg.message_type !== 'text') return;
  // 只理真人；机器人（含自己）发的消息不回，防自聊死循环
  if (!data.sender || data.sender.sender_type !== 'user') return;
  if (seen.includes(msg.message_id)) return;
  seen.push(msg.message_id);
  if (seen.length > 200) seen.shift();

  let text = '';
  try { text = JSON.parse(msg.content).text || ''; } catch { return; }
  text = text.replace(/@_user_\d+/g, '').trim(); // 剥掉 @机器人 的占位符
  // 群聊只在被 @ 时响应，私聊总是响应
  if (msg.chat_type !== 'p2p' && (!msg.mentions || !msg.mentions.length)) return;
  if (!text) return;

  // 记住私聊会话 id：拉历史、小本子发言回写都靠它
  if (msg.chat_id && msg.chat_id !== lastChatId) {
    lastChatId = msg.chat_id;
    if (deps.persistChatId) deps.persistChatId(lastChatId);
  }

  emit({ t: Number(msg.create_time) || Date.now(), role: 'user', content: text, id: msg.message_id, source: 'ws' });
  const reply = await answer(text);

  let replyId = '';
  try {
    const sent = await client.im.message.reply({
      path: { message_id: msg.message_id },
      data: { content: JSON.stringify({ text: reply }), msg_type: 'text' },
    });
    replyId = (sent && (sent.message_id || (sent.data && sent.data.message_id))) || '';
  } catch (err) {
    setStatus('error', `回复消息失败：${err.message}`);
    return;
  }
  emit({ t: Date.now(), role: 'assistant', content: reply, id: replyId || `local-${Date.now()}`, source: 'ws' });
  logMirror(msg.chat_type, text, reply);
}

// 小本子机器人 tab 的发言：和飞书消息走同一条回答通道，回答同时发到飞书会话里。
// 机器人在飞书里没法冒充主人发消息，所以飞书侧只会出现她的回答，问题留在小本子上
async function handleNotebook(text) {
  const reply = await answer(text);
  let replyId = '';
  if (client && lastChatId) {
    try {
      const sent = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: lastChatId, content: JSON.stringify({ text: reply }), msg_type: 'text' },
      });
      replyId = (sent && (sent.message_id || (sent.data && sent.data.message_id))) || '';
    } catch (err) {
      setStatus('error', `发飞书消息失败：${err.message}`);
    }
  }
  // 问题小本子已经自行上屏，这里只上报回答（source=notebook，主进程不给它冒泡）
  emit({ t: Date.now(), role: 'assistant', content: reply, id: replyId || `local-${Date.now()}`, source: 'notebook' });
  logMirror('notebook', text, reply);
  return reply;
}

// 展平 post 富文本：段落数组里把文本段拼起来（链接取地址，@取名字）
function flattenPost(obj) {
  const parts = [];
  if (obj.title) parts.push(obj.title);
  for (const p of obj.content || []) {
    let line = '';
    for (const seg of p || []) {
      if (seg.text) line += seg.text;
      else if (seg.tag === 'a' && seg.href) line += seg.href;
      else if (seg.tag === 'at' && seg.user_name) line += `@${seg.user_name}`;
    }
    if (line.trim()) parts.push(line);
  }
  return parts.join('\n').trim();
}

// 把一条飞书消息归一化；无法展示的类型的返回 null。
// 卡片（interactive）是 2.0 格式时 API 只给「升级客户端」占位，正文拿不到，只能标记位置
function normalize(it) {
  let text = '';
  if (it.msg_type === 'text') {
    try { text = JSON.parse(it.body.content).text || ''; } catch { return null; }
  } else if (it.msg_type === 'post') {
    try {
      const obj = JSON.parse(it.body.content);
      const root = obj.content ? obj : (obj.zh_cn || obj.en_us || Object.values(obj)[0] || {});
      text = flattenPost(root);
    } catch { return null; }
  } else if (it.msg_type === 'interactive') {
    text = '[卡片消息，在飞书里查看]';
  } else if (it.msg_type === 'image') {
    text = '[图片]';
  } else if (it.msg_type === 'sticker') {
    text = '[表情]';
  } else {
    return null;
  }
  text = text.replace(/@_user_\d+/g, '').trim();
  if (!text) return null;
  return {
    t: Number(it.create_time) || Date.now(),
    role: it.sender && it.sender.sender_type === 'user' ? 'user' : 'assistant',
    content: text,
    id: it.message_id,
  };
}

// 机器人 tab 的历史：直接拉飞书会话里的真实消息（展示完全 follow 飞书侧）；
// 没有会话 id（没握手也没收到过消息）退回内存镜像。返回 [{t, role, content, id}]
async function listHistory() {
  if (client && lastChatId) {
    try {
      const res = await client.im.message.list({
        params: { container_id_type: 'chat', container_id: lastChatId, page_size: 50, sort_type: 'ByCreateTimeAsc' },
      });
      const items = (res && res.items) || (res && res.data && res.data.items) || [];
      const out = [];
      for (const it of items) {
        const m = normalize(it);
        if (!m) continue;
        if (m.id) lastMsgIds.add(m.id); // 已上屏的别被轮询再报一遍
        const sec = Math.floor(m.t / 1000);
        if (sec > lastSyncSec) lastSyncSec = sec;
        out.push(m);
      }
      if (out.length) return out;
    } catch {}
  }
  const out = [];
  for (const m of mirror) {
    out.push({ t: m.t, role: 'user', content: m.userText, id: `local-m${m.t}q` });
    out.push({ t: m.t, role: 'assistant', content: m.replyText, id: `local-m${m.t}a` });
  }
  return out;
}

// 轮询增量：事件被其他后端消费时，靠它把飞书会话全部消息同步进来。
// 水位没初始化（还没拉过历史）时只记水位不播报，免得把陈年老消息全冒一遍泡
async function pollNew() {
  if (!client || !lastChatId) return [];
  if (!lastSyncSec) {
    lastSyncSec = Math.floor(Date.now() / 1000);
    return [];
  }
  try {
    const res = await client.im.message.list({
      params: { container_id_type: 'chat', container_id: lastChatId, page_size: 20, sort_type: 'ByCreateTimeAsc', start_time: String(lastSyncSec) },
    });
    const items = (res && res.items) || (res && res.data && res.data.items) || [];
    const out = [];
    for (const it of items) {
      if (it.message_id && lastMsgIds.has(it.message_id)) continue;
      const m = normalize(it);
      if (m && m.id) lastMsgIds.add(m.id);
      const sec = Math.floor(Number(it.create_time) / 1000) || 0;
      if (sec > lastSyncSec) lastSyncSec = sec;
      if (m) out.push({ ...m, source: 'poll' });
    }
    return out;
  } catch {
    return [];
  }
}

// 握手：按主人邮箱解析 open_id，机器人主动发一条消息，从返回里拿私聊 chat_id。
// 飞书里会真实多出一条机器人发的消息，所以由配置页的「连接会话」按钮触发
async function handshake() {
  if (!client) return { ok: false, error: '飞书连接没启用' };
  if (lastChatId) return { ok: true };
  const email = (deps.getConfig() || {}).ownerEmail;
  if (!email) return { ok: false, error: '先填你的飞书邮箱并保存' };
  let openId = '';
  try {
    const r = await client.contact.v3.user.batchGetId({ params: { user_id_type: 'open_id' }, data: { emails: [email] } });
    const list = (r && r.user_list) || (r && r.data && r.data.user_list) || [];
    openId = (list[0] && list[0].user_id) || '';
  } catch (err) {
    return { ok: false, error: `查用户失败：${err.message}` };
  }
  if (!openId) return { ok: false, error: '这个邮箱没查到用户（应用的可用范围要包含你）' };
  try {
    const sent = await client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: { receive_id: openId, content: JSON.stringify({ text: '小本子同步连上啦~ 以后我们的对话都会同步过去 🃏✨' }), msg_type: 'text' },
    });
    const chatId = (sent && (sent.chat_id || (sent.data && sent.data.chat_id))) || '';
    if (!chatId) return { ok: false, error: '握手消息发出去了，但没拿到会话 id' };
    lastChatId = chatId;
    if (deps.persistChatId) deps.persistChatId(chatId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `握手失败：${err.message}` };
  }
}

// 校验凭证并拿机器人名字（客户端模式的状态判定走这里）
async function verify() {
  try {
    const res = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' });
    const name = res && ((res.bot && res.bot.app_name) || (res.data && res.data.bot && res.data.bot.app_name));
    if (name) botName = name;
    setStatus('online');
  } catch (err) {
    setStatus('error', (err && err.message) || '凭证校验失败');
  }
}

function start() {
  stop();
  botName = '';
  const cfg = (deps && deps.getConfig()) || {};
  lastChatId = cfg.lastChatId || '';
  if (!cfg.enabled || !cfg.appId || !cfg.appSecret) { setStatus('off'); return; }
  setStatus('connecting');
  client = new Lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret, disableTokenCache: false });
  // 默认同步客户端模式：不持有长连接。同一应用多条长连接时飞书会把事件随机分发给
  // 其中一条——我们连着会抢走别的后端（niko）的事件，纯轮询拉消息反而一条不缺。
  // 只有主人明确让 Kira 接管回复（replyBot）时才起长连接消费事件
  if (!cfg.replyBot) {
    verify();
    return;
  }
  // 接管模式：起长连接消费事件并直接回复（此时应停掉其他后端，避免抢答）
  // 自定义 logger：密钥错误这类致命失败 SDK 只走 error 日志、不进 onError（自动重连会
  // 一直重试），借它把状态翻成 error；顺带压住 SDK 默认的 console 输出
  const statusLogger = {
    error: (...args) => setStatus('error', args.map(String).join(' ').replace(/^\[ws\][, ]*/, '')),
    warn: () => {}, info: () => {}, debug: () => {}, trace: () => {},
  };
  wsClient = new Lark.WSClient({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    logger: statusLogger,
    loggerLevel: Lark.LoggerLevel.warn,
    onReady: () => { setStatus('online'); fetchBotName(); },
    onReconnecting: () => setStatus('connecting'),
    onReconnected: () => setStatus('online'),
    onError: (err) => setStatus('error', err && err.message),
  });
  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      handleMessage(data).catch((err) => setStatus('error', `处理消息出错：${err.message}`));
    },
  });
  wsClient.start({ eventDispatcher: dispatcher }).catch((err) => setStatus('error', err && err.message));
}

function stop() {
  if (wsClient) {
    try { wsClient.close({ force: true }); } catch {}
    wsClient = null;
  }
  client = null;
}

module.exports = { init, start, stop, restart: start, getState, handleNotebook, listHistory, pollNew, handshake };
