// 钓鱼：走到屏幕顶沿坐下甩竿 → 覆盖层垂鱼线等上钩（旧靴子/宝箱）→ 收杆庆祝 → 回家
(function () {
  let fish = null;
  let fishHooked = false; // fxDone 只订阅一次

  registerAction({
    id: 'fish',
    lines: ['钓鱼咯~', '愿者上钩~', '今天会钓到什么呢', '静心等鱼来~'],
    start(ctx) {
      fish = { px: 0, py: 0, tx: 0, ty: 0, hx: 0, hy: 0, fx: null, cast: false, leanT: 2.8, leaning: 0 };
      ctx.logEvent('自主', '去钓鱼');
      ctx.say(ctx.pick(LINES.fish), 1500);
      if (!fishHooked) {
        fishHooked = true;
        ctx.onFxDone((kind) => {
          if (kind !== 'fish' || ctx.state !== 'fish.wait') return;
          ctx.say(ctx.pick(['上钩啦！', '钓到啦钓到啦！', '嘿嘿，有收获~']), 1600);
          ctx.fxBurst(170, 300, 12, 12, 52);
          ctx.enter('fish.back', 0.9);
        });
      }
      Promise.all([ctx.getPos(), ctx.getStage()]).then(([[px, py], st]) => {
        if (!fish) return;
        fish.px = px; fish.py = py;
        fish.hx = px; fish.hy = py; // 记下出发位，钓完回家
        fish.tx = Math.min(Math.max(px, st.minX), st.maxX);
        fish.ty = st.minY;                     // 窗口顶贴工作区顶沿 = 坐屏幕顶
        fish.fx = { x: px + 260, y: st.minY }; // 鱼线垂在窗边（半宽按基准值估，缩放下略有偏移）
        ctx.enter('fish.go');
      }).catch(() => { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); });
    },
    tick(state, dt, t, ctx) {
      if (!fish) return false;
      if (state === 'fish.go') {
        // 斜线赶到顶沿（goledge 同款走法）
        const dx = fish.tx - fish.px, dy = fish.ty - fish.py;
        const dist = Math.hypot(dx, dy);
        const step = 340 * dt;
        if (dist <= step + 2 || ctx.stateT > 10) { // 超时直接落位，别永远赶路
          ctx.moveBy(dx, dy);
          fish.px = fish.tx; fish.py = fish.ty;
          ctx.enter('fish.cast', 0.7);
        } else {
          const mx = dx / dist * step, my = dy / dist * step;
          ctx.moveBy(mx, my);
          fish.px += mx; fish.py += my;
          if (!ctx.walkAnimAdvance(Math.hypot(mx, my))) {
            ctx.tf.ty = -Math.abs(Math.sin(ctx.stateT * 9)) * 7;
            ctx.tf.rot = Math.sin(ctx.stateT * 9) * 2.5;
          }
        }
        return true;
      }
      if (state === 'fish.cast') {
        // 甩竿：后仰蓄力 → 前倾挥出
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.rot = k < 0.4 ? -10 * (k / 0.4) : -10 + 24 * ((k - 0.4) / 0.6);
        ctx.tf.ty = 4 * Math.sin(Math.PI * k);
        if (!fish.cast && k >= 0.55 && fish.fx) {
          fish.cast = true;
          ctx.fxStart('fish', fish.fx);
        }
        if (k >= 1) ctx.enter('fish.wait');
        return true;
      }
      if (state === 'fish.wait') {
        // 坐姿等鱼：下沉 + 偶尔前倾看漂
        ctx.tf.ty = 30;
        ctx.tf.sy = 0.93;
        let rot = 2;
        fish.leanT -= dt;
        if (fish.leanT <= 0 && fish.leaning <= 0) { fish.leaning = 0.7; fish.leanT = ctx.rand(2.5, 4.5); }
        if (fish.leaning > 0) {
          rot += 13 * Math.sin(Math.PI * (1 - fish.leaning / 0.7));
          fish.leaning -= dt;
        }
        ctx.tf.rot = rot;
        // 覆盖层失联兜底：16s 没回执自己收杆（覆盖层硬超时 15s，先到为准）
        if (ctx.stateT > 16) ctx.enter('fish.back', 0.9);
        return true;
      }
      if (state === 'fish.back') {
        // 起身庆祝：两个小跳
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = 30 * (1 - k) - 34 * Math.abs(Math.sin(k * Math.PI * 2));
        ctx.tf.sy = 0.93 + 0.07 * k;
        if (k >= 1) ctx.enter('fish.home');
        return true;
      }
      if (state === 'fish.home') {
        const dx = fish.hx - fish.px, dy = fish.hy - fish.py;
        const dist = Math.hypot(dx, dy);
        const step = 460 * dt;
        if (dist <= step + 2 || ctx.stateT > 10) {
          ctx.moveBy(dx, dy);
          fish = null;
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
        } else {
          const mx = dx / dist * step, my = dy / dist * step;
          ctx.moveBy(mx, my);
          fish.px += mx; fish.py += my;
          if (!ctx.walkAnimAdvance(Math.hypot(mx, my))) {
            ctx.tf.ty = -Math.abs(Math.sin(ctx.stateT * 10)) * 8;
            ctx.tf.rot = Math.sin(ctx.stateT * 10) * 3;
          }
        }
        return true;
      }
      return false;
    },
  });
})();
