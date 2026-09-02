// 伸懒腰：原地一个大大的懒腰（下蹲蓄力 → 向上拉伸微颤 → 阻尼回弹），3~4s 收尾。
// 姐姐形态换 sleep3 伸手图；chibi 没有伸手素材，直接拿原图做同一套拉伸变换（降级，不换图）。
// 换过图就要兜所有异常出口：看门狗 interval 在状态被外部切走时把立绘换回来。
(function () {
  const STRETCH_SRC = '../assets/sleep3.png';
  const FRONT_SRC = '../assets/pet.png';
  new Image().src = STRETCH_SRC; // 预加载，换图不闪

  let sess = null;

  function cleanup() {
    if (sess && sess.wd) clearInterval(sess.wd);
    sess = null;
  }

  function done(ctx, early) {
    const s = sess;
    cleanup();
    if (!s) return;
    if (s.swapped) ctx.swapSprite(FRONT_SRC);
    if (!early && Math.random() < 0.5) ctx.say(ctx.pick(['好舒服~', '精神多了！']), 1500);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'stretch',
    lines: ['嗯——伸个懒腰！', '哈——好舒服~', '活动一下筋骨', '懒腰万岁！', '呜嗯——！'],
    effect: { jing: 2, mood: 2 },
    start(ctx) {
      cleanup(); // 重入保险
      if (ctx.form !== 'normal' && ctx.form !== 'chibi') { // 法宝/背对形态降级为一句台词
        ctx.say('这个样子伸不开呀…', 1500);
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(2, 4);
        return;
      }
      sess = { swapped: ctx.form === 'normal', startInteract: ctx.lastInteract, wd: null };
      if (sess.swapped) ctx.swapSprite(STRETCH_SRC);
      ctx.say(ctx.pick(LINES.stretch), 1800);
      ctx.fxText('哈——', 170, 230, 30);
      ctx.logEvent('自主', '原地伸了个大大的懒腰');
      ctx.enter('stretch.do', ctx.rand(3, 3.8));
      if (sess.swapped) {
        // 看门狗：状态被外部切走（拖拽/菜单/大模型抢占）时换回正面图，防止伸手图粘在身上
        sess.wd = setInterval(() => {
          if (!sess) return;
          if (ctx.state !== 'stretch.do') { ctx.swapSprite(FRONT_SRC); cleanup(); }
        }, 200);
      }
    },
    tick(state, dt, t, ctx) {
      if (state !== 'stretch.do') return false;
      const s = sess;
      if (!s) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return true; }
      if (ctx.lastInteract > s.startInteract + 0.01) { done(ctx, true); return true; } // 被戳就缩回来

      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      // 0~15% 下蹲蓄力 → 15~60% 向上拉伸（顶端微颤）→ 60~100% 阻尼回弹
      if (k < 0.15) {
        const a = k / 0.15;
        ctx.tf.sy = 1 - 0.07 * a;
        ctx.tf.sx = 1 + 0.05 * a;
      } else if (k < 0.6) {
        const a = (k - 0.15) / 0.45;
        const e = a * a * (3 - 2 * a); // smoothstep，顶端停得住
        ctx.tf.sy = 0.93 + 0.15 * e + 0.004 * Math.sin(t * 30) * e; // 峰值 sy=1.08，带微颤
        ctx.tf.sx = 1.05 - 0.09 * e;
        ctx.tf.ty = -8 * e;
        ctx.tf.rot = 1.5 * Math.sin(t * 3) * e;
      } else {
        const a = (k - 0.6) / 0.4;
        const r = 1 - a;
        ctx.tf.sy = 1 + 0.08 * r * Math.cos(a * 3.5); // 阻尼震荡收回 1
        ctx.tf.sx = 1 - 0.04 * r * Math.cos(a * 3.5);
        ctx.tf.ty = -8 * r;
      }
      if (ctx.stateT >= ctx.stateDur) done(ctx, false);
      return true;
    },
  });
})();
