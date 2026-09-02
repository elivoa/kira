// 放风筝：她在地面来回小跑拽线，风筝（overlay 侧 ov_kite）在高处按正弦盘旋；
// 10~15s 后进入收线阶段，风筝缓缓降回手上，overlay 发 fxDone 回执收尾。
// 锚点协议：data.x/y = 窗口左上屏幕绝对坐标（主进程自动换算），hx/hy = 未缩放窗口局部
// 手部偏移，overlay 侧乘 ovlK 得到真实手部坐标（这里读不到 sizeK，缩放交给 overlay 算）。
(() => {
  const STATES = new Set(['kite.fly', 'kite.reel']);
  const HAND = { normal: { x: 230, y: 450 }, chibi: { x: 230, y: 560 } }; // 胸口偏上的持线手
  let K = null;          // 进行中场次
  let doneHooked = false; // 回执只订一次（ipcRenderer.on 重复调用会累加）

  function mine(ctx) { return STATES.has(ctx.state); }

  function sendUpdate(ctx, phase) {
    ctx.getPos().then(([x, y]) => {
      if (!K) return;
      const h = HAND[ctx.form] || HAND.normal;
      ctx.fxStart('kite', { x, y, hx: h.x + (K.dir || 1) * 26, hy: h.y, phase });
    }).catch(() => {});
  }

  function cleanup(ctx, foreign) {
    if (!K) return;
    clearInterval(K.timer);
    K = null;
    // 被打断（拖走/菜单换动作）：让 overlay 赶紧收场，回执来了也没人认，无碍
    if (foreign) ctx.fxStart('kite', { end: true });
  }

  function finish(ctx) {
    cleanup(ctx, false);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(4, 7);
  }

  registerAction({
    id: 'kite',
    lines: ['起风啦，放风筝去！', '飞高点，再飞高点~', '拽住拽住！', '风筝比我还自由', '线可不能断！'],
    effect: { jing: -2, mood: 3 },
    async start(ctx) {
      if (K) return;
      if (!doneHooked) {
        doneHooked = true;
        ctx.onFxDone((kind) => {
          if (kind !== 'kite' || !K || !mine(ctx)) return;
          ctx.fxBurst(170, 300, 10, 8, 40);
          ctx.say(ctx.pick(['完美降落！', '收工收工~', '风筝回来咯~']), 1600);
          finish(ctx);
        });
      }
      let st, px;
      try {
        st = await ctx.getStage();
        [px] = await ctx.getPos();
      } catch { return; }
      K = { st, dir: Math.random() < 0.5 ? -1 : 1, px, turnT: ctx.rand(1.2, 2.4), lineT: ctx.rand(2.5, 4), phase: 'fly' };
      // 伴侣定时器：节流给 overlay 报手部锚点；兼作打断看门狗（状态被切走就自我了断）
      K.timer = setInterval(() => {
        if (!K) return;
        if (!mine(ctx)) { cleanup(ctx, true); return; }
        sendUpdate(ctx, K.phase);
      }, 120);
      ctx.say(ctx.pick(LINES.kite), 1800);
      sendUpdate(ctx, 'fly');
      ctx.enter('kite.fly', ctx.rand(10, 15));
    },
    tick(state, dt, t, ctx) {
      if (state === 'kite.fly') {
        if (!K) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); return true; }
        // 来回小跑拽线：到边/到点就掉头
        K.turnT -= dt;
        if (K.turnT <= 0) { K.dir = -K.dir; K.turnT = ctx.rand(1.2, 2.6); }
        if (K.px <= K.st.minX + 40) K.dir = 1;
        else if (K.px >= K.st.maxX - 40) K.dir = -1;
        const dx = K.dir * 210 * dt;
        ctx.moveBy(dx, 0);
        K.px = Math.min(K.st.maxX, Math.max(K.st.minX, K.px + dx));
        if (ctx.walkAnimAdvance(dx)) {
          ctx.tf.rotY = K.dir > 0 ? 180 : 0; // 走路帧朝左：往右跑要镜像
        } else {
          ctx.tf.ty = -4 * Math.abs(Math.sin(t * 9)); // 没有走路帧素材的形态自己颠簸
        }
        K.lineT -= dt;
        if (K.lineT <= 0) { ctx.say(ctx.pick(LINES.kite), 1600); K.lineT = ctx.rand(3, 5); }
        if (ctx.stateT >= ctx.stateDur) {
          K.phase = 'reel';
          sendUpdate(ctx, 'reel');
          ctx.say('收线咯——', 1500);
          ctx.enter('kite.reel', 8); // 8s 没收到回执就自己兜底收尾（覆盖层失联场景）
        }
        return true;
      }
      if (state === 'kite.reel') {
        // 站着绞线等风筝落回手上：轻轻起伏即可
        ctx.tf.sy = 1 + 0.02 * Math.sin(t * 6);
        ctx.tf.rot = 1.5 * Math.sin(t * 2);
        if (ctx.stateT >= ctx.stateDur) finish(ctx);
        return true;
      }
      return false;
    },
  });
})();
