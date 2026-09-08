// 数星星：她坐下仰头，overlay（ov_stargaze）在屏幕上半部撒星星、偶尔划流星；
// 她一颗颗数出来，8~12s 后让 overlay 淡出，收 fxDone 回执再收尾。
(() => {
  const STATES = new Set(['stargaze.watch', 'stargaze.wait']);
  let S = null;          // 进行中场次
  let fxSeq = 0;         // 会话令牌自增（防打断后快速重开的旧回执串台）
  let doneHooked = false; // 回执只订一次（ipcRenderer.on 重复调用会累加）

  function mine(ctx) { return STATES.has(ctx.state); }

  function cleanup(ctx, foreign) {
    if (!S) return;
    clearInterval(S.guard);
    const s = S.seq;
    S = null;
    // 被打断（拖走/菜单换动作）：让 overlay 把星星收掉；重复发 end 对 overlay 无害
    if (foreign) ctx.fxStart('stargaze', { phase: 'end', seq: s });
  }

  function finish(ctx) {
    cleanup(ctx, false);
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(4, 7);
  }

  registerAction({
    id: 'stargaze',
    lines: ['今晚星星好多呀', '一起来数星星吧', '那颗最亮的是我吗？', '数星星数到睡着…'],
    effect: { mood: 2, shen: 1 },
    start(ctx) {
      if (S) return;
      if (!doneHooked) {
        doneHooked = true;
        ctx.onFxDone((kind, receiptSeq) => {
          if (kind !== 'stargaze' || !S || !mine(ctx)) return;
          if (receiptSeq !== undefined && receiptSeq !== S.seq) return; // 旧场次回执不认
          ctx.say(ctx.pick(['数着数着就困了…', '晚安，星星们', '明天还要一起来看哦']), 1800);
          finish(ctx);
        });
      }
      // 数数的序列：1 颗、3 颗、6 颗……随机递增
      const nums = [1];
      while (nums.length < 7) nums.push(nums[nums.length - 1] + 1 + Math.ceil(Math.random() * 4));
      S = { nums, idx: 0, countT: 1.0, seq: ++fxSeq };
      // 打断看门狗：状态被切走就收掉会话并通知 overlay 收场
      S.guard = setInterval(() => {
        if (S && !mine(ctx)) cleanup(ctx, true);
      }, 400);
      ctx.say(ctx.pick(LINES.stargaze), 1800);
      ctx.fxStart('stargaze', { phase: 'start', seq: S.seq });
      ctx.enter('stargaze.watch', ctx.rand(8, 12));
    },
    tick(state, dt, t, ctx) {
      if (state === 'stargaze.watch') {
        if (!S) { ctx.enter('idle'); ctx.idleWait = ctx.nextIdleWait(3, 6); return true; }
        // 坐下仰头：微微后仰 + 身体略沉略扁
        const e = Math.min(ctx.stateT / 0.8, 1);
        ctx.tf.rot = -6 * e;
        ctx.tf.ty = 6 * e;
        ctx.tf.sy = 1 - 0.04 * e;
        S.countT -= dt;
        if (S.countT <= 0 && S.idx < S.nums.length) {
          ctx.fxText(`${S.nums[S.idx++]} 颗…`, 170 + ctx.rand(-50, 50), 250 + ctx.rand(-30, 10), 24);
          S.countT = ctx.rand(1.1, 1.9);
        }
        if (ctx.stateT >= ctx.stateDur) {
          ctx.fxStart('stargaze', { phase: 'end', seq: S.seq }); // overlay 星星淡出，完了给回执
          ctx.enter('stargaze.wait', 5); // 5s 没回执自己兜底收尾（覆盖层失联场景）
        }
        return true;
      }
      if (state === 'stargaze.wait') {
        // 等回执期间把坐姿回正，回执落地即回待机
        const e = Math.min(ctx.stateT / 0.5, 1);
        ctx.tf.rot = -6 * (1 - e);
        ctx.tf.ty = 6 * (1 - e);
        ctx.tf.sy = 1 - 0.04 * (1 - e);
        if (ctx.stateT >= ctx.stateDur) finish(ctx);
        return true;
      }
      return false;
    },
  });
})();
