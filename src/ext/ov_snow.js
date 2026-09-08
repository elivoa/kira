// 下雪特效：30~50 片雪花（❄ 字 + 六角小点）缓缓飘落，开场即铺满屏幕；
// 8~12s 后雪停（不再补充新雪），余雪 2s 淡出后回报 fxDone。rAF + watchdog 兜底（同 flySword 模式）。
(() => {
  let cur = null; // 当前场次 { finish }

  function hexPoints(r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 2;
      pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  registerOvFx('snow', (data) => {
    if (cur) cur.finish(); // 拆旧开新：重开特效比新场次干等旧场次淡出体验好
    cur = startSnow(data && data.seq);
  });

  function startSnow(seq) {
    const layer = el('g', {});
    const N = 30 + ((Math.random() * 21) | 0);
    const flakes = [];
    for (let i = 0; i < N; i++) {
      let e;
      if (Math.random() < 0.45) {
        e = el('text', {
          'font-size': 10 + Math.random() * 10, fill: '#fff',
          opacity: 0.8 + Math.random() * 0.2, 'text-anchor': 'middle',
        }, layer);
        e.textContent = '❄';
      } else {
        e = el('polygon', {
          points: hexPoints(2.5 + Math.random() * 3), fill: '#eef4ff',
          opacity: 0.75 + Math.random() * 0.25,
        }, layer);
      }
      const f = {
        e,
        x0: Math.random() * innerWidth,
        y: -30 - Math.random() * (innerHeight + 60), // 铺满全屏，不从顶上慢慢长出来
        vy: 45 + Math.random() * 50,
        swayA: 15 + Math.random() * 30,
        swayW: 0.5 + Math.random() * 0.9,
        phase: Math.random() * 6.28,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 60,
      };
      e.setAttribute('transform', `translate(${f.x0},${f.y})`);
      flakes.push(f);
    }
    const DUR = 8000 + Math.random() * 4000; // 8~12s 下雪
    const FADE = 2000;
    const t0 = performance.now();
    let last = t0;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      layer.remove();
      if (cur === self) cur = null;
      window.pet.fxDone('snow', seq);
    }

    function tick(now) {
      if (done) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      const ms = now - t0;
      if (ms > DUR + FADE + 4000) { finish(); return; } // 硬超时兜底
      // 雪停后整体淡出，余雪落完前慢慢消失
      layer.setAttribute('opacity', ms > DUR ? Math.max(0, 1 - (ms - DUR) / FADE) : 1);
      if (ms > DUR + FADE) { finish(); return; }
      for (const f of flakes) {
        if (!f.e.isConnected) continue;
        f.y += f.vy * dt;
        if (f.y > innerHeight + 24) {
          if (ms < DUR) { // 雪中：落出屏幕就从头再来一片
            f.y = -20 - Math.random() * 60;
            f.x0 = Math.random() * innerWidth;
          } else { // 雪停：落完就不再补充
            f.e.remove();
            continue;
          }
        }
        f.rot += f.vr * dt;
        const x = f.x0 + Math.sin(ms / 1000 * f.swayW * 6.28 + f.phase) * f.swayA;
        f.e.setAttribute('transform', `translate(${x},${f.y}) rotate(${f.rot})`);
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

    const self = { finish };
    return self;
  }
})();
