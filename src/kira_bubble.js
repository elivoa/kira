// kira 消息泡泡渲染层：迷你聊天窗——左上角 Q 版头像 + 底部输入框，输入经 yomi-send 发给 kira，
// 自己的消息居右气泡、等待期 typing 态，kira 回复保持 markdown 正文样式（不带气泡）填进等待行；
// 不带历史：kira-bubble-show 新消息清场只留最新一条（同次打开内滚动可见），聊天记录不持久化。
// markdown 渲染走 MarkdownStream 静态渲染（markdown-it 配置与 KaTeX MATH_OPTIONS 同本本）、
// 链接点击走系统浏览器（不算关闭）、Esc 关闭（输入框聚焦时先失焦，再按才关）、双击或右下角 💬 打开 kira tab、
// 右下角还有：飞书跳转、↺ 复位默认位置、拖拽手柄调大小（位置+大小由主进程持久化）、
// 左下角放大钮：窗口×2+内容 CSS zoom×2 的临时放大态（不落盘，Esc 优先缩回），
// 光标落在泡泡上才接管鼠标（其余位置穿透），拖拽走 -webkit-app-region（顶部条整片可拖，文字不拖）。
// 输入框聚焦时窗口临时降到 floating 级（screen-saver 级会压住输入法候选框），失焦恢复
const kb = document.getElementById('kb');
const kbMsgs = document.getElementById('kbMsgs');
const kbText = document.getElementById('kbText');
const kbInput = document.getElementById('kbInput');
const kbSend = document.getElementById('kbSend');
const kbClose = document.getElementById('kbClose');
const kbOpen = document.getElementById('kbOpen');
const kbFeishu = document.getElementById('kbFeishu');
const kbReset = document.getElementById('kbReset');
const kbResize = document.getElementById('kbResize');
const kbZoom = document.getElementById('kbZoom');
const kbAvatar = document.querySelector('.kb-avatar');

let shown = false;
let zoomed = false; // 放大态：窗口×2+内容 zoom×2；临时态不落盘，Esc 优先缩回
let waiting = false; // 泡泡里发过言、等 kira 回答中：此时 kira-bubble-show 到来填等待行而非清场
let typingRow = null; // 等待行（回复到达后变正式 kira 正文行）

const pinScroll = () => { kbMsgs.scrollTop = kbMsgs.scrollHeight; };

// 等待行 → 正式 kira 行：摘掉 typing、填回复正文（markdown，无气泡）
function fillKiraRow(row, text) {
  row.classList.remove('typing');
  row.classList.add('kb-md');
  row.innerHTML = '';
  window.MarkdownStream.render(row, text || '');
  pinScroll();
}

window.pet.onKiraBubbleShow(({ text }) => {
  if (waiting && typingRow) {
    // 泡泡里发问的回答到了：填进等待行，自己的气泡保留
    fillKiraRow(typingRow, text);
    waiting = false;
    typingRow = null;
  } else {
    // 新消息/主动搭话：清掉上一轮（用户气泡+旧回复），只留最新一条——不带历史
    kbMsgs.innerHTML = '';
    kbText.innerHTML = '';
    kbMsgs.appendChild(kbText);
    window.MarkdownStream.render(kbText, text || '');
    kbMsgs.scrollTop = 0;
  }
  kb.classList.add('show');
  shown = true;
});

// 发送：自己的消息上屏为居右气泡 + 起等待行，经 yomi-send 发给 kira（与记事本 bot tab 同一通道）。
// 回答一般经 kira-bubble-show 事件先回来填等待行；事件流没来（120s 兜底文案）时用 invoke
// resolve 的文案填——waiting 标志保证两边只填一次，不双显
function sendChat() {
  const text = kbInput.value.trim();
  if (!text) return;
  kbInput.value = '';
  kbInput.style.height = '';
  const me = document.createElement('div');
  me.className = 'kb-msg me';
  const b = document.createElement('div');
  b.className = 'kb-bubble';
  b.textContent = text;
  me.appendChild(b);
  kbMsgs.appendChild(me);
  typingRow = document.createElement('div');
  typingRow.className = 'kb-msg kira typing';
  typingRow.textContent = '正在输入';
  kbMsgs.appendChild(typingRow);
  waiting = true;
  pinScroll();
  const settle = (reply) => {
    if (!waiting) return; // 事件流已填过
    fillKiraRow(typingRow, reply);
    waiting = false;
    typingRow = null;
  };
  window.pet.yomiSend(text).then((r) => {
    if (r && r.ok) settle(r.reply || '（发出去了，kira 还没回，稍等飞书上看吧）');
    else settle(`呜，没发出去…${r && r.error ? `（${r.error}）` : ''}`);
  }).catch(() => settle('呜，没发出去…'));
}

kbSend.addEventListener('click', () => {
  sendChat();
  if (document.hasFocus()) kbInput.focus();
});

kbInput.addEventListener('keydown', (e) => {
  // Esc 分层：输入框聚焦时先失焦（不关泡泡、不发送）；失焦后再按 Esc 才走 window 的缩回/关闭
  if (e.key === 'Escape') {
    e.stopPropagation();
    kbInput.blur();
    return;
  }
  // 回车发送、Shift+回车换行；输入法组词中的回车不算
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChat();
  }
});
// 多行输入自动撑高，封顶四行
kbInput.addEventListener('input', () => {
  kbInput.style.height = 'auto';
  kbInput.style.height = Math.min(kbInput.scrollHeight, 84) + 'px';
});

// 输入法候选框被挡：泡泡是 screen-saver 高层级，IME 候选窗被压在下面。
// 输入框聚焦时让主进程把窗口降到 floating，失焦恢复。window blur/focus 兜底：
// 切去别的 app 时输入框不触发 blur（仍是 activeElement），不兜底层级会卡在 floating。
// 桥接方法可能不存在（旧 preload），可选调用防崩
const kbIme = (on) => window.pet.kbIme && window.pet.kbIme(on);
kbInput.addEventListener('focus', () => kbIme(true));
kbInput.addEventListener('blur', () => kbIme(false));
window.addEventListener('blur', () => { if (document.activeElement === kbInput) kbIme(false); });
window.addEventListener('focus', () => { if (document.activeElement === kbInput) kbIme(true); });

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

// 双击打开小本子的 kira tab（同时关掉泡泡）；双击在链接、按钮或输入区上不算
kb.addEventListener('dblclick', (e) => {
  if (e.target.closest('a') || e.target.closest('button') || e.target.closest('.kb-inputrow')) return;
  if (!shown) return;
  shown = false;
  kb.classList.remove('show');
  window.pet.kiraBubbleOpen();
});

// 点击穿透：只有光标落在泡泡上才接管鼠标，其余全部穿透；
// 人物立绘悬贴在卡体之外（上/左冒出），它的矩形也算「在泡泡上」，否则悬贴部分会成为穿透洞
let ignoring = true;
window.addEventListener('mousemove', (e) => {
  let over = false;
  if (shown && kb.classList.contains('show')) {
    const inRect = (r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    over = inRect(kb.getBoundingClientRect()) || inRect(kbAvatar.getBoundingClientRect());
  }
  const want = !over;
  if (want !== ignoring) {
    ignoring = want;
    window.pet.kiraBubbleIgnore(want);
  }
});
