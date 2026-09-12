// Kira Note：四个页签 —— 实时聊天 / MR Link / 日志 / 配置
// 自绘边框：关闭/最小化/右下角拉伸
document.getElementById('tlClose').addEventListener('click', () => window.close());
document.getElementById('tlMin').addEventListener('click', () => window.pet.nbMin());
{
  const handle = document.getElementById('resizeHandle');
  let resizing = false;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
    window.pet.nbResizeStart();
  });
  window.addEventListener('mousemove', () => { if (resizing) window.pet.nbResizeMove(); });
  window.addEventListener('mouseup', () => {
    if (resizing) { resizing = false; window.pet.nbResizeEnd(); }
  });
}

const input = document.getElementById('input');
const inputrow = document.querySelector('.inputrow');
const chatMsgs = document.getElementById('chatMsgs');
const mrMsgs = document.getElementById('mrMsgs');
const logList = document.getElementById('logList');

let activeTab = 'chat';

// ---------- 页签切换 ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    for (const key of ['chat', 'history', 'mr', 'bot', 'mira', 'log', 'debug', 'config']) {
      document.getElementById(`page-${key}`).classList.toggle('hidden', key !== activeTab);
    }
    inputrow.classList.toggle('hidden', activeTab === 'log' || activeTab === 'config' || activeTab === 'history' || activeTab === 'debug');
    if (activeTab === 'log') loadLogs();
    if (activeTab === 'config') { loadChatConfig(); loadFeishuConfig(); loadYomiConfig(); loadMiraConfig(); }
    if (activeTab === 'history') loadHistoryTab();
    if (activeTab === 'bot') loadBotTab();
    if (activeTab === 'mira') loadMiraTab();
    updateMiraInput();
  });
});

// 主进程点名切页签（星盘菜单「设置」直达配置页）
window.pet.onNotebookTab((tab) => {
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (btn) btn.click();
});

// ---------- 消息 ----------
function addMsg(list, who, text, cmd, source) {
  const m = document.createElement('div');
  m.className = `msg ${who}`;
  if (who === 'Kira') {
    const av = document.createElement('img');
    av.className = 'avatar';
    av.src = '../assets/head.png';
    m.appendChild(av);
  }
  const b = document.createElement('div');
  b.className = 'bubble' + (cmd ? ' cmd' : '');
  if (who === 'Kira' && !cmd) {
    // Kira 的回答按 markdown 渲染（含公式）
    b.classList.add('md');
    window.MarkdownStream.render(b, text);
  } else {
    b.textContent = text;
  }
  if (cmd) {
    b.addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      b.textContent = '已复制！';
      setTimeout(() => { b.textContent = text; }, 800);
    });
  }
  if (source) {
    // 来源标识（mira 等外部会话）：气泡上方一行小字，样式与 kira 同源但可区分
    const col = document.createElement('div');
    col.className = 'bcol';
    const s = document.createElement('span');
    s.className = 'src';
    s.textContent = source;
    col.append(s, b);
    m.appendChild(col);
  } else {
    m.appendChild(b);
  }
  list.appendChild(m);
  list.scrollTop = list.scrollHeight;
  b.msgEl = m; // 带 bcol 包裹时 b.parentNode 不是 .msg，向上加载统一用 msgEl 定位
  return b;
}

// ---------- 实时聊天 ----------
const CHAT_RULES = [
  [/你好|嗨|hi|hello|在吗|在么/i, ['在呀', '我在我在', '嗨嗨，想我了？', '一直在等你呢']],
  [/在干嘛|在做什么|干嘛呢/, ['在看你呀', '在法宝里躺着呢', '在练习可爱', '在数你多久没理我了']],
  [/吃(饭|了|啥|什么)|饿/, ['记得按时吃饭哦', '我也想吃点心了', '吃饱了才有力气陪你']],
  [/累|辛苦|疲惫/, ['摸摸头，辛苦了', '累了就靠过来一点', '辛苦啦，给你捏捏肩']],
  [/喜欢|爱|想你/, ['我也最喜欢你了', '我也是！', '想你想到变小（物理）']],
  [/晚安|拜拜|再见|走了/, ['晚安，梦里见', '拜拜，记得想我', '好梦哦']],
  [/谢谢|感谢/, ['不客气~', '嘿嘿，应该的', '谢什么，多见外']],
  [/梗|笑话|段子/, null], // null 表示从梗池里挑
  [/傻|笨|蠢/, ['才不傻呢', '你礼貌吗！', '哼，你这样说我会伤心的']],
  [/可爱|好看|漂亮/, ['那当然，我可是限定款', '谢谢，你眼光真好', '嘿嘿，今天也在认真营业可爱']],
];

function chatAnswer(text) {
  for (const [re, answers] of CHAT_RULES) {
    if (re.test(text)) {
      if (!answers) return PHRASES.meme[(Math.random() * PHRASES.meme.length) | 0];
      return answers[(Math.random() * answers.length) | 0];
    }
  }
  return pickPhrase(); // 词穷就卖萌
}

// ---------- MR Link ----------
function mrAnswer(text) {
  const url = (text.match(/https?:\/\/\S+/) || [])[0];
  if (!url) return { text: '这看起来不是一个链接哦', cmd: false };
  const mr = url.match(/merge_requests\/(\d+)/);
  if (mr) return { text: `[!${mr[1]}](${url})`, cmd: true };
  return { text: '这个链接我还不会处理，目前只认识 MR 链接', cmd: false };
}

// ---------- 提交（按当前页签路由） ----------
function submit(text) {
  text = (text || '').trim();
  if (!text) return;
  input.value = '';
  if (activeTab === 'mr') {
    addMsg(mrMsgs, 'me', text);
    const r = mrAnswer(text);
    addMsg(mrMsgs, 'Kira', r.text, r.cmd);
    window.pet.notebookSay(r.cmd ? '记好啦' : '唔…这个不会');
    window.pet.logAppend({ t: Date.now(), type: '交互', text: r.cmd ? `小本子记了一条链接：${r.text}` : '在小本子里收到一条看不懂的输入' });
  } else if (activeTab === 'chat') {
    addMsg(chatMsgs, 'me', text);
    window.pet.logAppend({ t: Date.now(), type: '交互', text: `和小本子聊天：${text.slice(0, 30)}` });
    askKira(chatMsgs, text);
  } else if (activeTab === 'bot') {
    addMsg(botMsgs, 'me', text);
    window.pet.logAppend({ t: Date.now(), type: '交互', text: `在小本子飞书 tab 发言：${text.slice(0, 30)}` });
    // 登记乐观上屏的文本：daemon 会把同一条 user 消息回显回来，onFeishuMsg 命中即跳过防双显
    const sentText = text.slice(0, 2000); // main.js yomi-send/feishu-send 都先截 2000（yomi.js 的 4000 不再生效），回显必为同一串
    pendingBotSends.push(sentText);
    if (pendingBotSends.length > 20) pendingBotSends.shift();
    // kira 链接在线时走 yomi wire（回答进飞书）；否则走旧飞书通道
    const send = yomiState.status === 'online' ? window.pet.yomiSend(text) : window.pet.feishuSend(text);
    const typing = addMsg(botMsgs, 'Kira', '正在输入…');
    typing.classList.add('typing');
    botMsgs.scrollTop = botMsgs.scrollHeight;
    const fail = () => {
      typing.classList.remove('typing');
      typing.innerHTML = '';
      window.MarkdownStream.render(typing, '呜，没发出去…');
    };
    send.then((r) => {
      consumePendingBotSend(sentText); // 回显必在回答之前来（或不会来），到这里清掉防呆
      if (r && r.ok) {
        // 回答一般经事件流先回来填进等待气泡（onFeishuMsg）；事件流没来（120s 兜底、
        // 或当时不在 bot 页被丢弃）时 resolve 的文案不能丢，填进等待气泡
        if (typing.classList.contains('typing')) {
          lastBotReply = { text: r.reply || '', t: Date.now() };
          typing.classList.remove('typing');
          typing.innerHTML = '';
          window.MarkdownStream.render(typing, r.reply || '（发出去了，kira 还没回，稍等飞书上看吧）');
          botMsgs.scrollTop = botMsgs.scrollHeight;
        }
        return;
      }
      fail();
    }).catch(() => {
      consumePendingBotSend(sentText);
      fail();
    });
  } else if (activeTab === 'mira') {
    if (!hasMira || miraState.readonly) return; // 只读降级时输入框已禁用，这里双保险
    addMsg(miraMsgs, 'me', text, false, 'mira');
    recordMiraShown('user', text, ''); // 乐观气泡也进镜像：切 tab 重进整体重渲，回显被吃掉后这条不能丢
    window.pet.logAppend({ t: Date.now(), type: '交互', text: `在小本子 mira tab 发言：${text.slice(0, 30)}` });
    // 发送点即截 2000（与 bot 路径 main.js yomi-send/feishu-send 同口径）：pending 登记与发送同源，
    // prompt 若把同一条消息回显为 user.input，onMiraEvent 命中即跳过防双显，>2000 字也不会失配
    const sentText = text.slice(0, 2000);
    pendingMiraSends.push(sentText);
    if (pendingMiraSends.length > 20) pendingMiraSends.shift();
    const typing = addMsg(miraMsgs, 'Kira', '正在输入…', false, 'mira');
    typing.classList.add('typing');
    miraMsgs.scrollTop = miraMsgs.scrollHeight;
    const fail = () => {
      typing.classList.remove('typing');
      typing.innerHTML = '';
      window.MarkdownStream.render(typing, '呜，没发出去…');
    };
    // 回答经 mira-event 流回来填等待气泡（source_reply 整条）；120s 没回来给个兜底文案
    const bail = setTimeout(() => {
      if (typing.classList.contains('typing')) {
        typing.classList.remove('typing');
        typing.innerHTML = '';
        window.MarkdownStream.render(typing, '（发出去了，mira 还没回，稍后再看看）');
      }
    }, 120000);
    window.pet.miraSend(miraState.sessionId, sentText).then((r) => {
      // 防呆 consume 只在 mira 页做：切走期间回显躺在 miraPending 里还没被消费，这里吃掉登记项
      // 会让切回重放时匹配落空、用户消息再上一次（R2 P1）；回显不来也无害（pendingMiraSends 上限 20）
      if (activeTab === 'mira') consumePendingMiraSend(sentText);
      if (r && r.ok) {
        if (r.reply && typing.classList.contains('typing')) {
          clearTimeout(bail);
          lastMiraReply = { text: r.reply };
          typing.classList.remove('typing');
          typing.innerHTML = '';
          window.MarkdownStream.render(typing, r.reply);
          recordMiraShown('assistant', r.reply, ''); // resolve 先填的回答事件侧会按同文案跳过，镜像要自己记
          miraMsgs.scrollTop = miraMsgs.scrollHeight;
        }
        return;
      }
      clearTimeout(bail);
      fail();
    }).catch(() => {
      consumePendingMiraSend(sentText);
      clearTimeout(bail);
      fail();
    });
  }
}

// 问 Kira 并流式渲染到指定消息列表：token 经 chat-token 事件推回；失败或没配 key 回退本地规则
function askKira(list, text) {
  const typing = addMsg(list, 'Kira', '正在输入…');
  typing.classList.add('typing'); // 等待期呼吸点动画，首个 token 到达即摘掉
  const chatId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let session = null;
  const pinScroll = () => { list.scrollTop = list.scrollHeight; };
  const offToken = window.pet.onChatToken(({ id, delta }) => {
    if (id !== chatId) return;
    if (!session) {
      typing.classList.remove('typing');
      typing.innerHTML = '';
      session = window.MarkdownStream.create(typing, pinScroll);
    }
    session.append(delta);
  });
  const fallback = () => {
    // 中途出错保留已流出的部分；没流出任何内容则回退本地规则
    typing.classList.remove('typing');
    if (session) session.finish();
    else {
      typing.innerHTML = '';
      window.MarkdownStream.render(typing, chatAnswer(text));
    }
    pinScroll();
  };
  window.pet.chatSend(text, chatId).then((r) => {
    offToken();
    typing.classList.remove('typing');
    if (r.ok && r.text != null) {
      if (!session) {
        typing.innerHTML = '';
        session = window.MarkdownStream.create(typing, pinScroll);
      }
      session.finish(r.text); // 以最终全文校准一次
      window.pet.notebookSay('回你啦');
      pinScroll();
    } else {
      fallback();
    }
  }).catch(() => {
    offToken();
    fallback();
  });
}

document.getElementById('send').addEventListener('click', () => submit(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(input.value); });

// 拖链接进来：自动切到 MR Link 页签
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) document.querySelector('.tab[data-tab="mr"]').click();
  submit(text);
});

// ---------- 日志页签 ----------
function fmt(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function entryEl({ t, type, text }, count) {
  const e = document.createElement('div');
  e.className = 'entry';
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmt(t);
  const tp = document.createElement('span');
  tp.className = `type type-${type}`;
  tp.textContent = type;
  const tx = document.createElement('span');
  tx.textContent = text;
  e.append(time, tp, tx);
  if (count > 1) {
    // 同类合并的条数徽标
    const c = document.createElement('span');
    c.className = 'cnt';
    c.textContent = `×${count}`;
    e.appendChild(c);
  }
  return e;
}

// 日志页筛选/合并开关：只看大模型、同类合并（默认开）
let logFilterLLM = false;
let logMergeSame = true;
let cachedLogs = [];

// 同类（类型+文本相同）合并：按 key 聚合，保留最新时间戳的位置，带条数
function mergeLogs(logs) {
  const byKey = new Map();
  for (const e of logs) {
    const k = `${e.type}|${e.text}`;
    const cur = byKey.get(k);
    if (cur) {
      cur.count++;
      if (e.t > cur.entry.t) cur.entry = e;
    } else {
      byKey.set(k, { entry: e, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => b.entry.t - a.entry.t);
}

function renderLogs(logs) {
  cachedLogs = logs;
  logList.innerHTML = '';
  let list = logFilterLLM ? logs.filter((e) => e.type === '大模型') : logs;
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = logFilterLLM ? '还没有大模型参与的日志，配上 key 聊几句吧' : '还没有日志，去陪她玩一会儿吧';
    logList.appendChild(d);
    return;
  }
  if (logMergeSame) {
    for (const g of mergeLogs(list)) logList.appendChild(entryEl(g.entry, g.count));
  } else {
    for (let i = list.length - 1; i >= 0; i--) logList.appendChild(entryEl(list[i], 1));
  }
}

function loadLogs() {
  window.pet.getLogs().then(renderLogs);
}

window.pet.onLog(() => loadLogs()); // 有合并/筛选时局部插一行容易错位，直接重拉

// 清空日志二次确认：第一次点变成红色「确认清空？」，3 秒内再点才执行
const clearLogBtn = document.getElementById('clearLog');
let clearLogTimer = null;
function resetClearLogBtn() {
  clearLogBtn.classList.remove('confirm');
  clearLogBtn.textContent = '清空日志';
  clearTimeout(clearLogTimer);
  clearLogTimer = null;
}
clearLogBtn.addEventListener('click', () => {
  if (!clearLogTimer) {
    clearLogBtn.classList.add('confirm');
    clearLogBtn.textContent = '确认清空？';
    clearLogTimer = setTimeout(resetClearLogBtn, 3000);
    return;
  }
  resetClearLogBtn();
  window.pet.clearLogs();
  renderLogs([]);
});

document.getElementById('filterLLM').addEventListener('click', (e) => {
  logFilterLLM = !logFilterLLM;
  e.target.classList.toggle('on', logFilterLLM);
  renderLogs(cachedLogs);
});
document.getElementById('mergeSame').addEventListener('click', (e) => {
  logMergeSame = !logMergeSame;
  e.target.classList.toggle('on', logMergeSame);
  renderLogs(cachedLogs);
});

// ---------- 历史页签：按天分文件，右侧 Time Machine 式导航 ----------
const historyMsgs = document.getElementById('historyMsgs');
const tmStrip = document.getElementById('tmStrip');
let historyDays = [];
let selectedDay = null; // null = 默认视图（最近 2 天）

function dayKeyLocal(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// banner 上的日期文案：今天/昨天带标注，legacy 显示「更早」
function dayLabel(key) {
  if (key === 'legacy') return '更早';
  const [, m, d] = key.split('-').map(Number);
  if (key === dayKeyLocal(Date.now())) return `${m}月${d}日 · 今天`;
  if (key === dayKeyLocal(Date.now() - 86400000)) return `${m}月${d}日 · 昨天`;
  return `${m}月${d}日`;
}

// 导航条上的小字日期
function shortLabel(key) {
  if (key === 'legacy') return '早';
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

// 当前视图包含哪些天：选中了就只看那一天（最多 1 天），否则最近 2 天
function visibleDays() {
  if (selectedDay) return historyDays.filter((d) => d.date === selectedDay);
  return historyDays.slice(0, 2);
}

async function loadHistoryTab() {
  historyDays = await window.pet.getHistoryDays();
  renderTmStrip();
  renderHistory();
}

function renderTmStrip() {
  tmStrip.innerHTML = '';
  const shown = new Set(visibleDays().map((d) => d.date));
  for (const day of historyDays) {
    const item = document.createElement('div');
    item.className = 'tm-item' + (shown.has(day.date) ? ' active' : '');
    const date = document.createElement('span');
    date.className = 'tm-date';
    date.textContent = shortLabel(day.date);
    const dot = document.createElement('span');
    dot.className = 'tm-dot';
    const card = document.createElement('div');
    card.className = 'tm-card';
    const d1 = document.createElement('div');
    d1.className = 'd';
    d1.textContent = dayLabel(day.date);
    const d2 = document.createElement('div');
    d2.className = 'c';
    d2.textContent = `${day.count} 条对话`;
    card.append(d1, d2);
    if (day.preview) {
      const p = document.createElement('div');
      p.className = 'p';
      p.textContent = `${day.preview}…`;
      card.appendChild(p);
    }
    item.append(date, dot, card);
    // 点日期只看那一天；再点一次回到最近 2 天
    item.addEventListener('click', () => {
      selectedDay = selectedDay === day.date ? null : day.date;
      renderTmStrip();
      renderHistory();
    });
    tmStrip.appendChild(item);
  }
}

async function renderHistory() {
  historyMsgs.innerHTML = '';
  const showDays = visibleDays();
  if (!showDays.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '还没有历史，去聊几句吧';
    historyMsgs.appendChild(d);
    return;
  }
  // 时间正序展示（旧 → 新），不同日期之间用日期 banner 隔开
  for (const day of [...showDays].reverse()) {
    const banner = document.createElement('div');
    banner.className = 'date-banner';
    const s = document.createElement('span');
    s.textContent = `${dayLabel(day.date)} · ${day.count} 条`;
    banner.appendChild(s);
    historyMsgs.appendChild(banner);
    const msgs = await window.pet.getHistoryDay(day.date);
    for (const m of msgs) addMsg(historyMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
  }
  historyMsgs.scrollTop = historyMsgs.scrollHeight;
}

// ---------- 配置页签（Kimi key） ----------
const kimiKeyInput = document.getElementById('kimiKey');
const keyStatus = document.getElementById('keyStatus');

function showKeyStatus({ hasKey, masked, key }) {
  keyStatus.classList.toggle('ok', hasKey);
  keyStatus.textContent = hasKey ? `已配置，Kira 会用 Kimi 回答你` : '未配置 key，聊天走本地卖萌规则';
  // 已保存的 key 直接显示在输入框里，改完点保存即替换
  if (document.activeElement !== kimiKeyInput) kimiKeyInput.value = key || '';
}

function loadChatConfig() {
  window.pet.getChatConfig().then(showKeyStatus);
}

document.getElementById('saveKey').addEventListener('click', () => {
  const k = kimiKeyInput.value.trim();
  if (!k) { keyStatus.classList.remove('ok'); keyStatus.textContent = '先粘贴 key 再保存'; return; }
  window.pet.setChatConfig({ kimiKey: k });
  loadChatConfig();
  window.pet.notebookSay('key 记好啦');
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '在小本子配置了 Kimi key' });
});

document.getElementById('clearKey').addEventListener('click', () => {
  window.pet.setChatConfig({ kimiKey: '' });
  kimiKeyInput.value = '';
  loadChatConfig();
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '清除了 Kimi key' });
});

loadChatConfig(); // 打开本子就备好状态，不用等切页签

// ---------- 配置页签（版本 / 检查更新） ----------
window.pet.getVersion().then((v) => { document.getElementById('verText').textContent = `v${v}`; });
document.getElementById('checkUpdate').addEventListener('click', () => {
  window.pet.checkUpdate();
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '手动检查更新' });
});

// ---------- 配置页签（动作设置，从原设置窗口搬入） ----------
// 数据走 getSettings/setActions，主进程统一持久化到 ~/.config/kira/config.json
let actionSettings = {};

// 动作频率档位：值越大她越闲不住
const FREQ_STOPS = [
  { v: 0.4, label: '高冷' },
  { v: 0.7, label: '安静' },
  { v: 1, label: '正常' },
  { v: 1.6, label: '活泼' },
  { v: 2.5, label: '多动症' },
];

function freqIndex() {
  const f = actionSettings._freq || 1;
  let best = 0;
  FREQ_STOPS.forEach((s, i) => { if (Math.abs(s.v - f) < Math.abs(FREQ_STOPS[best].v - f)) best = i; });
  return best;
}

// 没设置过就用默认值（ACTIONS 里 off:true 的默认关，其余默认开）
function isOn(id) {
  const v = actionSettings[id];
  return v !== undefined ? v : !(ACTIONS[id] && ACTIONS[id].off);
}

function applyPatch(patch) {
  Object.assign(actionSettings, patch);
  window.pet.setActions(patch);
  renderActions();
}

function switchEl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'sw';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createElement('i'));
  return label;
}

function cfgSec(titleText) {
  const sec = document.createElement('div');
  sec.className = 'cfg-sec';
  const t = document.createElement('div');
  t.className = 'cfg-title';
  t.textContent = titleText;
  sec.appendChild(t);
  return sec;
}

function renderFreq() {
  const sec = cfgSec('动作频率');
  const idx = freqIndex();
  const label = document.createElement('span');
  label.textContent = FREQ_STOPS[idx].label;
  sec.querySelector('.cfg-title').append(' · ', label);
  const tip = document.createElement('div');
  tip.className = 'cfg-tip';
  tip.textContent = '动一次是概率问题，可动可不动，全看小东西心情。';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = 0;
  range.max = FREQ_STOPS.length - 1;
  range.step = 1;
  range.value = idx;
  range.addEventListener('input', () => {
    const s = FREQ_STOPS[+range.value];
    label.textContent = s.label;
    // 拖动中不整页重渲染，只更新值并同步
    actionSettings._freq = s.v;
    window.pet.setActions({ _freq: s.v });
  });
  sec.append(tip, range);
  return sec;
}

// 人物大小档位：窗口与立绘等比缩放
const SIZE_STOPS = [
  { v: 0.6, label: '迷你' },
  { v: 0.8, label: '偏小' },
  { v: 1, label: '标准' },
  { v: 1.25, label: '偏大' },
  { v: 1.5, label: '巨大' },
];

function sizeIndex() {
  const v = actionSettings._size || 1;
  let best = 0;
  SIZE_STOPS.forEach((s, i) => { if (Math.abs(s.v - v) < Math.abs(SIZE_STOPS[best].v - v)) best = i; });
  return best;
}

function renderSize() {
  const sec = cfgSec('人物大小');
  const idx = sizeIndex();
  const label = document.createElement('span');
  label.textContent = SIZE_STOPS[idx].label;
  sec.querySelector('.cfg-title').append(' · ', label);
  const tip = document.createElement('div');
  tip.className = 'cfg-tip';
  tip.textContent = '整个她（窗口和立绘）一起变大变小，立等可见。';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = 0;
  range.max = SIZE_STOPS.length - 1;
  range.step = 1;
  range.value = idx;
  range.addEventListener('input', () => {
    const s = SIZE_STOPS[+range.value];
    label.textContent = s.label;
    // 拖动中不整页重渲染，只更新值并同步（窗口缩放走主进程）
    actionSettings._size = s.v;
    window.pet.setActions({ _size: s.v });
  });
  sec.append(tip, range);
  return sec;
}

// 渲染一个子分组（普通 / 打扰性），返回元素；无动作时返回 null
function renderSubgroup(ids, title, warn) {
  if (!ids.length) return null;
  const wrap = document.createElement('div');

  // 分组统一开关：组内全开才算开
  const allOn = ids.every(isOn);
  const head = document.createElement('div');
  head.className = 'cfg-subgroup';
  const nameEl = document.createElement('span');
  nameEl.textContent = title;
  if (warn) {
    const w = document.createElement('span');
    w.className = 'warn';
    w.textContent = '会跑到屏幕中间';
    nameEl.appendChild(w);
  }
  head.appendChild(nameEl);
  head.appendChild(switchEl(allOn, (v) => {
    const patch = {};
    ids.forEach((id) => { patch[id] = v; });
    applyPatch(patch);
  }));
  wrap.appendChild(head);

  for (const id of ids) {
    const row = document.createElement('div');
    row.className = 'cfg-row';
    const label = document.createElement('span');
    label.textContent = ACTIONS[id].name;
    row.appendChild(label);
    row.appendChild(switchEl(isOn(id), (v) => applyPatch({ [id]: v })));
    wrap.appendChild(row);
  }
  return wrap;
}

function renderActions() {
  const list = document.getElementById('cfgActions');
  list.innerHTML = '';
  list.appendChild(renderFreq());
  list.appendChild(renderSize());
  // 通用开关
  const misc = cfgSec('通用设置');
  const ctRow = document.createElement('div');
  ctRow.className = 'cfg-row';
  const ctLabel = document.createElement('span');
  ctLabel.innerHTML = '点击穿透<div class="cfg-tip" style="margin:0">开启后只有点在角色身上才响应，其余位置点击穿透到下层窗口</div>';
  ctRow.appendChild(ctLabel);
  ctRow.appendChild(switchEl(isOn('_clickThrough'), (v) => applyPatch({ _clickThrough: v })));
  misc.appendChild(ctRow);
  list.appendChild(misc);
  for (const g of FORM_GROUPS) {
    const inForm = Object.keys(ACTIONS).filter((id) => actionFormGroup(ACTIONS[id]) === g.key);
    const normal = inForm.filter((id) => !ACTIONS[id].intrusive);
    const intrusive = inForm.filter((id) => ACTIONS[id].intrusive);
    if (!inForm.length) continue;
    const sec = cfgSec(g.label);
    const n = renderSubgroup(normal, '普通动作', false);
    if (n) sec.appendChild(n);
    const i = renderSubgroup(intrusive, '打扰性动作', true);
    if (i) sec.appendChild(i);
    list.appendChild(sec);
  }
}

window.pet.getSettings().then((s) => {
  actionSettings = s || {};
  renderActions();
  renderDebugActions();
});

// ---------- 调试动作页：全部动作平铺，点一下演一下（走星盘菜单同一条 menu-select 链） ----------
function renderDebugActions() {
  const list = document.getElementById('dbgList');
  list.innerHTML = '';
  for (const g of FORM_GROUPS) {
    const ids = Object.keys(ACTIONS).filter((id) => actionFormGroup(ACTIONS[id]) === g.key);
    if (!ids.length) continue;
    const h = document.createElement('div');
    h.className = 'dbg-group';
    h.textContent = g.label;
    list.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'dbg-grid';
    for (const id of ids) {
      const a = ACTIONS[id];
      const b = document.createElement('button');
      // 设置里关掉的/不进随机池的调暗，但调试页照样能点（点就是强制触发）
      b.className = 'dbg-btn' + (a.off || actionSettings[id] === false || !a.auto ? ' off' : '');
      b.title = `${id}｜forms: ${a.forms.join('/')}${a.intrusive ? '｜打扰性' : ''}${a.auto ? '' : '｜不进随机池'}`;
      const n = document.createElement('span');
      n.textContent = a.name;
      const i = document.createElement('span');
      i.className = 'i';
      i.textContent = id;
      b.append(n, i);
      b.addEventListener('click', () => {
        window.pet.menuSelect(id);
        b.classList.add('fire');
        setTimeout(() => b.classList.remove('fire'), 400);
      });
      grid.appendChild(b);
    }
    list.appendChild(grid);
  }
}

// ---------- 飞书：配置在「配置」页，连上后书脊多出以机器人命名的 tab ----------
const fsAppId = document.getElementById('fsAppId');
const fsAppSecret = document.getElementById('fsAppSecret');
const fsOwnerEmail = document.getElementById('fsOwnerEmail');
const fsEnabled = document.getElementById('fsEnabled');
const fsReplyBot = document.getElementById('fsReplyBot');
const fsStatus = document.getElementById('fsStatus');
const fsChatStatus = document.getElementById('fsChatStatus');
const botTab = document.getElementById('botTab');
const botTabName = document.getElementById('botTabName');
const botMsgs = document.getElementById('botMsgs');
let feishuState = { status: 'off', error: '', botName: '' };
let feishuConfigured = false;
const renderedIds = new Set(); // 已上屏的飞书消息 id，轮询/事件/本地三通道防重
// 小本子乐观上屏的发言文本队列：daemon 会把同一条 user 消息回显回来，命中即跳过防双显
const pendingBotSends = [];
// resolve 先于事件流回来时填过的回答：事件再到按同文案跳过一次（正常走不到，防 IPC 乱序）
let lastBotReply = null;

function consumePendingBotSend(text) {
  const idx = pendingBotSends.findIndex((p) => p === text);
  if (idx < 0) return false;
  pendingBotSends.splice(idx, 1);
  return true;
}

const FS_STATUS_TEXT = { off: '未启用（按上方指引配置，打开开关）', connecting: '连接中…', online: '在线，私聊她或在群里 @她 试试', error: '连接出错，检查配置和上方指引的第 2~4 步' };

// 机器人 tab 显隐：kira 链接（yomi）在线才显示，否则隐藏
function updateBotTab() {
  // kira 链接在线或配置好（启用 + 地址 + 会话）就显示
  const yomiConfigured = !!(yomiState.enabled && yomiState.wsUrl && yomiState.sessionId);
  if (yomiState.status === 'online' || yomiConfigured) {
    botTab.classList.remove('hidden');
    botTabName.textContent = 'kira';
    return;
  }
  botTab.classList.add('hidden');
  if (activeTab === 'bot') document.querySelector('.tab[data-tab="chat"]').click();
}

function renderFsStatus() {
  const online = feishuState.status === 'online';
  fsStatus.classList.toggle('ok', online);
  fsStatus.textContent = FS_STATUS_TEXT[feishuState.status] + (feishuState.error ? `：${feishuState.error}` : '');
}

function renderFsChatStatus(hasChat) {
  fsChatStatus.classList.toggle('ok', !!hasChat);
  fsChatStatus.textContent = hasChat ? '私聊会话已连接，飞书里的消息会全量同步进来' : '';
}

// 配置页：回显凭证/开关/状态；书脊 tab 的显隐和命名也在这统一刷
function loadFeishuConfig() {
  window.pet.getFeishuConfig().then((c) => {
    if (document.activeElement !== fsAppId) fsAppId.value = c.appId || '';
    if (document.activeElement !== fsAppSecret) fsAppSecret.value = c.appSecret || '';
    if (document.activeElement !== fsOwnerEmail) fsOwnerEmail.value = c.ownerEmail || '';
    fsEnabled.checked = !!c.enabled;
    fsReplyBot.checked = !!c.replyBot;
    feishuConfigured = !!(c.enabled && c.appId && c.appSecret);
    feishuState = { status: c.status, error: c.error, botName: c.botName || '' };
    renderFsStatus();
    renderFsChatStatus(c.hasChat);
    updateBotTab();
  });
}

// 机器人 tab：kira 链接在线时历史从 yomi session 拉，否则走旧飞书通道。
// 分页：全量缓存在 botHistory，首屏只渲染最新 15 条；滚到顶部动态加载更早的一批
const BOT_PAGE = 15;
let botHistory = [];
let botShown = 0;    // 已上屏消息在 botHistory 里的最早下标（>0 说明还有更早的可加载）
let botLoading = false;

function renderBotBatch(older) {
  const end = older ? botShown : botHistory.length;
  const start = Math.max(0, end - BOT_PAGE);
  const batch = botHistory.slice(start, end);
  botShown = start;
  if (older) {
    // 向上加载：插到当前最前，保持视口位置
    const first = botMsgs.firstChild;
    for (const m of batch) {
      if (m.id) renderedIds.add(m.id);
      const b = addMsg(botMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
      botMsgs.insertBefore(b.parentNode, first);
    }
  } else {
    for (const m of batch) {
      if (m.id) renderedIds.add(m.id);
      addMsg(botMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
    }
  }
}

// 滚到顶部：还有更早的就加载一批
botMsgs.addEventListener('scroll', () => {
  if (botMsgs.scrollTop > 40 || botShown <= 0 || botLoading) return;
  botLoading = true;
  const prevTop = botMsgs.scrollTop;
  const prevH = botMsgs.scrollHeight;
  renderBotBatch(true);
  if (botShown === 0 && !botMsgs.querySelector('.bot-top-done')) {
    // 最早一批也加载完了：顶部放结束标记（先做，高度才能算进下面的视口修正）
    const d = document.createElement('div');
    d.className = 'empty bot-top-done';
    d.textContent = '—— 到顶了，没有更早的消息 ——';
    botMsgs.insertBefore(d, botMsgs.firstChild);
  }
  // 视口不跳：新增内容（含结束标记）有多高补多少；addMsg 会滚底，必须按 prevTop 重算
  botMsgs.scrollTop = prevTop + (botMsgs.scrollHeight - prevH);
  botLoading = false;
});

function loadBotTab() {
  if (yomiState.status === 'online') {
    window.pet.yomiHistory().then((list) => {
      botMsgs.innerHTML = '';
      renderedIds.clear();
      if (!list || !list.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'kira 已连上，还没有同步到消息；之后飞书里的对话都会出现在这里';
        botMsgs.appendChild(d);
        return;
      }
      botHistory = list;
      botShown = list.length;
      renderBotBatch(false);
      botMsgs.scrollTop = botMsgs.scrollHeight;
    });
    return;
  }
  window.pet.getFeishuHistory().then((list) => {
    botMsgs.innerHTML = '';
    renderedIds.clear();
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '还没有同步到消息；去配置页点「连接会话」，之后飞书里的对话都会出现在这里';
      botMsgs.appendChild(d);
      return;
    }
    for (const m of list) {
      if (m.id) renderedIds.add(m.id);
      addMsg(botMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
    }
    botMsgs.scrollTop = botMsgs.scrollHeight;
  });
}

document.getElementById('fsSave').addEventListener('click', () => {
  window.pet.setFeishuConfig({
    appId: fsAppId.value.trim(),
    appSecret: fsAppSecret.value.trim(),
    ownerEmail: fsOwnerEmail.value.trim(),
    enabled: fsEnabled.checked,
    replyBot: fsReplyBot.checked,
  });
  loadFeishuConfig();
  window.pet.notebookSay('飞书配置记好啦');
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '更新了飞书机器人配置' });
});

// 连接会话：机器人按邮箱给主人发一条握手消息，从返回里拿私聊 chat_id
document.getElementById('fsHandshake').addEventListener('click', async () => {
  fsChatStatus.classList.remove('ok');
  fsChatStatus.textContent = '握手中…（机器人会在飞书里给你发一条消息）';
  const r = await window.pet.feishuHandshake();
  renderFsChatStatus(r && r.ok);
  if (r && r.ok) loadBotTab();
  else fsChatStatus.textContent = `连接失败：${(r && r.error) || '未知原因'}`;
});

document.getElementById('fsClear').addEventListener('click', () => {
  window.pet.setFeishuConfig({ appId: '', appSecret: '', ownerEmail: '', enabled: false, replyBot: false });
  fsAppId.value = '';
  fsAppSecret.value = '';
  fsOwnerEmail.value = '';
  fsEnabled.checked = false;
  fsReplyBot.checked = false;
  loadFeishuConfig();
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '清除了飞书机器人配置' });
});

fsEnabled.addEventListener('change', () => {
  window.pet.setFeishuConfig({ enabled: fsEnabled.checked });
  loadFeishuConfig();
});

fsReplyBot.addEventListener('change', () => {
  window.pet.setFeishuConfig({ replyBot: fsReplyBot.checked });
  loadFeishuConfig();
  window.pet.logAppend({ t: Date.now(), type: '系统', text: fsReplyBot.checked ? '打开了接管飞书回复' : '关闭了接管飞书回复（只同步）' });
});

// ---------- 链接 kira（yomi wire 协议） ----------
const yomiWsUrl = document.getElementById('yomiWsUrl');
const yomiToken = document.getElementById('yomiToken');
const yomiSessionId = document.getElementById('yomiSessionId');
const yomiEnabled = document.getElementById('yomiEnabled');
const yomiStatus = document.getElementById('yomiStatus');
const yomiSessionsOut = document.getElementById('yomiSessionsOut');
let yomiState = { status: 'off', error: '', sessionId: '' };

const YOMI_STATUS_TEXT = {
  off: '未启用', connecting: '连接中…', online: '已连上，kira 的消息会同步到桌宠和小本子', error: '连接出错',
};

function renderYomiStatus() {
  yomiStatus.classList.toggle('ok', yomiState.status === 'online');
  yomiStatus.textContent = (YOMI_STATUS_TEXT[yomiState.status] || yomiState.status) + (yomiState.error ? `：${yomiState.error}` : '');
}

function loadYomiConfig() {
  window.pet.getYomiConfig().then((c) => {
    if (document.activeElement !== yomiWsUrl) yomiWsUrl.value = c.wsUrl || '';
    if (document.activeElement !== yomiToken) yomiToken.value = c.token || '';
    if (document.activeElement !== yomiSessionId) yomiSessionId.value = c.sessionId || '';
    yomiEnabled.checked = !!c.enabled;
    yomiState = { status: c.status, error: c.error, sessionId: c.sessionId || '', enabled: !!c.enabled, wsUrl: c.wsUrl || '' };
    renderYomiStatus();
    updateBotTab();
  });
}

document.getElementById('yomiSave').addEventListener('click', () => {
  window.pet.setYomiConfig({
    wsUrl: yomiWsUrl.value.trim(),
    token: yomiToken.value.trim(),
    sessionId: yomiSessionId.value.trim(),
    enabled: yomiEnabled.checked,
  });
  // 同步本地状态：onFeishuMsg 的 sessionId 过滤和 updateBotTab 都读 yomiState，等下次 loadYomiConfig 刷新会漏消息
  yomiState = { ...yomiState, sessionId: yomiSessionId.value.trim(), enabled: yomiEnabled.checked, wsUrl: yomiWsUrl.value.trim() };
  window.pet.notebookSay('kira 链接记好啦');
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '更新了 kira 链接配置' });
});

yomiEnabled.addEventListener('change', () => {
  window.pet.setYomiConfig({ enabled: yomiEnabled.checked });
});

// 列会话：从 daemon 拉最近 session 供挑选，点一条填进 sessionId 输入框
document.getElementById('yomiSessionsBtn').addEventListener('click', async () => {
  yomiSessionsOut.textContent = '拉取中…';
  try {
    const list = await window.pet.yomiListSessions();
    yomiSessionsOut.innerHTML = '';
    if (!list || !list.length) { yomiSessionsOut.textContent = '没有会话（先确认已连上）'; return; }
    for (const s of list.slice(0, 20)) {
      const d = document.createElement('div');
      d.style.cssText = 'cursor:pointer;padding:2px 0;';
      d.textContent = `${s.id}｜${(s.title || s.name || '').slice(0, 30)}`;
      d.title = '点击填入 session_id';
      d.addEventListener('click', () => { yomiSessionId.value = s.id; });
      yomiSessionsOut.appendChild(d);
    }
  } catch (e) {
    yomiSessionsOut.textContent = `拉取失败：${e.message || e}`;
  }
});

window.pet.onYomiStatus((s) => {
  yomiState = { ...yomiState, status: s.status, error: s.error || '' };
  renderYomiStatus();
  updateBotTab();
});

// ---------- 记忆同步（kira ↔ 本地 ~/.agents 双向同步） ----------
const syncEnabled = document.getElementById('syncEnabled');
const syncInterval = document.getElementById('syncInterval');
const syncStatus = document.getElementById('syncStatus');
const syncNowBtn = document.getElementById('syncNow');
let syncState = { enabled: true, intervalHours: 6, running: false, lastRun: null };

function fmtSyncTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderSyncStatus() {
  if (syncState.running) {
    syncStatus.classList.remove('ok');
    syncStatus.textContent = '同步中…（拉取用户画像 + 推送记忆库，约一两分钟）';
    return;
  }
  const r = syncState.lastRun;
  if (!r) { syncStatus.textContent = '还没跑过同步（启动 5 分钟后首轮）'; return; }
  if (r.skipped) { syncStatus.textContent = `上次 ${fmtSyncTime(r.t)}：跳过（${r.skipped}）`; return; }
  const part = (x) => (x && x.ok ? `✓ ${x.detail}` : `✗ ${(x && x.error) || '失败'}`);
  syncStatus.textContent = `上次 ${fmtSyncTime(r.t)}：拉取 ${part(r.pull)}；推送 ${part(r.push)}`;
}

function loadSyncConfig() {
  window.pet.getSyncConfig().then((s) => {
    syncState = s;
    syncEnabled.checked = !!s.enabled;
    if (document.activeElement !== syncInterval) syncInterval.value = s.intervalHours || 6;
    renderSyncStatus();
  });
}

document.getElementById('syncSave').addEventListener('click', () => {
  const hours = Math.max(1, Math.min(168, parseInt(syncInterval.value, 10) || 6));
  syncInterval.value = hours;
  window.pet.setSyncConfig({ enabled: syncEnabled.checked, intervalHours: hours });
  syncState = { ...syncState, enabled: syncEnabled.checked, intervalHours: hours };
  window.pet.notebookSay('记忆同步记好啦');
  window.pet.logAppend({ t: Date.now(), type: '系统', text: `更新了记忆同步配置（${syncEnabled.checked ? '开' : '关'}，${hours} 小时）` });
});

syncEnabled.addEventListener('change', () => {
  window.pet.setSyncConfig({ enabled: syncEnabled.checked });
  syncState.enabled = syncEnabled.checked;
});

syncNowBtn.addEventListener('click', async () => {
  syncNowBtn.disabled = true;
  syncState.running = true;
  renderSyncStatus();
  try {
    await window.pet.syncNow(); // 状态经 sync-status 推送刷新
  } finally {
    syncNowBtn.disabled = false;
  }
});

window.pet.onSyncStatus((s) => {
  syncState = s;
  syncEnabled.checked = !!s.enabled;
  if (document.activeElement !== syncInterval) syncInterval.value = s.intervalHours || 6;
  renderSyncStatus();
});

// 状态变化：刷状态行和书脊 tab（拿到机器人名字后 tab 会改名）
window.pet.onFeishuStatus((s) => {
  feishuState = s;
  renderFsStatus();
  updateBotTab();
});

// 归一化飞书消息（事件/轮询/小本子回答）：按 id 防重，时间序追加
window.pet.onFeishuMsg((m) => {
  if (activeTab !== 'bot') return;
  // 只上屏绑定 session 的消息：SubscribeAll 推的是全部会话，别的 session 别串进来
  // （连等待气泡也不能让外来回答抢占）；旧 feishu 通道的消息无 sessionId，放行
  if (m.sessionId && m.sessionId !== yomiState.sessionId) return;
  if (m.id && renderedIds.has(m.id)) return;
  if (m.id) renderedIds.add(m.id);
  // 只清「还没有消息」占位符：结束标记（bot-top-done）和已上屏历史不能被误杀
  const placeholder = botMsgs.querySelector('.empty:not(.bot-top-done)');
  if (placeholder) placeholder.remove();
  if (m.role === 'user') {
    // 小本子自己发的会被 daemon 原样回显：乐观气泡已上屏，跳过（id 已在上面登记）
    if (consumePendingBotSend(m.content)) return;
    addMsg(botMsgs, 'me', m.content);
    return;
  }
  // resolve 先于事件流回来时回答已填过（见 submit），同文案别再上屏
  if (lastBotReply && lastBotReply.text === m.content && Date.now() - lastBotReply.t < 10000) {
    lastBotReply = null;
    return;
  }
  // 有等待气泡就把回答填进去（小本子发言的回答，kira/旧飞书通道同此约定）；没有就直接上屏
  const typing = botMsgs.querySelector('.bubble.typing');
  if (typing) {
    typing.classList.remove('typing');
    typing.innerHTML = '';
    window.MarkdownStream.render(typing, m.content);
    botMsgs.scrollTop = botMsgs.scrollHeight;
    return;
  }
  addMsg(botMsgs, 'Kira', m.content);
});

// ---------- 链接 mira（Mira Tag 子部署：WS /api/stream 订阅 + WS prompt 发言） ----------
// 通道与 yomi 镜像：get/set-mira-config、mira-status（推送）、mira-event（推送）、mira-send、mira-history
const miraWsUrl = document.getElementById('miraWsUrl');
const miraToken = document.getElementById('miraToken');
const miraProjectId = document.getElementById('miraProjectId');
const miraEnabled = document.getElementById('miraEnabled');
const miraStatus = document.getElementById('miraStatus');
const miraTab = document.getElementById('miraTab');
const miraMsgs = document.getElementById('miraMsgs');
const MIRA_DEFAULT_WS = 'wss://tag.mira.msh.team/api/stream';
// 连接器（M27）未合入前 preload 没有 mira 通道：全部 mira 功能静默关闭，不影响其他页签
const hasMira = typeof window.pet.getMiraConfig === 'function';
// 配置区与 tab 同守卫：无 mira 通道时藏掉（HTML 默认 display:none），避免保存/清除静默 no-op
if (hasMira) document.getElementById('miraSec').style.display = '';
let miraState = { status: 'off', error: '', sessionId: '', enabled: false, wsUrl: '', token: '', projectId: '', readonly: false };

const MIRA_STATUS_TEXT = {
  off: '未配置', connecting: '连接中…', online: '已连接，mira 的消息会同步到小本子', error: '连接出错', disconnected: '已断开',
};

function miraConfigured() {
  return !!(miraState.enabled && miraState.wsUrl && miraState.token && miraState.projectId);
}

// mira tab 显隐：配置好（启用+地址+token+项目）或在线就常驻
function updateMiraTab() {
  if (!hasMira) return;
  if (miraState.status === 'online' || miraConfigured()) {
    miraTab.classList.remove('hidden');
    return;
  }
  miraTab.classList.add('hidden');
  if (activeTab === 'mira') document.querySelector('.tab[data-tab="chat"]').click();
}

function renderMiraStatus() {
  miraStatus.classList.toggle('ok', miraState.status === 'online');
  miraStatus.textContent = (MIRA_STATUS_TEXT[miraState.status] || miraState.status) + (miraState.error ? `：${miraState.error}` : '');
}

// 只读降级时禁用输入框并注明；切走 mira tab 即恢复
function updateMiraInput() {
  const ro = activeTab === 'mira' && miraState.readonly;
  input.disabled = ro;
  document.getElementById('send').disabled = ro;
  input.placeholder = ro ? 'mira 暂只读同步' : '说点什么，或拖入链接…';
}

function loadMiraConfig() {
  if (!hasMira) return;
  window.pet.getMiraConfig().then((c) => {
    if (!c) return;
    if (document.activeElement !== miraWsUrl) miraWsUrl.value = c.wsUrl || MIRA_DEFAULT_WS;
    if (document.activeElement !== miraToken) miraToken.value = c.token || '';
    if (document.activeElement !== miraProjectId) miraProjectId.value = c.projectId || '';
    miraEnabled.checked = !!c.enabled;
    miraState = {
      status: c.status || 'off', error: c.error || '', sessionId: c.sessionId || '',
      enabled: !!c.enabled, wsUrl: c.wsUrl || '', token: c.token || '', projectId: c.projectId || '',
      readonly: !!(c.readonly || c.canSend === false),
    };
    renderMiraStatus();
    updateMiraTab();
    updateMiraInput();
  });
}

document.getElementById('miraSave').addEventListener('click', () => {
  if (!hasMira) return;
  const patch = {
    wsUrl: miraWsUrl.value.trim() || MIRA_DEFAULT_WS,
    token: miraToken.value.trim(),
    projectId: miraProjectId.value.trim(),
    enabled: miraEnabled.checked,
  };
  window.pet.setMiraConfig(patch);
  // 同步本地状态：事件过滤和 updateMiraTab 都读 miraState，等下次 loadMiraConfig 刷新会漏
  miraState = { ...miraState, ...patch };
  updateMiraTab();
  window.pet.notebookSay('mira 链接记好啦');
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '更新了 mira 链接配置' });
});

document.getElementById('miraClear').addEventListener('click', () => {
  if (!hasMira) return;
  window.pet.setMiraConfig({ wsUrl: '', token: '', projectId: '', enabled: false });
  miraWsUrl.value = MIRA_DEFAULT_WS;
  miraToken.value = '';
  miraProjectId.value = '';
  miraEnabled.checked = false;
  miraState = { ...miraState, enabled: false, wsUrl: '', token: '', projectId: '', sessionId: '', status: 'off', error: '' };
  renderMiraStatus();
  updateMiraTab();
  window.pet.logAppend({ t: Date.now(), type: '系统', text: '清除了 mira 链接配置' });
});

// 「给 AI 的接入指南」：hover 预览 prompt 全文，点击复制到剪贴板，按钮短暂变「已复制 ✓」
const MIRA_AI_PROMPT = `你要帮我自动完成「Link Mira」接入配置（Mira Tag 子部署，tag.mira.msh.team）。请按下面的步骤自己找齐三项信息（wsUrl / token / projectId）并填好：

1. wsUrl：固定为 wss://tag.mira.msh.team/api/stream（JSON-RPC over WebSocket）。

2. token：先读 ~/.zshrc 里 export 的 MOONGATE_ACCESS_TOKEN（39 位、MGU 前缀）。如果没有，提示我通过 MoonGate SSO 获取一个 access token 再给你。

3. 鉴权是两层：MoonGate Bearer 只过网关，应用层要先换 cookie——
   带 Bearer 调 GET https://tag.mira.msh.team/api/auth/providers/moongate/complete，从 302 响应的 Set-Cookie 里拿 mira_session（30 天有效）；之后所有 REST 和 WS 请求都要同时带 Bearer + Cookie 两种凭证。

4. projectId（填 space id，按顺序尝试）：
   a. 带上 Bearer + Cookie 调 GET https://tag.mira.msh.team/api/mira/spaces，从返回的 space 列表里按名称认出我的 space（私聊 space 名字通常带「私聊」，列表里能看到每个 space 绑定的飞书会话）；
   b. 认不出来时，去飞书里找 mira 机器人的回复卡片，从卡片链接里反推出 space id；
   c. 想验证：WS 连 wss://tag.mira.msh.team/api/stream（握手带 Bearer + Cookie），发 {"id":"1","method":"subscribe","space_id":"<space id>","params":{}}，回 {"id":"1","result":{"ok":true}} 就是对了；返回 Forbidden 说明我不是该 space 成员。

5. 三项信息都拿到后，填入 Kira 小本子「配置 → 链接 mira」的 wsUrl / token / project id（填 space id），打开「启用 mira 链接」并保存连接；最后确认 mira tab 里有消息同步进来，即完成。`;
const miraAiGuide = document.getElementById('miraAiGuide');
const miraAiTip = document.getElementById('miraAiTip');
miraAiTip.textContent = `${MIRA_AI_PROMPT}\n\n—— 点击按钮复制完整 prompt ——`;
miraAiGuide.addEventListener('click', () => {
  navigator.clipboard.writeText(MIRA_AI_PROMPT);
  miraAiGuide.classList.add('done');
  miraAiGuide.textContent = '已复制 ✓';
  setTimeout(() => {
    miraAiGuide.classList.remove('done');
    miraAiGuide.textContent = '🤖 AI 指南';
  }, 1600);
});

miraEnabled.addEventListener('change', () => {
  if (!hasMira) return;
  window.pet.setMiraConfig({ enabled: miraEnabled.checked });
  miraState.enabled = miraEnabled.checked;
  updateMiraTab();
});

// mira tab：tag 无 REST 历史端点、after_cursor 回放也不可用——只显示连接后的实时消息，
// 不做翻页加载；顶部常驻一条说明。不在 mira 页时消息暂存 miraPending，切回补显
const miraRenderedIds = new Set(); // 已上屏消息的 id/key/cursor，事件/回显双通道防重
const pendingMiraSends = [];       // 乐观上屏的发言文本：prompt 回显命中即跳过
const miraPending = [];            // 不在 mira 页时暂存的实时消息（上限 200，防无限积）
const miraShownMsgs = [];          // 已上屏消息的内存镜像 {role, text, key}（含乐观气泡，上限 200）：
//   切 tab 重进时 innerHTML 清空后靠它整体重渲——没有历史端点，清了就没处补
let lastMiraReply = null;          // miraSend resolve 先填过的回答：事件再到按同文案跳过一次

function recordMiraShown(role, text, key) {
  miraShownMsgs.push({ role, text, key: key || '' });
  if (miraShownMsgs.length > 200) {
    const old = miraShownMsgs.shift();
    if (old.key) miraRenderedIds.delete(old.key); // 镜像淘汰的键同步放出，防集合只涨不消
  }
}

function consumePendingMiraSend(text) {
  const idx = pendingMiraSends.findIndex((p) => p === text);
  if (idx < 0) return false;
  pendingMiraSends.splice(idx, 1);
  return true;
}

// 去重键优先 id（source_reply 的 toolCallId），其次 key（连接器传的 turn:seq，跨回合唯一）；
// cursor 只是回合内 seq，跨回合撞号，只作兜底
function miraMsgKey(m) { const k = m.id ?? m.key ?? m.cursor; return k == null ? '' : String(k); }

if (hasMira && window.pet.onMiraStatus) {
  window.pet.onMiraStatus((s) => {
    miraState = {
      ...miraState,
      status: s.status || miraState.status,
      error: s.error || '',
      sessionId: s.sessionId || miraState.sessionId,
      readonly: s.readonly !== undefined ? !!s.readonly : (s.canSend !== undefined ? s.canSend === false : miraState.readonly),
    };
    renderMiraStatus();
    updateMiraTab();
    updateMiraInput();
  });
}

function loadMiraTab() {
  if (!hasMira) return;
  miraMsgs.innerHTML = '';
  if (!miraConfigured()) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '先去「配置」页填好 mira 链接（地址 / token / space id）';
    miraMsgs.appendChild(d);
    return;
  }
  // 常驻说明（mira-live-note）：实时消息上屏清占位符时不清它
  const note = document.createElement('div');
  note.className = 'empty mira-live-note';
  note.textContent = '—— 只显示连接后的新消息，历史消息去 mira 那边看 ——';
  miraMsgs.appendChild(note);
  // 已上屏消息从内存镜像整体重渲（miraRenderedIds 不清：防重键要跨 tab 切换存活）
  for (const m of miraShownMsgs) addMsg(miraMsgs, m.role === 'user' ? 'me' : 'Kira', m.text, false, 'mira');
  // 切走期间暂存的消息补显
  const queued = miraPending.splice(0, miraPending.length);
  for (const ev of queued) handleMiraEvent(ev);
  if (!miraShownMsgs.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = miraState.sessionId
      ? '还没有新消息；之后会话里的对话会实时出现在这里'
      : '还没有定位到 mira 会话；连上之后这里会同步会话消息';
    miraMsgs.appendChild(d);
  }
  miraMsgs.scrollTop = miraMsgs.scrollHeight;
}

// mira 实时事件：{kind, sessionId, role, text, cursor, key, ts, source:'mira'}
// 连接器已按真实帧归一化：用户发言 role=user、source_reply 回答 role=assistant（kind 都是 message），
// thinking/assistant.delta/tool 等已在连接器侧过滤，这里只上屏 message
function handleMiraEvent(ev) {
  if (!ev || ev.source !== 'mira') return;
  // 只上屏绑定会话的消息；还没绑定时认领第一条消息的会话
  if (miraState.sessionId && ev.sessionId && ev.sessionId !== miraState.sessionId) return;
  if (!miraState.sessionId && ev.sessionId) miraState.sessionId = ev.sessionId;
  if (ev.kind !== 'message') return; // status/history_complete 等不上屏
  const key = miraMsgKey(ev);
  if (key && miraRenderedIds.has(key)) return;
  if (key) miraRenderedIds.add(key);
  // 只清「还没有消息」占位符：常驻说明（mira-live-note）和已上屏消息不能被误杀
  const placeholder = miraMsgs.querySelector('.empty:not(.mira-live-note)');
  if (placeholder) placeholder.remove();
  const role = ev.role || 'assistant';
  const text = ev.text || '';
  if (!text) return;
  if (role === 'user') {
    // 小本子自己发的经 prompt 回显：乐观气泡已上屏，跳过（key 已在上面登记）
    if (consumePendingMiraSend(text)) return;
    addMsg(miraMsgs, 'me', text, false, 'mira');
    recordMiraShown('user', text, key);
    return;
  }
  // resolve 先于事件流回来时回答已填过（见 submit），同文案别再上屏：命中即自清，不设时间窗——
  // 事件可能在 miraPending 里排队超过任何窗口（R2 P1），「回答只显示一次」要在任何时序下成立
  if (lastMiraReply && lastMiraReply.text === text) {
    lastMiraReply = null;
    return;
  }
  // 有等待气泡就把回答填进去；没有就直接上屏
  const typing = miraMsgs.querySelector('.bubble.typing');
  if (typing) {
    typing.classList.remove('typing');
    typing.innerHTML = '';
    window.MarkdownStream.render(typing, text);
    recordMiraShown('assistant', text, key);
    miraMsgs.scrollTop = miraMsgs.scrollHeight;
    return;
  }
  addMsg(miraMsgs, 'Kira', text, false, 'mira');
  recordMiraShown('assistant', text, key);
}

if (hasMira && window.pet.onMiraEvent) {
  window.pet.onMiraEvent((ev) => {
    if (!ev || ev.source !== 'mira') return;
    // 不在 mira 页：message 暂存待补显（没有历史端点可补拉，丢了就真没了），其余事件丢弃
    if (activeTab !== 'mira') {
      if (ev.kind === 'message') {
        miraPending.push(ev);
        if (miraPending.length > 200) miraPending.shift();
      }
      return;
    }
    handleMiraEvent(ev);
  });
}

loadFeishuConfig(); // 打开本子就备好 tab 显隐/命名，不用等切页签
loadYomiConfig();   // kira tab 同理：打开本子就拉一次链接状态，不然要等点配置页才出现
loadMiraConfig();   // mira tab 同理
loadSyncConfig();   // 记忆同步区块的状态/上次结果

// ---------- 打字避让（typingguard）：输入时通知桌宠别挡本本 ----------
// 通道复用 notebook-say（主进程原样转发给桌宠窗口），控制消息带哨兵前缀，
// 桌宠渲染层识别后不当台词上屏，因此不需要新增 IPC。
const NB_TYPING_PREFIX = '__nb_typing__:';
let nbTypingOn = false;
let nbComposing = false; // IME 组合中（中文输入未上屏也算打字）
let nbBeatTimer = null;

// 聚焦中的文本输入框（checkbox/range/button 这类非打字控件不算）
function nbTextField() {
  const el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return null;
  return ['checkbox', 'range', 'button', 'submit', 'radio'].includes(el.type) ? null : el;
}

function nbSendTyping(on, beat) {
  window.pet.notebookSay(NB_TYPING_PREFIX + JSON.stringify(beat ? { on, beat: true } : { on }));
}

function nbUpdateTyping() {
  const on = document.hasFocus() && (nbComposing || !!nbTextField());
  if (on === nbTypingOn) return;
  nbTypingOn = on;
  nbSendTyping(on, false);
  // typing 期间每 4 秒心跳一次：本子被直接关掉/异常退出时，桌宠靠心跳超时自行恢复
  clearInterval(nbBeatTimer);
  nbBeatTimer = null;
  if (on) nbBeatTimer = setInterval(() => nbSendTyping(true, true), 4000);
}

document.addEventListener('focusin', () => nbUpdateTyping());
// focusout 时 activeElement 已指向新元素，延迟一拍读到落定后的焦点
document.addEventListener('focusout', () => { nbComposing = false; setTimeout(nbUpdateTyping); });
document.addEventListener('compositionstart', () => { nbComposing = true; nbUpdateTyping(); });
document.addEventListener('compositionend', () => { nbComposing = false; nbUpdateTyping(); });
window.addEventListener('blur', () => { nbComposing = false; nbUpdateTyping(); });
window.addEventListener('focus', () => nbUpdateTyping());
window.addEventListener('beforeunload', () => { if (nbTypingOn) nbSendTyping(false, false); });

// ---------- 开场白：有历史就渲染历史，没有就打招呼 ----------
window.pet.chatHistory().then((history) => {
  if (history && history.length) {
    for (const m of history) addMsg(chatMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
  } else {
    addMsg(chatMsgs, 'Kira', '我是 Kira~\n想说什么都可以跟我说哦');
  }
});
addMsg(mrMsgs, 'Kira', '把 MR 链接拖进来，我帮你记成好看的格式');
