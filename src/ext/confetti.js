// 撒花：overlay 从屏幕顶部撒彩色纸屑（ov_confetti.js），她原地开心蹦跳。
// 纸屑撒完 overlay 回报 fxDone('confetti') 提前收尾；8s 没收到回报由 tick 兜底强制收。
(() => {
  let extCtx = null;

  function finish() {
    const ctx = extCtx;
    if (!ctx || ctx.state !== 'confetti.jump') return;
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'confetti',
    lines: ['撒花撒花~！', '今天值得庆祝！', '彩带雨来咯~', '耶！万岁~！'],
    effect: { mood: 3, jing: -1 },
    start(ctx) {
      if (!extCtx) { // 回执只订阅一次，EXT_CTX 是单例
        extCtx = ctx;
        ctx.onFxDone((kind) => { if (kind === 'confetti') finish(); });
      }
      ctx.say(ctx.pick(LINES.confetti), 1600);
      ctx.fxText('🎉', 170, 280, 40);
      ctx.fxStart('confetti');
      ctx.enter('confetti.jump', 8); // 兜底时长：正常 3~4s 由 fxDone 提前收尾
    },
    tick(state, dt, t, ctx) {
      if (state !== 'confetti.jump') return false;
      const ph = ctx.stateT * 8.5;
      ctx.tf.ty = -30 * Math.abs(Math.sin(ph)); // 原地开心蹦跳
      ctx.tf.rotY = 16 * Math.sin(ctx.stateT * 3.2);
      const sq = Math.abs(Math.cos(ph)); // 落地瞬间压扁一点，弹起来更有劲
      ctx.tf.sy = 1 - 0.05 * sq * sq;
      ctx.tf.sx = 1 + 0.04 * sq * sq;
      if (ctx.stateT >= ctx.stateDur) finish();
      return true;
    },
  });
})();
