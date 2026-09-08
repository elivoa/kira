// 走钢丝（overlay 侧）：两个高点之间拉一条微垂的钢丝（两端钉死 + smoothPath 画软绳）。
// 绳形用解析抛物线——和 renderer 侧她的脚底路径是同一条曲线，脚下零失配；
// 中段叠一点微颤显软，两端钉死不动。hold 到 mount+dur（她走到对岸）后淡出，fxDone 回报。
(() => {
  let cur = null; // 当前场次 { finish }：此前完全没有场次守卫，重开直接叠罗汉

  registerOvFx('tightrope', (data) => {
    if (!data || typeof data.x !== 'number' || typeof data.dx !== 'number') {
      window.pet.fxDone('tightrope', data && data.seq);
      return;
    }
    if (cur) cur.finish(); // 拆旧开新：旧绳立即撤，别两根钢丝挂屏上
    cur = show(data);
  });

  function show(data) {
    const x0 = data.x, y0 = data.y, x1 = data.x + data.dx;
    const sag = data.sag || 36;
    const hold = (data.mount || 1) + (data.dur || 10); // 她上绳 + 走绳的总时长（秒）
    const seq = data.seq; // 会话令牌：回执带上
    const N = 22;

    const layer = el('g', {});
    const rope = el('path', { fill: 'none', stroke: '#8a93a8', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, layer);
    const core = el('path', { fill: 'none', stroke: '#d7deee', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: 0.8 }, layer);
    const knotA = el('circle', { r: 4, fill: '#6a7288' }, layer);
    const knotB = el('circle', { r: 4, fill: '#6a7288' }, layer);
    layer.setAttribute('opacity', 0);

    let done = false;
    const t0 = performance.now();

    // 绳上 u 处：抛物线垂度 + 中段微颤；drawU 是拉绳进度（从起点钉到另一端）
    function ropePts(now, drawU) {
      const pts = [];
      const n = Math.max(2, Math.round(N * drawU));
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * drawU;
        const mid = 4 * u * (1 - u);
        pts.push({
          x: x0 + (x1 - x0) * u,
          y: y0 + sag * mid + 2.2 * Math.sin(now / 260 + u * 9) * mid,
        });
      }
      return pts;
    }

    function tickOv(now) {
      if (done) return;
      const ms = now - t0;
      // 硬兜底：特效绝不能赖在屏上
      if (ms > (hold + 6) * 1000) { finish(); return; }
      const drawU = Math.min(ms / 600, 1); // 0.6s 从一端拉到另一端
      const d = smoothPath(ropePts(now, drawU));
      rope.setAttribute('d', d);
      core.setAttribute('d', d);
      knotA.setAttribute('cx', x0); knotA.setAttribute('cy', y0);
      const tipMid = 4 * drawU * (1 - drawU);
      knotB.setAttribute('cx', x0 + (x1 - x0) * drawU);
      knotB.setAttribute('cy', y0 + sag * tipMid);
      // 她到岸后淡出
      if (ms > hold * 1000) {
        const k = Math.min((ms - hold * 1000) / 800, 1);
        layer.setAttribute('opacity', 1 - k);
        if (k >= 1) { finish(); return; }
      } else {
        layer.setAttribute('opacity', Math.min(ms / 300, 1));
      }
    }

    // 收尾只走一次
    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.remove();
      if (cur === self) cur = null;
      window.pet.fxDone('tightrope', seq);
    }

    function frame(now) {
      try { tickOv(now); } catch (e) { finish(); return; }
      if (!done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆兜底：墙钟推进，重复调用无害（flySword 同款）
    const watchdog = setInterval(() => {
      if (done) return;
      try { tickOv(performance.now()); } catch (e) { finish(); }
    }, 400);

    const self = { finish };
    return self;
  }
})();
