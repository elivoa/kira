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
    for (const key of ['chat', 'history', 'mr', 'log', 'config']) {
      document.getElementById(`page-${key}`).classList.toggle('hidden', key !== activeTab);
    }
    inputrow.classList.toggle('hidden', activeTab === 'log' || activeTab === 'config' || activeTab === 'history');
    if (activeTab === 'log') loadLogs();
    if (activeTab === 'config') loadChatConfig();
    if (activeTab === 'history') loadHistoryTab();
  });
});

// 主进程点名切页签（星盘菜单「设置」直达配置页）
window.pet.onNotebookTab((tab) => {
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (btn) btn.click();
});

// ---------- 消息 ----------
function addMsg(list, who, text, cmd) {
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
  m.appendChild(b);
  list.appendChild(m);
  list.scrollTop = list.scrollHeight;
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
    // 异步接 Kimi：token 经 chat-token 事件流式渲染；失败或没配 key 回退本地规则
    const typing = addMsg(chatMsgs, 'Kira', '正在输入…');
    typing.classList.add('typing'); // 等待期呼吸点动画，首个 token 到达即摘掉
    const chatId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let session = null;
    const pinScroll = () => { chatMsgs.scrollTop = chatMsgs.scrollHeight; };
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
}

document.getElementById('send').addEventListener('click', () => submit(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(input.value); });

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

function entryEl({ t, type, text }) {
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
  return e;
}

function renderLogs(logs) {
  logList.innerHTML = '';
  if (!logs.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '还没有日志，去陪她玩一会儿吧';
    logList.appendChild(d);
    return;
  }
  for (let i = logs.length - 1; i >= 0; i--) logList.appendChild(entryEl(logs[i]));
}

function loadLogs() {
  window.pet.getLogs().then(renderLogs);
}

window.pet.onLog((entry) => {
  const empty = logList.querySelector('.empty');
  if (empty) empty.remove();
  logList.prepend(entryEl(entry));
});

document.getElementById('clearLog').addEventListener('click', () => {
  window.pet.clearLogs();
  renderLogs([]);
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

function showKeyStatus({ hasKey, masked }) {
  keyStatus.classList.toggle('ok', hasKey);
  keyStatus.textContent = hasKey ? `已配置（${masked}），Kira 会用 Kimi 回答你` : '未配置 key，聊天走本地卖萌规则';
}

function loadChatConfig() {
  window.pet.getChatConfig().then(showKeyStatus);
}

document.getElementById('saveKey').addEventListener('click', () => {
  const k = kimiKeyInput.value.trim();
  if (!k) { keyStatus.classList.remove('ok'); keyStatus.textContent = '先粘贴 key 再保存'; return; }
  window.pet.setChatConfig({ kimiKey: k });
  kimiKeyInput.value = '';
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

function isOn(id) { return actionSettings[id] !== false; }

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
});

// ---------- 开场白：有历史就渲染历史，没有就打招呼 ----------
window.pet.chatHistory().then((history) => {
  if (history && history.length) {
    for (const m of history) addMsg(chatMsgs, m.role === 'user' ? 'me' : 'Kira', m.content);
  } else {
    addMsg(chatMsgs, 'Kira', '我是 Kira~\n想说什么都可以跟我说哦');
  }
});
addMsg(mrMsgs, 'Kira', '把 MR 链接拖进来，我帮你记成好看的格式');
