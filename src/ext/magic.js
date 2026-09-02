// 变魔术（normal）：挥笛子当魔术棒 → 笛子旋转隐去 → 变出卡牌悬浮旋转 → 爆星「锵锵！」消失。
// 笛子/卡牌都是 fxEl 建的 SVG image（700ms 自删），每帧重建+摆位；停止重建即消失，被打断也无残留。
(function () {
  const MY_LINES = ['见证奇迹的时刻！', '魔术时间~', '看好了，别眨眼！', '变变变——'];
  const FLUTE_W = 64, FLUTE_H = Math.round(64 * 1483 / 695); // 素材 695×1483 竖笛
  const CARD_W = 84, CARD_H = Math.round(84 * 58 / 54);       // 素材 54×58
  let prop = null; // { flute, card } 当前持有的道具元素

  function easeOutBack(k) {
    const c = 1.70158, u = k - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  // 道具图锚定中心，transform 只管平移/旋转/缩放
  function ensureImg(ctx, old, href, w, h) {
    if (old && old.isConnected) return old;
    return ctx.fxEl('image', { href, width: w, height: h, x: -w / 2, y: -h / 2 }, null);
  }

  registerAction({
    id: 'magic',
    lines: MY_LINES,
    effect: { qi: -4, mood: 3 },
    start(ctx) {
      prop = { flute: null, card: null, sparkT: 0 };
      ctx.say(ctx.pick(MY_LINES), 1500);
      ctx.enter('magic.wand', 1.4);
    },
    tick(state, dt, t, ctx) {
      if (state !== 'magic.wand' && state !== 'magic.card' && state !== 'magic.pop') { prop = null; return false; }
      if (!prop) prop = { flute: null, card: null, sparkT: 0 };

      if (state === 'magic.wand') {
        // 笛子当魔术棒，在她右手上方来回挥
        prop.flute = ensureImg(ctx, prop.flute, '../assets/flute.png', FLUTE_W, FLUTE_H);
        const rot = -35 + 30 * Math.sin(ctx.stateT * Math.PI * 2 * 1.4);
        prop.flute.setAttribute('transform', `translate(235,322) rotate(${rot})`);
        // 棒尖撒火花
        prop.sparkT -= dt;
        if (prop.sparkT <= 0) {
          ctx.fxEl('circle', { cx: 235 + ctx.rand(-14, 14), cy: 250 + ctx.rand(-10, 10), r: ctx.rand(1.5, 3.5), fill: '#cdb9ff' }, 'fx-pop');
          prop.sparkT = 0.12;
        }
        ctx.tf.rot = -3 + 3 * Math.sin(ctx.stateT * Math.PI * 2 * 1.4);
        if (ctx.stateT >= ctx.stateDur) ctx.enter('magic.card', 2.0);
        return true;
      }

      if (state === 'magic.card') {
        // 前 0.35s 笛子加速旋转缩小隐去（之后停止重建，自动消失）
        const fk = Math.min(ctx.stateT / 0.35, 1);
        if (fk < 1) {
          prop.flute = ensureImg(ctx, prop.flute, '../assets/flute.png', FLUTE_W, FLUTE_H);
          prop.flute.setAttribute('transform', `translate(235,322) rotate(${fk * 540}) scale(${1 - fk})`);
        } else prop.flute = null;
        // 卡牌弹出后悬浮自旋 2s
        prop.card = ensureImg(ctx, prop.card, '../assets/card.png', CARD_W, CARD_H);
        const pop = easeOutBack(Math.min(ctx.stateT / 0.3, 1));
        const fy = 300 + 8 * Math.sin(ctx.stateT * 3);
        prop.card.setAttribute('transform', `translate(170,${fy}) rotate(${ctx.stateT * 260}) scale(${pop})`);
        // 牌周偶尔闪星
        prop.sparkT -= dt;
        if (prop.sparkT <= 0) {
          ctx.fxEl('circle', { cx: 170 + ctx.rand(-46, 46), cy: fy + ctx.rand(-40, 40), r: ctx.rand(1.5, 3), fill: '#ffe9a8' }, 'fx-pop');
          prop.sparkT = 0.2;
        }
        if (ctx.stateT >= ctx.stateDur) {
          prop.card = null; // 停止重建即消失
          ctx.fxBurst(170, 300, 12, 12, 56);
          ctx.fxText('锵锵！', 170, 240, 36);
          ctx.enter('magic.pop', 1.0);
        }
        return true;
      }

      // 收尾小鞠躬
      const k = Math.min(ctx.stateT / ctx.stateDur, 1);
      const bow = Math.sin(Math.PI * k);
      ctx.tf.ty = 12 * bow;
      ctx.tf.rot = 8 * bow;
      if (ctx.stateT >= ctx.stateDur) {
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(3, 6);
      }
      return true;
    },
  });
})();
