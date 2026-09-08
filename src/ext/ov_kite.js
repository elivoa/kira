// 放风筝 overlay：Q版小 Kira（assets/chibi.png）当风筝，拴在软绳末端随绳摆动。
// 软绳与捣乱/攀爬安全绳同一套 verlet 链条 + smoothPath；巡航时两端都钉住（下端钉手部锚点、
// 上端钉 Kira 头顶挂线点）。phase: fly 盘旋 / break 断线——手上锚点释放，Kira 带着松开的
// 绳线翻滚着飘出屏幕，再整体淡出。桌宠侧每 120ms 报一次锚点（data.x/y 窗口左上 + hx/hy
// 未缩放局部偏移，乘 ovlK 得真实坐标）；data.end=true = 动作被打断，赶紧收场。
// 结束必须 fxDone('kite')，桌宠侧拿着回执才能收尾。
(() => {
  const N = 10;           // 软绳段数
  const HARD_MS = 40000;  // 硬兜底：任何路径都不能让风筝永远挂在屏幕上
  const BREAK_MS = 5500;  // 断线飘飞最长用时（正常 3s 左右就出屏）
  let S = null;           // 进行中场次

  // 组原点 = 头顶挂线点：图挂在原点正下方，旋转即绕挂点摆，像被线吊着飞
  function makeKite(layer) {
    const g = el('g', {}, layer);
    const W = 104 * ovlK;
    el('image', { href: '../assets/chibi.png', x: -W / 2, y: 0, width: W, height: W * 1125 / 1012 }, g);
    return { g };
  }

  function createSession(data) {
    const s = {
      layer: el('g', {}),
      done: false, ending: false, endT: 0,
      phase: 'fly',
      seq: data.seq, // 会话令牌：回执带上，renderer 只认当前场次
      t0: performance.now(), last: performance.now(),
      // 手部锚点：目标值（桌宠侧报的）+ 平滑值（防 120ms 上报台阶感）
      tx: (typeof data.x === 'number' ? data.x : innerWidth / 2) + (data.hx || 0) * ovlK,
      ty: (typeof data.y === 'number' ? data.y : innerHeight) + (data.hy || 0) * ovlK,
      ax: 0, ay: 0,
      kx: 0, ky: 0, pkx: 0, svx: 0,
      hcx: 0, hcy: innerHeight * (0.15 + Math.random() * 0.12),
      RX: innerWidth * 0.16, RY: innerHeight * 0.05,
      rot: 0, hang: 0,
      breakT: 0, bvx: 0, bvy: 0, tumbleV: 0, segFreeze: 3, // 断线飘飞状态（startBreak 才真正初始化）
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
      window.pet.fxDone('kite', s.seq);
    }
    s.finish = finish;

    function sparkle(x, y) {
      for (let i = 0; i < 3; i++) {
        el('circle', { cx: x + (Math.random() - 0.5) * 40, cy: y + (Math.random() - 0.5) * 30, r: 8 + Math.random() * 10, fill: 'none', stroke: '#ffe9a8', 'stroke-width': 3, class: 'fx-pop' }, s.layer);
      }
    }

    // 断线：手上锚点释放，给风筝向上/侧向初速度 + 翻滚角速度，绳长冻结在当前值
    function startBreak() {
      if (s.phase === 'break') return;
      s.phase = 'break';
      s.breakT = 0;
      const side = s.kx < innerWidth / 2 ? -1 : 1; // 朝近的一侧飘，早点出屏
      s.bvx = side * (150 + Math.random() * 110) + s.svx * 0.35;
      s.bvy = -(230 + Math.random() * 90);
      s.tumbleV = (Math.random() < 0.5 ? -1 : 1) * (130 + Math.random() * 110);
      const dist = Math.hypot(s.kx - s.ax, s.ky - s.ay);
      s.segFreeze = Math.max((dist * 1.03 + 6) / N, 3);
      sparkle(s.ax, s.ay); // 线从手上滑脱的小闪光
    }
    s.startBreak = startBreak;

    function tick(now) {
      if (s.done) return;
      const dt = Math.min((now - s.last) / 1000, 0.05);
      s.last = now;
      const ms = now - s.t0;
      if (ms > HARD_MS) s.ending = true;

      s.ax += (s.tx - s.ax) * Math.min(dt * 8, 1);
      s.ay += (s.ty - s.ay) * Math.min(dt * 8, 1);

      const broken = s.phase === 'break';
      if (broken) {
        // 断线飘飞：向上/侧向漂移 + 正弦扑腾，边翻滚边渐远变小，出屏后收场
        s.breakT += dt;
        s.kx += (s.bvx + Math.sin(s.breakT * 6) * 60) * dt;
        s.ky += (s.bvy + Math.cos(s.breakT * 4.3) * 40) * dt;
        s.rot += s.tumbleV * dt;
        const scale = Math.max(0.3, 1 - s.breakT * 0.16);
        s.kite.g.setAttribute('transform', `translate(${s.kx},${s.ky}) rotate(${s.rot}) scale(${scale})`);
        if (s.kx < -180 || s.kx > innerWidth + 180 || s.ky < -220 || s.breakT * 1000 > BREAK_MS) s.ending = true;
      } else {
        // 风筝运动：起飞甩上高空 → 正弦盘旋
        if (ms < 1200) {
          const k = 1 - Math.pow(1 - ms / 1200, 3); // easeOut 爬升
          s.kx = s.ax + (s.hcx - s.ax) * k;
          s.ky = s.ay + (s.hcy - s.ay) * k;
        } else {
          const t2 = (ms - 1200) / 1000;
          s.kx = s.hcx + Math.sin(t2 * 0.45) * s.RX + Math.sin(t2 * 1.7) * 14;
          s.ky = s.hcy + Math.sin(t2 * 0.9) * s.RY + Math.sin(t2 * 2.3) * 8;
        }
        // 姿态 = 绳端方向摆角（阻尼跟随）+ 横向速度侧倾，像被线吊着飞
        s.svx += ((s.kx - s.pkx) / Math.max(dt, 0.001) - s.svx) * Math.min(dt * 4, 1);
        s.pkx = s.kx;
        const prev = s.pts ? s.pts[N - 1] : { x: s.ax, y: s.ay };
        const targetHang = Math.max(-60, Math.min(60, Math.atan2(s.kx - prev.x, -(s.ky - prev.y)) * 180 / Math.PI));
        s.hang += (targetHang - s.hang) * Math.min(dt * 6, 1);
        s.rot = Math.max(-38, Math.min(38, s.hang * 0.8 + s.svx * 0.012));
        s.kite.g.setAttribute('transform', `translate(${s.kx},${s.ky}) rotate(${s.rot})`);
      }

      // 软绳 verlet：中间点重力积分，巡航两端钉死（手 + Kira 头顶），断线后只钉风筝端
      if (!s.pts) {
        s.pts = Array.from({ length: N + 1 }, (_, i) => {
          const x = s.ax + (s.kx - s.ax) * i / N, y = s.ay + (s.ky - s.ay) * i / N;
          return { x, y, px: x, py: y };
        });
      }
      const dist = Math.hypot(s.kx - s.ax, s.ky - s.ay);
      const seg = broken ? s.segFreeze : Math.max((dist * 1.03 + 6) / N, 3); // 比直线略长，垂一点自然弧度
      for (let i = broken ? 0 : 1; i < N; i++) {
        const p = s.pts[i];
        const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + 1000 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        if (!broken) { s.pts[0].x = s.ax; s.pts[0].y = s.ay; }
        s.pts[N].x = s.kx; s.pts[N].y = s.ky;
        for (let i = 0; i < N; i++) {
          const a = s.pts[i], b = s.pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.hypot(dx, dy) || 1;
          const fix = (d2 - seg) / d2;
          // 钉死的端点不动：巡航时手上端点钉死，断线后它变自由点（对半分）
          if (i === 0 && !broken) { b.x -= dx * fix; b.y -= dy * fix; }
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
    if (data.phase === 'break') startBreak(); // 覆盖层中途重载：直接进断线飘飞收尾
    return s;
  }

  registerOvFx('kite', (data) => {
    if (data && data.end) {
      // 动作被打断：收当前场次；带 seq 时只认同场次（防旧会话的 end 误杀新会话）
      if (S && (data.seq === undefined || data.seq === S.seq)) S.ending = true;
      return;
    }
    if (S && data && data.seq !== undefined && data.seq !== S.seq) S.finish(); // 新会话：拆旧开新
    if (S) {
      // 后续调用 = 锚点/阶段更新（节流上报，不重开一场）
      if (typeof data.x === 'number') S.tx = data.x + (data.hx || 0) * ovlK;
      if (typeof data.y === 'number') S.ty = data.y + (data.hy || 0) * ovlK;
      if (data.phase === 'break') S.startBreak();
      return;
    }
    S = createSession(data || {});
  });
})();
