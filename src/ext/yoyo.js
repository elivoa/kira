// 溜溜球（normal/chibi）：overlay 画软绳+溜溜球（见 ov_yoyo.js），renderer 侧负责报手心坐标和节奏。
// 起：fxStart('yoyo', {x,y 手心屏幕坐标})；过程中每 0.1s 重复发更新（窗口可能被拖走）；
// 收：fxStart('yoyo', {done:true}) → overlay 淡出后 fxDone 回执，这里等回执再回待机。
(function () {
  const MY_LINES = ['溜溜球，出发！', '看我的绝招~', '睡眠——再上挑！', '悠悠地转呀转'];
  let yo = null;      // { iv, receipt } 进行中的会话
  let yoCtx = null;   // 会话期间的 ctx（回执/看门狗回调里用）
  let hooked = false; // onFxDone 每调一次就多挂一个 IPC 监听，只许挂一次

  // ctx 拿不到窗口缩放系数，手心屏幕坐标改用 sprite 的 CSS 盒 + 窗口位置换算
  function sendHand(ctx) {
    const sp = document.getElementById('sprite');
    if (!sp || !yo) return;
    const r = sp.getBoundingClientRect();
    ctx.getPos().then(([px, py]) => {
      if (!yo) return;
      ctx.fxStart('yoyo', {
        x: Math.round(px + r.left + r.width * 0.82),
        y: Math.round(py + r.top + r.height * 0.52),
      });
    }).catch(() => {});
  }

  function cleanup(sendDone) {
    if (!yo) return;
    clearInterval(yo.iv);
    if (sendDone && yoCtx) yoCtx.fxStart('yoyo', { done: true });
    yo = null;
  }

  registerAction({
    id: 'yoyo',
    lines: MY_LINES,
    effect: { jing: -3, mood: 3 },
    start(ctx) {
      yoCtx = ctx;
      if (!hooked) {
        hooked = true;
        ctx.onFxDone((kind) => { if (kind === 'yoyo' && yo) yo.receipt = true; });
      }
      cleanup(true); // 防上次残留：旧 overlay 会话还在的话一并收掉
      ctx.say(ctx.pick(MY_LINES), 1500);
      ctx.enter('yoyo.play', ctx.rand(6, 8));
      yo = { receipt: false, iv: null };
      sendHand(ctx);
      // 心跳：报手心坐标 + 打断看门狗（tick 在 built-in 状态下不会被调到，只能靠它兜底）
      yo.iv = setInterval(() => {
        if (!yo) return;
        if (!String(ctx.state).startsWith('yoyo.')) { cleanup(true); return; }
        if (ctx.state === 'yoyo.play') sendHand(ctx);
      }, 100);
    },
    tick(state, dt, t, ctx) {
      if (state === 'yoyo.play') {
        if (!yo) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); return true; }
        // 身体随收放节奏小幅起伏（与 overlay 绳长正弦大致同频）
        const ph = ctx.stateT / ctx.stateDur * 3.5 * Math.PI * 2;
        ctx.tf.rot = 4 * Math.sin(ph);
        ctx.tf.ty = -3 * Math.abs(Math.sin(ph));
        if (ctx.stateT >= ctx.stateDur) {
          ctx.fxStart('yoyo', { done: true });
          ctx.enter('yoyo.wait');
        }
        return true;
      }
      if (state === 'yoyo.wait') {
        if (!yo || yo.receipt) { // 回执到了
          cleanup(false);
          ctx.say(ctx.pick(['收！', '完美收官~']), 1200);
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
          return true;
        }
        if (ctx.stateT > 30) { // 覆盖层失联兜底，绝不傻等
          cleanup(true);
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
          return true;
        }
        return true;
      }
      return false;
    },
  });
})();
