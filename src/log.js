// 日志查看页：新的在前，实时追加
const list = document.getElementById('list');

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

function render(logs) {
  list.innerHTML = '';
  if (!logs.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '还没有日志，去陪她玩一会儿吧';
    list.appendChild(d);
    return;
  }
  for (let i = logs.length - 1; i >= 0; i--) list.appendChild(entryEl(logs[i]));
}

window.pet.getLogs().then(render);

window.pet.onLog((entry) => {
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  list.prepend(entryEl(entry));
});

document.getElementById('clear').addEventListener('click', () => {
  window.pet.clearLogs();
  render([]);
});
