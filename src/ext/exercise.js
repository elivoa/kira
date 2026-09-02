// 做早操：喊节拍（0.8s/拍，1、2、3、4 循环）——上举/侧弯/下蹲/转体各两拍，最后「收！」立正
(function () {
  let ex = null;

  const easeInOut = (k) => {
    k = Math.min(Math.max(k, 0), 1);
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  };
  // 两拍动作包络：起势 30% → 保持 → 收势 25%
  const env = (k) => (k < 0.3 ? easeInOut(k / 0.3) : k > 0.75 ? easeInOut((1 - k) / 0.25) : 1);

  registerAction({
    id: 'exercise',
    lines: ['早操时间到！', '一二三四，动起来！', '伸展运动，预备——起！', '锻炼身体，保卫自己~'],
    start(ctx) {
      // 基础五节 8s，随机加两节到 11.2s，含进出落在 8~12s
      const moves = ['up', 'bend', 'squat', 'twist', 'up'];
      if (Math.random() < 0.6) moves.push('squat', 'twist');
      ex = { moves, beat: -1 };
      ctx.logEvent('自主', '开始做早操');
      ctx.say(ctx.pick(LINES.exercise), 1500);
      ctx.enter('exercise.ready', 0.5);
    },
    tick(state, dt, t, ctx) {
      if (!ex) return false;
      if (state === 'exercise.ready') {
        // 预备：小跳立正
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = -16 * Math.sin(Math.PI * k);
        if (k >= 1) ctx.enter('exercise.do', ex.moves.length * 2 * 0.8);
        return true;
      }
      if (state === 'exercise.do') {
        const BEAT = 0.8;
        // 喊节拍：每拍弹一个数字漫画字
        const beat = Math.floor(ctx.stateT / BEAT);
        if (beat !== ex.beat) {
          ex.beat = beat;
          ctx.fxText(`${(beat % 4) + 1}！`, 170 + ctx.rand(-34, 34), 300 + ctx.rand(-14, 14), 30);
        }
        const mi = Math.min(Math.floor(ctx.stateT / (BEAT * 2)), ex.moves.length - 1);
        const mk = (ctx.stateT % (BEAT * 2)) / (BEAT * 2);
        const move = ex.moves[mi];
        const e = env(mk);
        if (move === 'up') {           // 双臂上举：拉长 + 微升
          ctx.tf.sy = 1 + 0.06 * e;
          ctx.tf.ty = -12 * e;
        } else if (move === 'bend') {  // 侧弯：左右交替
          const dir = mi % 2 === 0 ? 1 : -1;
          ctx.tf.rot = 12 * dir * e;
          ctx.tf.skew = 3 * dir * e;
        } else if (move === 'squat') { // 下蹲：压矮 + 下沉
          ctx.tf.sy = 1 - 0.06 * e;
          ctx.tf.ty = 26 * e;
        } else {                       // 转体：一拍翻过去，一拍翻回来
          ctx.tf.rotY = mk < 0.5 ? 180 * easeInOut(mk * 2) : 180 + 180 * easeInOut((mk - 0.5) * 2);
        }
        if (ctx.stateT >= ctx.stateDur) {
          ctx.fxText('收！', 170, 286, 38);
          ctx.fxBurst(170, 320, 12, 10, 46);
          ctx.enter('exercise.end', 0.45);
        }
        return true;
      }
      if (state === 'exercise.end') {
        // 收势立正
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = -12 * Math.sin(Math.PI * k);
        if (k >= 1) {
          ex = null;
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
        }
        return true;
      }
      return false;
    },
  });
})();
