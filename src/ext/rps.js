// 石头剪刀布：她出拳（fxText 亮拳），自问自答「猜」你出的、当场判胜负，2~3 回合。
// 不接 miniChat 输入（保持自包含）：预判台词自带主角光环，总胜场多 → 开心，输多 → 赌气。
(() => {
  const THROWS = [
    { e: '✊', n: '石头' },
    { e: '✌️', n: '剪刀' },
    { e: '🖐', n: '布' },
  ];
  const INTRO = ['石头剪刀布！', '来猜拳嘛，三局两胜！'];
  const WIN_LINE = '耶，我赢啦！';
  const LOSE_LINE = '哼，不玩了！';
  const ROUND_S = 2.0;    // 每回合时长（秒）
  const REVEAL_AT = 1.1;  // 亮拳时刻（蓄力挥拳之后）

  let rounds = null; // [{ mine, guess, result: 'win'|'lose'|'tie' }]
  let fired = -1;    // 已亮拳的回合号
  let judged = false;

  // a 是否赢 b（石头→剪刀→布循环克制）
  const beats = (a, b) => (b - a + 3) % 3 === 1;

  function makeRounds() {
    const n = Math.random() < 0.5 ? 2 : 3;
    const rs = [];
    for (let i = 0; i < n; i++) {
      const mine = (Math.random() * 3) | 0;
      // 她的预判带点主角光环：55% 赢、30% 输、15% 平
      const r = Math.random();
      const guess = r < 0.55 ? (mine + 2) % 3 : r < 0.85 ? (mine + 1) % 3 : mine;
      rs.push({ mine, guess, result: beats(mine, guess) ? 'win' : beats(guess, mine) ? 'lose' : 'tie' });
    }
    return rs;
  }

  registerAction({
    id: 'rps',
    lines: [...INTRO, WIN_LINE, LOSE_LINE],
    effect: { jing: -2, mood: 2 },
    start(ctx) {
      rounds = makeRounds();
      fired = -1;
      judged = false;
      ctx.logEvent('自主', '拉着你猜拳');
      ctx.say(ctx.pick(INTRO), 1600);
      ctx.enter('rps.play', rounds.length * ROUND_S + 1.0);
    },
    tick(state, dt, t, ctx) {
      if (state !== 'rps.play') return false;
      const n = rounds.length;
      const r = Math.floor(ctx.stateT / ROUND_S);
      const rt = ctx.stateT - r * ROUND_S;
      if (r < n) {
        if (rt < REVEAL_AT) {
          // 蓄力挥拳三下：石头——剪刀——布！
          ctx.tf.ty = -15 * Math.abs(Math.sin(Math.PI * 3 * (rt / REVEAL_AT)));
        } else {
          if (fired < r) {
            fired = r;
            const rd = rounds[r];
            ctx.fxText(THROWS[rd.mine].e, 148, 250, 52);
            ctx.fxText(THROWS[rd.guess].e + '?', 226, 272, 28);
            ctx.say(`我出${THROWS[rd.mine].n}！你肯定出${THROWS[rd.guess].n}…` +
              (rd.result === 'win' ? '赢啦！' : rd.result === 'lose' ? '呜，输了…' : '平了？！'), 1700);
            ctx.logEvent('自主', `猜拳第${r + 1}回合：出${THROWS[rd.mine].n}，${rd.result === 'win' ? '她赢' : rd.result === 'lose' ? '她输' : '平'}`);
          }
          // 亮拳后的小顿挫
          const k = Math.min((rt - REVEAL_AT) / 0.3, 1);
          ctx.tf.sy = 1 - 0.05 * Math.sin(Math.PI * k);
        }
      }
      if (!judged && ctx.stateT >= n * ROUND_S + 0.8) {
        judged = true;
        const wins = rounds.filter((x) => x.result === 'win').length;
        const losses = rounds.filter((x) => x.result === 'lose').length;
        if (wins > losses) {
          ctx.say(WIN_LINE, 1800);
          ctx.fxBurst(170, 300);
          ctx.addStat('mood', 3);
        } else if (wins < losses) {
          ctx.say(LOSE_LINE, 1800);
          ctx.fxText('哼', 238, 190, 26);
          ctx.addStat('mood', -1);
        } else {
          ctx.say('平局！下次再战！', 1800);
        }
        ctx.enter('idle');
        ctx.idleWait = ctx.nextIdleWait(3, 6);
      }
      return true;
    },
  });
})();
