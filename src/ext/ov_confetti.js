// 撒花特效：40~80 个彩色小矩形/圆点从屏幕顶部撒下，旋转 + 左右摇摆下落，
// 落出屏幕移除；3~4s 收场回报 fxDone。rAF + watchdog 兜底（同 flySword 模式）。
(() => {
  let running = false;

  registerOvFx('confetti', () => {
    if (running) { window.pet.fxDone('confetti'); return; } // 防叠罗汉
    running = true;
    const layer = el('g', {});
    const N = 40 + ((Math.random() * 41) | 0);
    const pieces = [];
    for (let i = 0; i < N; i++) {
      const w = 6 + Math.random() * 8;
      const fill = `hsl(${(Math.random() * 360) | 0},92%,62%)`;
      const e = Math.random() < 0.35
        ? el('circle', { r: w / 2, fill }, layer)
        : el('rect', { x: -w / 2, y: -w * 0.32, width: w, height: w * 0.64, rx: 1.5, fill }, layer);
      const p = {
        e, dead: false,
        x0: Math.random() * innerWidth,
        y: -30 - Math.random() * 140,
        delay: Math.random() * 700,
        vy: 300 + Math.random() * 180,
        swayA: 20 + Math.random() * 46,
        swayW: 1.6 + Math.random() * 2.4,
        phase: Math.random() * 6.28,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 720,
      };
      e.setAttribute('transform', `translate(${p.x0},${p.y})`);
      pieces.push(p);
    }
    const DUR = 3000 + Math.random() * 1000; // 3~4s
    const t0 = performance.now();
    let last = t0;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.remove();
      running = false;
      window.pet.fxDone('confetti');
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > DUR + 600) { finish(); return; } // 硬超时兜底
      // 到点整体淡出，还在半路的纸屑一起带走
      layer.setAttribute('opacity', ms > DUR ? Math.max(0, 1 - (ms - DUR) / 600) : 1);
      for (const p of pieces) {
        if (p.dead) continue;
        const age = ms - p.delay;
        if (age < 0) continue;
        p.y += p.vy * dt;
        if (p.y > innerHeight + 40) { p.dead = true; p.e.remove(); continue; } // 落出屏幕移除
        p.rot += p.vr * dt;
        const x = p.x0 + Math.sin(age / 1000 * p.swayW * 6.28 + p.phase) * p.swayA;
        p.e.setAttribute('transform', `translate(${x},${p.y}) rotate(${p.rot})`);
      }
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
  });
})();
