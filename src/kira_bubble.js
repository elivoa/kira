// kira 消息泡泡渲染层：渲染 markdown 内容、单击关闭（选中文字不算）、双击打开 kira tab、
// 光标落在泡泡上才接管鼠标（其余位置穿透），拖拽走 -webkit-app-region（框边缘拖，文字不拖）
const kb = document.getElementById('kb');
const kbText = document.getElementById('kbText');
const md = window.markdownit({ html: false, linkify: true, breaks: true });

let shown = false;

window.pet.onKiraBubbleShow(({ text }) => {
  kbText.innerHTML = md.render(text || '');
  kb.classList.add('show');
  shown = true;
});

// 单击关闭：点了但选中了一段文字时不当关闭（那是想复制）
kb.addEventListener('click', () => {
  if (!shown) return;
  if (window.getSelection().toString()) return;
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleDismiss();
});

// 双击打开小本子的 kira tab（同时关掉泡泡）
kb.addEventListener('dblclick', () => {
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleOpen();
});

// 点击穿透：只有光标落在泡泡上才接管鼠标，其余全部穿透
let ignoring = true;
window.addEventListener('mousemove', (e) => {
  let over = false;
  if (shown && kb.classList.contains('show')) {
    const r = kb.getBoundingClientRect();
    over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }
  const want = !over;
  if (want !== ignoring) {
    ignoring = want;
    window.pet.kiraBubbleIgnore(want);
  }
});
