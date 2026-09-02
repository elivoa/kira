// 放灯笼特效：一盏灯笼（圆角矩形灯身 + 上下盖 + 穗子 + 暖光晕）从她手边升起，
// 摇摆着飘向屏幕上方、变小变远，6~8s 飘出顶部回报 fxDone。rAF + watchdog 兜底（同 flySword 模式）。
(() => {
  let running = false;

  function makeLantern(layer) {
    // 暖光渐变跟着 layer 一起生死：每次特效重建，避免引用到上一轮的残留 defs
    const defs = el('defs', {}, layer);
    const grad = el('radialGradient', { id: 'lanternGlow' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#ffd9a0', 'stop-opacity': 0.85 }, grad);
    el('stop', { offset: '100%', 'stop-color': '#ffd9a0', 'stop-opacity': 0 }, grad);
    const g = el('g', {}, layer);
    const glow = el('circle', { r: 70, fill: 'url(#lanternGlow)' }, g);
    el('rect', { x: -23, y: -29, width: 46, height: 58, rx: 15, fill: '#e04536', stroke: '#a02618', 'stroke-width': 2 }, g);
    el('ellipse', { cx: 0, cy: 0, rx: 12, ry: 20, fill: 'rgba(255,190,120,.55)' }, g); // 灯芯暖光
    el('rect', { x: -14, y: -37, width: 28, height: 9, rx: 3, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1.5 }, g); // 上盖
    el('rect', { x: -14, y: 28, width: 28, height: 9, rx: 3, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1.5 }, g); // 下盖
    el('line', { x1: 0, y1: 37, x2: 0, y2: 50, stroke: '#a02618', 'stroke-width': 2 }, g);
    el('rect', { x: -3.5, y: 50, width: 7, height: 14, rx: 3, fill: '#e04536', stroke: '#a02618', 'stroke-width': 1.5 }, g); // 穗子
    return { g, glow };
  }

  registerOvFx('lantern', (data) => {
    if (running) { window.pet.fxDone('lantern'); return; } // 防叠罗汉
    running = true;
    const k = ovlK; // 灯笼随桌宠整体缩放
    const layer = el('g', {});
    const { g: lantern, glow } = makeLantern(layer);

    // 手边起点：窗口(460x740 逻辑幅) 身体中线 ±95，手的高度约在窗口上沿 0.62 处
    const px = data && typeof data.x === 'number' ? data.x : innerWidth / 2 - 230 * k;
    const py = data && typeof data.y === 'number' ? data.y : innerHeight * 0.3;
    const cx = px + 230 * k;
    const side = cx < innerWidth / 2 ? 1 : -1; // 伸朝屏幕中间的那只手
    const hx = cx + side * 95 * k;
    const hy = py + 740 * k * 0.62;

    const DUR = 6500 + Math.random() * 1500; // 6.5~8s 飘出顶部
    const t0 = performance.now();
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.remove();
      running = false;
      window.pet.fxDone('lantern');
    }

    function tick(now) {
      if (done) return;
      const ms = now - t0;
      if (ms > DUR + 2000) { finish(); return; } // 硬超时兜底
      const kk = Math.min(ms / DUR, 1);
      const e = kk * kk * (3 - 2 * kk); // smoothstep：起步慢、远去也慢
      const y = hy - (hy + 140) * e;
      if (kk >= 1) { finish(); return; }
      const x = hx + Math.sin(ms / 380) * 24 * (1 - 0.35 * kk); // 越飘越稳
      const s = 1 - 0.55 * kk; // 变小变远
      const op = kk > 0.85 ? 1 - (kk - 0.85) / 0.15 : 1;
      lantern.setAttribute('transform', `translate(${x},${y}) rotate(${4 * Math.sin(ms / 500)}) scale(${s * k})`);
      lantern.setAttribute('opacity', op);
      glow.setAttribute('opacity', 0.7 + 0.25 * Math.sin(ms / 110)); // 烛光闪烁
    }

    function frame(now) {
      try { tick(now); } catch (e2) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆时的墙钟推进兜底：位移全按墙钟结算，重复调用无害
    const watchdog = setInterval(() => {
      if (done) return;
      try { tick(performance.now()); } catch (e2) { finish(); }
    }, 400);
  });
})();
