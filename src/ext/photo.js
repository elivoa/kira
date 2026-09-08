// 自拍：overlay 取景框框住她 1s → 全屏白闪 +「咔嚓！」→ 拍立得照片在角落旋转弹出、
// 停留 2s 再缩小消失（ov_photo.js）；她在这边摆 pose（姐姐换 point.png 指镜头，
// Q版 rotY 微侧 + sy 挺直）。全程约 3.6s，overlay 回报 fxDone('photo') 提前收尾；8s 兜底。
(() => {
  let extCtx = null;
  let poseForm = 'normal';
  let fxSeq = 0;  // 会话令牌自增
  let mySeq = 0;  // 当前拍摄会话的令牌
  let wd = null;  // 立绘看门狗

  function finish() {
    const ctx = extCtx;
    if (!ctx || ctx.state !== 'photo.pose') return;
    clearInterval(wd); wd = null;
    if (poseForm === 'normal') ctx.swapSprite('../assets/pet.png'); // 换回正脸立绘
    ctx.enter('idle');
    ctx.idleWait = ctx.nextIdleWait(3, 6);
  }

  registerAction({
    id: 'photo',
    lines: ['来，看镜头~', '茄子——！', '今天要美美哒', '咔嚓一声，留住现在'],
    effect: { mood: 3, jing: -1 },
    start(ctx) {
      if (!extCtx) { // 回执只订阅一次，EXT_CTX 是单例
        extCtx = ctx;
        ctx.onFxDone((kind, receiptSeq) => {
          if (kind === 'photo' && (receiptSeq === undefined || receiptSeq === mySeq)) finish();
        });
      }
      mySeq = ++fxSeq;
      ctx.say(ctx.pick(LINES.photo), 1600);
      poseForm = ctx.form;
      if (poseForm === 'normal') ctx.swapSprite('../assets/point.png'); // 指镜头的 pose
      ctx.enter('photo.pose', 8); // 兜底时长：正常 ~3.6s 由 fxDone 提前收尾
      // 打断看门狗：菜单/大模型切动作不会换回立绘（拖拽路径内核会换），指人图不能赖着
      clearInterval(wd);
      wd = setInterval(() => {
        if (extCtx && extCtx.state === 'photo.pose') return;
        clearInterval(wd); wd = null;
        if (poseForm === 'normal' && extCtx) extCtx.swapSprite('../assets/pet.png');
      }, 300);
      // 窗口左上角 + 形态给 overlay 定位取景框和照片贴图；拿到时动作已结束就不拍了
      ctx.getPos().then(([px, py]) => {
        if (extCtx && extCtx.state === 'photo.pose') ctx.fxStart('photo', { x: px, y: py, form: poseForm, seq: mySeq });
      }).catch(() => {});
    },
    tick(state, dt, t, ctx) {
      if (state !== 'photo.pose') return false;
      ctx.tf.rotY = 14; // 微微侧身
      ctx.tf.sy = 1.02; // 挺直一点
      ctx.tf.ty = -1.5 * Math.abs(Math.sin(ctx.stateT * 2.2));
      if (ctx.stateT >= ctx.stateDur) finish();
      return true;
    },
  });
})();
