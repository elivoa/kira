// 提醒喝水：主人在活跃（10 分钟内有互动）且距上次提醒超过 45 分钟、她处于平静状态时，
// 举起小杯子催喝水（monitor 条件触发，不进随机池），3~4 秒收尾。
(() => {
  const GAP = 45 * 60 * 1000; // 两次提醒最小间隔
  const ACTIVE = 10 * 60;     // 这么久内有互动才算「在活跃」（秒）
  let lastRemind = Date.now(); // 启动即计一次，第一次提醒在 45 分钟后
  let cupT = 0;                // 杯子重绘计时（fxEl 0.7s 自动消失，举杯期间要反复画）

  const calm = (s) => s === 'idle' || s === 'walk' || s === 'walkfar';

  // 在她右手边画一只冒热气的小杯子（窗口 340×620 逻辑画幅）
  function drawCup(ctx) {
    const g = ctx.fxEl('g', {});
    ctx.fxEl('rect', { x: 208, y: 350, width: 24, height: 28, rx: 5, fill: '#cfe8ff', stroke: '#1a1a2e', 'stroke-width': 3 }, null, g);
    ctx.fxEl('path', { d: 'M232 356 q11 7 0 16', fill: 'none', stroke: '#1a1a2e', 'stroke-width': 3, 'stroke-linecap': 'round' }, null, g);
    ctx.fxEl('path', { d: 'M215 344 q3 -4 0 -8 M223 344 q3 -4 0 -8', fill: 'none', stroke: '#9fd0f0', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, null, g);
  }

  registerAction({
    id: 'water',
    lines: ['喝点水吧，杯子都给你举好啦', '咕嘟咕嘟，补充水分~', '坐多久啦，喝口水歇歇', '水是生命之源！喝！'],
    start(ctx) {
      lastRemind = Date.now();
      cupT = 0;
      ctx.say(ctx.pick(LINES.water), 3000);
      ctx.fxText('🥤', 220, 330, 32);
      ctx.logEvent('自主', '看你忙了半天，提醒你喝口水');
      ctx.enter('water.hold', 3.6);
    },
    tick(state, dt, t, ctx) {
      if (state !== 'water.hold') return false;
      const k = Math.min(ctx.stateT / 0.35, 1);
      ctx.tf.rot = -5 * k; // 举杯时身子往上一挺
      cupT -= dt;
      if (cupT <= 0) { drawCup(ctx); cupT = 0.6; }
      if (ctx.stateT >= ctx.stateDur) {
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(4, 7);
      }
      return true;
    },
    monitor(ctx) {
      if (Date.now() - lastRemind < GAP) return;
      if (performance.now() / 1000 - ctx.lastInteract > ACTIVE) return; // 主人不在，不白提醒
      if (!calm(ctx.state)) return; // 不打断进行中的动作
      if (typeof DISPATCH !== 'undefined' && DISPATCH.water) DISPATCH.water();
    },
  });
})();
