// 深夜催睡：23:00~05:00 且她处于平静状态时，打个哈欠催主人去睡（monitor 条件触发，不进随机池）。
// 只催不睡：换哈欠图 2 秒 + 台词，然后换回正面图收尾，不进入睡觉状态。
(() => {
  const GAP = 20 * 60 * 1000; // 两次催睡最小间隔
  const YAWN_SRC = '../assets/sleep1.png';
  const FRONT = { // 各形态正面图，收尾时换回来
    normal: '../assets/pet.png', chibi: '../assets/chibi.png',
    flute: '../assets/flute.png', note: '../assets/note.png', back: '../assets/pet_back.png',
  };
  let lastNag = Date.now(); // 启动即计一次，避免刚开机就被催
  let restoreSrc = null;    // 打哈欠前换下的正面图；收尾/被打断时恢复

  new Image().src = YAWN_SRC; // 预加载，换图不闪

  const calm = (s) => s === 'idle' || s === 'walk' || s === 'walkfar';

  registerAction({
    id: 'nightsleep',
    lines: ['都几点啦，还不睡吗', '哈啊……我都困了，快睡吧', '熬夜会变丑哦，快去睡觉', '手机放下！明天再玩'],
    start(ctx) {
      lastNag = Date.now();
      restoreSrc = FRONT[ctx.form] || FRONT.normal;
      ctx.swapSprite(YAWN_SRC);
      ctx.fxText('哈啊…', 170, 300, 40);
      ctx.say(ctx.pick(LINES.nightsleep), 3200);
      ctx.logEvent('自主', '深夜了，打着哈欠催你睡觉');
      ctx.enter('nightsleep.yawn', 2.2);
    },
    tick(state, dt, t, ctx) {
      if (state !== 'nightsleep.yawn') return false;
      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      ctx.tf.rot = 5 * Math.sin(k * Math.PI * 2);   // 困得摇摇晃晃
      ctx.tf.sy = 1 - 0.04 * Math.sin(k * Math.PI); // 往下一沉
      if (ctx.stateT >= ctx.stateDur) {
        ctx.swapSprite(restoreSrc || FRONT.normal);
        restoreSrc = null;
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(4, 7);
      }
      return true;
    },
    monitor(ctx) {
      // 打哈欠途中被戳/被拖走：状态已离开，立绘兜底换回正面图，别挂着睡姿图到处跑
      if (restoreSrc && ctx.state !== 'nightsleep.yawn') {
        ctx.swapSprite(restoreSrc);
        restoreSrc = null;
      }
      const h = new Date().getHours();
      if (h < 23 && h >= 5) return;
      if (Date.now() - lastNag < GAP) return;
      if (!calm(ctx.state)) return; // 不打断进行中的动作
      if (typeof DISPATCH !== 'undefined' && DISPATCH.nightsleep) DISPATCH.nightsleep();
    },
  });
})();
