// kira 消息泡泡渲染层：markdown 渲染走 MarkdownStream 静态渲染（markdown-it 配置与 KaTeX MATH_OPTIONS 同本本）、
// 链接点击走系统浏览器（不算关闭）、Esc 或右上角 ✕ 关闭、双击或右下角 💬 打开 kira tab、
// 右下角还有：飞书跳转、↺ 复位默认位置、拖拽手柄调大小（位置+大小由主进程持久化）、
// 左下角放大钮：窗口×2+内容 CSS zoom×2 的临时放大态（不落盘，Esc 优先缩回），
// 光标落在泡泡上才接管鼠标（其余位置穿透），拖拽走 -webkit-app-region（框边缘拖，文字不拖）
const kb = document.getElementById('kb');
const kbText = document.getElementById('kbText');
const kbClose = document.getElementById('kbClose');
const kbOpen = document.getElementById('kbOpen');
const kbFeishu = document.getElementById('kbFeishu');
const kbReset = document.getElementById('kbReset');
const kbResize = document.getElementById('kbResize');
const kbZoom = document.getElementById('kbZoom');

let shown = false;
let zoomed = false; // 放大态：窗口×2+内容 zoom×2；临时态不落盘，Esc 优先缩回

window.pet.onKiraBubbleShow(({ text }) => {
  window.MarkdownStream.render(kbText, text || '');
  kb.classList.add('show');
  shown = true;
});

function dismiss() {
  if (!shown) return;
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleDismiss();
}

// 链接点击：capture 阶段拦下并 stopPropagation；交给主进程开系统浏览器。
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

// Esc：放大态优先缩回原尺寸，非放大态才关闭（窗口 focusable，用户点过泡泡拿到焦点后生效）
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (zoomed) window.pet.kbZoom(false);
  else dismiss();
});

// 右上角 ✕ 关闭按钮
kbClose.addEventListener('click', () => dismiss());

// 右下角 💬 按钮：打开小本子的 kira tab（同时关掉泡泡）；
// shown 守卫挡住双击序列的第二次 click，避免重复打开
kbOpen.addEventListener('click', () => {
  if (!shown) return;
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleOpen();
});

// 右下角飞书按钮：跳转飞书里 kira 机器人的私聊（不关泡泡）
kbFeishu.addEventListener('click', () => {
  if (!shown) return;
  window.pet.kiraBubbleFeishu();
});

// 右下角 ↺ 复位：清掉记录的位置/大小，泡泡回到人物头顶默认锚定（不关泡泡）
kbReset.addEventListener('click', () => {
  if (!shown) return;
  window.pet.kiraBubbleReset();
});

// 右下角拖拽手柄调大小：笔记本 nb-resize 同款三段式，主进程按光标差值 setSize。
// 拖拽期间主进程强制接管鼠标（渲染层的 kb-ignore 被压住），所以 mouseup 时把当前
// 穿透状态随 end 回传恢复；本地 ignoring 同步成同一值，防下一个 mousemove 重复发
let resizing = false;
kbResize.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  window.pet.kbResizeStart();
});
window.addEventListener('mousemove', () => { if (resizing) window.pet.kbResizeMove(); });
window.addEventListener('mouseup', (e) => {
  if (!resizing) return;
  resizing = false;
  const r = kb.getBoundingClientRect();
  const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  ignoring = !over;
  window.pet.kbResizeEnd(ignoring);
});

// 左下角放大钮：点击切换放大态。窗口尺寸由主进程×2（可能钳制），实际缩放比例随
// kira-bubble-zoom 事件回来后再落到 CSS zoom 上，保证两边比例一致
kbZoom.addEventListener('click', () => {
  if (!shown) return;
  window.pet.kbZoom(!zoomed);
});
window.pet.onKbZoom(({ on, scale }) => {
  zoomed = on;
  kb.style.zoom = scale;
  kbZoom.classList.toggle('on', on);
  kbZoom.title = on ? '缩小（Esc）' : '放大';
});

// 双击打开小本子的 kira tab（同时关掉泡泡）；双击在链接或按钮上不算
kb.addEventListener('dblclick', (e) => {
  if (e.target.closest('a') || e.target.closest('button')) return;
  if (!shown) return;
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
