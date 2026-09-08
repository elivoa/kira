// 雨伞飞天：撑伞被风带起来，像玛丽·波平斯一样沿缓和弧线飘过，再缓缓落回原高度。
// 升降 150~250px 用 moveBy 挪窗口实现（tf.ty 是窗口内偏移，跨不了屏幕上半部）；
// tf.ty 只做飞行中的轻微浮动。
(() => {
  const UMBRELLA_SRC = '../assets/umbrella.png';
  const FRONT = { normal: '../assets/pet.png', chibi: '../assets/chibi.png' };
  let F = null; // 进行中场次

  function easeIO(x) {
    x = Math.min(Math.max(x, 0), 1);
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }

  function finish(ctx) {
    if (!F) return;
    clearInterval(F.guard);
    F = null;
    ctx.swapSprite(FRONT[ctx.form] || FRONT.normal);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(4, 7);
  }

  registerAction({
    id: 'umbrellafly',
    lines: ['起风了——哇！', '风带我去哪儿？', '飞起来咯~', '啊啊好高——好好玩！'],
    effect: { jing: -2, mood: 3 },
    async start(ctx) {
      if (F) return;
      const from = ctx.state;
      F = { pending: true }; // 会话占位：await 往返期间挡住菜单连点的第二次触发
      let st, px, py;
      try {
        st = await ctx.getStage();
        [px, py] = await ctx.getPos();
      } catch { F = null; return; }
      if (ctx.state !== from) { F = null; return; } // IPC 往返期间被切走，别把她从新状态硬拽出来
      // 朝宽敞的一边飘；两边都挤就原地直上直下
      const roomR = st.maxX - px, roomL = px - st.minX;
      const dir = roomR >= roomL ? 1 : -1;
      F = {
        st, dir, x0: px, y0: py, px, py,
        rise: ctx.rand(150, 250),
        drift: Math.min(420, Math.max(0, Math.max(roomR, roomL) - 40)),
        texted: false,
      };
      // 打断看门狗：状态被切走就收掉会话并换回正面立绘——
      // 拖拽路径内核会换图，菜单/大模型切动作不会，撑伞图不能赖着
      F.guard = setInterval(() => {
        if (!F) return;
        if (ctx.state !== 'umbrellafly') {
          clearInterval(F.guard);
          F = null;
          ctx.swapSprite(FRONT[ctx.form] || FRONT.normal);
        }
      }, 400);
      ctx.say(ctx.pick(LINES.umbrellafly), 1800);
      ctx.swapSprite(UMBRELLA_SRC);
      ctx.enter('umbrellafly', ctx.rand(6, 10));
    },
    tick(state, dt, t, ctx) {
      if (state !== 'umbrellafly') return false;
      if (!F) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); return true; }
      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      const cruiseY = Math.max(F.st.minY + 30, F.y0 - F.rise);
      let nx, ny;
      if (k < 0.28) { // 起风爬升
        const e = easeIO(k / 0.28);
        nx = F.x0 + F.dir * F.drift * 0.15 * e;
        ny = F.y0 + (cruiseY - F.y0) * e;
      } else if (k < 0.7) { // 高空画一条缓和弧线飘过去
        const kk = (k - 0.28) / 0.42;
        nx = F.x0 + F.dir * F.drift * (0.15 + 0.7 * kk);
        ny = cruiseY - 26 * Math.sin(kk * Math.PI);
      } else { // 缓缓降落回原高度
        const e = easeIO((k - 0.7) / 0.3);
        nx = F.x0 + F.dir * F.drift * (0.85 + 0.15 * e);
        ny = cruiseY + (F.y0 - cruiseY) * e;
      }
      nx = Math.min(F.st.maxX, Math.max(F.st.minX, nx));
      ny = Math.min(F.st.floorY, Math.max(F.st.minY, ny));
      ctx.moveBy(nx - F.px, ny - F.py);
      F.px = nx; F.py = ny;
      // 伞面轻晃 + 身体轻微上下浮动
      ctx.tf.rot = 3 * Math.sin(ctx.stateT * 1.4);
      ctx.tf.ty = -3 * Math.sin(ctx.stateT * 2.2);
      if (!F.texted && k > 0.05) { F.texted = true; ctx.fxText('嗖——', 170, 300, 28); }
      if (k >= 1) {
        ctx.fxBurst(170, 600, 10, 8, 30); // 落地轻尘
        finish(ctx);
      }
      return true;
    },
  });
})();
