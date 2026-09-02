// 走钢丝（姐姐形态）：屏幕高处两个点之间拉一条微垂的钢丝，她跳上去从一端走到另一端。
// 绳形是解析抛物线（两端钉死），renderer 的脚底路径与 ov_tightrope 画的绳是同一条曲线，
// 脚下零失配——verlet 软绳的稳态垂度不可解析预知，贴不上脚，故不用（smoothPath 照用）。
// 走绳用走路帧；身体左右晃（中段最厉害）+ sy 微颤当平衡臂。
(() => {
  const INTRO = ['看我的，走钢丝！', '嘿——平衡大师上线！'];
  const MID_LINE = '哇、哇…别晃！';
  const END_LINE = '走到啦！厉害吧！';
  const SAG = 36;         // 绳中垂度（px，两侧共用同一值）
  const MOUNT = 1.0;      // 跳上钢丝耗时（秒），overlay 按同一时刻表排期
  const ROPE_MARGIN = 40; // 绳两端离屏幕左右边的距离

  let G = null; // 几何与进度：{ x0, x1, dir, topY, floorY, fromX, fromY, winW, winH, walkDur, cur:{x,y}, said }

  // 窗口往目标点挪一帧：只发增量，cur 记录已落地的位置（dash 的影子位置同款）
  function moveTo(ctx, x, y) {
    const dx = Math.round(x - G.cur.x), dy = Math.round(y - G.cur.y);
    if (dx || dy) ctx.moveBy(dx, dy);
    G.cur.x += dx; G.cur.y += dy;
  }

  const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  registerAction({
    id: 'tightrope',
    lines: [...INTRO, MID_LINE, END_LINE],
    effect: { jing: -6, mood: 3 },
    start(ctx) {
      G = null;
      if (ctx.form !== 'normal') { ctx.say('这个要姐姐形态才行…', 1500); return; }
      ctx.logEvent('自主', '去走钢丝');
      ctx.say(ctx.pick(INTRO), 1600);
      ctx.enter('tightrope.prep', 2.5);
      Promise.all([ctx.getPos(), ctx.getStage()]).then(([p, st]) => {
        const winW = window.innerWidth, winH = window.innerHeight; // 渲染页即桌宠窗口
        // 屏太矮（窗口顶到绳上后站立空间不足 120px）就不演了，prep 超时悄悄收工
        if (st.floorY - st.minY < 120) return;
        let x0 = st.minX + ROPE_MARGIN, x1 = st.maxX - ROPE_MARGIN;
        // 从离她近的一端上绳
        let dir = 1;
        if (Math.abs(p[0] - x1) < Math.abs(p[0] - x0)) { const tmp = x0; x0 = x1; x1 = tmp; dir = -1; }
        G = {
          x0, x1, dir,
          topY: st.minY,   // 走绳时窗口顶（脚底 = topY + winH = 绳线，窗口完全可见的最高处）
          floorY: st.floorY,
          fromX: p[0], fromY: p[1],
          winW, winH,
          walkDur: 8 + Math.random() * 4,
          cur: { x: p[0], y: p[1] },
          said: false,
        };
      }).catch(() => {});
    },
    tick(state, dt, t, ctx) {
      if (state === 'tightrope.prep') {
        // 起跳前的小下蹲蓄力；几何没算出来（IPC 失败/屏太矮）就到点收工
        const k = Math.min(ctx.stateT / 0.5, 1);
        ctx.tf.sy = 1 - 0.08 * Math.sin(Math.PI * k);
        if (G) {
          // 开绳：起点锚点按屏幕绝对坐标报给 overlay（主进程自动换算），dx 是偏移量不参与换算
          ctx.fxStart('tightrope', {
            x: G.x0 + G.winW / 2,
            y: G.topY + G.winH,
            dx: G.x1 - G.x0,
            sag: SAG, mount: MOUNT, dur: G.walkDur,
          });
          ctx.fxText('嘿咻', 170, 330, 24);
          ctx.enter('tightrope.up', MOUNT);
        } else if (ctx.stateT >= ctx.stateDur) {
          ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 5);
        }
        return true;
      }
      if (state === 'tightrope.up') {
        // 跳上绳端：位置弧线插值 + 倾身
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        const e = easeInOut(k);
        moveTo(ctx, G.fromX + (G.x0 - G.fromX) * e, G.fromY + (G.topY - G.fromY) * e);
        ctx.tf.rot = 3 * G.dir * Math.sin(Math.PI * k);
        if (k >= 1) ctx.enter('tightrope.walk', G.walkDur);
        return true;
      }
      if (state === 'tightrope.walk') {
        const u = Math.min(ctx.stateT / ctx.stateDur, 1);
        const mid = 4 * u * (1 - u); // 抛物线垂度因子，中段最大
        const px = G.x0 + (G.x1 - G.x0) * u;
        const py = G.topY + SAG * mid;
        const dx = px - G.cur.x;
        moveTo(ctx, px, py);
        ctx.walkAnimAdvance(dx);
        ctx.tf.sx = -G.dir; // 走路帧朝左：朝右走时镜像（tf.sx 会乘上内部 facing）
        ctx.tf.rot = (2 + 9 * mid) * Math.sin(Math.PI * 2 * 1.5 * ctx.stateT); // 越走晃越明显，中段最凶
        ctx.tf.sy = 1 + 0.018 * Math.sin(t * 13) + 0.01 * Math.sin(t * 7.3); // 双臂张合的平衡微颤
        if (!G.said && u >= 0.5) {
          G.said = true;
          ctx.fxText('哇、哇…', 170, 200, 26);
          ctx.say(MID_LINE, 1300);
        }
        if (u >= 1) {
          ctx.fxBurst(170, 300);
          ctx.fxText(END_LINE, 170, 258, 24);
          ctx.say(END_LINE, 1600);
          ctx.logEvent('自主', '走完了一段钢丝');
          ctx.enter('tightrope.down', 0.75);
        }
        return true;
      }
      if (state === 'tightrope.down') {
        // 跳下落地：加速下落 + 落地前的拉伸
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        moveTo(ctx, G.x1, G.topY + (G.floorY - G.topY) * k * k);
        ctx.tf.sx = 1 - 0.05 * k; ctx.tf.sy = 1 + 0.1 * k;
        if (k >= 1) {
          ctx.fxBurst(170, 590, 10, 8, 36);
          ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6);
        }
        return true;
      }
      return false;
    },
  });
})();
