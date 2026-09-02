// 打滚：团成球贴地横滚 200~400px（旋 2~3 圈），起身后头晕晃两下收尾。
// 纯窗口内实现：横移走 moveBy，旋转/团缩走 tf，不需要 overlay 特效。
const ROLL_SIDE_SRC = '../assets/pet_side.png';
new Image().src = ROLL_SIDE_SRC; // 预加载，开滚换图不闪

// 各形态正面图（收尾换回来用；与 renderer.js 的 FORMS 对齐，不引用其内部变量）
function rollFront(form) {
  return {
    normal: '../assets/pet.png',
    chibi: '../assets/chibi.png',
    flute: '../assets/flute.png',
    note: '../assets/note.png',
    back: '../assets/pet_back.png',
  }[form] || '../assets/pet.png';
}

let rollSt = null; // { ready, st, py, dir, dist, phase, t, dur, laps, moved, bodyR, dustT, sx0 }

registerAction({
  id: 'roll',
  lines: ['滚来滚去~', '看我团成一团！', '咕噜咕噜——', '晕乎乎…'],
  effect: { jing: -3, mood: 3 },
  start(ctx) {
    ctx.say(ctx.pick(LINES.roll), 1600);
    rollSt = { ready: false };
    ctx.enter('roll', 9); // 9s 硬超时，任何相卡死都由 tick 兜底回 idle
    Promise.all([ctx.getStage(), ctx.getPos()]).then(([st, [px, py]]) => {
      if (ctx.state !== 'roll' || !rollSt) return; // 初始化期间被打断，放弃
      const dir = (px - st.minX >= st.maxX - px) ? -1 : 1; // 朝空间更大的一侧滚
      const room = (dir > 0 ? st.maxX - px : px - st.minX) - 16;
      const dist = Math.max(50, Math.min(ctx.rand(200, 400), room));
      rollSt = {
        ready: true, st, py, dir, dist,
        phase: py < st.floorY - 4 ? 'pre' : 'spin',
        t: 0, dur: 1.3 + dist / 500,
        laps: dist >= 300 ? 3 : 2,
        moved: 0, sx0: 0,
        bodyR: ctx.form === 'chibi' ? 110 : 170, // 团起来后的滚动半径，pivot 抬高贴地
        dustT: 0,
      };
      // 姐姐换侧面图滚；Q 版没有侧面素材，直接团正面滚
      ctx.swapSprite(ctx.form === 'normal' ? ROLL_SIDE_SRC : rollFront(ctx.form));
    }).catch(() => {
      if (ctx.state === 'roll') { rollSt = null; ctx.swapSprite(rollFront(ctx.form)); ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
    });
  },
  tick(state, dt, t, ctx) {
    if (state !== 'roll') return false;
    const done = () => {
      rollSt = null;
      ctx.swapSprite(rollFront(ctx.form));
      ctx.enter('idle');
      ctx.idleWait = ctx.nextIdleWait(3, 6);
    };
    if (ctx.stateT >= ctx.stateDur) { done(); return true; } // 硬超时兜底
    const R = rollSt;
    if (!R || !R.ready) return true; // IPC 初始化未回，占位等下一帧

    if (R.phase === 'pre') {
      // 不在地面先快速落下
      ctx.tf.sy = 1.06; ctx.tf.sx = 0.96;
      const dy = R.st.floorY - R.py;
      const step = 700 * dt;
      if (dy <= step) { ctx.moveBy(0, dy); R.py = R.st.floorY; R.phase = 'spin'; R.t = 0; }
      else { ctx.moveBy(0, step); R.py += step; }
      return true;
    }

    if (R.phase === 'spin') {
      R.t += dt;
      const k = Math.min(R.t / R.dur, 1);
      const e = 1 - (1 - k) * (1 - k); // easeOut：蹬一脚起步，越滚越慢
      const target = R.dir * R.dist * e;
      ctx.moveBy(target - R.moved, 0);
      R.moved = target;
      ctx.tf.rot = R.dir * 360 * R.laps * e;
      // 团缩：起步/收尾各 15% 行程内渐入渐出
      const sq = k < 0.15 ? k / 0.15 : (k > 0.85 ? (1 - k) / 0.15 : 1);
      ctx.tf.sy = 1 - 0.38 * sq;
      ctx.tf.sx = 1 + 0.14 * sq;
      ctx.tf.ty = -R.bodyR * sq; // 旋转 pivot 抬到球心，球贴地滚
      R.dustT -= dt;
      if (R.dustT <= 0) {
        R.dustT = 0.16;
        ctx.fxEl('ellipse', {
          cx: 170 + ctx.rand(-26, 26), cy: 606 - ctx.rand(0, 8),
          rx: ctx.rand(6, 11), ry: ctx.rand(4, 7),
          fill: '#f0eef8', stroke: '#cfc9e0', 'stroke-width': 1,
        }, 'fx-dust');
      }
      if (k >= 1) {
        R.phase = 'rise'; R.t = 0;
        ctx.swapSprite(rollFront(ctx.form)); // 起身换回正面
        ctx.fxText('晕~', 170, ctx.form === 'chibi' ? 250 : 120, 30);
      }
      return true;
    }

    // rise：头晕晃两下
    R.t += dt;
    const k = Math.min(R.t / 0.9, 1);
    ctx.tf.rot = 9 * Math.sin(k * Math.PI * 3) * (1 - k);
    ctx.tf.sy = 1 + 0.06 * Math.sin(k * Math.PI);
    if (k >= 1) done();
    return true;
  },
});
