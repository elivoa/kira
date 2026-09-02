// 跟屁虫：远远跟着鼠标走，横向保持约 200px 距离不挡手。
// 鼠标停下 2s 她就地坐下看你几秒，然后自然收尾；总长 20~40s，期间戳她（任意互动）提前结束。
// 光标用 setInterval 0.15s 轮询（IPC 拿不到每帧同步值），位移和走路帧全在 tick 里按 dt 结算；
// 这个 interval 同时充当看门狗：状态被外部切走（拖拽/菜单/大模型抢占）时静默自清。
(function () {
  const FRONT = { normal: '../assets/pet.png', chibi: '../assets/chibi.png', back: '../assets/pet_back.png' };
  const FOLLOW_GAP = 200;   // 与光标的横向保持距离（px）
  const STILL_SEC = 2;      // 光标静止这么久就坐下
  // normal 受走路帧切帧节奏约束（>140 相邻帧互相涂抹），其它形态没有帧素材可以略快
  const SPEED = { normal: 130, chibi: 165, back: 165 };

  let sess = null; // 本场会话

  function cleanup() {
    if (sess && sess.poll) clearInterval(sess.poll);
    sess = null;
  }

  function finish(ctx, why) {
    const s = sess;
    cleanup();
    if (!s) return;
    // 立绘不用手动换：走路帧由 enter('idle') 兜底换回正面，坐下阶段本来就停在正面图上
    if (why === 'poke') ctx.say(ctx.pick(['知道啦，不跟了~', '戳我干嘛啦，不跟了！']), 1600);
    else ctx.say(ctx.pick(['不跟啦，你自己玩~', '嘿嘿，跟累啦', '就送到这儿啦~']), 1800);
    ctx.logEvent('自主', why === 'poke' ? '跟屁虫被戳了一下，不跟了' : why === 'sit' ? '跟屁虫坐下看了一会儿，心满意足地走了' : '跟屁虫跟够了，自然收尾');
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'follow',
    lines: ['等等我嘛~', '你去哪我就去哪', '嘿嘿，跟上啦', '别甩掉我哦', '我就远远跟着，不碍事~'],
    effect: { jing: -2, mood: 3 },
    start(ctx) {
      cleanup(); // 重入保险：上一场有残留先清掉
      if (!FRONT[ctx.form]) { // 法宝形态走不了路，降级为一句台词
        ctx.say('这个样子跟不了你呀…', 1500);
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(2, 4);
        return;
      }
      const now = performance.now() / 1000;
      sess = {
        cx: 0, cy: 0, px: 0, py: 0, minX: 0, maxX: 0, floorY: 0,
        side: 1,            // 跟在光标哪一侧（光标越过她就翻边）
        lastMoveT: now,     // 光标最后一次明显移动的时刻
        deadline: now + ctx.rand(20, 40),
        startInteract: ctx.lastInteract,
        busy: false, poll: null,
      };
      Promise.all([ctx.getCursor(), ctx.getPos(), ctx.getStage()]).then(([c, p, st]) => {
        if (!sess) return;
        sess.cx = c.x; sess.cy = c.y;
        sess.px = p[0]; sess.py = p[1];
        sess.minX = st.minX; sess.maxX = st.maxX; sess.floorY = st.floorY;
        sess.side = (p[0] + window.innerWidth / 2) >= c.x ? 1 : -1;
      }).catch(() => {});
      ctx.say(ctx.pick(LINES.follow), 1500);
      ctx.logEvent('自主', '开始当跟屁虫，远远跟着鼠标');
      ctx.enter('follow.go', 45); // stateDur 只是兜底，主计时看 deadline
      sess.poll = setInterval(() => {
        const s = sess;
        if (!s) return;
        // 看门狗：状态不是自己的了（被拖走/菜单切动作等）→ 静默自清，不抢状态不抢台词
        if (!String(ctx.state).startsWith('follow.')) { cleanup(); return; }
        if (s.busy) return;
        s.busy = true;
        Promise.all([ctx.getCursor(), ctx.getPos()]).then(([c, p]) => {
          if (sess !== s) return;
          const nowS = performance.now() / 1000;
          const moved = Math.hypot(c.x - s.cx, c.y - s.cy);
          if (moved > 8) s.lastMoveT = nowS;
          s.cx = c.x; s.cy = c.y;
          s.px = p[0]; s.py = p[1];
          // 坐下期间鼠标又跑远了：起身继续跟
          if (ctx.state === 'follow.sit' && moved > 40) ctx.enter('follow.go', 45);
          // 硬超时：tick 逻辑万一卡住，这里也一定能收尾
          if (nowS > s.deadline + 5) finish(ctx, 'time');
        }).catch(() => {}).finally(() => { if (sess === s) s.busy = false; });
      }, 150);
    },
    tick(state, dt, t, ctx) {
      if (!String(state).startsWith('follow.')) return false;
      const s = sess;
      if (!s) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return true; }
      if (t > s.deadline) { finish(ctx, 'time'); return true; }
      if (ctx.lastInteract > s.startInteract + 0.01) { finish(ctx, 'poke'); return true; }

      const winW = window.innerWidth; // 渲染窗口宽 = 主进程 winW()，比写死 460 耐整体缩放
      const herCX = s.px + winW / 2;

      if (state === 'follow.go') {
        // 光标静止超 2s：就地坐下
        if (t - s.lastMoveT > STILL_SEC) {
          ctx.swapSprite(FRONT[ctx.form]);
          ctx.enter('follow.sit', ctx.rand(3.5, 6));
          return true;
        }
        // 光标越过她到另一侧：换边，不挡手
        if ((s.cx - herCX) * s.side < -FOLLOW_GAP * 0.5) s.side = -s.side;
        // 目标：光标一侧 200px 处的窗口左沿，夹在工作区内；垂直回地面
        const tx = Math.min(Math.max(s.cx + s.side * FOLLOW_GAP - winW / 2, s.minX), s.maxX);
        const dx = tx - s.px, dy = s.floorY - s.py;
        const sp = SPEED[ctx.form] || 150;
        const mx = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * Math.min(Math.abs(dx), sp * dt);
        const my = Math.abs(dy) < 4 ? 0 : Math.sign(dy) * Math.min(Math.abs(dy), 500 * dt);
        if (mx || my) {
          ctx.moveBy(mx, my);
          s.px += mx; s.py += my;
          if (!ctx.walkAnimAdvance(mx)) {
            // 没走路帧素材的形态：保持旧的颠簸 + 前倾
            const ph = t * 9;
            ctx.tf.ty = -Math.abs(Math.sin(ph)) * 6;
            ctx.tf.rot = Math.sin(ph) * 2.5 + Math.sign(mx || s.side) * 3;
          }
          if (mx) ctx.tf.sx = mx < 0 ? 1 : -1; // 走路帧朝左，右走整图镜像（正/背面图镜像无感）
        } else {
          ctx.tf.sy = 1 + 0.015 * Math.sin(t * 2.2); // 就位：原地呼吸
        }
        return true;
      }

      // follow.sit：蹲下坐着看你（压扁 + 呼吸 + 偶尔歪头），坐满时长就收尾
      const settle = Math.min(ctx.stateT / 0.4, 1); // 0.4s 蹲下去
      ctx.tf.sy = 1 - 0.13 * settle + 0.012 * Math.sin(t * 2.2) * settle;
      ctx.tf.sx = (1 + 0.06 * settle) * (s.cx >= herCX ? -1 : 1); // 面向光标
      if (settle >= 1 && Math.sin(t * 0.9) > 0.92) ctx.tf.rot = 5; // 偶尔歪一下头
      if (ctx.stateT >= ctx.stateDur) finish(ctx, 'sit');
      return true;
    },
  });
})();
