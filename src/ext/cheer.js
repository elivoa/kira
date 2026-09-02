// 打字打call：主人连续打字 30 秒以上，她凑到活动窗口左下角附近挥小旗加油；
// 停笔 10 秒或挥够 20 秒就走回原位收尾（monitor 条件触发，不进随机池）。
// 打字状态来自 inputContext：tools/keys 没编译或缺「输入监控」权限时 typing 恒 false，
// 这个动作只是永远不触发，不影响其它功能。
(() => {
  const TYPE_HOLD = 30;       // 连续打字这么久才触发（秒）
  const STOP_QUIT = 10;       // 打call期间停笔这么久就收尾（秒）
  const WAVE_MAX = 20;        // 最多挥这么久（秒）
  const GO_MAX = 12;          // 赶路超时兜底（秒）：走不到就地开始/收尾，绝不卡死
  const COOLDOWN = 90 * 1000; // 一次打call结束后冷却
  const SPEED = 340;
  const WORDS = ['加油！', '冲冲冲！', '哒哒哒'];

  let querying = false;   // inputContext 查询在途（异步，monitor 每秒都会来）
  let typingSince = 0;    // 这波连续打字的开始时间（墙钟秒）
  let stopSince = 0;      // 打call期间停笔的开始时间（墙钟秒，0 = 还在打）
  let lastEnd = 0;        // 上次打call结束时间（冷却用）
  let cheer = null;       // 进行中的打call现场 {tx,ty, hx,hy, px,py, waveSx, flagT, wordT, phase}

  const calm = (s) => s === 'idle' || s === 'walk' || s === 'walkfar';

  // 挥动的小旗：fxEl 0.7s 自动消失，靠 tick 里交替倾角反复画来「挥」
  function drawFlag(ctx, phase) {
    const g = ctx.fxEl('g', { transform: `translate(92,318) rotate(${phase ? 16 : -16})` });
    ctx.fxEl('line', { x1: 0, y1: 0, x2: 0, y2: -34, stroke: '#8a5a2a', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, null, g);
    ctx.fxEl('polygon', { points: '0,-34 26,-27 0,-20', fill: '#ff5a76', stroke: '#1a1a2e', 'stroke-width': 2 }, null, g);
  }

  function finish(ctx) {
    cheer = null;
    lastEnd = Date.now();
    stopSince = 0;
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'cheer',
    lines: ['写得好快！加油加油！', '哒哒哒，文思泉涌！', '冲冲冲！我看好你！', '看你打字我都激动了'],
    async start(ctx) {
      const st = await ctx.getStage();
      const [px, py] = await ctx.getPos();
      const aw = await ctx.activeWindow();
      let tx = px, ty = py;
      if (aw) {
        // 站位：活动窗口左下角附近——优先贴窗左边（人在窗外一点），贴不下就站窗内左下
        const leftTx = aw.x - 250;
        tx = leftTx >= st.minX ? leftTx : Math.min(aw.x + 60, st.maxX);
        ty = Math.min(Math.max(aw.y + aw.h - 620, st.minY), st.floorY);
      }
      cheer = { tx, ty, hx: px, hy: py, px, py, waveSx: aw ? -1 : 1, flagT: 0, wordT: 1.0, phase: false };
      stopSince = 0;
      ctx.say(ctx.pick(LINES.cheer), 2600);
      ctx.logEvent('自主', aw ? `看你奋笔疾书，凑到「${aw.owner}」边上给你打call` : '看你奋笔疾书，原地给你打call');
      ctx.enter('cheer.go');
    },
    tick(state, dt, t, ctx) {
      if (state !== 'cheer.go' && state !== 'cheer.wave' && state !== 'cheer.back') return false;
      if (!cheer) { // 现场丢了（理论上来不了），兜底回待机
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(2, 5);
        return true;
      }

      if (state === 'cheer.wave') {
        ctx.tf.sx = cheer.waveSx; // 面朝窗口（正面图镜像，扩展拿不到 facing，用 tf.sx 代替）
        ctx.tf.rot = 7 * Math.sin(t * 6);
        ctx.tf.ty = -Math.abs(Math.sin(t * 6)) * 4;
        cheer.flagT -= dt;
        if (cheer.flagT <= 0) { cheer.phase = !cheer.phase; drawFlag(ctx, cheer.phase); cheer.flagT = 0.45; }
        cheer.wordT -= dt;
        if (cheer.wordT <= 0) {
          ctx.fxText(ctx.pick(WORDS), 170 + ctx.rand(-50, 50), 250 + ctx.rand(-16, 16), 30);
          cheer.wordT = 2.2;
        }
        const stopped = stopSince && Date.now() / 1000 - stopSince >= STOP_QUIT;
        if (stopped || ctx.stateT >= ctx.stateDur) ctx.enter('cheer.back'); // 你停笔了/挥够了，回去收尾
        return true;
      }

      // cheer.go / cheer.back：朝目标点走，位置自己记账（getPos 是异步 IPC，tick 里用不了）
      const gx = state === 'cheer.go' ? cheer.tx : cheer.hx;
      const gy = state === 'cheer.go' ? cheer.ty : cheer.hy;
      const dx = gx - cheer.px, dy = gy - cheer.py;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * dt;
      const arrived = dist <= Math.max(step, 5);
      const mx = arrived ? dx : dx / dist * step;
      const my = arrived ? dy : dy / dist * step;
      ctx.moveBy(mx, my);
      cheer.px += mx; cheer.py += my;
      ctx.tf.sx = dx >= 0 ? -1 : 1; // 走路帧朝左：往右走水平镜像
      if (!ctx.walkAnimAdvance(Math.hypot(mx, my))) ctx.tf.ty = -Math.abs(Math.sin(t * 12)) * 5; // chibi 没走路帧，自己蹦
      if (arrived || ctx.stateT > GO_MAX) {
        if (state === 'cheer.go') ctx.enter('cheer.wave', WAVE_MAX); // enter 会把走路帧自动换回正面图
        else finish(ctx);
      }
      return true;
    },
    monitor(ctx) {
      // 被拖拽/戳一戳等打断：状态已不在打call链上，清场（立绘由 enter() 兜底恢复）
      if (cheer && ctx.state !== 'cheer.go' && ctx.state !== 'cheer.wave' && ctx.state !== 'cheer.back') {
        cheer = null;
        lastEnd = Date.now();
        stopSince = 0;
      }
      if (!cheer && !calm(ctx.state)) return; // 别打断进行中的动作
      if (querying) return;
      querying = true;
      ctx.inputContext().then((ic) => {
        const now = Date.now() / 1000;
        const typing = !!(ic && ic.typing);
        if (cheer !== null) {
          // 打call期间盯停笔：停了开始计时，复打清零（tick 读到超阈值就走回去）
          if (typing) stopSince = 0;
          else if (!stopSince) stopSince = now;
        } else if (typing) {
          if (!typingSince) typingSince = now;
          if (now - typingSince >= TYPE_HOLD && Date.now() - lastEnd >= COOLDOWN) {
            typingSince = 0;
            if (typeof DISPATCH !== 'undefined' && DISPATCH.cheer) DISPATCH.cheer();
          }
        } else {
          typingSince = 0; // 停顿即重新累计「连续打字」
        }
      }).catch(() => {}).finally(() => { querying = false; });
    },
  });
})();
