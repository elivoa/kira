// 气球漂流覆盖层特效：气球（椭圆+小结+高光）拴软绳（verlet + smoothPath，同 mischief 一套写法），
// 她（chibi.png）吊在绳末端，从出发点缓缓飘向屏幕另一边再飘回来（sin 弧线 0→1→0，两端速度为零）。
// 兜底同 flySword：硬超时强制收尾、帧回调 try/catch、setInterval 墙钟推进。
(function () {
  let session = null; // 防叠罗汉：同时只允许一场

  function fly(data) {
    const layer = el('g', {});
    const K = ovlK;
    const R = 46 * K; // 气球半宽

    // 气球：椭圆 + 底部小结 + 高光
    const balloonG = el('g', {}, layer);
    el('ellipse', { cx: 0, cy: 0, rx: R, ry: 56 * K, fill: '#ff7b9c', stroke: '#c24a6e', 'stroke-width': 3 }, balloonG);
    el('path', { d: `M${-6 * K},${54 * K} L${6 * K},${54 * K} L0,${68 * K} Z`, fill: '#ff7b9c', stroke: '#c24a6e', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, balloonG);
    el('ellipse', { cx: -16 * K, cy: -20 * K, rx: 12 * K, ry: 20 * K, fill: 'rgba(255,255,255,.5)', transform: 'rotate(-18)' }, balloonG);

    // 软绳 + 吊在末端的小 Kira（绳末端即她头顶）
    const N = 6;
    const rope = el('path', { fill: 'none', stroke: '#8a7a5a', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layer);
    const charG = el('g', {}, layer);
    el('image', { href: '../assets/chibi.png', x: -52 * K, y: 0, width: 104 * K, height: 104 * K * 1125 / 1012 }, charG);

    const homeX = data.x, homeY = data.y - 130 * K; // 气球起点：她头顶上方
    // 飘向离她远的一侧
    const farX = homeX < innerWidth / 2 ? innerWidth * 0.78 : innerWidth * 0.22;
    const TOTAL = 9000 + Math.random() * 3000; // 9~12s 一个来回
    const ROPE_LEN = 70 * K;
    const seg = ROPE_LEN / N;

    let x = homeX, y = homeY, px = homeX; // 气球位置（px 算速度用于倾斜）
    let charX = homeX, charY = homeY + ROPE_LEN; // 她的位置（惯性阻尼，同 mischief）
    let charAng = 0;
    const pts = Array.from({ length: N + 1 }, (_, i) => ({
      x: homeX, y: homeY + seg * i, px: homeX, py: homeY + seg * i,
    }));
    const t0 = performance.now();
    let last = t0;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      session = null;
      clearInterval(watchdog);
      layer.style.transition = 'opacity .5s';
      layer.style.opacity = 0;
      setTimeout(() => layer.remove(), 550);
      window.pet.fxDone('balloon');
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > 25000) { finish(); return; } // 硬兜底

      const k = Math.min(ms / TOTAL, 1);
      if (k >= 1) { finish(); return; }
      // 来回弧线：prog 0→1→0，两端速度为零，起降都稳
      const prog = Math.sin(Math.PI * k);
      x = homeX + (farX - homeX) * prog + 26 * Math.sin(now / 700) * prog;
      y = homeY - 140 * prog + 14 * Math.sin(now / 500);

      // verlet：锚点钉在气球小结，其余重力积分后逐段长度约束
      const ax = x, ay = y + 66 * K;
      for (let i = 1; i <= N; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.92, vy = (p.y - p.py) * 0.92;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + 1600 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        pts[0].x = ax; pts[0].y = ay;
        for (let i = 0; i < N; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const fix = (d - seg) / d;
          if (i === 0) { b.x -= dx * fix; b.y -= dy * fix; }
          else { a.x += dx * fix / 2; a.y += dy * fix / 2; b.x -= dx * fix / 2; b.y -= dy * fix / 2; }
        }
      }
      const end = pts[N];
      charX += (end.x - charX) * Math.min(dt * 6, 1);
      charY += (end.y - charY) * Math.min(dt * 6, 1);
      const drawPts = pts.slice();
      drawPts[N] = { x: charX, y: charY };
      rope.setAttribute('d', smoothPath(drawPts));
      // 她沿绳角缓慢倾斜（角阻尼，不跟绳子急转）
      const targetAng = Math.atan2(charX - pts[N - 1].x, charY - pts[N - 1].y) * 180 / Math.PI * 0.7;
      charAng += (targetAng - charAng) * Math.min(dt * 8, 1);
      charG.setAttribute('transform', `translate(${charX},${charY}) rotate(${charAng})`);
      // 气球随水平速度轻倾
      const vel = (x - px) / Math.max(dt, 0.001);
      px = x;
      balloonG.setAttribute('transform', `translate(${x},${y}) rotate(${Math.max(-14, Math.min(14, vel * 0.03))})`);
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆时的墙钟推进兜底：位移全按墙钟结算，重复调用无害
    const watchdog = setInterval(() => {
      if (done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);

    return { finish };
  }

  registerOvFx('balloon', (data) => {
    if (data && data.done) { if (session) session.finish(); return; }
    if (!data || typeof data.x !== 'number') return;
    if (!session) session = fly(data);
  });
})();
