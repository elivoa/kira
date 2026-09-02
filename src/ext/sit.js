// 坐下陪你：走到光标附近 150~250px 处坐下，陪你 8~15s，偶尔歪头或嘟囔一句，然后起身收尾。
// 光标只在开场读一次（坐哪儿是开场定的），全程纯 tick 驱动，没有任何计时器要清理；
// 立绘始终是走路帧（enter 会兜底换回）或正面图，外部切走也无残留。
(function () {
  const FRONT = { normal: '../assets/pet.png', chibi: '../assets/chibi.png' };
  const SPEED = { normal: 125, chibi: 160 }; // normal 受走路帧切帧节奏约束

  let sess = null;

  function finish(ctx) {
    sess = null;
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
    if (Math.random() < 0.6) ctx.say(ctx.pick(['不打扰你啦~', '我去别处玩咯', '你自己忙，我撤啦~']), 1600);
  }

  registerAction({
    id: 'sit',
    lines: ['我坐这儿陪你', '你忙你的，我看看就好', '陪你一会儿~', '嘘——安静陪你', '坐着陪你，不捣乱'],
    effect: { jing: 2, mood: 2 },
    start(ctx) {
      if (!FRONT[ctx.form]) { // 法宝/背对形态没有合适的坐姿图，降级为一句台词
        ctx.say('这个样子坐不下呀…', 1500);
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(2, 4);
        return;
      }
      sess = {
        tx: 0, ty: 0, px: 0, py: 0, cx: 0, ready: false, // ready 前坐标全是占位值，不能判到达
        sitDur: ctx.rand(8, 15),
        lineT: ctx.rand(3, 4.5),
        tiltNext: ctx.rand(2.5, 4), tiltDir: 1,
      };
      Promise.all([ctx.getCursor(), ctx.getPos(), ctx.getStage()]).then(([c, p, st]) => {
        if (!sess) return;
        const winW = window.innerWidth; // 渲染窗口宽 = 主进程 winW()，比写死 460 耐整体缩放
        const herCX = p[0] + winW / 2;
        const gap = ctx.rand(150, 250);
        // 先挑近的一侧坐；那一侧出界了再换边
        let side = Math.abs(herCX - (c.x - gap)) <= Math.abs(herCX - (c.x + gap)) ? -1 : 1;
        let tx = c.x + side * gap - winW / 2;
        if (tx < st.minX || tx > st.maxX) { side = -side; tx = c.x + side * gap - winW / 2; }
        sess.tx = Math.min(Math.max(tx, st.minX), st.maxX);
        sess.ty = st.floorY;
        sess.px = p[0]; sess.py = p[1];
        sess.cx = c.x;
        sess.ready = true;
      }).catch(() => {});
      ctx.say(ctx.pick(LINES.sit), 1600);
      ctx.logEvent('自主', '走过去坐下陪你');
      ctx.enter('sit.go', 30); // 走路兜底时长，正常到达即切坐
    },
    tick(state, dt, t, ctx) {
      if (!String(state).startsWith('sit.')) return false;
      const s = sess;
      if (!s) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return true; }

      if (state === 'sit.go') {
        if (!s.ready) { // 坐标还没拿到：原地呼吸等数据；IPC 挂了就安静收尾
          ctx.tf.sy = 1 + 0.015 * Math.sin(t * 2.2);
          if (ctx.stateT >= ctx.stateDur) finish(ctx);
          return true;
        }
        const dx = s.tx - s.px, dy = s.ty - s.py;
        const dist = Math.hypot(dx, dy);
        if (dist < 8 || ctx.stateT >= ctx.stateDur) {
          ctx.swapSprite(FRONT[ctx.form]); // 走路帧换不回正面图（走路帧兜底只对 enter 生效，这里手动换）
          ctx.enter('sit.down', s.sitDur);
          return true;
        }
        const sp = SPEED[ctx.form] || 140;
        const step = Math.min(dist, sp * dt);
        const mx = dx / dist * step, my = dy / dist * step;
        ctx.moveBy(mx, my);
        s.px += mx; s.py += my;
        if (!ctx.walkAnimAdvance(mx)) {
          // 没走路帧素材的形态：保持旧的颠簸 + 前倾
          const ph = t * 9;
          ctx.tf.ty = -Math.abs(Math.sin(ph)) * 6;
          ctx.tf.rot = Math.sin(ph) * 2.5 + Math.sign(mx) * 3;
        }
        if (mx) ctx.tf.sx = mx < 0 ? 1 : -1; // 走路帧朝左，右走整图镜像
        return true;
      }

      if (state === 'sit.down') {
        const settle = Math.min(ctx.stateT / 0.45, 1); // 0.45s 蹲下去
        ctx.tf.sy = 1 - 0.14 * settle + 0.012 * Math.sin(t * 2.1) * settle;
        // 面向光标（锚定底部居中，压扁不会浮空）
        ctx.tf.sx = (1 + 0.07 * settle) * (s.cx >= s.px + window.innerWidth / 2 ? -1 : 1);
        // 偶尔歪头一秒
        if (ctx.stateT > s.tiltNext && ctx.stateT < s.tiltNext + 1.1) ctx.tf.rot = 6 * s.tiltDir;
        else if (ctx.stateT >= s.tiltNext + 1.1) {
          s.tiltNext = ctx.stateT + ctx.rand(3, 6);
          s.tiltDir = Math.random() < 0.5 ? -1 : 1;
        }
        // 偶尔嘟囔一句
        s.lineT -= dt;
        if (s.lineT <= 0) {
          ctx.say(ctx.pick(LINES.sit), 1800);
          s.lineT = ctx.rand(4, 6.5);
        }
        if (ctx.stateT >= ctx.stateDur) ctx.enter('sit.up', 0.55);
        return true;
      }

      // sit.up：起身回弹，然后回待机
      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      ctx.tf.sy = 0.86 + 0.14 * k + 0.02 * Math.sin(k * Math.PI);
      ctx.tf.sx = 1.07 - 0.07 * k;
      if (ctx.stateT >= ctx.stateDur) finish(ctx);
      return true;
    },
  });
})();
