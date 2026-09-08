// 自拍特效：取景框（四角括号 + 半透明暗边）框住她 1s → 全屏白闪 +「咔嚓！」
// → 拍立得照片（白边矩形贴她当前形态的图）在角落旋转弹出，停留 2s 再缩小消失。
// 全程墙钟驱动，rAF + watchdog 兜底（同 flySword 模式）。
(() => {
  let cur = null; // 当前场次 { finish }

  registerOvFx('photo', (data) => {
    if (cur) cur.finish(); // 拆旧开新：重开特效比新场次干等旧场次淡出体验好
    cur = startPhoto(data || {});
  });

  function startPhoto(data) {
    const seq = data.seq;
    const k = ovlK;
    const layer = el('g', {});

    // 她的身体区：窗口(460x740 逻辑幅) 内底部居中的 340x620 画幅，四周留点余量
    const px = typeof data.x === 'number' ? data.x : innerWidth / 2 - 230 * k;
    const py = typeof data.y === 'number' ? data.y : innerHeight - 740 * k;
    const m = 24 * k;
    const bx = Math.max(8, px + 60 * k - m);
    const by = Math.max(8, py + 120 * k - m);
    const bw = Math.min(innerWidth - 8, px + 60 * k + 340 * k + m) - bx;
    const bh = Math.min(innerHeight - 8, py + 120 * k + 620 * k + m) - by;

    // 暗边：框外四周压暗
    const dim = el('g', { opacity: 0 }, layer);
    el('rect', { x: 0, y: 0, width: innerWidth, height: by, fill: '#000' }, dim);
    el('rect', { x: 0, y: by + bh, width: innerWidth, height: Math.max(0, innerHeight - by - bh), fill: '#000' }, dim);
    el('rect', { x: 0, y: by, width: bx, height: bh, fill: '#000' }, dim);
    el('rect', { x: bx + bw, y: by, width: Math.max(0, innerWidth - bx - bw), height: bh, fill: '#000' }, dim);

    // 四角括号取景框
    const brackets = el('g', { opacity: 0 }, layer);
    const L = 34 * k + 18;
    const bAttrs = { fill: 'none', stroke: '#fff', 'stroke-width': 5, 'stroke-linecap': 'round' };
    el('path', { d: `M${bx},${by + L} L${bx},${by} L${bx + L},${by}`, ...bAttrs }, brackets);
    el('path', { d: `M${bx + bw - L},${by} L${bx + bw},${by} L${bx + bw},${by + L}`, ...bAttrs }, brackets);
    el('path', { d: `M${bx},${by + bh - L} L${bx},${by + bh} L${bx + L},${by + bh}`, ...bAttrs }, brackets);
    el('path', { d: `M${bx + bw - L},${by + bh} L${bx + bw},${by + bh} L${bx + bw},${by + bh - L}`, ...bAttrs }, brackets);

    const flash = el('rect', { x: 0, y: 0, width: innerWidth, height: innerHeight, fill: '#fff', opacity: 0 }, layer);

    // 拍立得照片：随机一个角落弹出，白边下厚上薄
    const W = 180, H = 224, PAD = 36;
    const corners = [
      [PAD + W / 2, PAD + H / 2],
      [innerWidth - PAD - W / 2, PAD + H / 2],
      [PAD + W / 2, innerHeight - PAD - H / 2],
      [innerWidth - PAD - W / 2, innerHeight - PAD - H / 2],
    ];
    const [ccx, ccy] = corners[(Math.random() * 4) | 0];
    const tilt = (Math.random() - 0.5) * 16;
    const card = el('g', { visibility: 'hidden' }, layer);
    el('rect', {
      x: -W / 2, y: -H / 2, width: W, height: H, rx: 6,
      fill: '#fff', stroke: 'rgba(0,0,0,.15)', 'stroke-width': 1.5,
    }, card);
    el('image', {
      href: data.form === 'chibi' ? '../assets/chibi.png' : '../assets/pet.png',
      x: -W / 2 + 12, y: -H / 2 + 12, width: W - 24, height: H - 46,
      preserveAspectRatio: 'xMidYMid meet',
    }, card);

    const FLASH_AT = 1000, CARD_AT = 1050, HOLD_TILL = 3050, END_AT = 3500;
    const t0 = performance.now();
    let done = false;
    let textPopped = false;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.remove();
      if (cur === self) cur = null;
      window.pet.fxDone('photo', seq);
    }

    function tick(now) {
      if (done) return;
      const ms = now - t0;
      if (ms > 8000) { finish(); return; } // 硬超时兜底

      // 取景框：淡入保持，白闪时随暗边一起撤
      const dimK = ms < FLASH_AT ? Math.min(ms / 250, 1) : Math.max(0, 1 - (ms - FLASH_AT) / 300);
      dim.setAttribute('opacity', 0.28 * dimK);
      brackets.setAttribute('opacity', dimK);

      // 白闪 + 拟声词
      if (ms >= FLASH_AT) {
        if (!textPopped) {
          textPopped = true;
          el('text', {
            x: bx + bw / 2, y: Math.max(60, by - 24), 'text-anchor': 'middle',
            'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
            'font-size': 46, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 8, 'paint-order': 'stroke',
            class: 'fx-pop',
          }, layer).textContent = '咔嚓！';
        }
        flash.setAttribute('opacity', Math.max(0, 1 - (ms - FLASH_AT) / 350));
      }

      // 照片：旋转弹出 → 停留 2s → 缩小消失
      if (ms >= CARD_AT && ms < HOLD_TILL) {
        const pk = Math.min((ms - CARD_AT) / 450, 1);
        const c1 = 1.70158, c3 = c1 + 1; // easeOutBack，弹出带回弹
        const s = 1 + c3 * Math.pow(pk - 1, 3) + c1 * Math.pow(pk - 1, 2);
        card.setAttribute('visibility', 'visible');
        card.setAttribute('transform', `translate(${ccx},${ccy}) rotate(${tilt - 25 * (1 - pk)}) scale(${Math.max(s, 0.01)})`);
      } else if (ms >= HOLD_TILL) {
        const sk = Math.min((ms - HOLD_TILL) / 400, 1);
        card.setAttribute('transform', `translate(${ccx},${ccy}) rotate(${tilt + 30 * sk}) scale(${Math.max(1 - 0.9 * sk, 0.01)})`);
        card.setAttribute('opacity', 1 - sk);
      }

      if (ms >= END_AT) { finish(); return; }
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆时的墙钟推进兜底：全程按墙钟结算，重复调用无害
    const watchdog = setInterval(() => {
      if (done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);

    const self = { finish };
    return self;
  }
})();
