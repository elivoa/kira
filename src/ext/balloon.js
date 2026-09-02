// 气球漂流（chibi）：她从窗口里消失（sprite visibility hidden，同 swordform 的处理），
// overlay 画气球+软绳吊着她飘向屏幕另一边再飘回来（见 ov_balloon.js），
// 收到 fxDone 回执后现身回弹收尾；覆盖层失联有 35s 兜底，绝不永远隐身。
(function () {
  const MY_LINES = ['气球要起飞咯~', '带我去旅行！', '飘呀飘……', '抓稳咯，出发！'];
  let bl = null;      // { iv, receipt } 进行中的会话
  let blCtx = null;
  let hooked = false; // onFxDone 只许挂一次（每调一次多一个 IPC 监听）

  function show(v) {
    const sp = document.getElementById('sprite');
    if (sp) sp.style.visibility = v ? 'visible' : 'hidden';
  }

  function cleanup(notify) {
    if (!bl) return;
    clearInterval(bl.iv);
    show(true);
    if (notify && blCtx) blCtx.fxStart('balloon', { done: true }); // 让 overlay 提前收
    bl = null;
  }

  function easeOutBack(k) {
    const c = 1.70158, u = k - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  registerAction({
    id: 'balloon',
    lines: MY_LINES,
    effect: { jing: -4, mood: 4 },
    start(ctx) {
      // Q版专属（菜单手动触发会绕过 forms 过滤，得自己守）
      if (ctx.form !== 'chibi') { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(2, 4); return; }
      blCtx = ctx;
      if (!hooked) {
        hooked = true;
        ctx.onFxDone((kind) => { if (kind === 'balloon' && bl) bl.receipt = true; });
      }
      cleanup(true); // 防上次残留：旧 overlay 会话还在的话一并收掉
      ctx.say(ctx.pick(MY_LINES), 1600);
      bl = { receipt: false, iv: null };
      // 出发点 = 她胸口的屏幕坐标（ctx 拿不到缩放系数，用 sprite 的 CSS 盒 + 窗口位置换算）
      const sp = document.getElementById('sprite');
      if (sp) {
        const r = sp.getBoundingClientRect();
        ctx.getPos().then(([px, py]) => {
          if (!bl) return;
          ctx.fxStart('balloon', {
            x: Math.round(px + r.left + r.width / 2),
            y: Math.round(py + r.top + r.height * 0.42),
          });
        }).catch(() => {});
      }
      show(false);
      ctx.enter('balloon.wait');
      // 打断看门狗：被拖走/菜单切动作等外部切走时立刻现身（tick 在 built-in 状态下不会被调到）
      bl.iv = setInterval(() => {
        if (!bl) return;
        if (!String(ctx.state).startsWith('balloon.')) cleanup(true);
      }, 300);
    },
    tick(state, dt, t, ctx) {
      if (state === 'balloon.wait') {
        if (!bl || bl.receipt) { // 回执到了：现身 + 爆星回弹
          cleanup(false);
          ctx.fxBurst(170, 300, 12, 12, 56);
          ctx.fxText('锵！', 170, 250, 30);
          ctx.enter('balloon.back', 0.55);
          return true;
        }
        if (ctx.stateT > 35) { // 覆盖层失联兜底
          cleanup(true);
          ctx.enter('balloon.back', 0.55);
          return true;
        }
        return true;
      }
      if (state === 'balloon.back') {
        const k = Math.min(ctx.stateT / ctx.stateDur, 1);
        const e = easeOutBack(k);
        ctx.tf.sx = e;
        ctx.tf.sy = e;
        if (ctx.stateT >= ctx.stateDur) {
          ctx.enter('idle');
          ctx.idleWait = ctx.nextIdleWait(3, 6);
        }
        return true;
      }
      return false;
    },
  });
})();
