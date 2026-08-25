// 桌宠渲染层：动画状态机 + 鼠标交互
const sprite = document.getElementById('sprite');
const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');

// ---------- 状态机 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// 状态: idle / walk / hop / land / spin / sway / drag / poke
//      / turnaway / away / gone / back / turnfront （走了走了系列）
let state = 'idle';
let stateT = 0;          // 当前状态已进行时间（秒）
let stateDur = 0;        // 当前状态总时长
let idleWait = 3;
let facing = 1;          // 朝向：1 正向，-1 镜像（走路时用）
let walkDir = 1;
let hopVy = 0, hopY = 0;
let bubbleTimer = null;
let curSize = 1;         // 走远时的缩放（1 = 正常大小）
let sizeFrom = 1;        // 走回来时的起始缩放
let goneStarT = 2;       // 消失期间星光闪烁的间隔计时
let lastInteract = performance.now() / 1000; // 最近一次互动时间，太久不理她会走掉

const IGNORE_AFTER = 40; // 秒，超过这么久没互动就「走了走了」
const FAR_Y = -50;       // 走远后向上飘的距离（px）
// 与 main.js 的窗口尺寸保持一致
const WIN_W = 340;
const WIN_H = 620;

const FRONT_SRC = '../assets/pet.png';
const BACK_SRC = '../assets/pet_back.png';
const CHIBI_SRC = '../assets/chibi.png';
const SIDE_SRC = '../assets/pet_side.png'; // 侧面图（朝左，镜像即朝右），姐姐形态走路/侧面暴走用

// 双形态：正常版 / Q版（Q版没有背面图，走远时沿用正面图）
const FORMS = {
  normal: { front: FRONT_SRC, back: BACK_SRC, height: 512 },
  chibi: { front: CHIBI_SRC, back: CHIBI_SRC, height: 330 },
};
let form = 'normal';
new Image().src = BACK_SRC;  // 预加载，转身/变身时不闪
new Image().src = CHIBI_SRC;
new Image().src = SIDE_SRC;

// ---------- 点击穿透 ----------
// 默认鼠标事件穿透到下层窗口；光标落在角色不透明像素（或法宝卡牌）上时才接管交互
let mouseIgnored = true;  // 与主进程创建时的 setIgnoreMouseEvents(true) 一致
let clickThrough = true;
let lastOver = false;
const alphaCache = {};

// 为每张立绘建一份 1/4 分辨率的 alpha 位图，用于命中检测
function buildAlpha(src) {
  if (alphaCache[src]) return;
  const img = new Image();
  img.onload = () => {
    const w = Math.ceil(img.naturalWidth / 4);
    const h = Math.ceil(img.naturalHeight / 4);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    alphaCache[src] = { w, h, data: ctx.getImageData(0, 0, w, h).data };
  };
  img.src = src;
}
[FRONT_SRC, BACK_SRC, SIDE_SRC, CHIBI_SRC].forEach(buildAlpha);

function overSprite(cx, cy) {
  const r = sprite.getBoundingClientRect();
  if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
    const m = alphaCache[sprite.dataset.cur];
    if (!m) return true; // 位图未建好先按命中处理
    const px = Math.min(m.w - 1, Math.max(0, Math.floor((cx - r.left) / r.width * m.w)));
    const py = Math.min(m.h - 1, Math.max(0, Math.floor((cy - r.top) / r.height * m.h)));
    return m.data[(py * m.w + px) * 4 + 3] > 30;
  }
  // 法宝卡牌悬浮时也可点
  if (cardImg.style.display === 'block') {
    const cr = cardImg.getBoundingClientRect();
    if (cx >= cr.left && cx <= cr.right && cy >= cr.top && cy <= cr.bottom) return true;
  }
  return false;
}

// 点击穿透：渲染层根据光标是否在角色上来回切换
function updateMouseIgnore(over) {
  lastOver = over;
  const want = clickThrough ? !over : false;
  if (want !== mouseIgnored) {
    mouseIgnored = want;
    window.pet.setMouseIgnore(want);
  }
}

window.addEventListener('mousemove', (e) => updateMouseIgnore(overSprite(e.clientX, e.clientY)));

const LINES = {
  poke: ['呜哇！', '别戳啦~', '嘿嘿', '干嘛呀？', '再戳我就不理你了！', '♪'],
  hop: ['嘿咻！', '飞起来了~'],
  spin: ['转圈圈~', '晕晕的...'],
  sway: ['♪~', '啦啦啦~'],
  walk: ['散散步~', '去哪儿呢？'],
  drag: ['要被带走啦！', '轻一点嘛~'],
  leave: ['哼，不理你了，走了走了', '走了走了！', '都不理我...走了'],
  back: ['我回来啦', '知道想我了？', '哼，还是回来陪你了'],
  morph: ['变身！', '锵锵~', '变~'],
  qbounce: ['蹦蹦跳~', '跳起来啦', '嘿嘿，看我！'],
  qsway: ['摇呀摇~', '♪♪', '左摇右摆~'],
  ledge: ['上去看看！', '站高高~', '这边风景好~'],
  gohome: ['回去咯', '玩够了，回家~', '该回去了'],
  dash: ['暴走！', '冲鸭！', '让开让开！'],
  dashSide: ['跑起来！', '哒哒哒哒', '跟上我！'],
  fly: ['御剑飞行！', '起飞咯~', '看我能飞多高'],
  poop: ['你讨厌！', '哼！接招！', '讨厌鬼！'],
  desk: ['喝口茶~', '休息一下', '工作辛苦啦', '陪我坐会儿吧'],
  seal: ['收！', '进法宝里待着~', '法宝，开！'],
  sword: ['剑来！', '变成剑咯', '御剑……不如成剑！'],
  drive: ['去兜风！', '上车！', '带你飞一圈'],
  mischief: ['嘿嘿，捣乱咯', '挡住挡住~', '就不让你点！'],
  lonely: ['喂——还在吗？', '看我一眼嘛…', '我是不是很透明？', '有人吗…'],
  angry: ['你别碰我。', '把你的脏手拿开。', '烦死了！', '手拿开！（超凶）', '再戳我真的生气了！', '呜……你欺负我！'],
};

function enter(next, dur = 0) {
  state = next;
  stateT = 0;
  stateDur = dur;
  // 离开飘移状态时清掉影子和灯笼
  if (next !== 'walk' && next !== 'gohome') hideFloatFx();
}

function say(text, ms = 1800) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

// ---------- 数值面板 ----------
const statsPanel = document.getElementById('statsPanel');
let statsTimer = null;

// 渲染并展示数值面板，几秒后自动收起
function showStats() {
  statsPanel.innerHTML = STATS_META.map((m) => {
    const v = Math.round(stats[m.key]);
    return `<div class="st-row">
      <span class="st-name">${m.name}${m.desc ? `·${m.desc}` : ''}</span>
      <span class="st-bar"><span class="st-fill" style="width:${v}%;background:${m.color}"></span></span>
      <span class="st-val">${v}</span>
    </div>`;
  }).join('');
  statsPanel.classList.add('show');
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => statsPanel.classList.remove('show'), 5000);
}

function spawnHeart() {  const h = document.createElement('div');
  h.className = 'heart';
  h.textContent = pick(['💜', '💙', '✨', '🎵']);
  const r = sprite.getBoundingClientRect();
  h.style.left = `${r.left + r.width * rand(0.3, 0.7)}px`;
  h.style.top = `${r.top + r.height * rand(0.1, 0.35)}px`;
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 1000);
}

// ---------- 漫画特效（SVG） ----------
const fx = document.getElementById('fx');
const SVG_NS = 'http://www.w3.org/2000/svg';
// 立绘脚底在窗口中的位置（立绘锚定底部居中）
const FOOT_X = 170, FOOT_Y = 616;

function fxEl(tag, attrs, cls, parent = fx) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (cls) el.setAttribute('class', cls);
  parent.appendChild(el);
  setTimeout(() => el.remove(), 700);
  return el;
}

// 持久 SVG 元素（不自动移除，用于桌子等场景道具）
function fxRaw(tag, attrs, parent = fx) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  parent.appendChild(el);
  return el;
}

// ---------- 飘移特效：地面影子 + 两个红灯笼 ----------
let shadowEl = null;
let lanternA = null, lanternB = null;

function makeLantern() {
  const g = fxRaw('g', {});
  fxRaw('ellipse', { cx: 0, cy: 0, rx: 13, ry: 16, fill: '#e04536', stroke: '#a02618', 'stroke-width': 1.5 }, g);
  fxRaw('ellipse', { cx: 0, cy: -3, rx: 6, ry: 9, fill: 'rgba(255,190,120,.35)' }, g); // 灯光
  fxRaw('rect', { x: -6, y: -20, width: 12, height: 5, rx: 2, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1 }, g);
  fxRaw('rect', { x: -6, y: 15, width: 12, height: 5, rx: 2, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1 }, g);
  fxRaw('line', { x1: 0, y1: 20, x2: 0, y2: 30, stroke: '#a02618', 'stroke-width': 1.5 }, g);
  fxRaw('rect', { x: -2.5, y: 30, width: 5, height: 9, rx: 2, fill: '#e04536' }, g); // 穗子
  return g;
}

function showFloatFx() {
  if (!shadowEl) shadowEl = fxRaw('ellipse', { cx: 170, cy: 612, rx: 60, ry: 10, fill: 'rgba(20,20,50,0.28)' });
  if (!lanternA) lanternA = makeLantern();
  if (!lanternB) lanternB = makeLantern();
}

function updateFloatFx(h, dir, t) {
  // 影子：飘得越高，影子越小越淡
  const k = Math.max(0.5, 1 - h / 60);
  shadowEl.setAttribute('rx', 60 * k);
  shadowEl.setAttribute('ry', 10 * k);
  shadowEl.setAttribute('opacity', 0.28 * k);
  // 灯笼一前一后跟在后面，各有自己的起伏节奏
  lanternA.setAttribute('transform',
    `translate(${170 - dir * 88 + 8 * Math.sin(t * 1.3)},${380 - h * 0.6 + 10 * Math.sin(t * 2.1)}) rotate(${6 * Math.sin(t * 1.7)})`);
  lanternB.setAttribute('transform',
    `translate(${170 - dir * 138 + 10 * Math.sin(t * 1.1 + 2)},${320 - h * 0.6 + 12 * Math.sin(t * 1.8 + 1)}) rotate(${-5 * Math.sin(t * 1.5)})`);
}

function hideFloatFx() {
  if (shadowEl) { shadowEl.remove(); shadowEl = null; }
  if (lanternA) { lanternA.remove(); lanternA = null; }
  if (lanternB) { lanternB.remove(); lanternB = null; }
}

// 爆裂星：多角星形，漫画冲击效果
function fxBurst(x, y, spikes = 12, r1 = 10, r2 = 48) {
  let pts = '';
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? r2 : r1;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts += `${x + r * Math.cos(a)},${y + r * Math.sin(a)} `;
  }
  fxEl('polygon', { points: pts, fill: '#fff', stroke: '#1a1a2e', 'stroke-width': 4, 'stroke-linejoin': 'round' }, 'fx-pop');
}

// 速度线：白底描边 + 深色芯，任何壁纸上都看得见
function fxSpeedLine(dir) {
  const g = fxEl('g', {}, 'fx-line');
  const x0 = FOOT_X - dir * rand(20, 50);
  const y = rand(360, 600);
  const len = rand(60, 140);
  const x1 = x0 - dir * len;
  fxEl('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#fff', 'stroke-width': 5, 'stroke-linecap': 'round' }, null, g);
  fxEl('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#1a1a2e', 'stroke-width': 2, 'stroke-linecap': 'round' }, null, g);
}

// 尘土：刹车/转向时脚下冒烟
function fxDust(x, y, n = 3) {
  for (let i = 0; i < n; i++) {
    const g = fxEl('g', {}, 'fx-dust');
    fxEl('ellipse', {
      cx: x + rand(-26, 26), cy: y - rand(0, 8),
      rx: rand(6, 12), ry: rand(4, 8),
      fill: '#f0eef8', stroke: '#cfc9e0', 'stroke-width': 1,
    }, null, g);
  }
}

// 四角星光：走远消失 / 走回来时闪烁
function fxStar(x, y, s = 1) {
  const L = 10 * s;
  fxEl('polygon', {
    points: `0,${-L} ${L * 0.25},${-L * 0.25} ${L},0 ${L * 0.25},${L * 0.25} 0,${L} ${-L * 0.25},${L * 0.25} ${-L},0 ${-L * 0.25},${-L * 0.25}`,
    fill: '#ffe9a8',
    stroke: '#e8b84a',
    'stroke-width': 1.5,
    transform: `translate(${x},${y})`,
  }, 'fx-pop');
}

// 拟声词：ドンッ / ビュンッ，漫画字（白描边黑字）
function fxText(str, x, y, size = 34) {
  fxEl('text', {
    x, y,
    'text-anchor': 'middle',
    'font-family': '"PingFang SC", sans-serif',
    'font-weight': 900,
    'font-style': 'italic',
    'font-size': size,
    fill: '#1a1a2e',
    stroke: '#fff',
    'stroke-width': 7,
    'paint-order': 'stroke',
  }, 'fx-pop').textContent = str;
}

// ---------- 桌子场景 ----------
// SVG 画一张木桌（带茶杯），立绘放大上移，胸部以上露出桌面，下半身藏桌后
const DESK_TY = 339; // 立绘就位后的下移量（让胸部正好在桌面上沿）
let pendingDesk = false; // Q版触发上桌时，先变回姐姐再上桌

function showDesk() {
  if (document.getElementById('desk')) return;
  const g = fxRaw('g', { id: 'desk' });
  g.style.transform = 'translateY(170px)';
  g.style.transition = 'transform .5s ease-out';

  const defs = fxRaw('defs', {}, g);
  const grad = fxRaw('linearGradient', { id: 'wood', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  fxRaw('stop', { offset: '0%', 'stop-color': '#b5824f' }, grad);
  fxRaw('stop', { offset: '100%', 'stop-color': '#8f5f33' }, grad);

  // 桌面 + 高光 + 桌体（不透明，挡住下半身）
  fxRaw('rect', { x: 8, y: 455, width: 324, height: 22, rx: 4, fill: 'url(#wood)', stroke: '#6e4522', 'stroke-width': 2 }, g);
  fxRaw('rect', { x: 8, y: 455, width: 324, height: 4, rx: 2, fill: 'rgba(255,255,255,.35)' }, g);
  fxRaw('rect', { x: 8, y: 477, width: 324, height: 143, fill: '#7a4e2a', stroke: '#5e3a1c', 'stroke-width': 2 }, g);
  // 桌体木纹分隔线
  fxRaw('line', { x1: 116, y1: 479, x2: 116, y2: 618, stroke: '#6b4223', 'stroke-width': 2, opacity: 0.5 }, g);
  fxRaw('line', { x1: 224, y1: 479, x2: 224, y2: 618, stroke: '#6b4223', 'stroke-width': 2, opacity: 0.5 }, g);

  // 茶杯 + 热气
  const cup = fxRaw('g', {}, g);
  fxRaw('rect', { x: 248, y: 439, width: 28, height: 17, rx: 3, fill: '#fff', stroke: '#9a93b8', 'stroke-width': 2 }, cup);
  fxRaw('path', { d: 'M276 443 q11 4 0 11', fill: 'none', stroke: '#9a93b8', 'stroke-width': 2.5 }, cup);
  fxRaw('path', { d: 'M256 431 q3 -6 0 -12 q-3 -6 0 -12', fill: 'none', stroke: '#d8d4e8', 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.8 }, cup);
  fxRaw('path', { d: 'M266 431 q3 -6 0 -12 q-3 -6 0 -12', fill: 'none', stroke: '#d8d4e8', 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.6 }, cup);

  requestAnimationFrame(() => { g.style.transform = 'translateY(0)'; });
}

function hideDesk() {
  const g = document.getElementById('desk');
  if (!g) return;
  g.style.transform = 'translateY(170px)';
  setTimeout(() => g.remove(), 550);
}

// 立刻撤掉桌子、恢复立绘高度（拖拽/切换动作时兜底）
function resetDesk() {
  const g = document.getElementById('desk');
  if (g) g.remove();
  sprite.style.height = FORMS[form].height + 'px';
}

// ---------- 动作 ----------
let pokeTimes = []; // 近期被戳时间，连续戳太多次她会生气扔屎
let pokeStreak = 0;   // 连续点击计数（间隔超过 2.5 秒清零）
let lastPokeAt = 0;

function doPoke() {
  addStat('shen', -6);  // 被戳消耗耐心
  addStat('mood', 2);   // 但也开心被关注
  const now = performance.now();
  // 隐藏彩蛋的连续点击计数：先记上这一下
  pokeStreak = now - lastPokeAt < 2500 ? pokeStreak + 1 : 1;
  lastPokeAt = now;
  pokeTimes = pokeTimes.filter((t) => now - t < 8000);
  pokeTimes.push(now);
  // 隐藏彩蛋：连续点击 10 次，炸毛（优先于扔屎判定）
  if (pokeStreak >= 10) {
    pokeStreak = 0;
    logEvent('交互', '被连续戳了 10 下，炸毛了');
    enter('poke', 0.38);
    say(pick(LINES.angry), 2200);
    return;
  }
  // 耐心耗尽或连戳太多次：生气扔屎
  if (pokeTimes.length >= 5 || stats.shen < 15) {
    pokeTimes = [];
    applyEffect('poop');
    logEvent('交互', '被戳烦了，生气地扔了一坨屎');
    doPoop();
    return;
  }
  logEvent('交互', '被戳了一下');
  enter('poke', 0.38);
  spawnHeart();
  if (Math.random() < 0.5) say(pick(LINES.poke));
}

function doHop() {
  hopVy = -660; // 起跳初速度，配合重力跳到 ~80px
  hopY = 0;
  enter('hop');
  say(pick(LINES.hop), 1200);
}

function doSpin() {
  enter('spin', 0.65);
  say(pick(LINES.spin), 1200);
}

function doSway() {
  enter('sway', 1.8);
  say(pick(LINES.sway), 1500);
}

function doWalk() {
  walkDir = Math.random() < 0.5 ? -1 : 1;
  if (form === 'normal') {
    // 姐姐形态用侧面图散步：先翻牌转成侧面，侧图朝左，facing = -walkDir 保证镜像方向正确
    facing = -walkDir;
    enter('walkin', 0.32);
  } else {
    facing = walkDir;
    enter('walk', rand(1.6, 3));
  }
  if (Math.random() < 0.4) say(pick(LINES.walk), 1500);
}

// 走了走了：翻牌转身换背面图 → 走远缩小 → 远处待一会儿 → 走回来 → 转身换回正面
function doLeave() {
  enter('turnaway', 0.5);
  say(pick(LINES.leave), 2000);
}

function doBack() {
  // 换回正面图走回来（消失中换图，不突兀）
  const front = FORMS[form].front;
  if (sprite.dataset.cur !== front) { sprite.dataset.cur = front; sprite.src = front; }
  sprite.style.visibility = 'visible';
  facing = 1;
  sizeFrom = 0.05;
  curSize = 0.05;
  fxStar(170, 560, 1.4); // 回来时的闪现星光
  enter('back', 2);
}

// 翻牌转身：前 1/4 圈压扁到侧面，换图，再转完剩余 3/4 圈
// onSwap 在换图瞬间回调（变身时用来切形态、换高度）
function turnFrame(k, newSrc, onSwap) {
  if (k < 0.5) return 90 * (k * 2);
  if (sprite.dataset.cur !== newSrc) {
    sprite.dataset.cur = newSrc;
    sprite.src = newSrc;
    if (onSwap) onSwap();
  }
  return 270 + 90 * (k * 2 - 1);
}

// 变身：翻牌中途切换形态和立绘高度
let nextForm = 'chibi';
function doMorph() {
  doMorphTo(form === 'normal' ? 'chibi' : 'normal');
}

// 切换到指定形态
function doMorphTo(target) {
  if (target === form || state === 'morph') return;
  nextForm = target;
  enter('morph', 0.6);
  spawnHeart();
  say(pick(LINES.morph), 1000);
}

// Q版专属动作
function doQBounce() {
  enter('qbounce', 1.5);
  if (Math.random() < 0.6) say(pick(LINES.qbounce), 1200);
}

function doQSway() {
  enter('qsway', 1.6);
  if (Math.random() < 0.6) say(pick(LINES.qsway), 1200);
}

// 去窗台玩：找到最前台窗口的上沿 → 走过去 → 沿边缘踱步 → 跳下来
// ledge: { tx, ty, minX, maxX, floorY, dir, px, py, vy }，px/py 是渲染层估计的窗口位置
let ledge = null;

async function doGoLedge() {
  const l = await window.pet.findLedge();
  if (!l) { idleWait = nextIdleWait(2, 4); return; }
  const [px, py] = await window.pet.getPos();
  ledge = {
    tx: Math.min(Math.max(px, l.minX), l.maxX),
    ty: l.y - WIN_H,
    minX: l.minX,
    maxX: l.maxX,
    floorY: l.floorY,
    dir: Math.random() < 0.5 ? -1 : 1,
    px, py,
    vy: 0,
  };
  enter('goledge');
  say(pick(LINES.ledge), 1500);
}

// ---------- 暴走模式 ----------
// 在屏幕底部高速往返：起步蓄力 → 加速冲刺 → 到边急转（纸片人翻牌）→ 来回数趟 → 急停冒烟
let dash = null;

async function doDash() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  // 姐姐形态一半概率换成侧面奔跑版暴走
  const side = form === 'normal' && Math.random() < 0.5;
  // 先朝更远的那侧跑，第一趟更长
  const dir = px > (st.minX + st.maxX) / 2 ? -1 : 1;
  dash = {
    ...st, px, py,
    sub: py < st.floorY - 4 ? 'pre' : 'start', // 不在地面先落地
    subT: 0,
    v: 0, dir, side,
    laps: 0, maxLaps: 5 + ((Math.random() * 3) | 0),
    flipT: 1,        // 转身翻牌进度（1 = 没在翻）
    lineT: 0,        // 速度线生成间隔
    dustT: 0,
    skidDusted: false,
  };
  enter('dash');
  say(side ? pick(LINES.dashSide) : pick(LINES.dash), 1500);
}

// 暴走单帧逻辑，返回是否已消费本帧（true 时不再走其它状态）
function dashFrame(dt) {
  dash.subT += dt;
  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;
  const d = dash;

  // 急转时的纸片人翻牌：0.22s 转 180°
  if (d.flipT < 1) {
    d.flipT = Math.min(1, d.flipT + dt / 0.22);
    rotY = 180 * easeInOut(d.flipT);
  }

  if (d.sub === 'pre') {
    // 先快速落到地面
    const dy = d.floorY - d.py;
    const step = 600 * dt;
    sy = 1.08; sx = 0.95; // 下落拉伸
    if (dy <= step) { window.pet.moveBy(0, dy); d.py = d.floorY; d.sub = 'start'; d.subT = 0; }
    else { window.pet.moveBy(0, step); d.py += step; }
  } else if (d.sub === 'start') {
    // 起步蓄力：下蹲压缩
    const k = Math.min(d.subT / 0.28, 1);
    sy = 1 - 0.2 * k; sx = 1 + 0.16 * k;
    if (k >= 1) {
      d.sub = 'run'; d.subT = 0;
      d.v = 700;
      fxBurst(FOOT_X, FOOT_Y - 30);
      if (d.side) {
        // 侧面奔跑版：爆裂瞬间换成侧面图
        sprite.dataset.cur = SIDE_SRC;
        sprite.src = SIDE_SRC;
        facing = -d.dir;
        fxText('哒哒哒', FOOT_X, 360);
      } else {
        fxText(pick(['ドンッ', 'ドドド']), FOOT_X, 360);
      }
      fxDust(FOOT_X, FOOT_Y, 4);
    }
  } else if (d.sub === 'run') {
    // 侧面奔跑版更快更猛
    d.v = Math.min(d.v + (d.side ? 5000 : 4200) * dt, d.side ? 2200 : 1900);
    let nx = d.px + d.dir * d.v * dt;
    let turned = false;
    if (nx <= d.minX) { nx = d.minX; turned = true; }
    if (nx >= d.maxX) { nx = d.maxX; turned = true; }
    window.pet.moveBy(nx - d.px, 0);
    d.px = nx;
    // 速度线拖尾
    d.lineT -= dt;
    if (d.lineT <= 0 && d.v > 900) { fxSpeedLine(d.dir); d.lineT = d.side ? 0.03 : 0.045; }
    if (d.side) {
      // 大步奔跑：高颠簸 + 大前倾 + 脚步扬尘
      ty = -Math.abs(Math.sin(d.subT * 26)) * 9;
      sy = 1 + 0.05 * Math.sin(d.subT * 26);
      rot = d.dir * 15;
      skew = -d.dir * 10;
      d.dustT -= dt;
      if (d.dustT <= 0 && d.v > 1200) { fxDust(FOOT_X - d.dir * 30, FOOT_Y, 1); d.dustT = 0.18; }
    } else {
      // 快步颠簸 + 前倾 + 侧倾
      ty = -Math.abs(Math.sin(d.subT * 22)) * 5;
      rot = d.dir * 7;
      skew = -d.dir * 8;
    }
    if (turned) {
      if (d.side) {
        d.sub = 'skid'; d.subT = 0; // 侧面版：急刹滑步
      } else {
        // 到边急转：翻牌掉头 + 反倾 + 冒烟，重新加速
        d.dir *= -1;
        d.flipT = 0;
        d.v = 1000;
        d.laps++;
        fxDust(FOOT_X, FOOT_Y, 4);
        if (Math.random() < 0.5) fxText('ビュンッ', FOOT_X, 340, 28);
        if (d.laps >= d.maxLaps) { d.sub = 'stop'; d.subT = 0; }
      }
    }
  } else if (d.sub === 'skid') {
    // 侧面版急刹：滑步 + 后仰 + 扬尘，然后镜像掉头接着冲
    d.v = Math.max(d.v - 3200 * dt, 900);
    window.pet.moveBy(d.dir * d.v * dt, 0);
    rot = -d.dir * 12;
    skew = -d.dir * 4;
    ty = -Math.abs(Math.sin(d.subT * 18)) * 4;
    if (d.subT > 0.08 && !d.skidDusted) { d.skidDusted = true; fxDust(FOOT_X, FOOT_Y, 6); }
    if (d.subT >= 0.32) {
      d.dir *= -1;
      facing = -d.dir; // 侧面图镜像即换向
      d.skidDusted = false;
      d.laps++;
      if (Math.random() < 0.5) fxText('哒哒哒', FOOT_X, 340, 26);
      if (d.laps >= d.maxLaps) { d.sub = 'stop'; d.subT = 0; }
      else { d.sub = 'run'; d.subT = 0; }
    }
  } else if (d.sub === 'stop') {
    // 急停：强减速 + 后仰
    d.v = Math.max(d.v - 4800 * dt, 0);
    const nx = d.px + d.dir * d.v * dt;
    window.pet.moveBy(nx - d.px, 0);
    d.px = nx;
    rot = -d.dir * 10;
    skew = -d.dir * 5;
    if (d.v <= 100) {
      fxDust(FOOT_X, FOOT_Y, 6);
      fxText('フーッ', FOOT_X, 350, 26);
      if (d.side) {
        // 跑完换回正面图
        sprite.dataset.cur = FORMS[form].front;
        sprite.src = FORMS[form].front;
        facing = 1;
      }
      enter('idle');
      idleWait = nextIdleWait(3, 6);
    }
  }
  // 侧面奔跑/急刹时按倾斜角反向补偿位移，避免立绘被窗口边缘裁掉
  if (d.side && (d.sub === 'run' || d.sub === 'skid' || d.sub === 'stop')) {
    tx = -FORMS[form].height * Math.sin(rot * Math.PI / 180) * 0.55;
  }
  return { tx, ty, rot, rotY, sx, sy, skew };
}

// ---------- 御剑飞行 ----------
// 起飞爬升 → 高空波浪巡航（到边纸片人掉头）→ 滑翔落地
let fly = null;

async function doFly() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  fly = {
    ...st, px, py,
    startY: py,
    sub: 'takeoff', subT: 0,
    dir: px > (st.minX + st.maxX) / 2 ? -1 : 1,
    cruiseY: st.minY + rand(80, 300),
    laps: 0, maxLaps: 2 + (Math.random() < 0.5 ? 1 : 0),
    flipT: 1, lineT: 0, texted: false,
  };
  enter('fly');
  say(pick(LINES.fly), 1600);
}

function flyFrame(dt) {
  const f = fly;
  f.subT += dt;
  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;

  if (f.flipT < 1) {
    f.flipT = Math.min(1, f.flipT + dt / 0.25);
    rotY = 180 * easeInOut(f.flipT);
  }

  if (f.sub === 'takeoff') {
    // 爬升：窗口升到巡航高度，前倾加大
    const k = easeInOut(Math.min(f.subT / 0.9, 1));
    const ny = f.startY + (f.cruiseY - f.startY) * k;
    window.pet.moveBy(f.dir * 120 * dt, ny - f.py);
    f.py = ny;
    f.px += f.dir * 120 * dt;
    rot = f.dir * 10 * k;
    skew = -f.dir * 4 * k;
    sy = 1 + 0.05 * Math.sin(f.subT * 10);
    if (!f.texted) { f.texted = true; fxText('嗖——', FOOT_X, 300); }
    if (k >= 1) { f.sub = 'cruise'; f.subT = 0; }
  } else if (f.sub === 'cruise') {
    // 波浪巡航：y 随 x 正弦起伏，身体随坡度倾斜
    const SPEED = 650;
    let nx = f.px + f.dir * SPEED * dt;
    let turned = false;
    if (nx <= f.minX) { nx = f.minX; turned = true; }
    if (nx >= f.maxX) { nx = f.maxX; turned = true; }
    const ny = f.cruiseY + 45 * Math.sin(nx / 160);
    window.pet.moveBy(nx - f.px, ny - f.py);
    f.px = nx; f.py = ny;
    rot = f.dir * 8 + f.dir * Math.cos(nx / 160) * 4;
    skew = -f.dir * 4;
    ty = -2 * Math.abs(Math.sin(f.subT * 6));
    f.lineT -= dt;
    if (f.lineT <= 0) { fxSpeedLine(f.dir); f.lineT = 0.08; }
    if (turned) {
      f.dir *= -1;
      f.flipT = 0;
      f.laps++;
      if (Math.random() < 0.4) fxText('嗖', FOOT_X, 320, 26);
      if (f.laps >= f.maxLaps) { f.sub = 'glide'; f.subT = 0; f.landFromY = f.py; }
    }
  } else if (f.sub === 'glide') {
    // 滑翔落地：缓降 + 回正
    const k = easeInOut(Math.min(f.subT / 0.9, 1));
    const ty2 = f.landFromY + (f.floorY - f.landFromY) * k;
    window.pet.moveBy(0, ty2 - f.py);
    f.py = ty2;
    rot = f.dir * 10 * (1 - k);
    skew = -f.dir * 4 * (1 - k);
    if (k >= 1) {
      fxDust(FOOT_X, FOOT_Y, 3);
      enter('land', 0.16);
    }
  }
  // 飞行时略微缩小 + 按倾斜角反向补偿位移，保证立绘不被窗口边缘裁掉；滑翔时平滑恢复
  if (f.sub === 'glide') {
    curSize = 0.85 + 0.15 * Math.min(f.subT / 0.9, 1);
  } else {
    curSize = 0.85;
  }
  tx = -FORMS[form].height * curSize * Math.sin(rot * Math.PI / 180) * 0.55;
  return { tx, ty, rot, rotY, sx, sy, skew };
}

// ---------- 你讨厌！ ----------
// 后撤蓄力 → 甩出（屎由覆盖层接管）→ 收势
let poopThrown = false;

function doPoop() {
  poopThrown = false;
  enter('poopthrow', 0.65);
  say(pick(LINES.poop), 1800);
}

// ---------- 化身成剑 ----------
// 化成剑光飞出（本体隐藏），剑在覆盖层上飞行，回来后变回人形
function doSword() {
  enter('swordform', 0.7);
  say(pick(LINES.sword), 1500);
}

// 剑飞回来了：闪光中变回人形
window.pet.onSwordEnd(() => {
  sprite.style.visibility = 'visible';
  fxBurst(FOOT_X, 300, 12, 12, 56);
  fxText('锵！', FOOT_X, 320, 30);
  enter('swordback', 0.5);
});

// ---------- 兜风 ----------
// 闪进保时捷（覆盖层开车巡游），回来后原地现身
function doDrive() {
  enter('driveform', 0.55);
  say(pick(LINES.drive), 1500);
}

window.pet.onDriveEnd(() => {
  sprite.style.visibility = 'visible';
  fxBurst(FOOT_X, 300, 12, 12, 56);
  fxText('到家咯', FOOT_X, 320, 26);
  enter('driveback', 0.5);
});

// ---------- 捣乱 ----------
// 跑去覆盖层追鼠标，被晃掉或到时间后归位
function doMischief() {
  enter('mischiefform', 0.5);
  say(pick(LINES.mischief), 1500);
}

window.pet.onMischiefEnd(() => {
  sprite.style.visibility = 'visible';
  fxBurst(FOOT_X, 300, 12, 12, 56);
  say(pick(['哼，算你狠', '下次还敢', '呜呜，被甩掉了']), 1800);
  enter('swordback', 0.5);
});

// ---------- 收进法宝（姐姐形态专属） ----------
// 腰间的 K 卡牌飞出 → 她被吸入卡牌 → 卡牌悬浮一阵 → 放她出来
const cardImg = document.createElement('img');
cardImg.id = 'cardImg';
cardImg.src = '../assets/card.png';
stage.appendChild(cardImg);

const WAIST = { x: 195, y: 346 }; // 卡牌在腰间时的窗口坐标（姐姐形态）
const WAIST_CHIBI = { x: 168, y: 505 }; // Q版腰间卡牌的窗口坐标
const FLOAT_POS = { x: 170, y: 290 }; // 卡牌悬浮位置
let seal = null;
let pendingSeal = false;

function cardShow(x, y, s, r, o) {
  cardImg.style.display = 'block';
  cardImg.style.opacity = o;
  cardImg.style.transform = `translate(${x - 24}px, ${y - 31}px) rotate(${r}deg) scale(${s})`;
}

function cardHide() { cardImg.style.display = 'none'; }

function doSeal() {
  if (form === 'chibi') { pendingSeal = true; doMorph(); return; }
  seal = { sub: 'emerge', subT: 0, floatDur: 0, sparkT: 0, said: false };
  enter('seal');
  say(pick(LINES.seal), 1500);
}

function sealFrame(dt) {
  const s = seal;
  s.subT += dt;
  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;

  if (s.sub === 'emerge') {
    // 卡牌从腰间飞出到悬浮位，微微张开
    const k = Math.min(s.subT / 0.6, 1);
    const e = easeInOut(k);
    cardShow(
      WAIST.x + (FLOAT_POS.x - WAIST.x) * e,
      WAIST.y + (FLOAT_POS.y - WAIST.y) * e,
      0.6 + 0.9 * e,
      -8 + 8 * e,
      1);
    rot = -6 * Math.sin(Math.PI * k);
    if (k >= 1) { s.sub = 'suck'; s.subT = 0; }
  } else if (s.sub === 'suck') {
    // 螺旋缩小被吸进卡牌，卡牌脉动发光
    const k = Math.min(s.subT / 0.9, 1);
    const e = easeInOut(k);
    ty = -320 * e;
    tx = 20 * Math.sin(k * 4 * Math.PI) * (1 - k);
    const sc = 1 - 0.98 * e;
    sx = sc; sy = sc;
    rotY = 720 * e;
    cardShow(FLOAT_POS.x, FLOAT_POS.y, 1.5 + 0.15 * Math.sin(k * 6 * Math.PI), 0, 1);
    if (k >= 1) {
      sprite.style.visibility = 'hidden';
      fxBurst(FLOAT_POS.x, FLOAT_POS.y);
      fxText('收！', FLOAT_POS.x, FLOAT_POS.y - 60, 30);
      s.sub = 'float'; s.subT = 0;
      s.floatDur = rand(5, 8);
    }
  } else if (s.sub === 'float') {
    // 只有卡牌悬浮：上下浮动 + 慢转 + 星光
    cardShow(
      FLOAT_POS.x,
      FLOAT_POS.y + 8 * Math.sin(s.subT * 2),
      1.5 + 0.05 * Math.sin(s.subT * 3),
      4 * Math.sin(s.subT * 1.3),
      1);
    s.sparkT -= dt;
    if (s.sparkT <= 0) {
      fxEl('circle', { cx: FLOAT_POS.x + rand(-34, 34), cy: FLOAT_POS.y + rand(-44, 24), r: rand(1.5, 3.5), fill: '#cdb9ff' }, 'fx-pop');
      s.sparkT = rand(0.3, 0.8);
    }
    if (s.subT > 2 && !s.said && Math.random() < 0.35) { s.said = true; say('放我出去~', 1500); }
    if (s.subT >= s.floatDur) {
      s.sub = 'release'; s.subT = 0;
      fxBurst(FLOAT_POS.x, FLOAT_POS.y, 12, 12, 60);
      sprite.style.visibility = 'visible';
    }
  } else if (s.sub === 'release') {
    // 弹出：scale 回弹，卡牌飞回腰间淡出
    const k = Math.min(s.subT / 0.7, 1);
    const e = easeOutBack(k);
    ty = -320 * (1 - e);
    sx = e; sy = e;
    const ke = easeInOut(k);
    cardShow(
      FLOAT_POS.x + (WAIST.x - FLOAT_POS.x) * ke,
      FLOAT_POS.y + (WAIST.y - FLOAT_POS.y) * ke,
      1.5 - ke, 8 * ke, 1 - ke);
    if (k >= 1) { cardHide(); enter('idle'); idleWait = nextIdleWait(3, 6); }
  }
  return { tx, ty, rot, rotY, sx, sy, skew };
}

function easeOutBack(k) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

// ---------- 来张桌子（姐姐形态专属） ----------
// 立绘放大到 700px 并下移，胸部以上露出桌面，下半身被桌体挡住
function doDesk() {
  if (form === 'chibi') { pendingDesk = true; doMorph(); return; }
  sprite.style.height = '700px';
  showDesk();
  enter('deskin', 0.6);
  say(pick(LINES.desk), 1800);
}

// ---------- 动作开关（设置页控制，只影响待机自动播放，右键菜单始终可用） ----------
let actionEnabled = {}; // 缺省 = 全开
window.pet.getSettings().then((s) => {
  actionEnabled = s || {};
  clickThrough = actionEnabled._clickThrough !== false;
  if (actionEnabled._home) homePos = actionEnabled._home; // 上次的常驻位置
});
window.pet.onSettings((s) => {
  actionEnabled = s || {};
  clickThrough = actionEnabled._clickThrough !== false; // 点击穿透默认开
  updateMouseIgnore(lastOver);
  // 拖动频率滑块会连续触发，节流到 3 秒一条
  if (Date.now() - lastSettingsLog > 3000) {
    lastSettingsLog = Date.now();
    logEvent('系统', '更新了设置');
  }
});

function enabled(id) { return actionEnabled[id] !== false; }

// ---------- 常驻位置 ----------
// 被拖拽到的落点 = 她应该呆着的位置；自主动作跑远了，闲置一段时间会自己走回去
let homePos = null;
let awaySince = null;
let homeward = null;

window.pet.getPos().then(([x, y]) => {
  if (!homePos) homePos = { x, y };
});

// 离家检查：超过 120px 且持续 25 秒以上，就走回家
async function checkHome() {
  if (!homePos) return false;
  const [px, py] = await window.pet.getPos();
  const dist = Math.hypot(px - homePos.x, py - homePos.y);
  if (dist < 120) { awaySince = null; return false; }
  if (!awaySince) { awaySince = performance.now() / 1000; return false; }
  if (performance.now() / 1000 - awaySince > 25) {
    awaySince = null;
    doGoHome();
    return true;
  }
  return false;
}

async function doGoHome() {
  if (!homePos) return;
  const [px, py] = await window.pet.getPos();
  const dir = homePos.x >= px ? 1 : -1;
  homeward = { tx: homePos.x, ty: homePos.y, px, py };
  logEvent('自主', '玩够了，走回常驻位置');
  // 姐姐形态用侧面图走，Q版直接镜像走
  if (form === 'normal') { facing = -dir; enter('gohomein', 0.32); }
  else { facing = dir; enter('gohome'); }
  if (Math.random() < 0.6) say(pick(LINES.gohome), 1500);
}

// ---------- 日志（自主动作 / 交互 / 系统事件） ----------
function logEvent(type, text) {
  window.pet.logAppend({ t: Date.now(), type, text });
}

// 设置变更日志节流，拖动滑块时不刷屏
let lastSettingsLog = 0;

// 动作频率（设置页滑块）：同时影响待机间隔和「继续发呆」的权重
function freqFactor() { return actionEnabled._freq || 1; }

function nextIdleWait(a, b) { return rand(a, b) / freqFactor(); }

// ---------- 小Kira 的数值 ----------
// 精（体力）：做动作消耗，剧烈动作耗得多，随时间/坐桌子恢复
// 气（法力）：法术类动作消耗（飞行/变身/收法宝），不足时放不出法术
// 神（耐心）：被戳/被拎消耗，太低会生气扔屎，不被打扰时缓慢恢复
// 心情：互动涨、被冷落降，影响待机动作倾向
// 透明值：一直不理她会涨，超过 30 开始变透明，互动立刻恢复
const stats = { jing: 80, qi: 60, shen: 80, mood: 70, touming: 0 };

const STATS_META = [
  { key: 'jing', name: '精', desc: '体力', color: '#e0a458' },
  { key: 'qi', name: '气', desc: '法力', color: '#7d6fd0' },
  { key: 'shen', name: '神', desc: '耐心', color: '#5aa8c8' },
  { key: 'mood', name: '心情', desc: '', color: '#e06a8a' },
  { key: 'touming', name: '透明', desc: '存在感', color: '#9a93b8' },
];

function addStat(key, delta) {
  stats[key] = Math.min(100, Math.max(0, stats[key] + delta));
  if (key === 'touming') applyTouming();
}

// 透明值 → 立绘不透明度：30 以下不变，最淡也只到 0.5
function applyTouming() {
  const t = stats.touming;
  sprite.style.opacity = t <= 30 ? 1 : Math.max(0.5, 1 - (t - 30) / 100);
}

// 动作对数值的影响（进入动作时结算一次）
const EFFECTS = {
  walk: { jing: -3, mood: 1 },
  hop: { jing: -4, mood: 2 },
  spin: { jing: -3, mood: 2 },
  sway: { jing: -2, mood: 3 },
  qbounce: { jing: -5, mood: 3 },
  qsway: { jing: -2, mood: 3 },
  morph: { qi: -5, mood: 2 },
  desk: { jing: 15, qi: 5, mood: 2 },
  seal: { qi: -10 },
  goledge: { jing: -6, mood: 2 },
  dash: { jing: -12, mood: 2 },
  fly: { jing: -8, qi: -12, mood: 3 },
  poop: { shen: 15, mood: -3 },
  leave: { mood: -5 },
  sword: { qi: -10, jing: -4, mood: 3 },
  drive: { jing: -3, mood: 5 },
  mischief: { jing: -3, mood: 4 },
};

// 体力和法力不够的动作做不来
function canAfford(id) {
  const e = EFFECTS[id] || {};
  return stats.jing >= -(e.jing || 0) && stats.qi >= -(e.qi || 0);
}

function applyEffect(id) {
  const e = EFFECTS[id] || {};
  for (const k in e) addStat(k, e[k]);
}

const DISPATCH = {
  walk: doWalk, hop: doHop, spin: doSpin, sway: doSway,
  qbounce: doQBounce, qsway: doQSway, morph: doMorph,
  desk: doDesk, seal: doSeal, goledge: doGoLedge,
  dash: doDash, fly: doFly, poop: doPoop, sword: doSword, drive: doDrive, mischief: doMischief,
};

// 心情好更爱玩开心动作，心情差不想玩
const HAPPY_ACTIONS = new Set(['sway', 'qsway', 'qbounce', 'spin', 'hop']);

function actionWeight(id) {
  let w = ACTIONS[id].w;
  if (HAPPY_ACTIONS.has(id)) {
    if (stats.mood < 30) w *= 0.3;
    else if (stats.mood > 70) w *= 1.5;
  }
  return w;
}

// 待机时按权重随机挑一个已开启且做得动的动作；太久没互动且开了开关就走掉
async function idleRandom() {
  if (performance.now() / 1000 - lastInteract > IGNORE_AFTER) {
    if (enabled('leave')) {
      applyEffect('leave');
      logEvent('自主', '太久没人理，自己走了走了');
      doLeave();
    } else idleWait = nextIdleWait(3, 6);
    return;
  }
  // 在外面浪太久了先回家
  if (await checkHome()) return;
  // 精快空了：姐姐形态下去桌后休息回精
  if (stats.jing < 15 && form === 'normal' && enabled('desk') && canAfford('desk') && Math.random() < 0.4) {
    say('有点累了…', 1500);
    logEvent('系统', '体力快空了，去桌后休息回精');
    doDesk();
    return;
  }
  let total = 12 / freqFactor(); // 「继续发呆」的权重
  const pool = [];
  for (const id in ACTIONS) {
    const a = ACTIONS[id];
    if (!a.auto || !a.forms.includes(form) || !enabled(id) || !canAfford(id)) continue;
    const w = actionWeight(id);
    pool.push([id, w]);
    total += w;
  }
  let r = Math.random() * total;
  for (const [id, w] of pool) {
    if ((r -= w) < 0) {
      applyEffect(id);
      logEvent('自主', `自己玩起了「${ACTIONS[id].name}」`);
      DISPATCH[id]();
      return;
    }
  }
  idleWait = nextIdleWait(2, 5); // 继续发呆
}

// 数值缓慢变化：恢复精/气/神，冷落涨透明值和降心情
let lastChatter = performance.now() / 1000;
setInterval(() => {
  const idleFor = performance.now() / 1000 - lastInteract;
  if (idleFor > 45) addStat('touming', 0.8);
  addStat('jing', state.startsWith('desk') ? 2.5 : 0.4);
  addStat('qi', 0.35);
  if (idleFor > 10) addStat('shen', 0.4);
  if (idleFor > 60) addStat('mood', -0.15);
  // 快透明了会主动求关注
  if (stats.touming > 50 && state === 'idle' && Math.random() < 0.05) {
    say(pick(LINES.lonely), 2000);
    logEvent('系统', '存在感太低，主动求关注');
  }
  // 没事就冒一句：肉麻话 / 梗 / 她自己的台词
  const nowSec = performance.now() / 1000;
  if (state === 'idle' && nowSec - lastChatter > 25 && Math.random() < 0.08) {
    lastChatter = nowSec;
    say(pickPhrase(), 2800);
  }
}, 1000);

// 定期把数值存盘
setInterval(() => window.pet.saveStats(stats), 15000);
window.pet.getStats().then((s) => {
  if (s) { Object.assign(stats, s); applyTouming(); }
});

// ---------- 鼠标交互 ----------
let pressing = false;
let dragging = false;
let downX = 0, downY = 0;
let pressTimer = null;      // 长按头发的计时器
let longPressFired = false; // 本次按压已触发过长按彩蛋

// 可以被戳一戳打断的状态（在这些状态下点击会立即重新触发戳一戳）
const POKEABLE_STATES = new Set(['idle', 'walk', 'sway', 'land', 'poke', 'hop', 'spin', 'qbounce', 'qsway']);

// 头部区域（姐姐形态立绘的头发范围，窗口坐标）
const HEAD_REGION = { x1: 95, y1: 95, x2: 250, y2: 270 };

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  lastInteract = performance.now() / 1000;
  addStat('touming', -100); // 被注意到了，立刻恢复存在感
  // 点腰间的小本子 = 打开笔记本（两种形态、安静站着时）
  const waistPos = form === 'normal' ? WAIST : form === 'chibi' ? WAIST_CHIBI : null;
  if (waistPos && (state === 'idle' || state === 'walk') &&
      Math.hypot(e.clientX - waistPos.x, e.clientY - waistPos.y) < 42) {
    window.pet.openNotebook();
    logEvent('交互', '打开了她腰间的小本子');
    return;
  }
  // 化剑/兜风/捣乱期间不响应戳/拖
  if (state === 'swordform' || state === 'swordwait' || state === 'driveform' || state === 'drivewait' ||
      state === 'mischiefform' || state === 'mischiefwait') return;
  // 收进法宝过程中：点卡牌 = 提前放她出来，其余时间不响应戳/拖
  if (state === 'seal') {
    if (seal.sub === 'float') {
      seal.sub = 'release';
      seal.subT = 0;
      fxBurst(FLOAT_POS.x, FLOAT_POS.y, 12, 12, 60);
      sprite.style.visibility = 'visible';
      logEvent('交互', '点了法宝卡牌，提前放她出来');
    }
    return;
  }
  pressing = true;
  dragging = false;
  downX = e.screenX;
  downY = e.screenY;
  // 隐藏彩蛋：长按头发超过 5 秒
  longPressFired = false;
  clearTimeout(pressTimer);
  if (form === 'normal' && e.clientX >= HEAD_REGION.x1 && e.clientX <= HEAD_REGION.x2 &&
      e.clientY >= HEAD_REGION.y1 && e.clientY <= HEAD_REGION.y2) {
    pressTimer = setTimeout(() => {
      if (pressing && !dragging) {
        longPressFired = true;
        say('你压我头发了', 2000);
        logEvent('交互', '被按住头发 5 秒：你压我头发了');
        addStat('shen', -3);
      }
    }, 5000);
  }
  // 她走远的时候点她 = 叫她回来
  if (state === 'away' || state === 'gone') doBack();
  window.pet.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!pressing) return;
  if (!dragging && Math.hypot(e.screenX - downX, e.screenY - downY) > 5) {
    dragging = true;
    stage.classList.add('dragging');
    addStat('shen', -10); // 被拎着走很没耐心
    addStat('mood', -2);
    logEvent('交互', '被拎起来了');
    // 从走远状态直接拎回来：恢复正常大小和当前形态的正面图
    curSize = 1;
    if (state.startsWith('desk')) resetDesk();
    const front = FORMS[form].front;
    if (sprite.dataset.cur !== front) { sprite.dataset.cur = front; sprite.src = front; }
    enter('drag');
    say(pick(LINES.drag), 1200);
  }
  if (dragging) window.pet.dragMove();
});

window.addEventListener('mouseup', () => {
  if (!pressing) return;
  pressing = false;
  clearTimeout(pressTimer);
  window.pet.dragEnd();
  if (dragging) {
    dragging = false;
    stage.classList.remove('dragging');
    facing = 1; // 从侧面图状态拖走的，回正
    enter('idle');
    idleWait = nextIdleWait(1, 3);
    // 落点记为常驻位置并持久化
    window.pet.getPos().then(([x, y]) => {
      homePos = { x, y };
      window.pet.setActions({ _home: homePos });
    });
    logEvent('交互', '被安置在新的常驻位置');
  } else if (!longPressFired && POKEABLE_STATES.has(state)) {
    doPoke(); // 原地点击 = 戳一戳，可被打断并立即重新触发
  }
});

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.openMenu();
});

window.pet.onMenuAction((id) => {
  lastInteract = performance.now() / 1000;
  addStat('touming', -100);
  if (id === 'stats') { showStats(); logEvent('交互', '查看了你的数值'); return; }
  if (state.startsWith('desk') && id !== 'desk') resetDesk(); // 桌子状态下切别的动作，先撤桌
  if (id === 'leave') {
    applyEffect('leave');
    logEvent('交互', '你让她走了走了');
    doLeave();
    return;
  }
  // 菜单切换形态
  if (id === 'form-normal' || id === 'form-chibi') {
    const target = id === 'form-chibi' ? 'chibi' : 'normal';
    if (target !== form) {
      applyEffect('morph');
      logEvent('交互', `你让她切到${target === 'chibi' ? 'Q版' : '姐姐'}形态`);
      doMorphTo(target);
    }
    return;
  }
  const fn = DISPATCH[id];
  if (!fn) return;
  curSize = 1; // 从飞行等缩放状态手动切动作时先复原
  if (!canAfford(id)) {
    // 体力/法力不够时手动触发也做不来
    say(stats.qi < -(EFFECTS[id].qi || 0) ? '法力不够了…' : '体力不够了…', 1500);
    logEvent('系统', `想做「${ACTIONS[id].name}」但体力/法力不够`);
    return;
  }
  applyEffect(id);
  logEvent('交互', `你陪她「${ACTIONS[id].name}」`);
  fn();
});

// ---------- 动画主循环 ----------
const GRAVITY = 2600;
const WALK_SPEED = 130; // px/s
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  stateT += dt;

  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;
  const t = now / 1000;

  switch (state) {
    case 'idle': {
      // 呼吸起伏 + 轻微摇晃
      sy = 1 + 0.015 * Math.sin(t * 2.2);
      rot = 0.8 * Math.sin(t * 0.9);
      if (stateT > idleWait) { idleRandom(); idleWait = nextIdleWait(2.5, 6); enterIfIdle(); }
      break;
    }
    case 'walkin': {
      // 翻牌转成侧面图，然后开走
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, SIDE_SRC);
      if (stateT >= stateDur) enter('walk', rand(1.6, 3));
      break;
    }
    case 'walk': {
      if (form === 'normal') {
        // 飘移：悬浮慢起伏 + 前倾，地面影子跟随，两个红灯笼一前一后
        const h = 15 + 8 * Math.sin(stateT * 4.2);
        ty = -h;
        rot = walkDir * 5 + 2.5 * Math.sin(stateT * 2.1);
        showFloatFx();
        updateFloatFx(h, walkDir, t);
      } else {
        // Q版：走路颠簸 + 前倾
        const ph = stateT * 9;
        ty = -Math.abs(Math.sin(ph)) * 7;
        rot = Math.sin(ph) * 2.5 + walkDir * 3;
      }
      window.pet.moveBy(walkDir * WALK_SPEED * dt, 0);
      if (stateT >= stateDur) {
        // 姐姐形态翻牌转回正面，Q版直接回待机
        if (form === 'normal') enter('walkout', 0.3);
        else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      }
      break;
    }
    case 'walkout': {
      // 翻牌转回正面图
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].front);
      if (stateT >= stateDur) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'gohomein': {
      // 翻牌转成侧面图，准备走回家
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, SIDE_SRC);
      if (stateT >= stateDur) enter('gohome');
      break;
    }
    case 'gohome': {
      // 朝常驻位置飘回去（斜线移动）
      const dx = homeward.tx - homeward.px, dy = homeward.ty - homeward.py;
      const dist = Math.hypot(dx, dy);
      const step = 220 * dt;
      const dir = Math.sign(dx) || 1;
      if (form === 'normal') {
        // 飘移：悬浮慢起伏 + 影子灯笼跟随
        const h = 15 + 8 * Math.sin(stateT * 4.2);
        ty = -h;
        rot = dir * 5 + 2.5 * Math.sin(stateT * 2.1);
        showFloatFx();
        updateFloatFx(h, dir, t);
      } else {
        ty = -Math.abs(Math.sin(stateT * 9)) * 7;
        rot = Math.sin(stateT * 9) * 2.5;
      }
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        if (form === 'normal') enter('gohomeout', 0.3);
        else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        homeward.px += mx; homeward.py += my;
      }
      if (stateT > 12) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); } // 走不到就算了
      break;
    }
    case 'gohomeout': {
      // 到家了，翻牌转回正面图
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].front);
      if (stateT >= stateDur) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'hop': {
      hopVy += GRAVITY * dt;
      hopY += hopVy * dt;
      if (hopY >= 0) { // 落地：压扁回弹
        hopY = 0;
        enter('land', 0.16);
        break;
      }
      ty = hopY;
      // 空中拉伸，上升快时更明显
      const stretch = Math.min(Math.abs(hopVy) / 2600, 0.12);
      sy = 1 + stretch;
      sx = 1 - stretch * 0.6;
      break;
    }
    case 'land': {
      const k = stateT / stateDur; // 0→1 回弹
      sy = 0.88 + 0.12 * k;
      sx = 1.08 - 0.08 * k;
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(1.5, 4); }
      break;
    }
    case 'spin': {
      // 绕垂直中线翻转的纸片人效果：rotateY 转一整圈
      const k = easeInOut(stateT / stateDur);
      rotY = 360 * k;
      ty = -14 * Math.sin(Math.PI * k);
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'sway': {
      const k = stateT / stateDur;
      rot = 9 * Math.sin(stateT * 10) * (1 - k * 0.3);
      ty = -3 * Math.abs(Math.sin(stateT * 5));
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'drag': {
      // 被拎着：微微下垂摇晃
      rot = 6 * Math.sin(t * 3);
      sy = 0.97;
      sx = 1.02;
      break;
    }
    case 'poke': {
      // 温柔的回弹：轻轻压一下再晃回来，点击可立即重新触发
      const k = stateT / stateDur;
      const s = Math.sin(Math.PI * k);
      sy = 1 - 0.07 * s;
      sx = 1 + 0.06 * s;
      rot = 2 * Math.sin(k * Math.PI * 2);
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'turnaway': { // 转身背对
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].back);
      if (stateT >= stateDur) enter('away', 3.2);
      break;
    }
    case 'away': {
      // 越走越远：一路缩小成小小一只 + 上飘 + 小步颠簸
      const k = Math.min(stateT / stateDur, 1);
      curSize = Math.max(1 - (1 - 0.05) * k, 0.05);
      ty = FAR_Y * k - Math.abs(Math.sin(stateT * 8)) * 4 * curSize;
      rot = Math.sin(stateT * 8) * 2.5;
      if (stateT >= stateDur) {
        // 星光闪烁几下，缩成小小一只留在原地
        fxStar(170, 558, 1.2);
        setTimeout(() => fxStar(156, 570), 200);
        setTimeout(() => fxStar(184, 564), 380);
        goneStarT = rand(2, 3);
        enter('gone', rand(6, 12));
      }
      break;
    }
    case 'gone': {
      // 小小一只待在远处：轻微起伏，偶尔闪星光
      curSize = 0.05;
      ty = FAR_Y + 1.5 * Math.sin(t * 1.6);
      sy = 1 + 0.03 * Math.sin(t * 2.2);
      goneStarT -= dt;
      if (goneStarT <= 0) {
        fxStar(170 + rand(-14, 14), 560 + rand(-10, 10), rand(0.6, 1));
        goneStarT = rand(2, 3.5);
      }
      if (stateT >= stateDur) doBack();
      break;
    }
    case 'back': { // 用正面图走回来
      const k = Math.min(stateT / stateDur, 1);
      curSize = sizeFrom + (1 - sizeFrom) * k;
      ty = FAR_Y * (1 - k) - Math.abs(Math.sin(stateT * 8)) * 4 * curSize;
      rot = Math.sin(stateT * 8) * 2.5;
      if (stateT >= stateDur) {
        curSize = 1;
        enter('idle');
        idleWait = nextIdleWait(3, 6);
        say(pick(LINES.back), 1800);
      }
      break;
    }
    case 'morph': { // 变身：翻牌中途切形态
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[nextForm].front, () => {
        form = nextForm;
        sprite.style.height = FORMS[form].height + 'px';
      });
      if (stateT >= stateDur) {
        // Q版点了上桌/收法宝：变回姐姐后接着执行
        if (pendingDesk) { pendingDesk = false; doDesk(); }
        else if (pendingSeal) { pendingSeal = false; doSeal(); }
        else { enter('idle'); idleWait = nextIdleWait(3, 6); }
      }
      break;
    }
    case 'qbounce': {
      // Q版三连蹦：参数化弹跳 + 夸张压弹
      const k = Math.min(stateT / stateDur, 1);
      const bounce = Math.abs(Math.sin(k * 3 * Math.PI));
      ty = -60 * bounce;
      sy = 1 + 0.12 * bounce;
      sx = 1 - 0.08 * bounce;
      rot = 3 * Math.sin(k * 6 * Math.PI);
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'qsway': {
      // Q版大幅摇摆
      const k = Math.min(stateT / stateDur, 1);
      rot = 14 * Math.sin(stateT * 12) * (1 - k * 0.2);
      ty = -6 * Math.abs(Math.sin(stateT * 6));
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'goledge': {
      // 朝窗台走（斜线移动），走路颠簸
      const dx = ledge.tx - ledge.px, dy = ledge.ty - ledge.py;
      const dist = Math.hypot(dx, dy);
      const step = 300 * dt;
      ty = -Math.abs(Math.sin(stateT * 9)) * 7;
      rot = Math.sin(stateT * 9) * 2.5;
      if (dx < -1) facing = -1; else if (dx > 1) facing = 1;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        ledge.px = ledge.tx; ledge.py = ledge.ty;
        facing = 1;
        enter('onledge', rand(6, 12));
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        ledge.px += mx; ledge.py += my;
      }
      if (stateT > 15) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); } // 走不到就算了
      break;
    }
    case 'onledge': {
      // 沿窗台上沿来回踱步
      let nx = ledge.px + ledge.dir * 55 * dt;
      if (nx < ledge.minX) { nx = ledge.minX; ledge.dir = 1; }
      if (nx > ledge.maxX) { nx = ledge.maxX; ledge.dir = -1; }
      window.pet.moveBy(nx - ledge.px, 0);
      ledge.px = nx;
      facing = ledge.dir;
      ty = -Math.abs(Math.sin(stateT * 8)) * 5;
      rot = Math.sin(stateT * 8) * 2;
      if (stateT >= stateDur) { facing = 1; ledge.vy = 0; enter('jumpdown'); }
      break;
    }
    case 'jumpdown': {
      // 从窗台跳下：窗口自由落体，到底（主进程 clamp 的位置）落地
      ledge.vy += 3000 * dt;
      const my = ledge.vy * dt;
      window.pet.moveBy(0, my);
      ledge.py += my;
      const stretch = Math.min(ledge.vy / 8000, 0.14);
      sy = 1 + stretch;
      sx = 1 - stretch * 0.6;
      if (ledge.py >= ledge.floorY) enter('land', 0.16);
      break;
    }
    case 'dash': {
      const r = dashFrame(dt);
      tx = r.tx; ty = r.ty; rot = r.rot; rotY = r.rotY;
      sx = r.sx; sy = r.sy; skew = r.skew;
      break;
    }
    case 'fly': {
      const r = flyFrame(dt);
      tx = r.tx; ty = r.ty; rot = r.rot; rotY = r.rotY;
      sx = r.sx; sy = r.sy; skew = r.skew;
      break;
    }
    case 'seal': {
      const r = sealFrame(dt);
      tx = r.tx; ty = r.ty; rot = r.rot; rotY = r.rotY;
      sx = r.sx; sy = r.sy; skew = r.skew;
      break;
    }
    case 'poopthrow': {
      // 后撤蓄力 → 甩出 → 收势
      const k = Math.min(stateT / stateDur, 1);
      if (k < 0.45) {
        const w = k / 0.45;
        rot = -11 * w;
        sy = 1 - 0.07 * w;
        sx = 1 + 0.05 * w;
      } else {
        const w = (k - 0.45) / 0.55;
        rot = -11 + 26 * w;
        sy = 0.93 + 0.07 * w;
        sx = 1.05 - 0.05 * w;
      }
      if (!poopThrown && k >= 0.55) {
        poopThrown = true;
        window.pet.throwPoop();
      }
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(3, 6); }
      break;
    }
    case 'swordform': {
      // 化成剑光：高速旋转缩小 + 闪光
      const k = Math.min(stateT / stateDur, 1);
      rotY = 720 * easeInOut(k);
      const sc = 1 - 0.9 * k;
      sx = sc; sy = sc;
      if (k >= 1) {
        sprite.style.visibility = 'hidden';
        window.pet.swordStart();
        enter('swordwait');
      }
      break;
    }
    case 'swordwait': {
      // 本体是剑，在覆盖层上飞，窗口里先空着
      break;
    }
    case 'swordback': {
      // 变回人形：回弹出现
      const k = Math.min(stateT / stateDur, 1);
      const e = easeOutBack(k);
      sx = e; sy = e;
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(3, 6); }
      break;
    }
    case 'driveform': {
      // 跳上车：小跳 + 闪光后消失
      const k = Math.min(stateT / stateDur, 1);
      ty = -60 * Math.sin(Math.PI * k);
      const sc = 1 - 0.9 * k * k;
      sx = sc; sy = sc;
      rotY = 360 * k;
      if (k >= 1) {
        sprite.style.visibility = 'hidden';
        window.pet.driveStart();
        enter('drivewait');
      }
      break;
    }
    case 'drivewait': {
      // 在覆盖层上兜风，窗口里先空着
      break;
    }
    case 'mischiefform': {
      // 小跳消失，跑去追鼠标
      const k = Math.min(stateT / stateDur, 1);
      ty = -50 * Math.sin(Math.PI * k);
      const sc = 1 - 0.9 * k * k;
      sx = sc; sy = sc;
      if (k >= 1) {
        sprite.style.visibility = 'hidden';
        window.pet.mischiefStart();
        enter('mischiefwait');
      }
      break;
    }
    case 'mischiefwait': {
      // 在覆盖层上捣乱，窗口里先空着
      break;
    }
    case 'driveback': {
      // 下车：回弹出现
      const k = Math.min(stateT / stateDur, 1);
      const e = easeOutBack(k);
      sx = e; sy = e;
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(3, 6); }
      break;
    }
    case 'deskin': {
      // 桌子升起，立绘下移到桌后
      const k = easeInOut(stateT / stateDur);
      ty = DESK_TY * k;
      if (stateT >= stateDur) enter('deskidle', rand(7, 12));
      break;
    }
    case 'deskidle': {
      // 坐在桌后：呼吸 + 偶尔歪头
      ty = DESK_TY;
      sy = 1 + 0.012 * Math.sin(t * 2.2);
      rot = 1.5 * Math.sin(t * 0.8);
      if (stateT >= stateDur) { hideDesk(); enter('deskout', 0.5); }
      break;
    }
    case 'deskout': {
      // 桌子撤走，立绘回位
      const k = easeInOut(stateT / stateDur);
      ty = DESK_TY * (1 - k);
      if (stateT >= stateDur) {
        sprite.style.height = FORMS[form].height + 'px';
        enter('idle');
        idleWait = nextIdleWait(3, 6);
      }
      break;
    }
  }

  sprite.style.transform =
    `translateX(-50%) translate(${tx}px, ${ty}px) rotate(${rot}deg) skewX(${skew}deg) perspective(700px) rotateY(${rotY}deg) scale(${sx * facing * curSize}, ${sy * curSize})`;

  // 气泡每帧跟着立绘头顶走：位置 = 头顶上方，缩放 = 立绘的远近缩放
  const spriteH = state.startsWith('desk') ? 700 : FORMS[form].height;
  const headY = WIN_H + ty - spriteH * sy * curSize;
  bubble.style.left = `calc(50% + ${tx}px)`;
  bubble.style.top = `${headY - bubble.offsetHeight - 6}px`;
  bubble.style.transform = `translateX(-50%) scale(${curSize})`;

  requestAnimationFrame(frame);
}

// idleRandom 里可能选择继续待机，此时保持 idle 状态
function enterIfIdle() {
  if (state === 'idle') stateT = 0;
}

function easeInOut(k) {
  k = Math.min(Math.max(k, 0), 1);
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

// 笔记本带话：气泡提示
window.pet.onNotebookSay((text) => say(text, 1500));

logEvent('系统', 'Kira 起床啦');
requestAnimationFrame(frame);
