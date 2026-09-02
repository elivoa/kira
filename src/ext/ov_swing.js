// 荡秋千覆盖层：屏幕顶边垂两条软绳吊一块小木板，Q版站板上单摆摆动
// 摆角 30°→60°→30°（周期 ~2s），10~14s 后连人带板淡出，回执桌宠侧现身
(function () {
  let swinging = false; // 防叠罗汉：重入直接回执，桌宠侧不会干等

  registerOvFx('swing', (data) => {
    if (swinging) { window.pet.fxDone('swing'); return; }
    swinging = true;
    startSwing(data || {});
  });

  function startSwing(data) {
    const K = ovlK;
    const layer = el('g', {});
    const ROPE_N = 12;
    const LEN = Math.min(innerHeight * 0.52, 560); // 摆长（顶锚点到板面）
    const BOARD_W = 122 * K, BOARD_H = 10 * K, BOARD_DX = 46 * K;
    const ANCH_DX = 34 * K;                        // 两绳顶锚点半间距
    const GIRL_W = 96 * K, GIRL_H = GIRL_W * 1125 / 1012;
    const TOTAL = 10000 + Math.random() * 4000;
    const PERIOD = 2000;

    // 横向留出最大摆幅余量（60° 时平移 ≈0.87 倍摆长），别甩出屏幕
    const margin = Math.min(LEN * 0.87 + BOARD_W, innerWidth / 2 - 40);
    const rawX = typeof data.x === 'number' ? data.x : innerWidth / 2;
    const ax = Math.min(Math.max(rawX, margin), innerWidth - margin);

    const ropeAttr = { fill: 'none', stroke: '#8a6d4b', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const ropeL = el('path', ropeAttr, layer);
    const ropeR = el('path', ropeAttr, layer);
    const knotL = el('circle', { r: 4, fill: '#8a6d4b' }, layer);
    const knotR = el('circle', { r: 4, fill: '#8a6d4b' }, layer);
    const seat = el('g', {}, layer);
    el('rect', { x: -BOARD_W / 2, y: 0, width: BOARD_W, height: BOARD_H, rx: 3, fill: '#b5854a', stroke: '#7a5426', 'stroke-width': 2 }, seat);
    el('line', { x1: -BOARD_W / 2 + 8, y1: BOARD_H * 0.45, x2: BOARD_W / 2 - 8, y2: BOARD_H * 0.45, stroke: 'rgba(122,84,38,.5)', 'stroke-width': 1.5 }, seat); // 木纹
    el('image', { href: '../assets/chibi.png', x: -GIRL_W / 2, y: -GIRL_H + 2 * K, width: GIRL_W, height: GIRL_H }, seat);

    const mkChain = () => Array.from({ length: ROPE_N + 1 }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
    const chL = mkChain(), chR = mkChain();
    let chained = false;

    let done = false;
    const t0 = performance.now();
    let last = t0;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.style.transition = 'opacity .6s';
      layer.style.opacity = 0;
      setTimeout(() => layer.remove(), 650);
      swinging = false;
      window.pet.fxDone('swing');
    }

    // 两端钉死的软绳（climbRope 同款）：2% 松量垂出软感，底端跟着板跑自然带起甩鞭
    function verlet(ch, topX, bot, dt) {
      const dist = Math.hypot(bot.x - topX, bot.y);
      const seg = (dist * 1.02 + 2) / ROPE_N;
      for (let i = 1; i <= ROPE_N; i++) {
        const p = ch[i];
        const vx = (p.x - p.px) * 0.92, vy = (p.y - p.py) * 0.92;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + 1600 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        ch[0].x = topX; ch[0].y = 0;
        ch[ROPE_N].x = bot.x; ch[ROPE_N].y = bot.y;
        for (let i = 0; i < ROPE_N; i++) {
          const a = ch[i], b = ch[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.hypot(dx, dy) || 1;
          const fix = (d2 - seg) / d2;
          if (i === 0) { b.x -= dx * fix; b.y -= dy * fix; }
          else if (i === ROPE_N - 1) { a.x += dx * fix; a.y += dy * fix; }
          else { a.x += dx * fix / 2; a.y += dy * fix / 2; b.x -= dx * fix / 2; b.y -= dy * fix / 2; }
        }
      }
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > TOTAL + 3000) { finish(); return; } // 硬兜底：任何路径都不能让秋千永远荡

      // 摆角包络：30° → 中段 60° → 尾段回到 30°
      const amp = (30 + 30 * Math.sin(Math.PI * Math.min(ms / (TOTAL * 0.8), 1))) * Math.PI / 180;
      const th = amp * Math.sin(2 * Math.PI * ms / PERIOD);
      const bx = ax + LEN * Math.sin(th);
      const by = LEN * Math.cos(th);
      const cos = Math.cos(th), sin = Math.sin(th);
      // 板随摆角转，两个拴绳点跟着板走
      const aL = { x: bx - BOARD_DX * cos, y: by - BOARD_DX * sin };
      const aR = { x: bx + BOARD_DX * cos, y: by + BOARD_DX * sin };

      if (!chained) { // 首帧把链条沿绳向拉直，免得从原点弹过来
        chained = true;
        for (let i = 0; i <= ROPE_N; i++) {
          const k = i / ROPE_N;
          const pL = chL[i];
          pL.x = pL.px = (ax - ANCH_DX) + (aL.x - (ax - ANCH_DX)) * k; pL.y = pL.py = aL.y * k;
          const pR = chR[i];
          pR.x = pR.px = (ax + ANCH_DX) + (aR.x - (ax + ANCH_DX)) * k; pR.y = pR.py = aR.y * k;
        }
      }

      verlet(chL, ax - ANCH_DX, aL, dt);
      verlet(chR, ax + ANCH_DX, aR, dt);
      ropeL.setAttribute('d', smoothPath(chL));
      ropeR.setAttribute('d', smoothPath(chR));
      knotL.setAttribute('cx', ax - ANCH_DX); knotL.setAttribute('cy', 0);
      knotR.setAttribute('cx', ax + ANCH_DX); knotR.setAttribute('cy', 0);
      seat.setAttribute('transform', `translate(${bx},${by}) rotate(${th * 180 / Math.PI})`);

      if (ms > TOTAL) { finish(); return; }
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆兜底：摆动全按墙钟结算，定时器重复调用无害
    const watchdog = setInterval(() => {
      if (done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);
  }
})();
