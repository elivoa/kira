// 方向键逗宠：她说「按方向键抓我呀」，你按一次方向键她就跳开一小段（moveBy + 弹跳 ty）；
// 15s 内没被戳到 → 得意「抓不到我~」，被戳到 →「呜，被抓住了」。
// arrow-key 广播不带方向（main.js 只透传事件不带键值），降级为随机方向跳开。
(() => {
  const INTRO = ['按方向键抓我呀！', '来呀来呀，方向键抓我！'];
  const TAUNTS = ['抓不到我~', '这边这边！', '太慢啦~'];
  const WIN_LINE = '嘿嘿，抓不到我~ 我赢啦！';
  const CAUGHT_LINE = '呜，被抓住了';

  let C = null;    // ctx：按键/戳击回调里读实时 state 用
  let hop = null;  // { t, dur, dx, dy, frac } 进行中的跳开（frac = 已结算位移比例）
  let tauntAt = 5; // 下一次嘲讽的 stateT

  const active = () => C && C.state === 'arrowdodge.play';

  // 两个监听全程只挂这一次，靠状态判断认领——onArrowKey 无注销接口，
  // 每次动作都挂新监听会叠加泄漏；状态不由外部改成别的时，回调空转无害
  window.pet.onArrowKey(() => { if (active()) dodge(); });
  document.getElementById('stage').addEventListener('mousedown', (e) => {
    if (e.button === 0 && active()) caught();
  });

  function dodge() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    hop = { t: 0, dur: 0.38, dx: dir * (130 + Math.random() * 100), dy: -40 + Math.random() * 70, frac: 0 };
    if (Math.random() < 0.3) C.say(C.pick(TAUNTS), 900);
  }

  function caught() {
    const ctx = C;
    hop = null;
    ctx.say(CAUGHT_LINE, 1600);
    ctx.logEvent('交互', '方向键逗宠：被戳中了');
    ctx.enter('arrowdodge.caught', 0.7);
  }

  registerAction({
    id: 'arrowdodge',
    lines: [...INTRO, TAUNTS[0], CAUGHT_LINE],
    effect: { jing: -3, mood: 2 },
    start(ctx) {
      C = ctx;
      hop = null;
      tauntAt = 5;
      ctx.logEvent('自主', '开始方向键逗宠');
      ctx.say(ctx.pick(INTRO), 2000);
      ctx.enter('arrowdodge.play', 15);
    },
    tick(state, dt, t, ctx) {
      if (state === 'arrowdodge.play') {
        if (hop) {
          hop.t += dt;
          const k = Math.min(hop.t / hop.dur, 1);
          // 位移随时间 easeOut 结算，每帧只补未走过的增量（跳一半再按就直接换目标）
          const f = Math.sin(Math.PI * 0.5 * k);
          const df = f - hop.frac;
          hop.frac = f;
          ctx.moveBy(hop.dx * df, hop.dy * df);
          ctx.tf.ty = -58 * Math.sin(Math.PI * k);
          ctx.tf.sx = 1.04; ctx.tf.sy = 0.96;
          if (k >= 1) hop = null;
        } else {
          ctx.tf.sy = 1 + 0.012 * Math.sin(t * 2.2);
        }
        // 收尾前两秒不嘲讽，避免和胜利台词打架
        if (ctx.stateT >= tauntAt && ctx.stateT < ctx.stateDur - 2) {
          tauntAt = ctx.stateT + 4;
          ctx.say(ctx.pick(TAUNTS), 1200);
        }
        if (ctx.stateT >= ctx.stateDur) {
          ctx.say(WIN_LINE, 2000);
          ctx.addStat('mood', 3);
          ctx.logEvent('自主', '方向键逗宠：15 秒没被抓到，得意');
          ctx.enter('arrowdodge.win', 0.7);
        }
        return true;
      }
      if (state === 'arrowdodge.win') {
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.ty = -26 * Math.abs(Math.sin(Math.PI * 2 * k));
        if (k >= 1) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
        return true;
      }
      if (state === 'arrowdodge.caught') {
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        ctx.tf.sy = 1 - 0.16 * Math.sin(Math.PI * k);
        ctx.tf.rot = 2.5 * Math.sin(t * 26) * (1 - k); // 被戳懵的哆嗦
        if (k >= 1) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
        return true;
      }
      return false;
    },
  });
})();
