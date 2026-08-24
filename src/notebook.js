// Kira 的小本子：三个页签 —— 实时聊天 / MR Link / 日志
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
    for (const key of ['chat', 'mr', 'log']) {
      document.getElementById(`page-${key}`).classList.toggle('hidden', key !== activeTab);
    }
    inputrow.classList.toggle('hidden', activeTab === 'log');
    if (activeTab === 'log') loadLogs();
  });
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
  b.textContent = text;
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
    addMsg(chatMsgs, 'Kira', chatAnswer(text));
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

// ---------- 开场白 ----------
addMsg(chatMsgs, 'Kira', '我是 Kira~\n想说什么都可以跟我说哦');
addMsg(mrMsgs, 'Kira', '把 MR 链接拖进来，我帮你记成好看的格式');
