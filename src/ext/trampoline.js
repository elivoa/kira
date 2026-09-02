// 蹦床：原地越蹦越高（3~5 次，最高约 200px），抛物线由整窗 moveBy 承担
// （跳 200px 用窗内 ty 会裁掉头顶，整窗蹦还更像蹦床）；窗内 tf 只做 squash & stretch。
// 最后一次高高跃起 + rotY 转体 360°，落地爆星收尾。不需要 overlay 特效。
let trampSt = null; // { ready, st, py, phase, hs, ds, i, t, baseY }

registerAction({
  id: 'trampoline',
  lines: ['蹦床蹦床！', '我要飞得更高~', '弹起来啦！', '看我跳到云朵上！'],
  effect: { jing: -5, mood: 4 },
  start(ctx) {
    ctx.say(ctx.pick(LINES.trampoline), 1600);
    trampSt = { ready: false };
    ctx.enter('trampoline', 12); // 12s 硬超时兜底
    Promise.all([ctx.getStage(), ctx.getPos()]).then(([st, [px, py]]) => {
      if (ctx.state !== 'trampoline' || !trampSt) return; // 初始化期间被打断，放弃
      const n = 3 + ((ctx.rand(0, 2.99)) | 0); // 3~5 跳
      const hs = [], ds = [];
      for (let i = 0; i < n; i++) {
        const h = 60 + 140 * i / (n - 1); // 每次更高，最后一跳 ~200px
        hs.push(h);
        ds.push(2 * Math.sqrt(2 * h / 2600)); // 与内置 hop 同一重力，物理感时长
      }
      trampSt = {
        ready: true, st, py,
        phase: py < st.floorY - 4 ? 'pre' : 'jump',
        hs, ds, i: 0, t: 0, baseY: st.floorY,
      };
    }).catch(() => {
      if (ctx.state === 'trampoline') { trampSt = null; ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
    });
  },
  tick(state, dt, t, ctx) {
    if (state !== 'trampoline') return false;
    const done = () => {
      trampSt = null;
      ctx.enter('idle');
      ctx.idleWait = ctx.nextIdleWait(3, 6);
    };
    if (ctx.stateT >= ctx.stateDur) { done(); return true; } // 硬超时兜底
    const R = trampSt;
    if (!R || !R.ready) return true; // IPC 初始化未回，占位等下一帧

    if (R.phase === 'pre') {
      // 不在地面先落到「蹦床面」
      ctx.tf.sy = 1.06; ctx.tf.sx = 0.96;
      const dy = R.st.floorY - R.py;
      const step = 700 * dt;
      if (dy <= step) { ctx.moveBy(0, dy); R.py = R.st.floorY; R.phase = 'jump'; R.t = 0; }
      else { ctx.moveBy(0, step); R.py += step; }
      return true;
    }

    if (R.phase === 'jump') {
      R.t += dt;
      const last = R.i === R.hs.length - 1;
      const d = R.ds[R.i], h = R.hs[R.i];
      const k = Math.min(R.t / d, 1);
      const yOff = 4 * h * k * (1 - k); // 抛物线：0 → h → 0
      const newPy = R.baseY - yOff;
      ctx.moveBy(0, newPy - R.py);
      R.py = newPy;
      // squash & stretch：起跳拉伸（k=0 → sy 1.12），下落压扁（k=1 → sy 0.88≈0.9）
      const v = 1 - 2 * k;
      ctx.tf.sy = 1 + 0.12 * v;
      ctx.tf.sx = 1 - 0.07 * v;
      if (last) ctx.tf.rotY = 360 * k; // 最后一跳边飞边转体
      if (k >= 1) {
        ctx.moveBy(0, R.baseY - R.py); // 精确落回地面
        R.py = R.baseY;
        if (last) {
          R.phase = 'land'; R.t = 0;
          ctx.fxBurst(170, 596, 10, 8, 42);
        } else {
          R.i++; R.t = 0;
          ctx.fxEl('ellipse', {
            cx: 170 + ctx.rand(-20, 20), cy: 606,
            rx: ctx.rand(6, 10), ry: ctx.rand(4, 6),
            fill: '#f0eef8', stroke: '#cfc9e0', 'stroke-width': 1,
          }, 'fx-dust');
        }
      }
      return true;
    }

    // land：落地压扁回弹一下
    R.t += dt;
    const k = Math.min(R.t / 0.35, 1);
    ctx.tf.sy = 0.88 + 0.12 * k + 0.06 * Math.sin(k * Math.PI);
    ctx.tf.sx = 1 - (ctx.tf.sy - 1) * 0.7;
    if (k >= 1) done();
    return true;
  },
});
