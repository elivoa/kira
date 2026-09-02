// 蹦迪：原地跳舞 6~10s——脚下小弹跳 + 左右摇摆 + 每拍快速翻面交替，
// 音符「♪」「♫」随机飘，脚下按节拍冒彩色小点，最后摆个 pose 收尾。
// 纯窗口内实现，不需要 overlay 特效。
const DANCE_POINT_SRC = '../assets/point.png';
new Image().src = DANCE_POINT_SRC; // 预加载，收尾 pose 换图不闪

const DANCE_BEAT = 0.45;
const DANCE_COLORS = ['#ff6b9d', '#ffd166', '#6bd5ff', '#b79bff', '#7ff0b2'];

function danceFront(form) {
  return {
    normal: '../assets/pet.png',
    chibi: '../assets/chibi.png',
    flute: '../assets/flute.png',
    note: '../assets/note.png',
    back: '../assets/pet_back.png',
  }[form] || '../assets/pet.png';
}

let danceSt = null; // { ready, st, py, phase, t, dur, lastBeat, poseDur }

registerAction({
  id: 'dance',
  lines: ['蹦迪时间到！', '音乐响起来~', '跟我一起摇摆！', '这拍子，绝了！'],
  effect: { jing: -4, shen: -2, mood: 5 },
  start(ctx) {
    ctx.say(ctx.pick(LINES.dance), 1600);
    danceSt = { ready: false };
    ctx.enter('dance', 15); // 15s 硬超时兜底
    Promise.all([ctx.getStage(), ctx.getPos()]).then(([st, [px, py]]) => {
      if (ctx.state !== 'dance' || !danceSt) return; // 初始化期间被打断，放弃
      danceSt = {
        ready: true, st, py,
        phase: py < st.floorY - 4 ? 'pre' : 'dance',
        t: 0, dur: ctx.rand(6, 10), lastBeat: -1, poseDur: 1.1,
      };
    }).catch(() => {
      if (ctx.state === 'dance') { danceSt = null; ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
    });
  },
  tick(state, dt, t, ctx) {
    if (state !== 'dance') return false;
    const done = () => {
      danceSt = null;
      ctx.swapSprite(danceFront(ctx.form));
      ctx.enter('idle');
      ctx.idleWait = ctx.nextIdleWait(3, 6);
    };
    if (ctx.stateT >= ctx.stateDur) { done(); return true; } // 硬超时兜底
    const D = danceSt;
    if (!D || !D.ready) return true; // IPC 初始化未回，占位等下一帧

    if (D.phase === 'pre') {
      // 不在地面先落地再开跳
      ctx.tf.sy = 1.06; ctx.tf.sx = 0.96;
      const dy = D.st.floorY - D.py;
      const step = 700 * dt;
      if (dy <= step) { ctx.moveBy(0, dy); D.py = D.st.floorY; D.phase = 'dance'; D.t = 0; }
      else { ctx.moveBy(0, step); D.py += step; }
      return true;
    }

    if (D.phase === 'dance') {
      D.t += dt;
      if (D.dur - D.t <= D.poseDur) {
        // 留最后一秒摆 pose：姐姐换指人图，Q 版定格弹一下
        D.phase = 'pose'; D.t = 0;
        if (ctx.form === 'normal') {
          ctx.swapSprite(DANCE_POINT_SRC);
          ctx.fxText('耶~！', 170, 120, 32);
        } else {
          ctx.fxBurst(170, 300, 10, 8, 40);
        }
        return true;
      }
      const ph = D.t / DANCE_BEAT;
      const beat = Math.floor(ph);
      const frac = ph - beat;
      ctx.tf.ty = -13 * Math.sin(Math.PI * frac); // 每拍一次小弹跳
      ctx.tf.rot = 9 * Math.sin(Math.PI * ph);    // 两拍一个左右摇摆循环
      // 快速翻面：每拍翻 180°，前 35% 拍内翻完，正反面交替
      const fk = Math.min(frac / 0.35, 1);
      const fe = fk < 0.5 ? 2 * fk * fk : 1 - Math.pow(-2 * fk + 2, 2) / 2; // easeInOut
      ctx.tf.rotY = 180 * beat + 180 * fe;
      // 节拍特效：跨拍瞬间飘音符 + 脚下冒彩点
      if (beat !== D.lastBeat) {
        D.lastBeat = beat;
        if (Math.random() < 0.8) {
          ctx.fxText(ctx.pick(['♪', '♫']), ctx.rand(90, 250), ctx.rand(110, 300), ctx.rand(20, 32));
        }
        for (let i = 0; i < 3; i++) {
          ctx.fxEl('circle', {
            cx: ctx.rand(110, 230), cy: ctx.rand(570, 606), r: ctx.rand(3, 6),
            fill: ctx.pick(DANCE_COLORS),
          }, 'fx-pop');
        }
      }
      return true;
    }

    // pose：定格炫耀一下
    D.t += dt;
    const k = Math.min(D.t / D.poseDur, 1);
    if (ctx.form === 'normal') {
      ctx.tf.rot = 4 * Math.sin(k * Math.PI * 2);
      ctx.tf.rotY = 0;
    } else {
      ctx.tf.sy = 1 + 0.1 * Math.sin(k * Math.PI);
      ctx.tf.rotY = 0;
    }
    if (k >= 1) done();
    return true;
  },
});
