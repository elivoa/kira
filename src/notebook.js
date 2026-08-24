// kiki 的小本子：聊天式交互。第一个本领：把 MR 链接转成 markdown 引用格式
const msgs = document.getElementById('msgs');
const input = document.getElementById('input');

function addMsg(who, text, cmd) {
  const m = document.createElement('div');
  m.className = `msg ${who}`;
  if (who === 'kiki') {
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
      const old = text;
      b.textContent = '已复制！';
      setTimeout(() => { b.textContent = old; }, 800);
    });
  }
  m.appendChild(b);
  msgs.appendChild(m);
  msgs.scrollTop = msgs.scrollHeight;
}

// 处理输入：目前只认 GitLab MR 链接
function answer(text) {
  const url = (text.match(/https?:\/\/\S+/) || [])[0];
  if (!url) return { text: '这看起来不是一个链接哦', cmd: false };
  const mr = url.match(/merge_requests\/(\d+)/);
  if (mr) return { text: `[!${mr[1]}](${url})`, cmd: true };
  return { text: '这个链接我还不会处理，目前只认识 MR 链接', cmd: false };
}

function submit(text) {
  text = (text || '').trim();
  if (!text) return;
  addMsg('me', text);
  input.value = '';
  const r = answer(text);
  addMsg('kiki', r.text, r.cmd);
  // 告诉她一声（气泡 + 日志）
  window.pet.notebookSay(r.cmd ? '记好啦' : '唔…这个不会');
  window.pet.logAppend({ t: Date.now(), type: '交互', text: r.cmd ? `小本子记了一条链接：${r.text}` : '在小本子里收到一条看不懂的输入' });
}

document.getElementById('send').addEventListener('click', () => submit(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(input.value); });

// 拖链接进来
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  submit(text);
});

addMsg('kiki', '我是 kiki 的小本子~\n把链接拖进来，我帮你记成好看的格式', false);
