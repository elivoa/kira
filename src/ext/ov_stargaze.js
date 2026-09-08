// 数星星 overlay：屏幕上半部撒 20~40 颗星星（小圆点/十字星），opacity 正弦错相位闪烁；
// 偶尔一颗流星（userSpaceOnUse 渐变短线，头亮尾透明）快速斜落。
// 桌宠侧 fxStart('stargaze', {phase:'start'}) 开场、{phase:'end'} 收场（淡出后 fxDone）。
(() => {
  const HARD_MS = 25000; // 硬兜底：桌宠侧最长 12+5s，超此必收
  let G = null;          // 进行中场次

  function ensureMeteorGrad(layer) {
    if (document.getElementById('sgMeteorGrad')) return;
    const defs = el('defs', {}, layer);
    const g = el('linearGradient', { id: 'sgMeteorGrad', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0 }, g);
    el('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': 1 }, g);
  }

  function createSession(data) {
    const s = {
      layer: el('g', {}),
      done: false, ending: false, endT: 0,
      seq: data.seq, // 会话令牌：回执带上，renderer 只认当前场次
      t0: performance.now(), last: performance.now(),
      stars: [], meteor: null, meteorT: 1.5 + Math.random() * 1.5,
    };
    ensureMeteorGrad(s.layer);
    // 撒星星：小圆点为主，掺一些十字星
    const n = 20 + Math.floor(Math.random() * 21);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * innerWidth;
      const y = innerHeight * (0.04 + Math.random() * 0.46);
      let e;
      if (Math.random() < 0.3) {
        const L = 2.5 + Math.random() * 2;
        e = el('path', {
          d: `M${-L},0 H${L} M0,${-L} V${L}`,
          stroke: Math.random() < 0.5 ? '#fff' : '#ffe9a8', 'stroke-width': 1.3, 'stroke-linecap': 'round',
          transform: `translate(${x},${y})`,
        }, s.layer);
      } else {
        e = el('circle', {
          cx: x, cy: y, r: 1 + Math.random() * 1.5,
          fill: ['#fff', '#ffe9a8', '#dfe8ff'][(Math.random() * 3) | 0],
        }, s.layer);
      }
      s.stars.push({ e, base: 0.55 + Math.random() * 0.45, speed: 1.2 + Math.random() * 1.8, phase: Math.random() * 6.28 });
    }

    function finish() {
      if (s.done) return;
      s.done = true;
      clearInterval(s.watchdog);
      s.layer.remove();
      if (G === s) G = null;
      window.pet.fxDone('stargaze', s.seq);
    }
    s.finish = finish;

    function spawnMeteor() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const a = (25 + Math.random() * 15) * Math.PI / 180;
      const speed = 900 + Math.random() * 500;
      s.meteor = {
        x: innerWidth * (0.15 + Math.random() * 0.7),
        y: innerHeight * (0.05 + Math.random() * 0.2),
        vx: dir * Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0, max: 0.7 + Math.random() * 0.2,
        len: 120 + Math.random() * 60,
        line: el('line', { stroke: 'url(#sgMeteorGrad)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, s.layer),
        head: el('circle', { r: 2.2, fill: '#fff' }, s.layer),
      };
    }

    function tick(now) {
      if (s.done) return;
      const dt = Math.min((now - s.last) / 1000, 0.05);
      s.last = now;
      const ms = now - s.t0;
      if (ms > HARD_MS) s.ending = true;
      const t2 = ms / 1000;

      for (const st of s.stars) {
        st.e.setAttribute('opacity', st.base * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t2 * st.speed + st.phase))));
      }

      // 流星：一次只划一颗，死了才排下一颗（渐变是共享的，避免互相覆盖）
      if (!s.meteor && !s.ending) {
        s.meteorT -= dt;
        if (s.meteorT <= 0) spawnMeteor();
      }
      if (s.meteor) {
        const m = s.meteor;
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx2 = m.x - m.vx / sp * m.len, ty2 = m.y - m.vy / sp * m.len;
        m.line.setAttribute('x1', tx2); m.line.setAttribute('y1', ty2);
        m.line.setAttribute('x2', m.x); m.line.setAttribute('y2', m.y);
        // 渐变跟着流星走：尾透明 → 头亮
        const grad = document.getElementById('sgMeteorGrad');
        grad.setAttribute('x1', tx2); grad.setAttribute('y1', ty2);
        grad.setAttribute('x2', m.x); grad.setAttribute('y2', m.y);
        m.head.setAttribute('cx', m.x); m.head.setAttribute('cy', m.y);
        const fadeIn = Math.min(m.life / 0.08, 1);
        const fadeOut = Math.max(0, 1 - Math.max(0, m.life - m.max * 0.6) / (m.max * 0.4));
        m.line.setAttribute('opacity', fadeIn * fadeOut);
        m.head.setAttribute('opacity', fadeIn * fadeOut);
        if (m.life >= m.max) {
          m.line.remove(); m.head.remove();
          s.meteor = null;
          s.meteorT = 1.8 + Math.random() * 2.7;
        }
      }

      // 开场淡入 / 收场淡出
      let op = Math.min(ms / 800, 1);
      if (s.ending) {
        s.endT += dt;
        op *= Math.max(0, 1 - s.endT / 1.0);
        if (s.endT >= 1.0) { finish(); return; }
      }
      s.layer.setAttribute('opacity', op);
    }

    function frame(now) {
      try { tick(now); } catch (e) { finish(); return; }
      if (!s.done) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF 停摆兜底：推进全按墙钟结算，重复调用无害
    s.watchdog = setInterval(() => {
      if (s.done) return;
      try { tick(performance.now()); } catch (e) { finish(); }
    }, 400);
    return s;
  }

  registerOvFx('stargaze', (data) => {
    if (data && data.phase === 'end') {
      // 收场信号：带 seq 时只认同场次（防旧会话的 end 误收新场次）
      if (G && (data.seq === undefined || data.seq === G.seq)) G.ending = true;
      return;
    }
    if (G && data && data.seq !== undefined && data.seq !== G.seq) G.finish(); // 新会话：拆旧开新
    if (G) return; // 防叠罗汉：同场次重复开场忽略
    G = createSession(data || {});
  });
})();
