// 溜溜球覆盖层特效：软绳（verlet 链条 + smoothPath，同 mischief/climbRope 一套写法）从手心垂下，
// 绳长按正弦伸缩实现上下收放，球（圆+中缝）随绳末端摆动；中缝高速自转装出「睡眠」空转。
// renderer 每 0.1s 重发手心坐标（重复调用 = 更新），data.done = 收尾信号。
// 兜底同 flySword：硬超时强制收尾、帧回调 try/catch、setInterval 墙钟推进。
(function () {
  let session = null; // 防叠罗汉：同时只允许一场

  function startYoyo(data) {
    const layer = el('g', {});
    const N = 8;
    const R = 22 * ovlK;
    const rope = el('path', { fill: 'none', stroke: '#e8e0d0', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layer);
    const ballG = el('g', {}, layer);
    el('circle', { cx: 0, cy: 0, r: R, fill: '#ef6a8a', stroke: '#8a2f4c', 'stroke-width': 3 }, ballG);
    const seam = el('g', {}, ballG); // 中缝（自转层）
    el('line', { x1: -R, y1: 0, x2: R, y2: 0, stroke: '#8a2f4c', 'stroke-width': 3 }, seam);
    el('circle', { cx: 0, cy: 0, r: R * 0.22, fill: '#f6d365', stroke: '#8a2f4c', 'stroke-width': 2 }, ballG);
    el('ellipse', { cx: -R * 0.35, cy: -R * 0.4, rx: R * 0.3, ry: R * 0.18, fill: 'rgba(255,255,255,.55)' }, ballG);

    let hx = data.x, hy = data.y;   // 手心锚点（renderer 持续更新）
    let bx = data.x, by = data.y + 90 * ovlK; // 球位置（轻阻尼跟随绳末端）
    const pts = Array.from({ length: N + 1 }, (_, i) => ({
      x: data.x, y: data.y + 10 * i, px: data.x, py: data.y + 10 * i,
    }));
    const t0 = performance.now();
    let last = t0;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      session = null;
      clearInterval(watchdog);
      layer.style.transition = 'opacity .45s';
      layer.style.opacity = 0;
      setTimeout(() => layer.remove(), 500);
      window.pet.fxDone('yoyo');
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > 30000) { finish(); return; } // 硬兜底：done 信号丢了也不残留

      // 绳长正弦伸缩：1.9s 一回合，最短贴手、最长 160
      const len = (95 + 65 * Math.sin((ms / 1000) * Math.PI * 2 / 1.9 - Math.PI / 2)) * ovlK;
      const seg = len / N;
      const ax = hx + 3 * Math.sin(now / 90), ay = hy; // 手腕微晃

      // verlet：锚点钉在手心，其余重力积分后逐段长度约束
      for (let i = 1; i <= N; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
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
      bx += (end.x - bx) * Math.min(dt * 16, 1);
      by += (end.y - by) * Math.min(dt * 16, 1);
      const drawPts = pts.slice();
      drawPts[N] = { x: bx, y: by };
      rope.setAttribute('d', smoothPath(drawPts));
      seam.setAttribute('transform', `rotate(${(now * 0.72) % 360})`); // 720°/s 空转
      // 球随最末段绳角轻微倾斜
      const sway = Math.atan2(bx - pts[N - 1].x, by - pts[N - 1].y) * 180 / Math.PI;
      ballG.setAttribute('transform', `translate(${bx},${by}) rotate(${sway * 0.25})`);
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

    return {
      finish,
      setHand(x, y) { hx = x; hy = y; },
    };
  }

  registerOvFx('yoyo', (data) => {
    if (data && data.done) { if (session) session.finish(); return; }
    if (!data || typeof data.x !== 'number') return;
    if (session) session.setHand(data.x, data.y);
    else session = startYoyo(data);
  });
})();
