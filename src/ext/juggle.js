// 抛接球（normal/chibi）：原地站定，三个彩球在头顶按相位错开的抛物线轮流起落，结束鞠躬。
// 球用 ctx.fxEl 创建——fxEl 自带 700ms 自动移除，所以每帧检查 isConnected 重建并更新位置，
// 被打断时残留元素也会自行消失，不需要额外清理。
(function () {
  const MY_LINES = ['看球看球！', '杂耍时间到~', '三个球，小意思！', '嘿——接住了！'];
  const COLORS = ['#ff7b9c', '#6fb7ff', '#ffd166'];
  let balls = null; // [{ el, color, r }]

  registerAction({
    id: 'juggle',
    lines: MY_LINES,
    effect: { jing: -4, mood: 3 },
    start(ctx) {
      balls = null;
      ctx.say(ctx.pick(MY_LINES), 1500);
      ctx.enter('juggle.play', ctx.rand(6, 8));
    },
    tick(state, dt, t, ctx) {
      if (state !== 'juggle.play' && state !== 'juggle.bow') { balls = null; return false; }

      if (state === 'juggle.play') {
        const chibi = ctx.form === 'chibi';
        if (!balls) {
          const r = chibi ? 9 : 11;
          balls = COLORS.map((color) => ({ el: null, color, r }));
        }
        // 抛接弧线：手位在两肩上方，球顶刚好过头顶
        const handY = chibi ? 392 : 268;
        const apex = chibi ? 110 : 160;
        const f = 0.8; // 每秒抛接回合数，三只球相位各错 1/3
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i];
          const th = Math.PI * 2 * (ctx.stateT * f + i / 3);
          const lift = Math.max(0, Math.sin(th)); // 下半周贴手位滑行 = 球在手里
          const x = 170 + 54 * Math.cos(th);
          const y = handY - apex * lift;
          if (!b.el || !b.el.isConnected) {
            b.el = ctx.fxEl('circle', { r: b.r, fill: b.color, stroke: '#1a1a2e', 'stroke-width': 2.5 }, null);
          }
          b.el.setAttribute('cx', x);
          b.el.setAttribute('cy', y);
        }
        // 身体随抛接节奏小起伏
        ctx.tf.ty = 2.5 * Math.sin(ctx.stateT * Math.PI * 2 * f);
        ctx.tf.rot = 1.5 * Math.sin(ctx.stateT * Math.PI * 2 * f + 1);
        if (ctx.stateT >= ctx.stateDur) {
          for (const b of balls) if (b.el) b.el.remove();
          balls = null;
          ctx.fxText('谢谢~', 170, chibi ? 260 : 150, 26);
          ctx.enter('juggle.bow', 0.9);
        }
        return true;
      }

      // 鞠躬：ty 下沉回弹 + 前倾
      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      const bow = Math.sin(Math.PI * k);
      ctx.tf.ty = 16 * bow;
      ctx.tf.rot = 12 * bow;
      ctx.tf.sy = 1 - 0.05 * bow;
      if (ctx.stateT >= ctx.stateDur) {
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(3, 6);
      }
      return true;
    },
  });
})();
