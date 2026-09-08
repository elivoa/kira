// 梦游：闭着眼慢慢漂移（极慢 moveBy + Zzz 飘字 + 慢摇晃），撞到屏幕边就惊醒收尾；10~20s 到点自己醒。
// 立绘换成睡姿场景图（sleep1/sleep2），任何出口前都必须换回正面图——
// 看门狗 interval 必备：状态被外部抢走（菜单/拖拽/大模型决策）时兜底换图自清，顺带周期同步真实位置（被拖走也不飘）。
(function () {
  const FRONT_SRC = '../assets/pet.png';
  const POSES = ['../assets/sleep1.png', '../assets/sleep2.png'];
  new Image().src = POSES[0]; // 预加载，换图不闪
  new Image().src = POSES[1];
  const SPEED = 30; // 梦游漂移，够慢才有梦游感

  let sess = null;

  function cleanup() {
    if (sess && sess.wd) clearInterval(sess.wd);
    sess = null;
  }

  function wake(ctx, why) {
    const s = sess;
    if (!s) return;
    // 只停看门狗，sess 必须留着——sleepwalk.wake 分支的动画靠 tick 驱动，结尾自己 cleanup
    if (s.wd) { clearInterval(s.wd); s.wd = null; }
    ctx.swapSprite(FRONT_SRC);
    if (why === 'bump') {
      ctx.fxBurst(170, 210);
      ctx.say(ctx.pick(['呜哇！撞、撞醒了！', '哎哟！谁把墙放这儿的！', '咚！！……咦，我怎么在这儿？']), 2200);
    } else if (why === 'poke') {
      ctx.fxBurst(170, 210);
      ctx.say(ctx.pick(['呜哇！别吓我！', '呀！……我刚才在梦游？']), 2000);
    } else {
      ctx.say(ctx.pick(['嗯……我怎么走到这儿了？', '唔……刚才好像做了个梦', '咦？我不是在床上吗？']), 2200);
    }
    ctx.logEvent('自主', why === 'bump' ? '梦游撞到屏幕边，惊醒了' : why === 'poke' ? '梦游被戳醒了' : '梦游了一圈，自己醒了');
    ctx.enter('sleepwalk.wake', why === 'time' ? 0.7 : 0.9);
  }

  registerAction({
    id: 'sleepwalk',
    lines: ['唔……zzz', '我在哪……', '月亮带我去哪呀', '呼……别吵醒我', '梦游中，请勿打扰'],
    effect: { jing: 1, mood: 1 },
    start(ctx) {
      cleanup(); // 重入保险
      if (ctx.form !== 'normal') { // 睡姿图只有姐姐版，其它形态降级为一句台词
        ctx.say('困……可是这个样子梦不了', 1500);
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(2, 4);
        return;
      }
      sess = {
        px: 0, py: 0, minX: -1e9, maxX: 1e9, floorY: 0, // 工作区未就绪前不夹取
        dir: Math.random() < 0.5 ? -1 : 1,
        deadline: performance.now() / 1000 + ctx.rand(10, 20),
        zzzT: 1.0, mumbleT: ctx.rand(4, 7),
        startInteract: ctx.lastInteract,
        busy: false, wd: null,
      };
      ctx.swapSprite(ctx.pick(POSES));
      ctx.say(ctx.pick(LINES.sleepwalk), 2000);
      ctx.logEvent('自主', '闭着眼睛开始梦游');
      ctx.enter('sleepwalk.walk', 25); // stateDur 只是兜底，主计时看 deadline
      Promise.all([ctx.getPos(), ctx.getStage()]).then(([p, st]) => {
        if (!sess) return;
        sess.px = p[0]; sess.py = p[1];
        sess.minX = st.minX; sess.maxX = st.maxX; sess.floorY = st.floorY;
        // 本来就被停在屏幕边：往屏幕里头走，别一开场就撞醒
        if (sess.px - st.minX < 60) sess.dir = 1;
        else if (st.maxX - sess.px < 60) sess.dir = -1;
      }).catch(() => {});
      // 看门狗：状态被外部切走 → 换回正面图自清；每拍同步一次真实位置（拖拽/主进程夹取后的偏差修正）
      sess.wd = setInterval(() => {
        const s = sess;
        if (!s) return;
        if (!String(ctx.state).startsWith('sleepwalk.')) { ctx.swapSprite(FRONT_SRC); cleanup(); return; }
        if (performance.now() / 1000 > s.deadline + 5) { wake(ctx, 'time'); return; } // 硬超时兜底
        if (s.busy) return;
        s.busy = true;
        ctx.getPos().then((p) => { if (sess === s) { s.px = p[0]; s.py = p[1]; } })
          .catch(() => {}).finally(() => { if (sess === s) s.busy = false; });
      }, 250);
    },
    tick(state, dt, t, ctx) {
      if (!String(state).startsWith('sleepwalk.')) return false;
      const s = sess;
      if (!s) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return true; }

      if (state === 'sleepwalk.wake') {
        // 惊醒一哆嗦：小跳 + 抖动衰减
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = -26 * Math.sin(Math.PI * Math.min(k * 1.6, 1));
        ctx.tf.rot = 4 * Math.sin(k * 20) * (1 - k);
        if (ctx.stateT >= ctx.stateDur) {
          cleanup();
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
        }
        return true;
      }

      // sleepwalk.walk
      if (performance.now() / 1000 > s.deadline) { wake(ctx, 'time'); return true; }
      if (ctx.lastInteract > s.startInteract + 0.01) { wake(ctx, 'poke'); return true; }
      // 水平极慢漂移；垂直缓回地面；位置自跟踪并夹取，撞边即惊醒
      let target = Math.min(Math.max(s.px + s.dir * SPEED * dt, s.minX), s.maxX);
      const mx = target - s.px;
      const dy = s.floorY - s.py;
      const my = Math.abs(dy) < 3 ? 0 : Math.sign(dy) * Math.min(Math.abs(dy), 90 * dt);
      if (mx || my) {
        ctx.moveBy(mx, my);
        s.px += mx; s.py += my;
      }
      if (s.px <= s.minX + 0.5 || s.px >= s.maxX - 0.5) { wake(ctx, 'bump'); return true; }
      // 漂移姿态：慢 sway + 浮沉 + 呼吸
      ctx.tf.rot = 2.5 * Math.sin(t * 1.1);
      ctx.tf.ty = -3 * Math.sin(t * 0.9);
      ctx.tf.sy = 1 + 0.012 * Math.sin(t * 1.6);
      // Zzz 飘字（紫 Z，与趴睡同款）
      s.zzzT -= dt;
      if (s.zzzT <= 0) {
        ctx.fxEl('text', {
          x: 170 + ctx.rand(-45, 45), y: 190 + ctx.rand(-25, 25),
          'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
          'font-size': ctx.rand(16, 30), fill: '#7d6fd0', stroke: '#fff', 'stroke-width': 5, 'paint-order': 'stroke',
        }, 'fx-pop').textContent = 'Z';
        s.zzzT = ctx.rand(1.6, 2.6);
      }
      // 梦话
      s.mumbleT -= dt;
      if (s.mumbleT <= 0) {
        ctx.say(ctx.pick(LINES.sleepwalk), 2000);
        s.mumbleT = ctx.rand(5, 8);
      }
      return true;
    },
  });
})();
