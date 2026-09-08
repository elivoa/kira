// 放灯笼：overlay 一盏灯笼从手边升起、摇摆着飘向屏幕上方变小变远（ov_lantern.js），
// 她仰头目送。灯笼飘出顶部（6~8s）回报 fxDone('lantern') 提前收尾；10s 没收到由 tick 兜底。
(() => {
  let extCtx = null;
  let fxSeq = 0; // 会话令牌自增
  let mySeq = 0; // 当前场次的令牌

  function finish(withText) {
    const ctx = extCtx;
    if (!ctx || ctx.state !== 'lantern.watch') return;
    if (withText) ctx.fxText('飞高高~', 170, 300, 30);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'lantern',
    lines: ['放灯笼咯~', '带着愿望飞上去吧', '灯笼灯笼，飞高高~', '一路顺风呀'],
    effect: { mood: 3, shen: -1 },
    start(ctx) {
      if (!extCtx) { // 回执只订阅一次，EXT_CTX 是单例
        extCtx = ctx;
        ctx.onFxDone((kind, receiptSeq) => {
          if (kind === 'lantern' && (receiptSeq === undefined || receiptSeq === mySeq)) finish(true);
        });
      }
      mySeq = ++fxSeq;
      ctx.say(ctx.pick(LINES.lantern), 1800);
      ctx.enter('lantern.watch', 10); // 兜底时长：正常 6~8s 由 fxDone 提前收尾
      // 窗口左上角坐标给 overlay 定位手边起点；拿到时动作已结束就不放了
      ctx.getPos().then(([px, py]) => {
        if (extCtx && extCtx.state === 'lantern.watch') ctx.fxStart('lantern', { x: px, y: py, seq: mySeq });
      }).catch(() => {});
    },
    tick(state, dt, t, ctx) {
      if (state !== 'lantern.watch') return false;
      ctx.tf.rot = -5 + 1.5 * Math.sin(ctx.stateT * 1.8); // 微仰头目送
      ctx.tf.ty = -2;
      if (ctx.stateT >= ctx.stateDur) finish(false);
      return true;
    },
  });
})();
