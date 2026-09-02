// 滑滑梯：找当前活动窗口的一条竖边沿（没有就用屏幕右边沿），从顶沿附近沿对角线
// 2~3s 加速滑到底，脚下拖尾尘，落地弹一下收尾。
// 纯窗口内实现：滑动走 moveBy，尘用窗内 fx-dust（窗口高速移动，尘点自然拖成尾迹）。
const SLIDE_FRAME_SRC = '../assets/climb/f20.png'; // 攀爬帧图朝右，坐姿下滑刚好
new Image().src = SLIDE_FRAME_SRC; // renderer 已预加载全序列，这里双保险

function slideFront(form) {
  return {
    normal: '../assets/pet.png',
    chibi: '../assets/chibi.png',
    flute: '../assets/flute.png',
    note: '../assets/note.png',
    back: '../assets/pet_back.png',
  }[form] || '../assets/pet.png';
}

let slideSt = null; // { ready, st, phase, t, px, py, gx, gy, sx, sy, ex, ey, goDur, slideDur, lean, dustT, goX, goY }

registerAction({
  id: 'slide',
  lines: ['滑滑梯咯——', '嗖——一下就到底！', '让让让让！', '这个坡归我啦！'],
  effect: { jing: -3, mood: 4 },
  start(ctx) {
    ctx.say(ctx.pick(LINES.slide), 1600);
    slideSt = { ready: false };
    ctx.enter('slide', 13); // 13s 硬超时兜底
    Promise.all([ctx.getStage(), ctx.getPos(), ctx.activeWindow()]).then(([st, [px, py], aw]) => {
      if (ctx.state !== 'slide' || !slideSt) return; // 初始化期间被打断，放弃
      const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
      let sx, sy;
      if (aw) {
        // 两条竖边沿选离她近的那条，从顶沿附近起滑
        const cx = px + 170;
        const edge = Math.abs(cx - aw.x) <= Math.abs(cx - (aw.x + aw.w)) ? aw.x : aw.x + aw.w;
        sx = clamp(edge - 170, st.minX, st.maxX);
        sy = clamp(aw.y + 30, st.minY, st.floorY - 240); // 保底 240px 滑程
      } else {
        sx = st.maxX; // 没有活动窗口：屏幕右边沿
        sy = st.minY + 40;
      }
      // 落点朝屏幕内侧漂一段，形成对角线滑道
      const inward = sx > (st.minX + st.maxX) / 2 ? -1 : 1;
      const drop = st.floorY - sy;
      const drift = inward * clamp(drop * 0.25, 60, 160);
      const ex = clamp(sx + drift, st.minX, st.maxX);
      const slideDist = Math.hypot(ex - sx, drop);
      slideSt = {
        ready: true, st, phase: 'go', t: 0,
        px, py, gx: px, gy: py, sx, sy, ex, ey: st.floorY,
        goDur: Math.max(Math.hypot(sx - px, sy - py) / 750, 0.01),
        slideDur: clamp(slideDist / 420, 2, 3), // 2~3s 滑完
        lean: ex >= sx ? 8 : -8,
        dustT: 0, goX: px, goY: py,
      };
    }).catch(() => {
      if (ctx.state === 'slide') { slideSt = null; ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
    });
  },
  tick(state, dt, t, ctx) {
    if (state !== 'slide') return false;
    const done = () => {
      slideSt = null;
      ctx.swapSprite(slideFront(ctx.form));
      ctx.enter('idle');
      ctx.idleWait = ctx.nextIdleWait(3, 6);
    };
    if (ctx.stateT >= ctx.stateDur) { done(); return true; } // 硬超时兜底
    const S = slideSt;
    if (!S || !S.ready) return true; // IPC 初始化未回，占位等下一帧

    if (S.phase === 'go') {
      // 小跑带跳地赶到滑梯口
      S.t += dt;
      const k = Math.min(S.t / S.goDur, 1);
      const nx = S.gx + (S.sx - S.gx) * k;
      const ny = S.gy + (S.sy - S.gy) * k;
      const mx = nx - S.goX, my = ny - S.goY;
      ctx.moveBy(mx, my);
      S.goX = nx; S.goY = ny;
      if (ctx.form === 'normal') ctx.walkAnimAdvance(mx); // 姐姐有走路帧就推帧（带符号，方向才对）
      ctx.tf.ty = -14 * Math.abs(Math.sin(S.t * 10));
      ctx.tf.rot = mx > 0.5 ? 5 : (mx < -0.5 ? -5 : 0);
      if (k >= 1) {
        S.phase = 'slide'; S.t = 0;
        S.px = S.sx; S.py = S.sy;
        if (ctx.form === 'normal') ctx.swapSprite(SLIDE_FRAME_SRC); // 攀爬帧只有姐姐素材
        ctx.fxText('嗖——', 170, 240, 30);
      }
      return true;
    }

    if (S.phase === 'slide') {
      S.t += dt;
      const k = Math.min(S.t / S.slideDur, 1);
      const e = Math.pow(k, 1.8); // 起步慢、越滑越快
      const nx = S.sx + (S.ex - S.sx) * e;
      const ny = S.sy + (S.ey - S.sy) * e;
      ctx.moveBy(nx - S.px, ny - S.py);
      S.px = nx; S.py = ny;
      ctx.tf.rot = S.lean; // 顺着滑道方向微后仰
      S.dustT -= dt;
      if (S.dustT <= 0) {
        S.dustT = 0.07;
        ctx.fxEl('ellipse', {
          cx: 170 + ctx.rand(-30, 30), cy: 596 + ctx.rand(-14, 10),
          rx: ctx.rand(5, 10), ry: ctx.rand(3, 7),
          fill: '#f0eef8', stroke: '#cfc9e0', 'stroke-width': 1,
        }, 'fx-dust');
      }
      if (k >= 1) {
        S.phase = 'land'; S.t = 0;
        ctx.swapSprite(slideFront(ctx.form)); // 落地现原形
        ctx.fxBurst(170, 596, 10, 8, 42);
        ctx.fxText('咚！', 170, 520, 26);
      }
      return true;
    }

    // land：压扁 + 弹一下
    S.t += dt;
    const k = Math.min(S.t / 0.4, 1);
    ctx.tf.ty = -24 * Math.sin(Math.PI * k);
    ctx.tf.sy = 0.82 + 0.18 * k + 0.06 * Math.sin(k * Math.PI);
    ctx.tf.sx = 1 - (ctx.tf.sy - 1) * 0.7;
    if (k >= 1) done();
    return true;
  },
});
