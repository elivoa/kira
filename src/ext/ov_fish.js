// 钓鱼覆盖层：顶边垂一根软绳鱼线，末端鱼钩+浮漂轻晃；等 3~6s「上钩」——
// 线猛一沉，钓起旧靴子或宝箱，晃两下后连线一起淡出，回执桌宠侧收杆
(function () {
  let fishing = false; // 防叠罗汉：重入直接回执，桌宠侧不会干等

  registerOvFx('fish', (data) => {
    if (fishing) { window.pet.fxDone('fish'); return; }
    fishing = true;
    startFish(data || {});
  });

  function textPop(parent, str, x, y, size) {
    el('text', {
      x, y, 'text-anchor': 'middle',
      'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
      'font-size': size, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 7, 'paint-order': 'stroke',
      class: 'fx-pop',
    }, parent).textContent = str;
  }

  // 旧靴子：筒 + 翘头 + 补丁，土棕色
  function makeBoot(parent) {
    const g = el('g', {}, parent);
    el('path', { d: 'M-13 -30 L1 -30 L1 -5 L9 -5 Q20 -5 20 4 Q20 12 11 12 L-7 12 Q-13 12 -13 5 Z', fill: '#96754d', stroke: '#63482a', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g);
    el('rect', { x: -13, y: 7, width: 33, height: 6, rx: 2.5, fill: '#63482a' }, g);
    el('rect', { x: -9, y: -24, width: 7, height: 9, rx: 1.5, fill: 'none', stroke: '#63482a', 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }, g);
    return g;
  }

  // 小宝箱：箱身 + 盖 + 金箍 + 锁
  function makeChest(parent) {
    const g = el('g', {}, parent);
    el('rect', { x: -20, y: -12, width: 40, height: 24, rx: 3, fill: '#a8743c', stroke: '#6b4423', 'stroke-width': 2.5 }, g);
    el('rect', { x: -22, y: -21, width: 44, height: 11, rx: 4, fill: '#c08a4e', stroke: '#6b4423', 'stroke-width': 2.5 }, g);
    el('line', { x1: -8, y1: -21, x2: -8, y2: 12, stroke: '#e8c86a', 'stroke-width': 3 }, g);
    el('line', { x1: 8, y1: -21, x2: 8, y2: 12, stroke: '#e8c86a', 'stroke-width': 3 }, g);
    el('rect', { x: -4, y: -13, width: 8, height: 9, rx: 1.5, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1.5 }, g);
    return g;
  }

  function startFish(data) {
    const K = ovlK;
    const layer = el('g', {});
    const ROPE_N = 12;
    const LEN0 = innerHeight * 0.3 + 30 + Math.random() * 60;
    let seg = LEN0 / ROPE_N;
    const ax = Math.min(Math.max(typeof data.x === 'number' ? data.x : innerWidth / 2, 90), innerWidth - 90);

    const rope = el('path', { fill: 'none', stroke: '#5a4a6a', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layer);
    el('circle', { cx: ax, cy: 2, r: 3.5, fill: '#5a4a6a' }, layer); // 顶端的结
    const hookG = el('g', {}, layer);
    el('path', { d: 'M0 0 C7 2 8 9 5 14 C2 19 -6 18 -7 11', fill: 'none', stroke: '#8a8f9e', 'stroke-width': 3, 'stroke-linecap': 'round' }, hookG);
    const bobber = el('g', {}, layer);
    el('circle', { cx: 0, cy: 0, r: 5.5 * K, fill: '#fff', stroke: '#b03a2e', 'stroke-width': 1.2 }, bobber);
    el('path', { d: `M${-5.5 * K} 0 A${5.5 * K} ${5.5 * K} 0 0 1 ${5.5 * K} 0 Z`, fill: '#e04536' }, bobber); // 上半红
    el('line', { x1: 0, y1: -10 * K, x2: 0, y2: -5.5 * K, stroke: '#b03a2e', 'stroke-width': 2 }, bobber);

    // 软绳链条：上端钉死，下端自由（climbRope 的两端钉死写法去掉下端钉点）
    const pts = Array.from({ length: ROPE_N + 1 }, (_, i) => ({ x: ax, y: seg * i, px: ax, py: seg * i }));
    let hx = ax, hy = LEN0; // 钩子位置（阻尼跟随，不跟绳子高频乱跳）
    const WAIT = 3000 + Math.random() * 3000;
    let phase = 'wait', phaseAt = 0;
    let catchG = null;
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
      fishing = false;
      window.pet.fxDone('fish');
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > WAIT + 9000) { finish(); return; } // 硬兜底：任何路径都不能让线永远垂着

      // 阶段推进全按墙钟（rAF 停摆时靠 watchdog 一样走）
      if (phase === 'wait' && ms >= WAIT) {
        phase = 'bite'; phaseAt = ms;
        for (let i = ROPE_N - 2; i <= ROPE_N; i++) pts[i].y += 26; // 猛一沉
      } else if (phase === 'bite' && ms >= phaseAt + 380) {
        phase = 'reel'; phaseAt = ms;
        catchG = (Math.random() < 0.5 ? makeBoot : makeChest)(layer);
        textPop(layer, '哎？！', hx, hy - 70, 34);
      } else if (phase === 'reel' && ms >= phaseAt + 1500) {
        phase = 'hold'; phaseAt = ms;
      } else if (phase === 'hold' && ms >= phaseAt + 800) {
        finish(); return;
      }

      // 收线：绳段缩短到 55%
      if (phase === 'reel' || phase === 'hold') {
        const target = LEN0 * 0.55 / ROPE_N;
        seg += (target - seg) * Math.min(dt * 2.2, 1);
      }

      // verlet：除顶端外重力积分 + 轻微横漂（上钩后漂得更急，线绷紧了）
      const sway = phase === 'wait' ? 10 : 26;
      for (let i = 1; i <= ROPE_N; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
        p.px = p.x; p.py = p.y;
        p.x += vx + Math.sin(now / 900 + i * 0.35) * sway * dt * (i / ROPE_N);
        p.y += vy + 1600 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        pts[0].x = ax; pts[0].y = 0;
        for (let i = 0; i < ROPE_N; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = Math.hypot(dx, dy) || 1;
          const fix = (d2 - seg) / d2;
          if (i === 0) { b.x -= dx * fix; b.y -= dy * fix; }
          else { a.x += dx * fix / 2; a.y += dy * fix / 2; b.x -= dx * fix / 2; b.y -= dy * fix / 2; }
        }
      }

      const rx = pts[ROPE_N].x, ry = pts[ROPE_N].y;
      hx += (rx - hx) * Math.min(dt * 8, 1);
      hy += (ry - hy) * Math.min(dt * 8, 1);
      rope.setAttribute('d', smoothPath(pts));
      const ang = Math.atan2(hx - pts[ROPE_N - 1].x, hy - pts[ROPE_N - 1].y) * 180 / Math.PI;
      hookG.setAttribute('transform', `translate(${hx},${hy}) rotate(${ang * 0.5}) scale(${K})`);
      bobber.setAttribute('transform', `translate(${pts[ROPE_N - 2].x},${pts[ROPE_N - 2].y})`);

      if (catchG) {
        // 收获物挂在钩子下方：刚钓上来猛晃两下，幅度渐收
        const k = Math.min((ms - phaseAt) / 1500, 1);
        const wig = phase === 'reel' ? 18 * (1 - k * 0.6) * Math.sin((ms - phaseAt) / 90) : 6 * Math.sin(now / 300);
        catchG.setAttribute('transform', `translate(${hx},${hy + 34 * K}) rotate(${wig}) scale(${K})`);
      }
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆兜底：阶段全按墙钟推进，定时器重复调用无害
    const watchdog = setInterval(() => {
      if (done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);
  }
})();
