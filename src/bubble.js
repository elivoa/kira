// 气泡窗口渲染层：显示台词、粘性气泡点击关闭、按光标位置切换点击穿透
const bubble = document.getElementById('bubble');
let bubbleTimer = null;
let sticky = false;
let scale = 1;

function applyTransform() {
  bubble.style.transform = `translateX(-50%) scale(${scale})`;
}

// 桌宠每帧报缩放（远近缩放 × 整体缩放，已在桌宠侧钳过下限）
window.pet.onBubbleScale((s) => {
  scale = s;
  applyTransform();
});

window.pet.onBubbleSay(({ text, ms, sticky: st }) => {
  clearTimeout(bubbleTimer);
  sticky = !!st;
  bubble.style.width = ''; // 清掉上一条粘性气泡的自适应宽度
  bubble.textContent = text;
  bubble.classList.toggle('sticky', sticky);
  if (sticky) {
    // 文字多的框宽一点：按字数自适应（160~460px，窗口宽 560，可以比人物区域宽很多）
    bubble.style.width = `${Math.max(160, Math.min(460, 40 + text.length * 9))}px`;
    const hint = document.createElement('span');
    hint.className = 'sticky-hint';
    hint.textContent = '✦ 点我消失';
    bubble.appendChild(hint);
  } else {
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms || 1800);
  }
  bubble.classList.add('show');
});

// 粘性气泡点一下关闭，并通知桌宠解除 sticky 状态
bubble.addEventListener('click', () => {
  if (!sticky) return;
  sticky = false;
  bubble.classList.remove('show', 'sticky');
  window.pet.bubbleDismiss();
});

// 点击穿透：只有光标落在粘性气泡上才接管鼠标，其余全部穿透
let ignoring = true;
window.addEventListener('mousemove', (e) => {
  let over = false;
  if (sticky && bubble.classList.contains('show')) {
    const r = bubble.getBoundingClientRect();
    over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }
  const want = !over;
  if (want !== ignoring) {
    ignoring = want;
    window.pet.bubbleIgnore(want);
  }
});
