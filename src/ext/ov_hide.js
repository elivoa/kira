// 捉迷藏（overlay 侧）：半个头从屏幕某个边角探出来，呼吸浮动；
// 期间覆盖层临时接管点击（mischief 同款 ovIgnore，用完必须恢复穿透），点中头 = 找到。
// 回执：点中 fxDone('hide.found')，15s 没人点 fxDone('hide.timeout')。
(() => {
  const HIDE_MS = 15000;
  let session = null; // 进行中的场次（防叠罗汉，peek 同款）

  let styleDone = false;
  function ensureStyle() {
    if (styleDone) return;
    styleDone = true;
    const s = document.createElement('style');
    s.textContent = '@keyframes hidebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}';
    document.head.appendChild(s);
  }

  registerOvFx('hide', (data) => {
    // 已有场次时新触发直接判超时收场，renderer 侧立即现身
    if (session) { window.pet.fxDone('hide.timeout'); return; }
    session = { done: false };
    try { show(data && data.corner, session); } catch (e) { finish(session, 'hide.timeout'); }
  });

  function textPop(layer, str, x, y, size) {
    el('text', {
      x, y, 'text-anchor': 'middle',
      'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
      'font-size': size, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 7, 'paint-order': 'stroke',
      class: 'fx-pop',
    }, layer).textContent = str;
  }

  function show(corner, ss) {
    ensureStyle();
    corner = ['tl', 'tr', 'bl', 'br'].includes(corner) ? corner : 'tr';
    const left = corner === 'tl' || corner === 'bl';
    const top = corner === 'tl' || corner === 'tr';

    const img = new Image();
    img.src = '../assets/head.png';
    img.onload = () => {
      if (ss.done) return;
      const H = Math.max(130, Math.min(Math.round(innerHeight * 0.22 * ovlK), 280));
      const W = Math.round(H * img.naturalWidth / img.naturalHeight);
      // 大半截探出屏外只露小半个头；纵向贴在对应的上/下边角一带
      const topPx = top
        ? Math.round(innerHeight * (0.04 + Math.random() * 0.12))
        : Math.round(innerHeight * (0.80 + Math.random() * 0.10)) - H;
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;top:${topPx}px;${left ? 'left' : 'right'}:${-Math.round(W * 0.58)}px;` +
        `width:${W}px;height:${H}px;opacity:0;` +
        `transform:translateX(${left ? -Math.round(W * 0.3) : Math.round(W * 0.3)}px);` +
        'transition:opacity .4s ease,transform .5s cubic-bezier(.2,1.25,.4,1);' +
        'filter:drop-shadow(0 8px 22px rgba(20,20,50,.4));';
      img.style.cssText = 'width:100%;height:100%;animation:hidebob 2.4s ease-in-out infinite;';
      box.appendChild(img);
      document.body.appendChild(box);
      const layer = el('g', {}); // 提示/爆点层
      void box.offsetWidth; // reflow 让滑入过渡生效
      box.style.opacity = '1';
      box.style.transform = 'translateX(0)';

      // 接管点击：点中头 = 找到；点歪了偶尔给个小提示。点击区域按实时包围盒算（头在浮动）
      window.pet.ovIgnore(false);
      const onDown = (e) => {
        if (e.button !== 0 || ss.done) return;
        const r = img.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          textPop(layer, '✦', (r.left + r.right) / 2, r.top, 40);
          finish(ss, 'hide.found');
        } else if (Math.random() < 0.4) {
          textPop(layer, '嘻嘻~', e.clientX, e.clientY - 20, 22);
        }
      };
      window.addEventListener('mousedown', onDown);
      ss.onDown = onDown; ss.box = box; ss.layer = layer;

      ss.timers = [
        // 藏匿提示：窸窣声帮玩家定位
        setTimeout(() => { if (!ss.done) textPop(layer, '窸窣…', left ? 60 : innerWidth - 60, topPx + 20, 22); }, 2200),
        setTimeout(() => { if (!ss.done) textPop(layer, '窸窣窸窣…', left ? 70 : innerWidth - 70, topPx + 46, 22); }, 9000),
        setTimeout(() => finish(ss, 'hide.timeout'), HIDE_MS),
        // 硬兜底：任何路径都不能让覆盖层一直占着点击
        setTimeout(() => finish(ss, 'hide.timeout'), HIDE_MS + 5000),
      ];
    };
    img.onerror = () => finish(ss, 'hide.timeout');
  }

  // 收尾只走一次：先恢复穿透，再撤头，最后回报桌宠（顺序同 mischief）
  function finish(ss, kind) {
    if (!ss || ss.done) return;
    ss.done = true;
    (ss.timers || []).forEach(clearTimeout);
    if (ss.onDown) window.removeEventListener('mousedown', ss.onDown);
    window.pet.ovIgnore(true);
    if (ss.box) {
      const box = ss.box;
      box.style.transition = 'opacity .35s ease';
      box.style.opacity = '0';
      setTimeout(() => box.remove(), 400);
    }
    if (ss.layer) ss.layer.remove();
    if (session === ss) session = null;
    window.pet.fxDone(kind);
  }
})();
