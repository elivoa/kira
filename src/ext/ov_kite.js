// 放风筝 overlay：菱形风筝（两个三角形拼 + 两条飘带）+ 软绳连到她手上。
// 软绳与捣乱/攀爬安全绳同一套 verlet 链条 + smoothPath，只是两端都钉住（下端钉手部锚点、
// 上端钉风筝）。桌宠侧每 120ms 报一次锚点（data.x/y 窗口左上 + hx/hy 未缩放局部偏移，
// 乘 ovlK 得真实坐标）；phase: fly 盘旋 / reel 收线下降；data.end=true = 动作被打断，赶紧收场。
// 结束必须 fxDone('kite')，桌宠侧拿着回执才能收尾。
(() => {
  const N = 10;           // 软绳段数
  const HARD_MS = 40000;  // 硬兜底：任何路径都不能让风筝永远挂在屏幕上
  let S = null;           // 进行中场次

  function makeKite(layer) {
    const g = el('g', {}, layer);
    const W = 62 * ovlK, H = 82 * ovlK;
    el('polygon', { points: `0,${-H / 2} ${-W / 2},0 ${W / 2},0`, fill: '#ffb3c7', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
    el('polygon', { points: `${-W / 2},0 ${W / 2},0 0,${H / 2}`, fill: '#b9a8ff', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
    el('line', { x1: 0, y1: -H / 2, x2: 0, y2: H / 2, stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.5 }, g);
    el('line', { x1: -W / 2, y1: 0, x2: W / 2, y2: 0, stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.5 }, g);
    el('circle', { cx: 0, cy: 0, r: 3 * ovlK, fill: '#fff' }, g);
    const tailA = el('path', { fill: 'none', stroke: '#ffb3c7', 'stroke-width': 2.5 * ovlK, 'stroke-linecap': 'round' }, g);
    const tailB = el('path', { fill: 'none', stroke: '#b9a8ff', 'stroke-width': 2.5 * ovlK, 'stroke-linecap': 'round' }, g);
    return { g, tailA, tailB, tailY: H / 2, tailStep: 11 * ovlK, tailAmp: 2.2 * ovlK };
  }

  function createSession(data) {
    const s = {
      layer: el('g', {}),
      done: false, ending: false, endT: 0,
      phase: data.phase === 'reel' ? 'reel' : 'fly',
      reelT: 0,
      t0: performance.now(), last: performance.now(),
      // 手部锚点：目标值（桌宠侧报的）+ 平滑值（防 120ms 上报台阶感）
      tx: (typeof data.x === 'number' ? data.x : innerWidth / 2) + (data.hx || 0) * ovlK,
      ty: (typeof data.y === 'number' ? data.y : innerHeight) + (data.hy || 0) * ovlK,
      ax: 0, ay: 0,
      kx: 0, ky: 0, pkx: 0, svx: 0,
      hcx: 0, hcy: innerHeight * (0.15 + Math.random() * 0.12),
      RX: innerWidth * 0.16, RY: innerHeight * 0.05,
      pts: null,
    };
    s.ax = s.tx; s.ay = s.ty;
    s.kx = s.ax; s.ky = s.ay; s.pkx = s.kx; // 风筝从手上起飞
    s.hcx = Math.min(innerWidth * 0.78, Math.max(innerWidth * 0.22, s.ax));
    s.rope = el('path', { fill: 'none', stroke: '#6b5a3a', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s.layer);
    s.kite = makeKite(s.layer);

    function finish() {
      if (s.done) return;
      s.done = true;
      clearInterval(s.watchdog);
      s.layer.remove();
      if (S === s) S = null;
      window.pet.fxDone('kite');
    }
    s.finish = finish;

    function sparkle(x, y) {
      for (let i = 0; i < 3; i++) {
        el('circle', { cx: x + (Math.random() - 0.5) * 40, cy: y + (Math.random() - 0.5) * 30, r: 8 + Math.random() * 10, fill: 'none', stroke: '#ffe9a8', 'stroke-width': 3, class: 'fx-pop' }, s.layer);
      }
    }

    function tick(now) {
      if (s.done) return;
      const dt = Math.min((now - s.last) / 1000, 0.05);
      s.last = now;
      const ms = now - s.t0;
      if (ms > HARD_MS) s.ending = true;

      s.ax += (s.tx - s.ax) * Math.min(dt * 8, 1);
      s.ay += (s.ty - s.ay) * Math.min(dt * 8, 1);

      // 风筝运动：起飞甩上高空 → 正弦盘旋；reel 阶段缓缓降回手上
      if (s.phase === 'reel') {
        const dx = s.ax - s.kx, dy = s.ay - s.ky;
        const dist = Math.hypot(dx, dy) || 1;
        const sp = Math.min(380, Math.max(140, dist * 0.9));
        s.kx += dx / dist * sp * dt;
        s.ky += dy / dist * sp * dt;
        s.reelT += dt;
        if (dist < 74 || s.reelT > 6) { sparkle(s.kx, s.ky); s.ending = true; }
      } else if (ms < 1200) {
        const k = 1 - Math.pow(1 - ms / 1200, 3); // easeOut 爬升
        s.kx = s.ax + (s.hcx - s.ax) * k;
        s.ky = s.ay + (s.hcy - s.ay) * k;
      } else {
        const t2 = (ms - 1200) / 1000;
        s.kx = s.hcx + Math.sin(t2 * 0.45) * s.RX + Math.sin(t2 * 1.7) * 14;
        s.ky = s.hcy + Math.sin(t2 * 0.9) * s.RY + Math.sin(t2 * 2.3) * 8;
      }
      // 按横向速度倾斜，盘旋时自然侧倾
      s.svx += ((s.kx - s.pkx) / Math.max(dt, 0.001) - s.svx) * Math.min(dt * 4, 1);
      s.pkx = s.kx;
      const rot = Math.max(-26, Math.min(26, s.svx * 0.03));
      s.kite.g.setAttribute('transform', `translate(${s.kx},${s.ky}) rotate(${rot})`);
      // 两条飘带：正弦摆动的小折线，挂在风筝下尖
      for (const [tail, off] of [[s.kite.tailA, 0], [s.kite.tailB, 2.1]]) {
        let d = `M0,${s.kite.tailY}`;
        for (let j = 1; j <= 5; j++) {
          d += ` L${(Math.sin(now / 180 + j * 1.1 + off) * s.kite.tailAmp * j).toFixed(1)},${(s.kite.tailY + j * s.kite.tailStep).toFixed(1)}`;
        }
        tail.setAttribute('d', d);
      }

      // 软绳 verlet：中间点重力积分，两端钉死（手 + 风筝），再逐段长度约束
      if (!s.pts) {
        s.pts = Array.from({ length: N + 1 }, (_, i) => {
          const x = s.ax + (s.kx - s.ax) * i / N, y = s.ay + (s.ky - s.ay) * i / N;
          return { x, y, px: x, py: y };
        });
      }
      const dist = Math.hypot(s.kx - s.ax, s.ky - s.ay);
      const seg = Math.max((dist * 1.03 + 6) / N, 3); // 比直线略长，垂一点自然弧度
      for (let i = 1; i < N; i++) {
        const p = s.pts[i];
        const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + 1000 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        s.pts[0].x = s.ax; s.pts[0].y = s.ay;
        s.pts[N].x = s.kx; s.pts[N].y = s.ky;
        for (let i = 0; i < N; i++) {
          const a = s.pts[i], b = s.pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.hypot(dx, dy) || 1;
          const fix = (d2 - seg) / d2;
          // 端点段只动内侧点（端点钉死），中间段对半分
          if (i === 0) { b.x -= dx * fix; b.y -= dy * fix; }
          else if (i === N - 1) { a.x += dx * fix; a.y += dy * fix; }
          else { a.x += dx * fix / 2; a.y += dy * fix / 2; b.x -= dx * fix / 2; b.y -= dy * fix / 2; }
        }
      }
      s.rope.setAttribute('d', smoothPath(s.pts));

      // 收场淡出
      if (s.ending) {
        s.endT += dt;
        s.layer.setAttribute('opacity', Math.max(0, 1 - s.endT / 0.45));
        if (s.endT >= 0.45) { finish(); return; }
      }
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!s.done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆（窗口被判定遮挡等）时的推进兜底：位移全按墙钟结算，重复调用无害
    s.watchdog = setInterval(() => {
      if (s.done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);
    return s;
  }

  registerOvFx('kite', (data) => {
    if (data && data.end) { if (S) S.ending = true; return; }
    if (S) {
      // 后续调用 = 锚点/阶段更新（节流上报，不重开一场）
      if (typeof data.x === 'number') S.tx = data.x + (data.hx || 0) * ovlK;
      if (typeof data.y === 'number') S.ty = data.y + (data.hy || 0) * ovlK;
      if (data.phase && data.phase !== S.phase) {
        S.phase = data.phase;
        if (S.phase === 'reel') S.reelT = 0;
      }
      return;
    }
    S = createSession(data || {});
  });
})();
