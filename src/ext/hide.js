// 捉迷藏（renderer 侧）：窗口隐身，ov_hide 在屏幕某个边角露半个头；
// 头被点中 → 跳到那个角现身「被找到啦！」；15s 没人找 → 自己出来嘟囔。
// 回执通道只能传 kind 字符串，故约定 'hide.found' / 'hide.timeout' 两种回执区分结局（seq 作第二参数）。
(() => {
  const INTRO = ['来找我呀！', '藏好啦，快来找~', '嘿嘿，你绝对找不到我'];
  const FOUND_LINE = '被找到啦！';
  const TIMEOUT_LINE = '哼，都不来找我…';

  const SPR = document.getElementById('sprite');
  let C = null;    // ctx：overlay 回执回调里读实时 state 用
  let spot = null; // { px, py, st } 藏起时的窗口位置与舞台（被找到后跳角定位用）
  let corner = 'tl';
  let fxSeq = 0;   // 会话令牌自增
  let mySeq = 0;   // 当前藏匿会话的令牌
  let wd = null;   // 打断看门狗

  // 回执订阅全程只挂这一次，靠状态判断认领，避免每次动作叠加监听
  window.pet.onFxExtDone((kind, receiptSeq) => {
    if (!C || C.state !== 'hide.hiding') return;
    if (receiptSeq !== undefined && receiptSeq !== mySeq) return; // 旧场次回执不认
    if (kind === 'hide.found') popOut(true);
    else if (kind === 'hide.timeout') popOut(false);
  });

  function disarm() {
    if (wd) { clearInterval(wd); wd = null; }
  }

  // 现身：被找到 → 跳到藏身的那个角；没人找 → 原地出来
  function popOut(found) {
    const ctx = C;
    disarm();
    if (found && spot) {
      const tx = corner === 'tl' || corner === 'bl' ? spot.st.minX : spot.st.maxX;
      const ty = corner === 'tl' || corner === 'tr' ? spot.st.minY : spot.st.floorY;
      ctx.moveBy(Math.round(tx - spot.px), Math.round(ty - spot.py));
    }
    SPR.style.visibility = 'visible';
    ctx.fxBurst(170, 300);
    if (found) {
      ctx.fxText(FOUND_LINE, 170, 258, 26);
      ctx.say(FOUND_LINE, 1600);
      ctx.addStat('mood', 4);
      ctx.logEvent('交互', '捉迷藏被找到了');
    } else {
      ctx.say(TIMEOUT_LINE, 1800);
      ctx.addStat('mood', -2);
      ctx.logEvent('自主', '捉迷藏没人找，自己出来了');
    }
    ctx.enter('hide.pop', 0.55);
  }

  registerAction({
    id: 'hide',
    lines: [...INTRO, FOUND_LINE, TIMEOUT_LINE],
    effect: { jing: -3, mood: 2 },
    start(ctx) {
      C = ctx;
      spot = null;
      mySeq = ++fxSeq;
      SPR.style.visibility = 'visible'; // 防上次异常残留隐身
      ctx.logEvent('自主', '玩捉迷藏，藏起来了');
      ctx.say(ctx.pick(INTRO), 1800);
      ctx.enter('hide.vanish', 0.55);
      // 隐身动画期间取好窗口位置和舞台，现身时不用再等 IPC
      Promise.all([ctx.getPos(), ctx.getStage()])
        .then(([p, st]) => { spot = { px: p[0], py: p[1], st }; })
        .catch(() => {});
      // 打断看门狗：hide.hiding 期间被拖走/菜单切动作，tick 停摆、回执被状态守卫丢弃，
      // 内核不会替扩展恢复 visibility → 立即现身 + 清会话 + 通知 overlay 收场
      disarm();
      wd = setInterval(() => {
        if (String(ctx.state).startsWith('hide.')) return;
        disarm();
        SPR.style.visibility = 'visible';
        spot = null;
        ctx.fxStart('hide', { done: true });
      }, 300);
    },
    tick(state, dt, t, ctx) {
      // 任何异常都不能把她留在隐身态
      try {
        if (state === 'hide.vanish') {
          // 翻牌旋没（swordform 同款退场）
          const k = Math.min(ctx.stateT / ctx.stateDur, 1);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          ctx.tf.rotY = 720 * e;
          const sc = 1 - 0.9 * e;
          ctx.tf.sx = sc; ctx.tf.sy = sc;
          if (k >= 1) {
            SPR.style.visibility = 'hidden';
            corner = ctx.pick(['tl', 'tr', 'bl', 'br']);
            ctx.fxStart('hide', { corner, seq: mySeq });
            ctx.enter('hide.hiding', 18);
          }
          return true;
        }
        if (state === 'hide.hiding') {
          // 兜底：overlay 失联（崩溃/重载/回执丢失）时到点自己现身，绝不永远隐身（swordwait 同款）
          if (ctx.stateT >= ctx.stateDur) {
            disarm();
            SPR.style.visibility = 'visible';
            ctx.say(TIMEOUT_LINE, 1800);
            ctx.logEvent('系统', '捉迷藏：覆盖层回执丢失，兜底现身');
            ctx.enter('hide.pop', 0.55);
          }
          return true;
        }
        if (state === 'hide.pop') {
          // 回弹现身
          const k = Math.min(ctx.stateT / ctx.stateDur, 1);
          const c1 = 1.70158, c3 = c1 + 1;
          const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
          ctx.tf.sx = e; ctx.tf.sy = e;
          if (k >= 1) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); }
          return true;
        }
        return false;
      } catch (e) {
        // 看门狗随后会发现状态离开 hide.*，代为通知 overlay 收场
        SPR.style.visibility = 'visible';
        ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 5);
        return true;
      }
    },
  });
})();
