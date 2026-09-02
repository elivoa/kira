// 打伞散步：换撑伞图慢悠悠走一个来回（伞图自带人物，不用走路帧），
// 伞面轻微左右晃（rot ±3°），到点换回正面图收尾。
(() => {
  const UMBRELLA_SRC = '../assets/umbrella.png';
  const FRONT = { normal: '../assets/pet.png', chibi: '../assets/chibi.png' };
  let W = null; // 进行中场次

  function finish(ctx) {
    if (!W) return;
    clearInterval(W.guard);
    W = null;
    ctx.swapSprite(FRONT[ctx.form] || FRONT.normal);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'umbrellawalk',
    lines: ['撑把小伞散散步~', '嗒、嗒、嗒……', '慢慢走，不着急', '伞上有星星哦'],
    effect: { mood: 2 },
    async start(ctx) {
      if (W) return;
      let st, px;
      try {
        st = await ctx.getStage();
        [px] = await ctx.getPos();
      } catch { return; }
      // 朝宽敞的一边溜达，最远 260px；贴边太近就少走点
      const roomR = st.maxX - px, roomL = px - st.minX;
      const dir = roomR >= roomL ? 1 : -1;
      const dist = Math.min(260, Math.max(60, (dir > 0 ? roomR : roomL) - 30));
      W = { st, dir, x0: px, px, target: px + dir * dist, phase: 'go' };
      // 打断看门狗：状态被切走（拖走/菜单换动作）就收掉会话；
      // 立绘不在这里恢复——拖拽会自己换回正面图，菜单换动作与内置动作同 flaw（飞图残留同类）
      W.guard = setInterval(() => {
        if (W && ctx.state !== 'umbrellawalk') { clearInterval(W.guard); W = null; }
      }, 400);
      ctx.say(ctx.pick(LINES.umbrellawalk), 1800);
      ctx.swapSprite(UMBRELLA_SRC);
      ctx.enter('umbrellawalk', ctx.rand(8, 12));
    },
    tick(state, dt, t, ctx) {
      if (state !== 'umbrellawalk') return false;
      if (!W) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); return true; }
      const T = ctx.stateDur;
      if (W.phase === 'go' || W.phase === 'back') {
        const aim = W.phase === 'go' ? W.target : W.x0;
        const dx = aim - W.px;
        const step = 80 * dt; // 慢悠悠 80px/s
        const mx = Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
        ctx.moveBy(mx, 0);
        W.px = Math.min(W.st.maxX, Math.max(W.st.minX, W.px + mx));
        if (W.phase === 'go' && (W.px === W.target || ctx.stateT > T * 0.45)) W.phase = 'back';
        else if (W.phase === 'back' && (Math.abs(W.x0 - W.px) < 1 || ctx.stateT > T * 0.88)) W.phase = 'rest';
      }
      // 轻微上下浮动模拟步伐 + 伞面左右晃；rest 时只剩呼吸般的轻晃
      const k = W.phase === 'rest' ? 0.4 : 1;
      ctx.tf.ty = -2.5 * k * Math.abs(Math.sin(ctx.stateT * 5.5));
      ctx.tf.rot = 3 * k * Math.sin(ctx.stateT * 1.6);
      if (ctx.stateT >= T) finish(ctx);
      return true;
    },
  });
})();
