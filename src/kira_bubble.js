// kira 消息泡泡渲染层：markdown 渲染走 MarkdownStream 静态渲染（markdown-it 配置与 KaTeX MATH_OPTIONS 同本本）、
// 链接点击走系统浏览器（不算关闭）、单击关闭（选中文字不算）、双击打开 kira tab、
// 光标落在泡泡上才接管鼠标（其余位置穿透），拖拽走 -webkit-app-region（框边缘拖，文字不拖）
const kb = document.getElementById('kb');
const kbText = document.getElementById('kbText');

let shown = false;

window.pet.onKiraBubbleShow(({ text }) => {
  window.MarkdownStream.render(kbText, text || '');
  kb.classList.add('show');
  shown = true;
});

// 链接点击：capture 阶段拦下并 stopPropagation，事件到不了 kb 的单击关闭；交给主进程开系统浏览器。
// 同 href 300ms 去重：双击序列是 click→click→dblclick，两次 click 都会走到这，不去重会开两个相同标签
let lastHref = null;
let lastTime = 0;
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || !kb.contains(a)) return;
  e.preventDefault();
  e.stopPropagation();
  const href = a.getAttribute('href');
  if (!href) return;
  const now = Date.now();
  if (href === lastHref && now - lastTime < 300) return;
  lastHref = href;
  lastTime = now;
  window.pet.kbOpenLink(href);
}, true);

// 单击关闭：点了但选中了一段文字时不当关闭（那是想复制）
kb.addEventListener('click', () => {
  if (!shown) return;
  if (window.getSelection().toString()) return;
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleDismiss();
});

// 双击打开小本子的 kira tab（同时关掉泡泡）；双击在链接上不算
kb.addEventListener('dblclick', (e) => {
  if (e.target.closest('a')) return;
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
