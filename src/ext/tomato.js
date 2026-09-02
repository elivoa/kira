// 番茄钟：菜单触发。她说一声开始，安静陪 25 分钟，到点爆星 +「叮！时间到」提醒休息 5 分钟。
// 计时挂在 monitor 墙钟检查上，与她当下的状态解耦——中途她去做别的/被戳被拖，到点照样响。
// 只在 app 运行期间计时，不持久化。
(() => {
  const FOCUS_MIN = 25;
  const ACCOMPANY = 45; // 开始后她安静陪坐的时长（秒），之后回待机，计时继续走
  let endAt = 0;        // 到点的墙钟秒（0 = 没在计时）

  registerAction({
    id: 'tomato',
    lines: ['专注 25 分钟，开始！', '番茄钟启动！我安静陪你', '开工开工，25 分钟后我叫你', '专心哦，我帮你看着时间'],
    start(ctx) {
      endAt = Date.now() / 1000 + FOCUS_MIN * 60;
      ctx.say(ctx.pick(LINES.tomato), 2800);
      ctx.fxText('🍅', 170, 320, 36);
      ctx.logEvent('交互', `番茄钟开始：${FOCUS_MIN} 分钟`);
      ctx.enter('tomato.focus', ACCOMPANY);
    },
    tick(state, dt, t, ctx) {
      if (state !== 'tomato.focus') return false;
      // 低打扰陪伴：只有轻轻的呼吸起伏（地基没有可复用的坐姿状态/素材，用安静站立代替）
      ctx.tf.sy = 1 + 0.015 * Math.sin(t * 2.2);
      ctx.tf.rot = 1.5 * Math.sin(t * 0.8);
      if (ctx.stateT >= ctx.stateDur) {
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(5, 8);
      }
      return true;
    },
    monitor(ctx) {
      if (!endAt || Date.now() / 1000 < endAt) return;
      endAt = 0;
      // 到点提醒不抢状态：只叠窗内特效和气泡，她正在做的动作不被打断
      ctx.fxBurst(170, 380);
      ctx.fxText('叮！时间到', 170, 310, 40);
      ctx.say(`${FOCUS_MIN} 分钟到啦，快起来休息 5 分钟~`, 4200);
      ctx.logEvent('交互', '番茄钟到点，提醒休息 5 分钟');
    },
  });
})();
