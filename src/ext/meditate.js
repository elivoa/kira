// 打坐（姐姐形态）：原地盘腿冥想——极慢呼吸、头顶真气光晕缓缓脉动、偶尔一声「吁——」
// 立绘用正面图 + 下沉盘腿感（sleep2 是被褥场景图，直接当立绘换会穿帮，故降级）
(function () {
  let med = null;

  const easeInOut = (k) => {
    k = Math.min(Math.max(k, 0), 1);
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  };

  registerAction({
    id: 'meditate',
    lines: ['吸——呼——', '心无杂念…', '气沉丹田…', '嘘，我在充电'],
    effect: { qi: 15, jing: 5 },
    start(ctx) {
      med = { haloT: 0, sighT: ctx.rand(2.5, 4), gradN: 0 };
      ctx.logEvent('自主', '打坐冥想中');
      ctx.say(ctx.pick(LINES.meditate), 1800);
      ctx.enter('meditate.sit', 0.7);
    },
    tick(state, dt, t, ctx) {
      if (!med) return false;
      if (state === 'meditate.sit') {
        // 下沉盘腿
        const k = easeInOut(ctx.stateT / ctx.stateDur);
        ctx.tf.ty = 34 * k;
        ctx.tf.sy = 1 - 0.06 * k;
        if (ctx.stateT >= ctx.stateDur) ctx.enter('meditate.zen', ctx.rand(8, 15));
        return true;
      }
      if (state === 'meditate.zen') {
        ctx.tf.ty = 34;
        // 极慢呼吸：周期 ~5.2s，幅度 ±0.008
        ctx.tf.sy = 0.94 * (1 + 0.008 * Math.sin(t * 2 * Math.PI / 5.2));
        ctx.tf.rot = 0.7 * Math.sin(t * 0.45);
        // 真气光晕：fxEl 只活 700ms，每 0.35s 重造一个，叠出持续脉动的径向渐变圆
        med.haloT -= dt;
        if (med.haloT <= 0) {
          med.haloT = 0.35;
          const id = `medGrad${++med.gradN}`; // id 必须唯一：重叠期的 url(#) 引用各自生效
          const r = 46 + 10 * Math.sin(t * 2 * Math.PI / 4.4);
          const g = ctx.fxEl('g', {});
          const grad = ctx.fxEl('radialGradient', { id }, null, g);
          ctx.fxEl('stop', { offset: '0%', 'stop-color': '#ffe9a8', 'stop-opacity': 0.8 }, null, grad);
          ctx.fxEl('stop', { offset: '55%', 'stop-color': '#ffd27a', 'stop-opacity': 0.32 }, null, grad);
          ctx.fxEl('stop', { offset: '100%', 'stop-color': '#ffd27a', 'stop-opacity': 0 }, null, grad);
          ctx.fxEl('circle', { cx: 170, cy: 130, r, fill: `url(#${id})` }, null, g);
        }
        // 吐纳
        med.sighT -= dt;
        if (med.sighT <= 0) {
          ctx.fxText('吁——', 170 + ctx.rand(-26, 26), 168, 24);
          med.sighT = ctx.rand(3.5, 5.5);
        }
        if (ctx.stateT >= ctx.stateDur) {
          ctx.fxBurst(170, 300, 12, 10, 48);
          ctx.say(ctx.pick(['神清气爽！', '满血复活~', '杂念清空！']), 1600);
          ctx.enter('meditate.rise', 0.6);
        }
        return true;
      }
      if (state === 'meditate.rise') {
        // 起身回位
        const k = easeInOut(ctx.stateT / ctx.stateDur);
        ctx.tf.ty = 34 * (1 - k);
        ctx.tf.sy = 0.94 + 0.06 * k;
        if (ctx.stateT >= ctx.stateDur) {
          med = null;
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
        }
        return true;
      }
      return false;
    },
  });
})();
