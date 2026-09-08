// 接雪花：overlay 只管下雪（ov_snow.js），她在屏幕中下部随机来回跑，到点小跳做接雪状。
// 雪停（8~12s + 2s 淡出）overlay 回报 fxDone('snow') 提前收尾；16s 没收到由 tick 兜底。
(() => {
  let extCtx = null;
  let fxSeq = 0; // 会话令牌自增
  let mySeq = 0; // 当前场次的令牌
  let m = null; // { minX, maxX, x, tx, dir, retargetT, catchT }：跑动状态，x 为窗口左上角逐屏坐标

  function finish() {
    const ctx = extCtx;
    m = null;
    if (!ctx || ctx.state !== 'snow.run') return;
    ctx.say('雪停啦~', 1500);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'snow',
    lines: ['下雪啦下雪啦！', '接住一片雪花~', '冰冰凉凉的~', '别跑，让我接住你！'],
    effect: { mood: 3, jing: -2 },
    start(ctx) {
      if (!extCtx) { // 回执只订阅一次，EXT_CTX 是单例
        extCtx = ctx;
        ctx.onFxDone((kind, receiptSeq) => {
          if (kind === 'snow' && (receiptSeq === undefined || receiptSeq === mySeq)) finish();
        });
      }
      mySeq = ++fxSeq;
      m = null;
      ctx.say(ctx.pick(LINES.snow), 1800);
      ctx.fxStart('snow', { seq: mySeq });
      ctx.enter('snow.run', 16); // 兜底时长：正常由 fxDone 提前收尾
      Promise.all([ctx.getStage(), ctx.getPos()]).then(([st, [px]]) => {
        m = {
          minX: st.minX + 40,
          maxX: Math.max(st.minX + 40, st.maxX - 40),
          x: px, tx: null, dir: 1, retargetT: 0, catchT: 0,
        };
      }).catch(() => {});
    },
    tick(state, dt, t, ctx) {
      if (state !== 'snow.run') return false;
      if (!m) { // 舞台信息还没到，原地轻轻颠
        ctx.tf.ty = -Math.abs(Math.sin(ctx.stateT * 8)) * 5;
        return true;
      }
      if (m.catchT > 0) { // 到达目标点：小跳一下做接雪状
        m.catchT -= dt;
        const k = 1 - Math.max(m.catchT, 0) / 0.45;
        ctx.tf.ty = -26 * Math.sin(Math.PI * k);
        ctx.tf.sy = 1 + 0.05 * Math.sin(Math.PI * k);
        if (ctx.form === 'normal') ctx.tf.sx = -m.dir;
      } else {
        m.retargetT -= dt;
        if (m.tx == null || m.retargetT <= 0) {
          m.tx = ctx.rand(m.minX, m.maxX);
          m.retargetT = ctx.rand(1.5, 2.6);
        }
        const dx = m.tx - m.x;
        if (Math.abs(dx) <= 4) {
          m.catchT = 0.45;
          if (Math.random() < 0.35) ctx.fxText(ctx.pick(['接到啦！', '❄', '嘿！']), 170, 300, 26);
        } else {
          const dir = dx > 0 ? 1 : -1;
          m.dir = dir;
          const step = Math.min(Math.abs(dx), 220 * dt);
          m.x += dir * step;
          ctx.moveBy(dir * step, 0);
          if (ctx.form === 'normal') {
            ctx.tf.sx = -dir; // 走路帧朝左：向右跑要镜像（待机时 facing=1，tf.sx 即真实朝向）
            ctx.walkAnimAdvance(step);
          } else { // 没有走路帧的形态：保持旧式跑步颠簸
            ctx.tf.ty = -Math.abs(Math.sin(ctx.stateT * 11)) * 6;
            ctx.tf.rot = Math.sin(ctx.stateT * 11) * 2.5;
          }
        }
      }
      if (ctx.stateT >= ctx.stateDur) finish();
      return true;
    },
  });
})();
