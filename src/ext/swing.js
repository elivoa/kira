// 荡秋千（Q版专属）：本体打转缩没 → 覆盖层从屏幕顶垂软绳吊木板开荡 → 收绳回执后原地弹回
// 立绘「隐藏」靠 tf 缩放 0：扩展拿不到 sprite 句柄，swordform 的 visibility 写法用不了
(function () {
  let swingFx = null;     // 起荡锚点（屏幕绝对坐标，主进程负责换算）
  let fxSeq = 0;          // 会话令牌自增
  let mySeq = 0;          // 当前场次的令牌
  let swingHooked = false; // fxDone 只订阅一次

  const easeOutBack = (k) => {
    k = Math.min(Math.max(k, 0), 1);
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
  };

  registerAction({
    id: 'swing',
    lines: ['荡秋千咯~', '飞高高！', '秋千秋千，荡起来！', '我要荡到云上去~'],
    start(ctx) {
      if (ctx.form !== 'chibi') { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return; }
      swingFx = null;
      mySeq = ++fxSeq;
      ctx.logEvent('自主', '去荡秋千');
      ctx.say(ctx.pick(LINES.swing), 1500);
      if (!swingHooked) {
        swingHooked = true;
        ctx.onFxDone((kind, receiptSeq) => {
          if (kind !== 'swing' || ctx.state !== 'swing.wait') return;
          if (receiptSeq !== undefined && receiptSeq !== mySeq) return; // 旧场次回执不认
          ctx.fxBurst(170, 300, 12, 12, 56);
          ctx.fxText('嘿咻！', 170, 320, 28);
          ctx.enter('swing.back', 0.5);
        });
      }
      // 预取锚点：秋千挂在窗口正上方的屏幕顶边（窗口半宽按基准 230 估，整体缩放下略有偏移）
      Promise.all([ctx.getPos(), ctx.getStage()]).then(([[px], st]) => {
        swingFx = { x: px + 230, y: st.minY };
      }).catch(() => {});
      ctx.enter('swing.go', 0.5);
    },
    tick(state, dt, t, ctx) {
      if (state === 'swing.go') {
        // 起势：小跳 + 高速旋转缩小（driveform 同款消失感）
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = -50 * Math.sin(Math.PI * k);
        const sc = 1 - 0.9 * k * k;
        ctx.tf.sx = sc; ctx.tf.sy = sc;
        ctx.tf.rotY = 360 * k;
        if (k >= 1) {
          if (swingFx) {
            ctx.fxStart('swing', { x: swingFx.x, y: swingFx.y, seq: mySeq });
            swingFx = null;
            ctx.enter('swing.wait');
          } else if (ctx.stateT > 2.5) { // 坐标拿不到就不玩了，别卡在隐身
            ctx.enter('idle');
            ctx.idleWait = ctx.nextIdleWait(2, 4);
          }
        }
        return true;
      }
      if (state === 'swing.wait') {
        ctx.tf.sx = 0; ctx.tf.sy = 0; // 本体藏在覆盖层的秋千上
        // 覆盖层失联兜底：18s 没回执自己现身（覆盖层硬超时 17s，先到为准）
        if (ctx.stateT > 18) ctx.enter('swing.back', 0.5);
        return true;
      }
      if (state === 'swing.back') {
        // 回弹现身
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.sx = easeOutBack(k); ctx.tf.sy = ctx.tf.sx;
        if (k >= 1) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
        return true;
      }
      return false;
    },
  });
})();
