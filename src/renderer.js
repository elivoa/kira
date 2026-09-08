// 桌宠渲染层：动画状态机 + 鼠标交互
const sprite = document.getElementById('sprite');
const stage = document.getElementById('stage');

// ---------- 状态机 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// 状态: idle / walk / hop / land / sway / drag / poke
//      / turnaway / away / gone / back / turnfront （走了走了系列）
let state = 'idle';
let stateT = 0;          // 当前状态已进行时间（秒）
let stateDur = 0;        // 当前状态总时长
let idleWait = 3;
let facing = 1;          // 朝向：1 正向，-1 镜像（走路时用）
let walkDir = 1;
let hopVy = 0, hopY = 0;
let curSize = 1;         // 走远时的缩放（1 = 正常大小）
let sizeFrom = 1;        // 走回来时的起始缩放
let goneStarT = 2;       // 消失期间星光闪烁的间隔计时
let lastInteract = performance.now() / 1000; // 最近一次互动时间，太久不理她会走掉
let screenAsleep = false; // 熄屏/锁屏/休眠中：暂停自主动作和冷落累计
window.pet.onPowerState(({ locked }) => {
  screenAsleep = locked;
  if (!locked) lastInteract = performance.now() / 1000; // 醒来重新计时，睡的时间不算冷落
});
window.pet.getPowerState().then((v) => { screenAsleep = !!v; });

const IGNORE_AFTER = 40; // 秒，超过这么久没互动就「走了走了」
const FAR_Y = -50;       // 走远后向上飘的距离（px）
// 与 main.js 的窗口基础尺寸保持一致
// settings._size 是整体缩放系数：窗口会跟着 resize，这里所有窗口坐标也要乘系数
const WIN_W = 460;
const WIN_H = 740;
// 特效/道具坐标标定在 340×620 逻辑画幅上（底部居中对齐窗口）；窗口加大后，
// SVG 特效层靠 CSS 底部居中锚定，DOM 道具（笛子/踏板/卡牌）的平移要加这个偏移
const LOGIC_W = 340;
const LOGIC_H = 620;
let sizeK = 1;
const winW = () => Math.round(WIN_W * sizeK);
const winH = () => Math.round(WIN_H * sizeK);
const sk = (v) => v * sizeK; // 窗口坐标/尺寸换算
const offX = () => (winW() - LOGIC_W * sizeK) / 2;
const offY = () => winH() - LOGIC_H * sizeK;

// 立绘高度与特效层尺寸随整体缩放更新
function applySpriteHeight() {
  sprite.style.height = FORMS[form].height * sizeK + 'px';
  const sx2 = document.getElementById('spriteX');
  if (sx2) sx2.style.height = sprite.style.height;
  const fx = document.getElementById('fx');
  fx.setAttribute('width', Math.round(LOGIC_W * sizeK));
  fx.setAttribute('height', Math.round(LOGIC_H * sizeK));
  const card = document.getElementById('cardImg');
  if (card) card.style.width = 64 * sizeK + 'px';
  const board = document.getElementById('boardImg');
  if (board) board.style.width = 200 * sizeK + 'px'; // 真剑踏板宽度
  const flute = document.getElementById('fluteImg');
  if (flute) flute.style.width = 60 * sizeK + 'px';
  // 场景图（睡觉/看腿）：DOM 图不随窗口尺寸走，手动乘缩放
  const sleepImg = document.getElementById('sleepImg');
  if (sleepImg) {
    sleepImg.style.width = LOGIC_W * sizeK + 'px';
    for (const im of sleepImg.querySelectorAll('img')) im.style.width = LOGIC_W * sizeK + 'px';
  }
  const legImg = document.getElementById('legImg');
  if (legImg) legImg.style.width = LOGIC_W * sizeK + 'px';
}

const FRONT_SRC = '../assets/pet.png';
const BACK_SRC = '../assets/pet_back.png';
const CHIBI_SRC = '../assets/chibi.png';
const SIDE_SRC = '../assets/pet_side.png'; // 侧面图（朝左，镜像即朝右），背对形态偷偷回头看一眼用
const FLUTE_SRC = '../assets/flute.png';   // 法宝形态（银笛）
const NOTE_SRC = '../assets/note.png';     // 法宝形态（星月夜笔记本）

// 四种形态：姐姐 / Q版 / 法宝 / 背对
// 背对形态 front=背面图、back=正面图，转身类动作（笛子乱飞/走了走了）自然变成「转过来又转回去」
const FORMS = {
  normal: { front: FRONT_SRC, back: BACK_SRC, height: 512 },
  chibi: { front: CHIBI_SRC, back: CHIBI_SRC, height: 330 },
  flute: { front: FLUTE_SRC, back: FLUTE_SRC, height: 460 },
  note: { front: NOTE_SRC, back: NOTE_SRC, height: 430 },
  back: { front: BACK_SRC, back: FRONT_SRC, height: 512 },
};
let form = 'normal';
new Image().src = BACK_SRC;  // 预加载，转身/变身时不闪
new Image().src = CHIBI_SRC;
new Image().src = SIDE_SRC;
new Image().src = FLUTE_SRC;
new Image().src = NOTE_SRC;

// 敲门求关注真图序列：备敲（蓄力）和叩上去（咚！！爆星）。帧图朝右 = 敲左边沿；敲右边沿用 facing=dir 镜像
const KNOCK_READY_SRC = '../assets/knock/ready.png';
const KNOCK_HIT_SRC = '../assets/knock/hit.png';
new Image().src = KNOCK_READY_SRC;
new Image().src = KNOCK_HIT_SRC;

// 指人发火：叉腰指你骂骂咧咧（正面图）
const POINT_SRC = '../assets/point.png';
new Image().src = POINT_SRC;

// 撑伞飘落：（窗台/窗顶跳下时换这张）
const UMBRELLA_SRC = '../assets/umbrella.png';
new Image().src = UMBRELLA_SRC;

// 攀爬序列帧：53 帧侧脸爬墙循环（tools/video_climb_frames3.js 从暗背景爬墙视频逐帧截取，
// 视频自带近乎完美的周期（f8~f60 姿势差仅 6.2），全帧使用不抽帧，24fps 原速播放；
// 帧图朝右 = 贴窗口左沿爬，贴右沿镜像）
// 运动模型只保留两档速度：蹬腿相匀速向上，换腿相停住；位移按渲染帧 dt 连续结算，窗口永不下移
const CLIMB_PUSH_SPEED = 204; // px/s（蹬腿相全程匀速向上，均值与原位移表一致）
const CLIMB_PUSH = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]; // 53 帧哪些是蹬腿相
const CLIMB_SRC = [];
for (let i = 1; i <= 53; i++) {
  const s = `../assets/climb/f${String(i).padStart(2, '0')}.png`;
  CLIMB_SRC.push(s);
  new Image().src = s; // 预加载，爬升切帧不闪
}

// 走路序列帧：侧面走路循环（源视频 24fps 走路段 4~96 全用，tools/walk_loop_align.js
// 按脚底间距信号对齐成 4 个完整步态周期共 100 帧：各周期保持自然长度 27/24/25/24，
// 不复制帧（复制帧是 42ms 冻结卡顿）；首尾残段用同相位桥接接合（桥接相位须同时锁
// 脚与胳膊——AI 视频手臂摆动与步频不同步，脚对上时胳膊可能反相；脚用 spread 波形、
// 胳膊用上半身前缘 armSig，跨周期候选联合评分），回卷即视频连续帧；
// 接点柔化与边缘雾清理由 tools/walk_post.js 完成），
// 帧图朝左（sx*facing 镜像即朝右），脚底在画布底部，
// 显示方式与攀爬帧相同（sprite 底部居中锚定，高 FORMS.normal.height * sizeK）。
const WALK_N = 100;
const WALK_SRC = [];
for (let i = 1; i <= WALK_N; i++) {
  const s = `../assets/walk/f${String(i).padStart(2, '0')}.png`;
  WALK_SRC.push(s);
  new Image().src = s; // 预加载，切帧不闪
}
// 每累计走这么多 px 切下一帧（可调）：移动快帧就快、慢就慢、停下就停在当前帧。
// 标定（脚部实测）：底部鞋印连通块逐帧跟踪支撑脚，中位地速 7.4 素材px/帧，
// 素材高 836 显示高 512 → 4.54 显示px/帧（1s/帧前进合成图 + 网格线验证：此值下支撑脚粘地；
// 之前按全帧运动量估的 5.9 偏大 30%，支撑脚持续前滑、腿前后跳）。
// 帧内脚速不均导致的滑步，由 tools/walk_foot_fix.js 在素材侧把接触点掰到恒速线解决，
// 不用变速切帧（接触点 WALK_PX 表试过，体感不行已撤回）
const WALK_PX_PER_FRAME = 4.54;
// 用走路帧的地面移动状态（dash 不在内：只有 side 侧面版用帧，在 dashFrame 里手动推）
const WALK_FRAME_STATES = new Set(['walk', 'walkfar', 'gohome', 'goledge', 'onledge', 'knockgo', 'climbgo', 'wallgo', 'evade']);
// 走路帧的链内出口：这些 next 状态会自己换图/继续用帧，enter 时不做立绘恢复兜底
const WALK_KEEP_STATES = new Set([...WALK_FRAME_STATES, 'walkout', 'gohomeout', 'jumpdown', 'evadeout']);

// 走路帧推进器：按窗口实际位移推进帧（快就快切、慢就慢切、停下停在当前帧）。
// 相位 fi 全局连续不重置，93 帧长条靠多场走路接力播完。
// 走路帧只有姐姐形态素材：form!=='normal' 时返回 false 且不动立绘，调用方保持旧的颠簸表现
const walkAnim = { fi: 0, acc: 0 };
const spriteX = document.getElementById('spriteX'); // 交叉淡化层
function walkAnimAdvance(px) {
  if (form !== 'normal') return false;
  walkAnim.acc += Math.abs(px);
  let advanced = false;
  while (walkAnim.acc >= WALK_PX_PER_FRAME) {
    walkAnim.acc -= WALK_PX_PER_FRAME;
    walkAnim.fi = (walkAnim.fi + 1) % WALK_SRC.length;
    advanced = true;
  }
  if (!advanced) return true;
  // 交叉淡化：旧帧顶到上层 80ms 淡出，新帧在底层立即就位，帧切换不生硬
  spriteX.src = sprite.src;
  spriteX.style.transition = 'none';
  spriteX.style.opacity = 1;
  void spriteX.offsetWidth; // reflow，让 opacity=1 先生效再挂过渡
  spriteX.style.transition = '';
  spriteX.style.opacity = 0;
  swapSprite(WALK_SRC[walkAnim.fi]);
  return true;
}

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
  // 小输入框打开期间，框体区域也要接管鼠标
  if (miniChatOpen) {
    const ir = miniChat.getBoundingClientRect();
    if (cx >= ir.left && cx <= ir.right && cy >= ir.top && cy <= ir.bottom) return true;
  }
  return false;
}

// 点击穿透：渲染层根据光标是否在角色上来回切换
// 按住不放（拖拽中）时一律接管：拖到屏幕外沿时光标会滑出立绘，
// 这时若切成穿透，mouseup 就收不到了，她会一直粘在鼠标上
function updateMouseIgnore(over) {
  lastOver = over;
  const want = clickThrough && !pressing ? !over : false;
  if (want !== mouseIgnored) {
    mouseIgnored = want;
    window.pet.setMouseIgnore(want);
  }
}

window.addEventListener('mousemove', (e) => updateMouseIgnore(overSprite(e.clientX, e.clientY)));

const LINES = {
  poke: ['呜哇！', '别戳啦~', '嘿嘿', '干嘛呀？', '再戳我就不理你了！', '♪'],
  hop: ['嘿咻！', '飞起来了~'],
  sway: ['♪~', '啦啦啦~'],
  walk: ['散散步~', '去哪儿呢？'],
  walkfar: ['去那边看看~', '巡视一下领地~', '出发出发！'],
  drag: ['要被带走啦！', '轻一点嘛~'],
  leave: ['哼，不理你了，走了走了', '走了走了！', '都不理我...走了'],
  back: ['我回来啦', '知道想我了？', '哼，还是回来陪你了'],
  morph: ['变身！', '锵锵~', '变~'],
  qbounce: ['蹦蹦跳~', '跳起来啦', '嘿嘿，看我！'],
  qsway: ['摇呀摇~', '♪♪', '左摇右摆~'],
  ledge: ['上去看看！', '站高高~', '这边风景好~'],
  gohome: ['回去咯', '玩够了，回家~', '该回去了'],
  evade: ['不挡你啦~', '我挪挪~', '给你让个地儿~'],
  nbEvade: ['哦哦我这就走', '挡到了挡到了', '在写字呀，那我让让~', '唔唔，不挡本本', '我溜我溜~'],
  dash: ['暴走！', '冲鸭！', '让开让开！'],
  dashSide: ['跑起来！', '哒哒哒哒', '跟上我！'],
  fly: ['御剑飞行！', '起飞咯~', '看我能飞多高'],
  poop: ['你讨厌！', '哼！接招！', '讨厌鬼！'],
  desk: ['喝口茶~', '休息一下', '工作辛苦啦', '陪我坐会儿吧'],
  work: ['赶稿中！', '马上就好！', '哒哒哒哒…', '别催了别催了', 'DDL 是第一生产力！'],
  seal: ['收！', '进法宝里待着~', '法宝，开！'],
  sword: ['剑来！', '变成剑咯', '御剑……不如成剑！'],
  drive: ['去兜风！', '上车！', '带你飞一圈'],
  mischief: ['嘿嘿，捣乱咯', '挡住挡住~', '就不让你点！'],
  lonely: ['喂——还在吗？', '看我一眼嘛…', '我是不是很透明？', '有人吗…'],
  angry: ['你别碰我。', '把你的脏手拿开。', '烦死了！', '手拿开！（超凶）', '再戳我真的生气了！', '呜……你欺负我！'],
  scared: ['呜哇！撞死我了！', '鬼呀👻！别过来！', '救命！什么东西撞我！', '呜啊啊别碰我！', '撞、撞死我了……快跑！', '鬼呀👻👻！'],
  peek: ['才、才没有偷看你！', '别误会…我只是看看你在干嘛', '哼，就瞄一眼', '没在看你，看风景呢'],
  brock: ['哼', '就不回头', '你自己玩吧', '不想理你了', '哄不好了'],
  knock: ['你理理我嘛', '在吗在吗？开门！', '开门开门！是我！', '理我一下嘛~', '喂——我在这儿！'],
  climb: ['爬上去看看！', '嘿咻嘿咻…', '上面的风景应该不错~'],
  yell: ['你！就是你！', '戳戳戳，就知道戳！', '别碰我！！', '我数到三！一！！', '大坏蛋！', '哼！气死我了！', '再戳我真生气了！', '出来挨打！（叉腰）', '骂骂咧咧骂骂咧咧', '你礼貌吗！！', '手指的就是你！', '别躲！说的就是你！', '你给我过来！'],
};

// 内置睡觉三态精确匹配：扩展状态名（sleepwalk.*）也以 sleep 开头，startsWith 会把它们误当睡觉系
const SLEEP_STATES = new Set(['sleepin', 'sleeping', 'sleepout']);
function isSleepState(s) { return SLEEP_STATES.has(s); }

function enter(next, dur = 0) {
  // 变身被打断（拖拽/戳一戳/菜单切动作等）：接续动作作废，否则残留动作会在下一次变身结束时莫名放出
  if (state === 'morph' && next !== 'morph') {
    if (pendingAction === 'sleep') pendingSleepDur = null;
    pendingAction = null;
  }
  state = next;
  stateT = 0;
  stateDur = dur;
  // 走路帧相位跨状态/跨场次保持连续不重置：93 帧长条一场走不完，回 f01 起步会导致尾部帧永远轮不到
  // 走路帧只在移动状态链内显示；被打断离开（超时/戳一戳/被吓跑/菜单切动作等）兜底恢复立绘
  if (!WALK_KEEP_STATES.has(next) && WALK_SRC.includes(sprite.dataset.cur)) swapSprite(FORMS[form].front);
  // 离开移动状态链时藏掉交叉淡化层（链内 80ms 自行淡出，不用管）
  if (!WALK_KEEP_STATES.has(next)) {
    spriteX.style.transition = 'none';
    spriteX.style.opacity = 0;
  }
  // 飘移特效（影子+灯笼）已随走路帧下线；离开飞行时收掉踏板，离开乱飞时收掉笛子，离开睡觉时撤被褥
  hideFloatFx();
  if (next !== 'fly') boardHide();
  if (next !== 'flutefly' && next !== 'fluteback' && next !== 'fluteturn' && next !== 'working') fluteHide();
  if (next !== 'legshow') legImg.style.opacity = 0; // 看腿图只在展示期间存在
  // 离开睡觉时撤场景、立绘恢复
  if (!isSleepState(next)) {
    sleepImg.style.opacity = 0;
    setSpriteVeiled(false);
  }
  // 桌子（来张桌子/工作模式）只在 desk/work 链内存在：菜单之外的切换路径（自主 idleRandom、
  // 大模型决策 DISPATCH、拖拽打断等）没有 resetDesk，桌子+放大立绘会叠到新动作上（已踩坑）
  if (!String(next).startsWith('desk') && !String(next).startsWith('work') && document.getElementById('desk')) resetDesk();
  // 攀爬安全绳只在 climbup 期间存在：到顶/爬不动/被拖走/菜单切动作等任何离开路径都收绳
  if (next !== 'climbup' && climb && climb.rope) { climb.rope = false; window.pet.ropeEnd(); }
}

function say(text, ms = 1800) {
  if (stickyActive) return; // 粘性气泡没被点掉前，自言自语气泡不抢屏
  window.pet.bubbleSay({ text, ms, sticky: false });
}

// 主动搭话的粘性气泡：12 秒不点会自己消失（不算看过），点掉才算看到；样式与自言自语气泡区分
let stickyActive = false;
function saySticky(text) {
  stickyActive = true;
  window.pet.bubbleSay({ text, sticky: true, ms: STICKY_SHOW_MS });
}
// 飞书来消息：粘性气泡展示她在飞书上的回答（不念对方说了什么），点泡泡翻开小本子的飞书 tab
let feishuBubble = false;
window.pet.onFeishuIncoming(({ text }) => {
  feishuBubble = true;
  saySticky(`飞书上回了：${text}`);
});
// 气泡在独立窗口里：点掉 = 看到了（记互动、这条搭话翻篇）；超时自己消失 = 没看到，稍后还会再拿出来
window.pet.onBubbleDismissed(() => {
  stickyActive = false;
  lastInteract = performance.now() / 1000;
  pendingProactive = null;
  if (feishuBubble) {
    feishuBubble = false;
    window.pet.openNotebook('bot');
    logEvent('交互', '点开飞书消息提醒，回了小本子');
    return;
  }
  logEvent('交互', '看到了 Kira 的主动搭话');
});
window.pet.onBubbleHidden(() => {
  stickyActive = false;
});

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
const DESK_TY = 339; // 立绘就位后的下移量（让胸部正好在桌面上沿）；窗口坐标，使用时乘 sizeK

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
  applySpriteHeight();
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
  // 有点烦但还没到扔屎的程度（连戳 3+ 且耐心低于 30）：叉腰指人骂骂咧咧，20s CD
  if (pokeTimes.length >= 3 && stats.shen < 30 && now / 1000 - lastPoint > 20) {
    pokeTimes = [];
    DISPATCH.point();
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

// ---------- 指人发火 ----------
// 被戳得有点烦（耐心低于 30，还没到扔屎的程度）：叉腰指着你不放，骂骂咧咧一串
let lastPoint = 0;      // 20s CD
let pointState = null;  // { said, lineT }

function doPoint() {
  lastPoint = performance.now() / 1000;
  logEvent('交互', '被点烦了，叉腰指着你骂骂咧咧');
  applyEffect('point');
  say(pick(LINES.yell), 1800);
  swapSprite(POINT_SRC);
  fxText('💢', 235 + rand(-15, 15), 190 + rand(-10, 10), 26);
  pointState = { said: 1, lineT: 0 };
  enter('point');
}

// ---------- 睡觉模式（真睡姿场景图版） ----------
// 趴桌场景三张：埋臂趴睡 / 侧头趴睡 / 横躺伸手，睡觉中三张轮换（点一下也换一张）
// 过渡：睡觉场景图淡入盖过立绘 → 睡觉中翻身换图 → 伸手图伸个懒腰 → 淡出回立绘
const SLEEP1_SRC = '../assets/sleep1.png';
const SLEEP2_SRC = '../assets/sleep2.png';
const SLEEP3_SRC = '../assets/sleep3.png';
// 睡姿轮换顺序（sleep3 伸手图既是轮换姿势，也是睡醒伸懒腰图）
const SLEEP_POSES = [SLEEP1_SRC, SLEEP2_SRC, SLEEP3_SRC];
// 各睡姿头部位置（Zzz 出生点），按窗口坐标标定
const SLEEP_HEAD = {
  'sleep1.png': { x: 150, y: 255 },
  'sleep2.png': { x: 105, y: 195 },
  'sleep3.png': { x: 85, y: 240 },
};
// 各睡姿的人物区域（柔边椭圆遮罩）：呼吸起伏只作用于被罩住的人物层，桌子保持不动
const SLEEP_MASK = {
  'sleep1.png': 'radial-gradient(ellipse 30% 52% at 48% 50%, #000 60%, transparent 80%)',
  'sleep2.png': 'radial-gradient(ellipse 36% 51% at 47% 50%, #000 60%, transparent 80%)',
  'sleep3.png': 'radial-gradient(ellipse 40% 50% at 46% 50%, #000 60%, transparent 80%)',
};
new Image().src = SLEEP1_SRC;
new Image().src = SLEEP2_SRC;
new Image().src = SLEEP3_SRC;
const SLEEP_MUMBLE = ['zzZ…', '唔嗯…', '呼…', '嗯…再五分钟…', '嘿嘿…嘿嘿…'];
let zzzT = 0;
let flipT = 0; // 翻身计时
let spriteVeiled = false; // 睡觉场景盖住立绘时，applyTouming 不准把她恢复可见

const sleepImg = document.createElement('div');
sleepImg.id = 'sleepImg';
const sleepBase = document.createElement('img'); // 完整场景（桌子在这层，不动）
const sleepTop = document.createElement('img');  // 人物层（遮罩+呼吸）
sleepBase.className = 'base';
sleepTop.className = 'top';
sleepImg.appendChild(sleepBase);
sleepImg.appendChild(sleepTop);
// 插在 fx 层下面，Zzz/气泡才不会被场景图挡住
stage.insertBefore(sleepImg, fx);

// 设置睡觉场景图：两层用同一张图，top 层按姿势上人物遮罩
function setSleepScene(src) {
  sleepBase.src = src;
  sleepTop.src = src;
  const m = SLEEP_MASK[src.split('/').pop()];
  sleepTop.style.maskImage = m;
  sleepTop.style.webkitMaskImage = m;
}
setSleepScene(SLEEP2_SRC);

function setSpriteVeiled(v) {
  spriteVeiled = v;
  sprite.style.transition = 'opacity .7s ease';
  sprite.style.opacity = v ? 0 : 1;
}

function swapSleepPose(src) {
  sleepImg.style.opacity = 0;
  setTimeout(() => {
    setSleepScene(src);
    sleepImg.style.opacity = 1;
  }, 380);
}

function sleepPoseFile() { return sleepBase.src.split('/').pop(); }

// 换到下一张睡姿（三张三张轮换）
function cycleSleepPose() {
  const i = SLEEP_POSES.findIndex(s => s.endsWith(sleepPoseFile()));
  swapSleepPose(SLEEP_POSES[(i + 1) % SLEEP_POSES.length]);
}

// ---------- 特殊任务：看腿 ----------
// 只能由「长按输入框」里的暗号触发——不进菜单、不进自主池、不进大模型工具列表
const LEG1_SRC = '../assets/leg1.png'; // 侧踩桌子指你
const LEG2_SRC = '../assets/leg2.png'; // 正面对你踩过来
new Image().src = LEG1_SRC;
new Image().src = LEG2_SRC;
const LEG_LINES = ['看你个鬼！', '滚！', '不给看！', '你要黑腿还是白腿？', '看你个腿。', '我Tui～', '变态！就一眼哦', '哼，便宜你了'];

const legImg = document.createElement('img');
legImg.id = 'legImg';
stage.insertBefore(legImg, fx); // 压在 fx 层下，气泡/特效不被挡

// 暗号识别：提到腿/袜/脚且带「看/给/想」类意图就算
function matchLegAsk(text) {
  return /腿|袜|jio|脚|足|黑丝|白丝/i.test(text) && /看|瞧|瞅|欣赏|show|给|想|要/i.test(text);
}

// 看腿表演：俏皮话 + 随机一张踩桌图，淡入带回弹弹出 + 星光，5 秒后撤场
function doLegShow(line) {
  enter('legshow', 5);
  legImg.src = Math.random() < 0.5 ? LEG1_SRC : LEG2_SRC;
  legImg.style.transition = 'opacity .5s ease, transform .38s cubic-bezier(.2,1.4,.4,1)';
  legImg.style.transform = 'translateX(-50%) scale(0.92)';
  void legImg.offsetWidth; // 强制 reflow，让回弹生效
  legImg.style.opacity = 1;
  legImg.style.transform = 'translateX(-50%) scale(1)';
  setSpriteVeiled(true);
  fxStar(120, 300, 0.9);
  fxStar(220, 320, 0.9);
  fxStar(170, 200, 1.2);
  say(line, 2600);
  addStat('shen', -2);
  addStat('mood', 2);
}

// 暗中观察：她先隐身溜到屏幕边，半张超级大的脸从侧边探出来偷看，看完自己回来
function doPeekBig() {
  enter('peekbig', 9); // 兜底时长，正常由 peek-end 提前结束
  setSpriteVeiled(true);
  window.pet.peekStart();
}

function endPeekBig() {
  if (state !== 'peekbig') return;
  setSpriteVeiled(false);
  enter('idle');
  idleWait = nextIdleWait(3, 6);
  if (Math.random() < 0.5) say(pick(['嘿嘿，看到你了', '盯——', '吓到了？']), 1500);
}

window.pet.onPeekEnd(endPeekBig);

let pendingSleepDur = null;

function doSleep(dur = null) {
  // 睡姿场景图只有姐姐版：chibi 也在 sleep.forms 里（DISPATCH 包装不拦），这里自己守，先变姐姐再睡
  if (form !== 'normal') { pendingAction = 'sleep'; pendingSleepDur = dur; doMorphTo('normal'); return; }
  // 变身完成后的接续调用不带 dur：保留菜单哄睡（doSleep(1e9)）存下的时长，别用 null 冲掉
  pendingSleepDur = dur ?? pendingSleepDur;
  setSleepScene(SLEEP1_SRC);
  sleepImg.style.opacity = 1;
  setSpriteVeiled(true);
  flipT = rand(15, 25);
  enter('sleepin', 0.9);
  say('哈啊~ 困了', 1600);
}

function doWake() {
  pendingSleepDur = null; // 清掉菜单哄睡存下的时长：sleepin 阶段被打断时别漏给下一次自主入睡
  sleepTop.style.transform = ''; // 停掉呼吸再伸懒腰
  swapSleepPose(SLEEP3_SRC);
  enter('sleepout', 0.9);
  say('嗯…早上了？', 1500);
}

// 背对专属：偷偷回头瞟一眼——翻牌到侧面停一下，再翻回去继续背对
function doPeek() {
  enter('peekout', 0.35);
  say(pick(LINES.peek), 1500);
}

// 背对专属：赌气晃晃
function doBrock() {
  enter('brock', rand(1.6, 2.2));
  if (Math.random() < 0.7) say(pick(LINES.brock), 1500);
}

function doSway() {
  enter('sway', 1.8);
  say(pick(LINES.sway), 1500);
}

// ---------- 笛子乱飞（姐姐形态专属） ----------
// 背对着站定，笛子绕身高速乱飞（会穿到身后），持续 ~9 秒
const fluteImg = document.createElement('img');
fluteImg.id = 'fluteImg';
fluteImg.src = '../assets/flute.png';
stage.appendChild(fluteImg);
sprite.style.zIndex = 2; // 让笛子能穿到她身后（z=1）或飞在前面（z=3）

function fluteShow(x, y, rot, behind) {
  fluteImg.style.display = 'block';
  fluteImg.style.zIndex = behind ? 1 : 3;
  fluteImg.style.opacity = behind ? 0.55 : 1; // 身后时压暗模拟遮挡
  fluteImg.style.transform = `translate(${sk(x) - 30 + offX()}px, ${sk(y) - 64 + offY()}px) rotate(${rot}deg)`;
}

function fluteHide() { fluteImg.style.display = 'none'; }

function doFluteFly() {
  enter('fluteturn', 0.5);
  say(pick(['看我的！', '笛子，去！', '给你表演一个~']), 1500);
}

// 散步的边缘约束：记录当前位置与目标边缘，走到边就停，不原地干走
let walkEdge = null; // { tx, px }，px 是渲染层估计的窗口位置
function doWalk(dir) {
  walkDir = dir || (Math.random() < 0.5 ? -1 : 1);
  walkEdge = null;
  Promise.all([window.pet.getStage(), window.pet.getPos()]).then(([st, [px]]) => {
    walkEdge = { tx: nbClampTx(walkDir > 0 ? st.maxX : st.minX, px, st), px };
  }).catch(() => {});
  if (form === 'normal') {
    // 姐姐形态用走路序列帧散步：先翻牌转成走路当前帧，帧图朝左，facing = -walkDir 保证镜像方向正确
    facing = -walkDir;
    enter('walkin', 0.32);
  } else {
    facing = walkDir;
    enter('walk', rand(1.6, 3));
  }
  if (Math.random() < 0.4) say(pick(LINES.walk), 1500);
}

// 走到另一边：朝更远那侧屏幕边缘一直走，到边停下（同款翻牌起步 + 走路帧）
let farwalk = null;
async function doWalkFar() {
  const st = await window.pet.getStage();
  const [px] = await window.pet.getPos();
  walkDir = px > (st.minX + st.maxX) / 2 ? -1 : 1; // 朝更远的一端
  farwalk = { tx: nbClampTx(walkDir > 0 ? st.maxX : st.minX, px, st), px };
  if (form === 'normal') {
    facing = -walkDir;
    enter('walkfarin', 0.32);
  } else {
    facing = walkDir;
    enter('walkfar', 60);
  }
  if (Math.random() < 0.4) say(pick(LINES.walkfar), 1500);
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

// 变身：翻牌中途切换形态和立绘高度；随机换成另一个形态（不许原地变）
// 自主变身只在人形间切换：笛子/法宝没有能变回来的自动动作，随机变过去会卡死
const MORPH_POOL = ['normal', 'chibi', 'back'];
let nextForm = 'chibi';
function doMorph() {
  const pool = MORPH_POOL.filter((f) => f !== form);
  doMorphTo(pool[(Math.random() * pool.length) | 0]);
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
    ty: l.y - winH(),
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

// ---------- 撞墙模式 ----------
// 烦躁时跑到活跃窗口的边沿，助跑拿头撞墙，撞完发晕，然后回家
let wall = null;

async function doWallBang() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  let wallX, dir;
  const aw = await window.pet.activeWindow();
  if (aw) {
    // 选近的一侧：贴左墙外沿或右墙外沿
    const dLeft = Math.abs(px - (aw.x - winW()));
    const dRight = Math.abs(px - (aw.x + aw.w));
    wallX = dLeft <= dRight ? aw.x - winW() : aw.x + aw.w;
    dir = dLeft <= dRight ? 1 : -1; // 撞的方向（朝墙）
  } else {
    // 读不到活跃窗口就拿屏幕边撞
    const dLeft = Math.abs(px - st.minX), dRight = Math.abs(px - st.maxX);
    wallX = dLeft <= dRight ? st.minX : st.maxX;
    dir = dLeft <= dRight ? 1 : -1;
  }
  const tx = Math.min(Math.max(wallX, st.minX), st.maxX);
  wall = {
    tx, ty: st.floorY, dir, px, py: st.floorY,
    floorY: st.floorY,
    phase: 'go', phaseT: 0,
    count: 0, maxCount: 3 + ((Math.random() * 3) | 0),
  };
  logEvent('自主', aw ? `烦躁了，去撞「${aw.owner}」的墙` : '烦躁了，去撞屏幕边');
  if (form === 'normal') { facing = -dir; enter('wallgoin', 0.3); }
  else { facing = dir; enter('wallgo'); }
  say(pick(['烦死了！', '让我撞一撞！', '啊啊啊——']), 1500);
}

// ---------- 敲门求关注 ----------
// 跑到活跃窗口的侧边，侧身对着边沿「棒！棒！棒！」敲门，喊你理理我嘛
// 侧身图 493x1298，显示高 512 → 显示半宽约 97px；身体在窗口内居中，左右沿 = 窗心∓97
const SIDE_HALF_W = 97;
let knock = null;

async function doKnock() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  const aw = await window.pet.activeWindow();
  let tx, dir;
  if (aw) {
    // 贴的是「身体边缘」不是窗口框：侧身图显示半宽约 97px，居中在窗口里，
    // 身体左沿 = 窗心-97，右沿 = 窗心+97；让贴墙一侧的身体边和窗口边重合（再多吃 4px 像真贴上）
    const cx = winW() / 2;
    const leftTx = aw.x - (cx + SIDE_HALF_W * sizeK) + 4;          // 敲窗口左沿：她站左边，身体右边贴上
    const rightTx = aw.x + aw.w - (cx - SIDE_HALF_W * sizeK) - 4;  // 敲窗口右沿：她站右边，身体左边贴上
    const leftOk = leftTx >= st.minX, rightOk = rightTx <= st.maxX;
    const dLeft = Math.abs(px - leftTx), dRight = Math.abs(px - rightTx);
    if (leftOk && (!rightOk || dLeft <= dRight)) { tx = leftTx; dir = 1; }
    else if (rightOk) { tx = rightTx; dir = -1; }
    else {
      // 两侧都贴不下，拿屏幕边凑数
      const sl = Math.abs(px - st.minX), sr = Math.abs(px - st.maxX);
      tx = sl <= sr ? st.minX : st.maxX;
      dir = sl <= sr ? 1 : -1;
    }
  } else {
    const dLeft = Math.abs(px - st.minX), dRight = Math.abs(px - st.maxX);
    tx = dLeft <= dRight ? st.minX : st.maxX;
    dir = dLeft <= dRight ? 1 : -1;
  }
  tx = Math.min(Math.max(tx, st.minX), st.maxX);
  // 垂直对齐窗口中部，够不着地板就浮着敲
  const midY = aw ? aw.y + aw.h / 2 - winH() / 2 : st.floorY;
  knock = {
    tx, ty: Math.min(Math.max(midY, st.minY), st.floorY),
    dir, px, py,
    count: 0, maxCount: 3, // 固定三声：棒！棒！棒！
    phase: 'aim', phaseT: 0,
  };
  logEvent('自主', aw ? `去敲「${aw.owner}」的边儿求关注` : '去敲屏幕边求关注');
  facing = -dir;
  enter('knockin', 0.3);
  say(pick(LINES.knock), 1800);
}

// ---------- 攀爬 ----------
// 走到活跃窗口最近的一侧边沿，顺着墙爬上去（32 帧循环）。
// 爬到顶沿后：上方够高（≥420px，站得下她）就上去踱步待会儿（复用 onledge/jumpdown），
// 不够高就直接跳下来。攀爬帧只有姐姐形态素材，其它形态先变身再爬。
let climb = null;

async function doClimb() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  const aw = await window.pet.activeWindow();
  if (!aw) {
    logEvent('自主', '想爬墙但没枚举到可爬的窗口（检查 tools/windows 是否已编译）');
    idleWait = nextIdleWait(2, 4);
    return;
  }
  // 只拦「太矮的窗」：贴屏幕顶的高窗照样爬，位置到顶（clamp）后由停滞检测收尾跳下
  if (aw.h < 260) {
    say('这个太矮了，爬不了', 1400);
    idleWait = nextIdleWait(2, 4);
    return;
  }
  // 站位：攀爬帧的拳头/脚趾触点（旧 340 窗口实测 x≈252，即窗心+82）对准窗沿，再压 2px，手紧握、脚蹬紧。
  // 注意别用袖口/小臂最右点（frame-x 410）对齐——那会让拳头恒差 12px；袖口探过窗沿是合理的
  const GRIP_X = winW() / 2 + 82 * sizeK;
  const leftTx = aw.x - GRIP_X + 2;
  const rightTx = aw.x + aw.w - (winW() - GRIP_X) - 2;
  const leftOk = leftTx >= st.minX, rightOk = rightTx <= st.maxX;
  // 选边：以她的中心到两侧窗沿的距离，永远走最近的一边
  const cx = px + winW() / 2;
  const dLeft = Math.abs(cx - aw.x), dRight = Math.abs(cx - (aw.x + aw.w));
  let tx, useLeft;
  if (leftOk && (!rightOk || dLeft <= dRight)) { tx = leftTx; useLeft = true; }
  else if (rightOk) { tx = rightTx; useLeft = false; }
  else {
    logEvent('自主', `「${aw.owner}」两侧窗沿都贴不出站位，放弃爬墙`);
    idleWait = nextIdleWait(2, 4);
    return;
  }
  climb = {
    tx, ty: st.floorY, useLeft,
    px, py,
    topPy: aw.y - winH(),                    // 爬到顶沿时的窗口 y（脚底贴沿）
    minX: Math.round(Math.max(aw.x + 20, st.minX)),
    maxX: Math.round(Math.min(aw.x + aw.w - winW() - 20, st.maxX)),
    floorY: st.floorY,
    lieOk: aw.y - st.minY >= 420,           // 顶沿上方空间够不够她站/躺
    fi: 0, fT: 0,
    yT: 0, lastY: null, stillN: 0,          // 上爬停滞采样（位置不变了就停）
    progT: 0, lastDist: null, progN: 0,     // 走近墙边时无进展判定
  };
  logEvent('自主', `顺着「${aw.owner}」的边沿往上爬`);
  applyEffect('climb');
  say(pick(LINES.climb), 1600);
  enter('climbgo');
}

// 换立绘（爬完要切回当前形态正面图）
function swapSprite(src) {
  if (sprite.dataset.cur !== src) { sprite.dataset.cur = src; sprite.src = src; }
}

// 攀爬时的腰间位置（屏幕绝对坐标）：安全绳上端拴在这儿
function climbWaist() {
  return [climb.px + winW() / 2, climb.py + winH() * 0.55];
}

// ---------- 暴走模式 ----------
// 在屏幕底部高速往返：起步蓄力 → 加速冲刺 → 到边急转（纸片人翻牌）→ 来回数趟 → 急停冒烟
let dash = null;

// 暴走/逃跑：opts.dir 指定起步方向，opts.maxLaps 覆盖趟数（0 = 冲到边上就停），opts.line 替换台词
async function doDash(opts = {}) {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  // 姐姐形态一半概率换成侧面奔跑版暴走
  const side = form === 'normal' && Math.random() < 0.5;
  // 默认先朝更远的那侧跑，第一趟更长
  const dir = opts.dir || (px > (st.minX + st.maxX) / 2 ? -1 : 1);
  dash = {
    ...st, px, py,
    sub: py < st.floorY - 4 ? 'pre' : 'start', // 不在地面先落地
    subT: 0,
    v: 0, dir, side,
    laps: 0, maxLaps: opts.maxLaps ?? (5 + ((Math.random() * 3) | 0)),
    flipT: 1,        // 转身翻牌进度（1 = 没在翻）
    lineT: 0,        // 速度线生成间隔
    dustT: 0,
    skidDusted: false,
  };
  enter('dash');
  say(opts.line || (side ? pick(LINES.dashSide) : pick(LINES.dash)), opts.line ? 2400 : 1500);
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
        // 侧面奔跑版：爆裂瞬间换成走路帧开跑（相位接续，不重置）
        swapSprite(WALK_SRC[walkAnim.fi]);
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
    if (d.side) walkAnimAdvance(nx - d.px); // 侧面版：帧随冲刺速度快进
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
    walkAnimAdvance(d.dir * d.v * dt); // skid 是 side 版专属子状态，直接推帧
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
    if (d.side) walkAnimAdvance(nx - d.px);
    d.px = nx;
    rot = -d.dir * 10;
    skew = -d.dir * 5;
    if (d.v <= 100) {
      fxDust(FOOT_X, FOOT_Y, 6);
      fxText('フーッ', FOOT_X, 350, 26);
      // 跑完换回正面图（侧面版的走路帧、被吓从走路状态切入的残留都在这里恢复）
      swapSprite(FORMS[form].front);
      facing = 1;
      enter('idle');
      idleWait = nextIdleWait(3, 6);
    }
  }
  // 侧面奔跑/急刹时按倾斜角反向补偿位移，避免立绘被窗口边缘裁掉
  if (d.side && (d.sub === 'run' || d.sub === 'skid' || d.sub === 'stop')) {
    tx = -FORMS[form].height * sizeK * Math.sin(rot * Math.PI / 180) * 0.55;
  }
  return { tx, ty, rot, rotY, sx, sy, skew };
}

// ---------- 御剑飞行（真剑踏板 + 飞行姿态人物） ----------
// 起飞爬升 → 高空波浪巡航（到边纸片人掉头）→ 滑翔落地
let fly = null;

// 飞行姿态立绘（assets/fly_char.png：裙摆发丝向后飘的驭剑姿，脸朝左，内容已裁到 bbox）
const FLY_GIRL_SRC = '../assets/fly_char.png';
new Image().src = FLY_GIRL_SRC;

async function doFly() {
  const st = await window.pet.getStage();
  const [px, py] = await window.pet.getPos();
  fly = {
    ...st, px, py,
    startY: py,
    sub: 'takeoff', subT: 0,
    dir: px > (st.minX + st.maxX) / 2 ? -1 : 1,
    cruiseY: st.minY + rand(80, 300),
    // 巡航按时间不按趟数：8~28s，加起飞降落 0.9s×2 全程 10~30s
    laps: 0, cruiseDur: rand(8, 28),
    flipT: 1, lineT: 0, texted: false,
  };
  facing = -fly.dir; // 素材脸朝左：往右飞要镜像
  swapSprite(FLY_GIRL_SRC);
  enter('fly');
  say(pick(LINES.fly), 1600);
}

// ---------- 御剑踏板（真剑素材，横剑） ----------
// 起飞时踏板从脚下升起，落地后踏板飞走
const boardImg = document.createElement('img');
boardImg.id = 'boardImg';
boardImg.src = '../assets/fly_sword.png';
stage.appendChild(boardImg);

// 新剑素材 1449×436（内容已裁到 bbox）：细长。宽度/抬升/倾角上限是一组联调出来的约束：
// 剑穗垂在图底，巡航倾斜时穗尖会戳出窗口底边（764）——W210 + LIFT28 + 倾角≤12° 保证全程不出界，
// 同时站立面（剑身上沿约图高 30% 处）贴在鞋底。剑尖朝左，随飞行方向镜像
const BOARD_W = 210, BOARD_RATIO = 436 / 1449, BOARD_STAND = 0.3, BOARD_LIFT = 28, BOARD_MAX_ROT = 12;
function boardShow(yC, rot, opacity = 1) {
  boardImg.style.display = 'block';
  boardImg.style.opacity = opacity;
  const w = BOARD_W * sizeK, h = w * BOARD_RATIO;
  boardImg.style.width = `${w}px`;
  boardImg.style.transform = `translate(${FOOT_X - w / 2 + offX()}px, ${yC - h * BOARD_STAND - BOARD_LIFT * sizeK + offY()}px) rotate(${rot}deg) scaleX(${-fly.dir})`;
}

function boardHide() { boardImg.style.display = 'none'; }

function flyFrame(dt) {
  const f = fly;
  f.subT += dt;
  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;

  if (f.flipT < 1) {
    f.flipT = Math.min(1, f.flipT + dt / 0.25);
    rotY = 180 * easeInOut(f.flipT);
    // 翻牌完成瞬间把镜像交接给 facing：rotY 回 0 后人必须朝新方向飞，
    // 否则剩下的巡航全程背向飞行（侧脸素材，掉头没交接的 bug）
    if (f.flipT >= 1) facing = -f.dir;
  }

  if (f.sub === 'takeoff') {
    // 爬升：窗口升到巡航高度，踏板同步从脚下升上来，人微前倾
    const k = easeInOut(Math.min(f.subT / 0.9, 1));
    const ny = f.startY + (f.cruiseY - f.startY) * k;
    window.pet.moveBy(f.dir * 120 * dt, ny - f.py);
    f.py = ny;
    f.px += f.dir * 120 * dt;
    rot = f.dir * 6 * k;
    skew = -f.dir * 2 * k;
    sy = 1 + 0.05 * Math.sin(f.subT * 10);
    // 升起前 40% 淡入：新剑带下垂剑穗，升出窗底那截会被硬切，用淡入遮掉
    boardShow(680 - 74 * k, f.dir * 10 * k, Math.min(1, k * 2.5));
    if (!f.texted) { f.texted = true; fxText('嗖——', FOOT_X, 300); }
    if (k >= 1) { f.sub = 'cruise'; f.subT = 0; }
  } else if (f.sub === 'cruise') {
    // 波浪巡航：y 随 x 正弦起伏，踏板贴坡度，人站在板上小倾
    const SPEED = 650;
    let nx = f.px + f.dir * SPEED * dt;
    let turned = false;
    if (nx <= f.minX) { nx = f.minX; turned = true; }
    if (nx >= f.maxX) { nx = f.maxX; turned = true; }
    const ny = f.cruiseY + 45 * Math.sin(nx / 160);
    window.pet.moveBy(nx - f.px, ny - f.py);
    f.px = nx; f.py = ny;
    const slope = 45 * Math.cos(nx / 160) / 160; // dy/dx
    rot = f.dir * 4 + f.dir * slope * 30;
    skew = -f.dir * 2;
    ty = -2 * Math.abs(Math.sin(f.subT * 6));
    // 踏板贴坡度，但倾角上限 12°：剑穗垂在图底，再大的角会把穗尖甩出窗口底边
    const boardRot = Math.max(-BOARD_MAX_ROT, Math.min(BOARD_MAX_ROT, f.dir * 6 + slope * 57.3 * f.dir * 0.7));
    boardShow(606, boardRot);
    f.lineT -= dt;
    if (f.lineT <= 0) { fxSpeedLine(f.dir); f.lineT = 0.08; }
    if (turned) {
      f.dir *= -1;
      f.flipT = 0;
      f.laps++;
      if (Math.random() < 0.4) fxText('嗖', FOOT_X, 320, 26);
    }
    // 巡航时间到就滑翔（不等掉头，从当前高度直接落）
    if (f.subT >= f.cruiseDur) { f.sub = 'glide'; f.subT = 0; f.landFromY = f.py; }
  } else if (f.sub === 'glide') {
    // 滑翔落地：缓降 + 回正，踏板向下飞走
    const k = easeInOut(Math.min(f.subT / 0.9, 1));
    const ty2 = f.landFromY + (f.floorY - f.landFromY) * k;
    window.pet.moveBy(0, ty2 - f.py);
    f.py = ty2;
    rot = f.dir * 6 * (1 - k);
    skew = -f.dir * 2 * (1 - k);
    boardShow(606 + 120 * k * k, f.dir * 10 * (1 - k));
    if (k >= 1) {
      boardHide();
      fxDust(FOOT_X, FOOT_Y, 3);
      swapSprite(FORMS[form].front); // 落地换回当前形态立绘
      facing = 1;
      enter('land', 0.16);
    }
  }
  // 飞行时略微缩小 + 按倾斜角反向补偿位移，保证立绘不被窗口边缘裁掉；滑翔时平滑恢复
  if (f.sub === 'glide') {
    curSize = 0.85 + 0.15 * Math.min(f.subT / 0.9, 1);
  } else {
    curSize = 0.85;
  }
  tx = -FORMS[form].height * sizeK * curSize * Math.sin(rot * Math.PI / 180) * 0.55;
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
// 腰间的长笛飞出 → 她被吸入法宝 → 法宝悬浮一阵 → 放她出来
const cardImg = document.createElement('img');
cardImg.id = 'cardImg';
cardImg.src = '../assets/flute.png';
stage.appendChild(cardImg);

const WAIST = { x: 195, y: 346 }; // 卡牌在腰间时的窗口坐标（姐姐形态）
const WAIST_CHIBI = { x: 168, y: 505 }; // Q版腰间卡牌的窗口坐标
const FLOAT_POS = { x: 170, y: 290 }; // 卡牌悬浮位置
let seal = null;

function cardShow(x, y, s, r, o) {
  cardImg.style.display = 'block';
  cardImg.style.opacity = o;
  cardImg.style.transform = `translate(${sk(x) - 32 + offX()}px, ${sk(y) - 68 + offY()}px) rotate(${r}deg) scale(${s})`;
}

function cardHide() { cardImg.style.display = 'none'; }

function doSeal() {
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
  sprite.style.height = 700 * sizeK + 'px';
  showDesk();
  enter('deskin', 0.6);
  say(pick(LINES.desk), 1800);
}

// ---------- 工作模式（姐姐形态专属） ----------
// 同一张课桌，但她在疯狂捯饬：高频抖动 + 烟雾 + 笛子纸张乱飞
let work = null;

function doWork() {
  sprite.style.height = 700 * sizeK + 'px';
  showDesk();
  work = { smokeT: 0.5, paperT: 0.8, lineT: 2.5 };
  enter('workin', 0.6);
  say('开工！', 1200);
}

// ---------- 动作开关（设置页控制，只影响待机自动播放，右键菜单始终可用） ----------
let actionEnabled = {}; // 缺省 = 全开
window.pet.getSettings().then((s) => {
  actionEnabled = s || {};
  clickThrough = actionEnabled._clickThrough !== false;
  if (actionEnabled._home) homePos = actionEnabled._home; // 上次的常驻位置
  // 整体缩放 = 用户滑块 × 屏幕自适应基数（主进程算好随 settings 下发）
  sizeK = (actionEnabled._size || 1) * (actionEnabled._screenK || 1);
  applySpriteHeight();
});
window.pet.onSettings((s) => {
  actionEnabled = s || {};
  clickThrough = actionEnabled._clickThrough !== false; // 点击穿透默认开
  sizeK = (actionEnabled._size || 1) * (actionEnabled._screenK || 1); // 整体缩放（窗口已由主进程 resize）
  applySpriteHeight();
  updateMouseIgnore(lastOver);
  // 拖动频率滑块会连续触发，节流到 3 秒一条
  if (Date.now() - lastSettingsLog > 3000) {
    lastSettingsLog = Date.now();
    logEvent('系统', '更新了设置');
  }
});

// 动作开关：没设置过就用默认值（ACTIONS 里 off:true 的默认关，其余默认开）
function enabled(id) {
  const v = actionEnabled[id];
  return v !== undefined ? v : !(ACTIONS[id] && ACTIONS[id].off);
}

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
  // 姐姐形态翻牌换走路帧走回去，其它形态直接镜像走
  if (form === 'normal') { facing = -dir; enter('gohomein', 0.32); }
  else { facing = dir; enter('gohome'); }
  if (Math.random() < 0.6) say(pick(LINES.gohome), 1500);
}

// ---------- 避让：不挡输入区 / 不挡前台窗口 ----------
// inputContext 由主进程提供；包成可替换的模块级变量，测试时可注入 mock
let getInputContext = () => window.pet.inputContext();
const EVADE_COOLDOWN = 4;   // 秒，避让后缓缓，别来回抖
const DANGER_PAD_X = 40;    // 光标危险区横向外扩
const DANGER_PAD_Y = 50;    // 光标危险区纵向外扩
let evading = null;         // { tx, ty, px, py }，px/py 是渲染层估计的窗口位置
let lastEvade = -EVADE_COOLDOWN;
let evadeChecking = false;  // 异步重入保护：一次查询没完不叠下一次
let softHits = 0;           // 软避让：连续相交 tick 计数

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

async function evadeTick() {
  if (evadeChecking) return;
  evadeChecking = true;
  try { await evadeCheck(); } finally { evadeChecking = false; }
}

async function evadeCheck() {
  const nowSec = performance.now() / 1000;
  if (nowSec - lastEvade < EVADE_COOLDOWN) return;
  if (state !== 'idle' && state !== 'walk' && state !== 'walkfar') return; // 其它动作状态（敲窗/爬墙/睡觉/被拖拽等）不打扰
  if (nbTyping && Date.now() - nbLastBeat > NB_BEAT_TIMEOUT) nbTyping = false; // 心跳断了：本子多半已关，自行恢复
  const [px, py] = await window.pet.getPos();
  const pet = { x: px, y: py, w: winW(), h: winH() };
  // typingguard：小本本输入中，整个本子窗口（含外扩）都是危险区，挡了立刻嘟囔着走开
  const nbDanger = nbDangerRect();
  if (nbDanger) {
    if (rectsOverlap(pet, nbDanger)) {
      // 超宽本本两侧躲不开时会一直压着：冷却期内不重复避/重复嘀咕，除非她离开后再次进入危险区
      if (nbWasClear || nowSec - nbLastEvadeAt >= NB_EVADE_GAP) {
        // pickEvadeTarget 吃的是 active-window 的 {x,y,w,h} 形状，notebookBounds 是 Electron 的 width/height，先归一
        const nbActive = { x: nbBounds.x, y: nbBounds.y, w: nbBounds.width, h: nbBounds.height };
        const target = await pickEvadeTarget({ active: nbActive, caret: null }, px);
        if (target) {
          nbLastEvadeAt = nowSec;
          nbWasClear = false;
          doEvade(target, px, py, pick(LINES.nbEvade));
        }
      }
    } else {
      nbWasClear = true; // 已离开危险区，下次再进来立刻重避
    }
    return; // typing 期间只避本子，下面的全局打字检测和软避让都歇着
  }
  let ctx;
  try { ctx = await getInputContext(); } catch { return; }
  if (!ctx) return;
  if (ctx.typing) {
    softHits = 0;
    // 危险区：光标矩形四向外扩；拿不到光标用前台窗口矩形
    let danger = null;
    if (ctx.caret) {
      danger = {
        x: ctx.caret.x - DANGER_PAD_X, y: ctx.caret.y - DANGER_PAD_Y,
        w: ctx.caret.width + DANGER_PAD_X * 2, h: ctx.caret.height + DANGER_PAD_Y * 2,
      };
    } else if (ctx.active) {
      danger = { x: ctx.active.x, y: ctx.active.y, w: ctx.active.w, h: ctx.active.h };
    }
    if (danger && rectsOverlap(pet, danger)) {
      const target = await pickEvadeTarget(ctx, px);
      if (target) doEvade(target, px, py);
    }
    return;
  }
  // 软避让：站着不动且一直压着前台窗口，连续 3 个 tick 就自己走开
  if (state === 'idle' && ctx.active && rectsOverlap(pet, { x: ctx.active.x, y: ctx.active.y, w: ctx.active.w, h: ctx.active.h })) {
    if (++softHits >= 3) {
      softHits = 0;
      lastEvade = nowSec;
      const awayDir = px + winW() / 2 < ctx.active.x + ctx.active.w / 2 ? -1 : 1;
      logEvent('自主', '一直挡着窗口，自己挪开');
      doWalk(awayDir);
    }
  } else {
    softHits = 0;
  }
}

// 挑一个不挡事的目标点（返回窗口左上角 {x, y}，y 贴地板）
async function pickEvadeTarget(ctx, px) {
  const st = await window.pet.getStage();
  const ty = st.floorY;
  if (ctx.active) {
    // 优先贴 active 左侧/右侧完整避开：两边都能放下时选近的，只一边能放用那一边
    const leftX = ctx.active.x - winW() - 12;
    const rightX = ctx.active.x + ctx.active.w + 12;
    const leftOk = leftX >= st.minX;
    const rightOk = rightX <= st.maxX;
    if (leftOk && rightOk) return { x: Math.abs(px - leftX) <= Math.abs(px - rightX) ? leftX : rightX, y: ty };
    if (leftOk) return { x: leftX, y: ty };
    if (rightOk) return { x: rightX, y: ty };
  }
  // active 太大避不开（或没有 active）：去离 caret 中心 x 最远的一侧屏幕角落
  const caretCx = ctx.caret ? ctx.caret.x + ctx.caret.width / 2 : px + winW() / 2;
  const x = Math.abs(st.minX - caretCx) >= Math.abs(st.maxX - caretCx) ? st.minX : st.maxX;
  return { x, y: ty };
}

function doEvade(target, px, py, line) {
  lastEvade = performance.now() / 1000;
  evading = { tx: target.x, ty: target.y, px, py };
  const dir = target.x >= px ? 1 : -1;
  logEvent('自主', '你在打字，让开输入区');
  // 姐姐形态翻牌换走路帧走过去，其它形态直接镜像走
  if (form === 'normal') { facing = -dir; enter('evadein', 0.32); }
  else { facing = dir; enter('evade'); }
  say(line || pick(LINES.evade), 1500);
}

// ---------- 打字避让（typingguard）：小本本输入时绝不挡本本 ----------
// typing 状态由 notebook.js 经 notebook-say 通道（哨兵前缀 JSON）推来；
// 本子窗口位置优先走 get-notebook-bounds 现场查（settings 落盘有首跑盲区），typing 中每 8 秒重拉
const NB_TYPING_PREFIX = '__nb_typing__:';
const NB_BEAT_TIMEOUT = 10000; // 心跳超时：本子关了/崩了自行恢复正常
const NB_EVADE_GAP = 15;       // 秒，避不开时的重复避让/嘀咕冷却（重新进入危险区不受限）
let nbTyping = false;
let nbBounds = null;  // 本子窗口屏幕坐标 {x, y, width, height}
let nbLastBeat = 0;
let nbBoundsT = 0;
let nbLastEvadeAt = -NB_EVADE_GAP;
let nbWasClear = true; // 她当前是否在本子危险区外（离开后再次进入要立刻重避）

function nbOnTypingMsg(payload) {
  let m;
  try { m = JSON.parse(payload); } catch { return; }
  nbLastBeat = Date.now();
  if (!m.on) { nbTyping = false; return; }
  const wasOff = !nbTyping;
  nbTyping = true;
  if (wasOff) nbWasClear = true; // 新一轮输入：她在本子上要立刻避，不受冷却挡
  if (wasOff || Date.now() - nbBoundsT > 8000) nbRefreshBounds();
  if (wasOff) evadeTick().catch(() => {}); // 已经开始输入：她已经挡在本子上的话马上走开
}

// 本子窗口位置：优先现场查（首次打开没动过窗口时 settings 里还没有），查不到再读持久化的 notebookBounds
async function nbRefreshBounds() {
  nbBoundsT = Date.now();
  try {
    const live = await window.pet.getNotebookBounds();
    if (live && typeof live.x === 'number') { nbBounds = live; return; }
  } catch {}
  try {
    const s = await window.pet.getSettings();
    const b = s && s.notebookBounds;
    nbBounds = b && typeof b.x === 'number' ? b : null;
  } catch {}
}

// 本子危险矩形（四向外扩）：水平/垂直任一不相交就不用避
function nbDangerRect() {
  if (!nbTyping || !nbBounds) return null;
  const m = 36;
  return { x: nbBounds.x - m, y: nbBounds.y - m, w: nbBounds.width + m * 2, h: nbBounds.height + m * 2 };
}

// 地面行走轴上的禁入区间：窗口左上角 x 落在 [min, max] 内就会压到本子；本子不在地面高度返回 null
function nbWalkSpan(st) {
  const d = nbDangerRect();
  if (!d) return null;
  if (st.floorY + winH() <= d.y || st.floorY >= d.y + d.h) return null;
  return { min: d.x - winW(), max: d.x + d.w };
}

// 行走目标 x 的禁入夹取：目标落进本子区间、或整段路径要横穿本子，都改成停在区间外一侧
function nbClampTx(tx, px, st) {
  const span = nbWalkSpan(st);
  if (!span) return tx;
  const lo = Math.max(st.minX, span.min - 4), hi = Math.min(st.maxX, span.max + 4);
  if (px <= span.min && tx > span.min) return lo;
  if (px >= span.max && tx < span.max) return hi;
  if (tx > span.min && tx < span.max) return px < (span.min + span.max) / 2 ? lo : hi; // 她在区间内：往近的一侧走出去
  return tx;
}

// typing 期间不进随机池的动作：会横穿/压到本子区域的位移动作（菜单手动触发不拦）。
// follow 会贴到光标旁（打字时基本就在本本边）、sleepwalk/umbrellawalk 地面游走，一并拦
const NB_POOL_BLOCK = new Set(['walkfar', 'dash', 'fly', 'drive', 'goledge', 'climb', 'knock', 'wallbang', 'mischief', 'flutefly', 'follow', 'sleepwalk', 'umbrellawalk']);
function nbPoolOk(id) { return !nbTyping || !NB_POOL_BLOCK.has(id); }

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

// 透明值 → 立绘不透明度（临时禁用：视觉不再变淡，数值照记；睡觉场景盖住时保持隐藏）
function applyTouming() {
  sprite.style.opacity = spriteVeiled ? 0 : 1;
}

// 动作对数值的影响（进入动作时结算一次）
const EFFECTS = {
  walk: { jing: -3, mood: 1 },
  walkfar: { jing: -6, mood: 2 },
  hop: { jing: -4, mood: 2 },
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
  flutefly: { qi: -8, jing: -3, mood: 4 },
  work: { jing: -6, mood: 1 },
  wallbang: { shen: 15, jing: -6, mood: 2 },
  sleep: { jing: 25, shen: 10, mood: 3 },
  mischief: { jing: -3, mood: 4 },
  peek: { jing: -2, mood: 2 },
  brock: { mood: 3 },
  peekbig: { mood: 2 },
  knock: { jing: -3, mood: 2, shen: 2 },
  climb: { jing: -8, mood: 3 },
  point: { shen: 8, mood: -1 }, // 骂骂咧咧一顿，消气
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
  walk: doWalk, walkfar: doWalkFar, hop: doHop, sway: doSway,
  qbounce: doQBounce, qsway: doQSway, morph: doMorph,
  desk: doDesk, seal: doSeal, goledge: doGoLedge,
  dash: doDash, fly: doFly, poop: doPoop, sword: doSword, drive: doDrive, mischief: doMischief, flutefly: doFluteFly, sleep: doSleep, wallbang: doWallBang, work: doWork,
  peek: doPeek, brock: doBrock, peekbig: doPeekBig, knock: doKnock, climb: doClimb, point: doPoint,
};

// ---------- 动作扩展桥接（src/ext/，契约见 ext/README.md） ----------
// core.js 未加载时（walk_test 等测试页）退化为空表：default 分支/心跳/DISPATCH 合并全部空转
const EXT_ACTIONS = window.EXT_ACTIONS || (window.EXT_ACTIONS = {});

// 扩展 tick 的变换传出对象：主循环每帧重置，tick 返回 true 后抄进当帧局部量统一应用
const EXT_TF = { tx: 0, ty: 0, rot: 0, rotY: 0, sx: 1, sy: 1, skew: 0 };

// fxDone 回执的单订阅分发：只挂一次 ipcRenderer.on，扩展注册进 Set 随便加不泄漏
const EXT_FXDONE_FNS = new Set();
window.pet.onFxExtDone((kind, seq) => {
  for (const fn of EXT_FXDONE_FNS) {
    try { fn(kind, seq); } catch (e) { /* 一个扩展的回执异常不连坐其它扩展 */ }
  }
});

// 扩展动作的上下文：只暴露能力，内部变量一律给 getter/setter（tf 是唯一共享可写对象）
const EXT_CTX = {
  enter, say, logEvent, addStat, swapSprite, fxBurst, fxText, fxEl,
  rand, pick, walkAnimAdvance, nextIdleWait,
  stats,
  tf: EXT_TF,
  moveBy: (dx, dy) => window.pet.moveBy(dx, dy),
  getPos: () => window.pet.getPos(),
  getStage: () => window.pet.getStage(),
  getCursor: () => window.pet.getCursor(),
  activeWindow: () => window.pet.activeWindow(),
  inputContext: () => window.pet.inputContext(),
  onArrowKey: (fn) => window.pet.onArrowKey(fn),
  fxStart: (kind, data) => window.pet.fxStart(kind, data),
  onFxDone: (fn) => { EXT_FXDONE_FNS.add(fn); },
  get state() { return state; },
  get stateT() { return stateT; },
  get stateDur() { return stateDur; },
  get form() { return form; },
  get idleWait() { return idleWait; },
  set idleWait(v) { idleWait = v; },
  get lastInteract() { return lastInteract; },
};

// 与 applyEffect 同逻辑，读扩展 def 上的 effect（不进 EFFECTS 主表，也不参与 canAfford 预检）
function applyEffectExt(id) {
  const e = (EXT_ACTIONS[id] && EXT_ACTIONS[id].effect) || {};
  for (const k in e) addStat(k, e[k]);
}

// 扩展动作并入主循环：台词进 LINES，DISPATCH 走统一入口（菜单/大模型决策/随机池即刻可见）
for (const id in EXT_ACTIONS) {
  const def = EXT_ACTIONS[id];
  // 撞内置动作 id 直接拒收：静默覆盖内置动作比动作不存在难查得多
  if (Object.prototype.hasOwnProperty.call(DISPATCH, id)) {
    console.warn(`[ext] 动作「${id}」与内置动作撞名，已拒收`);
    continue;
  }
  if (def.lines) LINES[id] = def.lines;
  // start 是三个钩子里唯一可能被同步调用的，异常必须隔离（effect 已结算，别让用户白付钱）
  DISPATCH[id] = () => {
    applyEffectExt(id);
    try { def.start(EXT_CTX); } catch (e) { logEvent('系统', `扩展动作「${id}」启动异常：${e && e.message}`); }
  };
}

// 形象强匹配：当前形态不在动作 forms 里就先变到 forms[0]，变身完成后由 morph 收尾统一接续（pendingAction）。
// 内置/ext 动作一视同仁；随机池/问脑已按 forms 过滤不会触发，兜底的是菜单手动触发和内部直达调用。
let pendingAction = null;
for (const id in DISPATCH) {
  const run = DISPATCH[id];
  DISPATCH[id] = () => {
    const a = ACTIONS[id];
    if (a && !a.forms.includes(form)) {
      pendingAction = id;
      doMorphTo(a.forms[0]);
      return;
    }
    run();
  };
}

// 心情好更爱玩开心动作，心情差不想玩
const HAPPY_ACTIONS = new Set(['sway', 'qsway', 'qbounce', 'hop']);

function actionWeight(id) {
  let w = ACTIONS[id].w;
  if (HAPPY_ACTIONS.has(id)) {
    if (stats.mood < 30) w *= 0.3;
    else if (stats.mood > 70) w *= 1.5;
  }
  return w;
}

// ---------- 智能决策（Kimi 大脑） ----------
// 待机动作到了「合适的时机」先问模型：动作+台词配套由它定；没配 key / 失败 / 超时回退随机。
// 两次问脑至少隔 BRAIN_GAP 秒，避免每个待机 tick 都打 API
const BRAIN_GAP = 45;
let lastBrain = 0;
const recentActs = []; // 最近做过的动作名，给模型避重复

// 返回 { action: 'id' | 'none', say } 或 null（回退随机）
async function askBrain() {
  const nowSec = performance.now() / 1000;
  if (nowSec - lastBrain < BRAIN_GAP) return null;
  const pool = [];
  for (const id in ACTIONS) {
    const a = ACTIONS[id];
    // DISPATCH 无实现的（ext 文件未落地的新动作）不进池，否则选中即 TypeError
    if (!a.auto || !a.forms.includes(form) || !enabled(id) || !canAfford(id) || !DISPATCH[id] || !nbPoolOk(id)) continue;
    pool.push({ id, name: a.name, intrusive: !!a.intrusive });
  }
  if (!pool.length) return null;
  lastBrain = nowSec; // 先占位，失败了也别连着问
  let r;
  try {
    r = await window.pet.decideAction({
      form,
      stats: { jing: stats.jing, qi: stats.qi, shen: stats.shen, mood: stats.mood, touming: stats.touming },
      idleSec: Math.round(nowSec - lastInteract),
      time: new Date().toTimeString().slice(0, 5),
      actions: pool,
      recent: recentActs.slice(-6),
    });
  } catch { return null; }
  if (!r || !r.ok || typeof r.action !== 'string') return null;
  if (r.action !== 'none' && !pool.some((p) => p.id === r.action)) return null; // 模型瞎编的 id 不执行
  return { action: r.action, say: typeof r.say === 'string' ? r.say.trim().slice(0, 80) : '' };
}

// 待机时决定做什么：优先模型决策，其次按权重随机；太久没互动且开了开关就走掉
// 决策里要等模型（网络），用 idleDeciding 挡住重入，防止一次决策没完又叠一次
let idleDeciding = false;
async function idleRandom() {
  if (idleDeciding) return;
  idleDeciding = true;
  try { await idleRandomOnce(); } finally { idleDeciding = false; }
}

async function idleRandomOnce() {
  // 熄屏/锁屏/休眠中：不做任何自主动作，安静等主人回来
  if (screenAsleep) { idleWait = nextIdleWait(2, 5); return; }
  if (performance.now() / 1000 - lastInteract > IGNORE_AFTER && enabled('leave')) {
    if (Math.random() < 0.25) { // 走了走了概率降到 1/4
      applyEffect('leave');
      logEvent('自主', '太久没人理，自己走了走了');
      doLeave();
    } else idleWait = nextIdleWait(3, 6);
    return;
  }
  // 注意：「走了走了」默认停用，上面的冷落分支不能无条件 return——
  // 否则被冷落 40 秒后她就永远站着不动了，要照常走后面的趴睡/问脑/随机逻辑
  // 在外面浪太久了先回家
  if (await checkHome()) return;
  // 被冷落了：没事就去趴桌睡一会儿（冷落 2 分钟才睡，睡 4~10 分钟自己醒；
  // 一直睡到被戳醒只留给菜单哄睡——不然她几乎永远在睡，太安静了）
  if (performance.now() / 1000 - lastInteract > 120 && enabled('sleep') && canAfford('sleep') && Math.random() < 0.5) {
    applyEffect('sleep');
    logEvent('自主', '没人理，趴桌上睡着了');
    doSleep();
    return;
  }
  // 精快空了：姐姐形态下去桌后休息回精
  if (stats.jing < 15 && form === 'normal' && enabled('desk') && canAfford('desk') && Math.random() < 0.4) {
    say('有点累了…', 1500);
    logEvent('系统', '体力快空了，去桌后休息回精');
    doDesk();
    return;
  }
  // 神（耐心）见底：烦躁了去撞墙发泄
  if (stats.shen < 30 && enabled('wallbang') && canAfford('wallbang') && Math.random() < 0.5) {
    applyEffect('wallbang');
    DISPATCH.wallbang();
    return;
  }
  // 合适的时机：问大脑，动作和台词配套由模型决定，日志记「智能」
  const brain = await askBrain();
  if (brain) {
    if (brain.action === 'none') {
      if (brain.say) say(brain.say, 2600);
      logEvent('智能', brain.say ? `没动，就说了句：${brain.say}` : '想了想，继续趴着不动');
      idleWait = nextIdleWait(2, 5);
      return;
    }
    applyEffect(brain.action);
    recentActs.push(ACTIONS[brain.action].name);
    logEvent('智能', `自己决定「${ACTIONS[brain.action].name}」${brain.say ? `：${brain.say}` : ''}`);
    DISPATCH[brain.action]();
    if (brain.say) say(brain.say, 2600); // 在动作自带台词之后说，模型的台词优先
    return;
  }
  let total = 12 / freqFactor(); // 「继续发呆」的权重
  const pool = [];
  for (const id in ACTIONS) {
    const a = ACTIONS[id];
    // DISPATCH 无实现的（ext 文件未落地的新动作）不进池，否则选中即 TypeError
    if (!a.auto || !a.forms.includes(form) || !enabled(id) || !canAfford(id) || !DISPATCH[id] || !nbPoolOk(id)) continue;
    const w = actionWeight(id);
    pool.push([id, w]);
    total += w;
  }
  let r = Math.random() * total;
  for (const [id, w] of pool) {
    if ((r -= w) < 0) {
      applyEffect(id);
      recentActs.push(ACTIONS[id].name);
      logEvent('自主', `随机玩起了「${ACTIONS[id].name}」`);
      DISPATCH[id]();
      return;
    }
  }
  idleWait = nextIdleWait(2, 5); // 继续发呆
}

// 数值缓慢变化：恢复精/气/神，冷落涨透明值和降心情
let lastChatter = performance.now() / 1000;
// 主动搭话：用户闲置 4 分钟后才可能触发，新消息两次至少隔 8 分钟
const PROACTIVE_AFTER = 240;
const PROACTIVE_COOLDOWN = 480;
const PROACTIVE_REGAP = 150; // 没被理的搭话，隔这么久再拿出来给你看
const PROACTIVE_SHOW_MAX = 3; // 同一条最多拿出来几次，都不理才换掉
const STICKY_SHOW_MS = 12000; // 粘性气泡不点也会自己消失（不算看过）
let lastProactive = 0;
// 没被点掉的搭话：自己消失不算看过，过一会儿原样再拿出来；点掉才翻篇
let pendingProactive = null; // { text, shown }

// 有 key 才调大模型；拿到的话用粘性气泡说（区别于自言自语）
async function maybeProactiveChat() {
  try {
    const cfg = await window.pet.getChatConfig();
    if (!cfg || !cfg.hasKey) return;
    const r = await window.pet.chatProactive();
    if (r && r.ok && r.text) {
      pendingProactive = { text: r.text, shown: 1 };
      saySticky(r.text);
    }
  } catch {}
}

setInterval(() => {
  if (screenAsleep) return; // 熄屏/休眠中：一切暂停，安静等主人回来
  const idleFor = performance.now() / 1000 - lastInteract;
  if (idleFor > 45) addStat('touming', 0.8);
  addStat('jing', state === 'sleeping' ? 3 : state.startsWith('desk') ? 2.5 : 0.4);
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
  // 有 key 且闲置久了：主动调大模型找主人搭话；没被理的搭话过一会儿原样再拿出来，几次都不理才换新的
  if (state === 'idle' && !stickyActive && idleFor > PROACTIVE_AFTER) {
    if (pendingProactive) {
      if (nowSec - lastProactive > PROACTIVE_REGAP) {
        lastProactive = nowSec;
        pendingProactive.shown++;
        if (pendingProactive.shown > PROACTIVE_SHOW_MAX) {
          logEvent('系统', '搭话拿出来了几次都没被理，这条先收回去了');
          pendingProactive = null;
        } else {
          saySticky(pendingProactive.text);
        }
      }
    } else if (nowSec - lastProactive > PROACTIVE_COOLDOWN) {
      lastProactive = nowSec;
      maybeProactiveChat();
    }
  }
  // 扩展动作的条件触发监控（深夜催睡/提醒喝水/打字打call 等）：挂数值心跳，每秒左右一次
  for (const id in EXT_ACTIONS) {
    const ex = EXT_ACTIONS[id];
    if (!ex.monitor) continue;
    if (!enabled(id)) continue; // 设置里关掉的动作，心跳触发也一并停
    // 持续抛错的 monitor 不能无声死掉：每个 id 只记一次，避免刷屏
    try { ex.monitor(EXT_CTX); } catch (e) {
      if (!ex._monitorErr) { ex._monitorErr = true; logEvent('系统', `扩展动作「${ex.id}」monitor 异常：${e && e.message}`); }
    }
  }
  // 避让检查：打字中不挡输入区，平时不长期压着前台窗口
  evadeTick().catch(() => {});
}, 1000);

// ---------- 惊吓检测：光标贴着 Kira 时晃鼠标 / 连按方向键 → 害怕地尖叫快跑 ----------
// 光标由渲染层 60ms 轮询（主进程 screen.getCursorScreenPoint，无需权限）；
// 方向键由主进程的 tools/keys（CGEventTap）转发，没权限时这条路自动失效，晃鼠标检测不受影响
const SCARE_COOLDOWN = 12; // 秒，一次吓跑后缓缓，别被连着吓
const cursorTrail = [];    // 最近 0.9s 的光标采样 {x, y, t}
let arrowTimes = [];       // 最近 1.2s 的方向键时间戳
let lastScare = 0;

// 轴上方向折返次数（滤掉 <4px 的抖动噪声）
function countReversals(vals) {
  let n = 0, prev = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    if (Math.abs(d) < 4) continue;
    const s = Math.sign(d);
    if (prev && s !== prev) n++;
    prev = s;
  }
  return n;
}

// 0.9s 内同一轴折返 4 次以上且幅度 >60px = 在晃鼠标
function isShaking(trail) {
  if (trail.length < 6) return false;
  const xs = trail.map((p) => p.x);
  const ys = trail.map((p) => p.y);
  return (countReversals(xs) >= 4 && Math.max(...xs) - Math.min(...xs) > 60) ||
         (countReversals(ys) >= 4 && Math.max(...ys) - Math.min(...ys) > 60);
}

async function scareTick() {
  const c = await window.pet.getCursor();
  const t = performance.now();
  cursorTrail.push({ x: c.x, y: c.y, t });
  while (cursorTrail.length && t - cursorTrail[0].t > 900) cursorTrail.shift();
  arrowTimes = arrowTimes.filter((at) => t - at < 1200);
  const nowSec = t / 1000;
  // 冷却中或正在做别的动作时只看不动
  if (nowSec - lastScare < SCARE_COOLDOWN) return;
  if (state !== 'idle' && state !== 'walk') return;
  if (screenAsleep) return; // 熄屏中不被吓
  const shake = isShaking(cursorTrail);
  const arrows = arrowTimes.length >= 4; // 1.2s 内连按 4 次方向键
  if (!shake && !arrows) return;
  // 与光标重合或紧挨着（窗口外扩 60px）才会被吓到
  const [px, py] = await window.pet.getPos();
  const near = c.x >= px - 60 && c.x <= px + winW() + 60 && c.y >= py - 60 && c.y <= py + winH() + 60;
  if (!near) return;
  lastScare = nowSec;
  cursorTrail.length = 0;
  arrowTimes = [];
  // 背对光标方向尖叫冲刺：一趟冲到边上急停，离开当前位置
  const awayDir = c.x < px + winW() / 2 ? 1 : -1;
  applyEffect('dash');
  logEvent('交互', shake ? '被晃来晃去的鼠标吓到，尖叫着跑开了' : '被方向键一顿猛戳吓到，尖叫着跑开了');
  doDash({ dir: awayDir, maxLaps: 0, line: pick(LINES.scared) });
}

window.pet.onArrowKey(() => { arrowTimes.push(performance.now()); });
setInterval(() => { scareTick().catch(() => {}); }, 60);

// 定期把数值存盘
setInterval(() => window.pet.saveStats(stats), 15000);
window.pet.getStats().then((s) => {
  if (s) { Object.assign(stats, s); applyTouming(); }
});

// ---------- 长按小输入框：直接对她说话 ----------
// 长按身体 0.6s 弹出输入框；回车后先进暗号匹配（看腿等特殊任务），没命中就走大模型，
// 回答流式刷到她的气泡上。无论哪条路，问答都会进聊天历史（小本子可见）。
const miniChat = document.getElementById('miniChat');
let miniChatOpen = false;
let chatPressTimer = null;  // 长按计时器
let pendingChatId = null;   // 等待大模型回答的流式 id
let miniReply = '';         // 流式累积的回答

function openMiniChat() {
  miniChatOpen = true;
  miniChat.value = '';
  miniChat.style.display = 'block';
  requestAnimationFrame(() => miniChat.classList.add('show'));
  miniChat.focus();
  updateMouseIgnore(true); // 输入期间窗口接管事件，别穿透
}

function closeMiniChat() {
  if (!miniChatOpen) return;
  miniChatOpen = false;
  miniChat.classList.remove('show');
  miniChat.style.display = 'none';
  miniChat.blur();
  updateMouseIgnore(lastOver); // 恢复按命中检测穿透
}

async function submitMiniChat() {
  const text = miniChat.value.trim();
  closeMiniChat();
  if (!text) return;
  lastInteract = performance.now() / 1000;
  addStat('touming', -100);
  // 特殊任务：看腿。本地一问一答写进历史，不问大模型
  if (matchLegAsk(text)) {
    const line = pick(LEG_LINES);
    logEvent('交互', `特殊任务「看腿」：${text.slice(0, 30)}`);
    window.pet.chatInject(text, line);
    doLegShow(line);
    return;
  }
  // 没触发特殊任务：大模型回答，气泡流式显示
  logEvent('交互', `你对她说：${text.slice(0, 40)}`);
  pendingChatId = 'mc' + Date.now();
  miniReply = '';
  say('嗯…', 60000); // 等待占位，流式来了就刷掉
  const r = await window.pet.chatSend(text, pendingChatId);
  pendingChatId = null;
  const finalText = (r && r.text) || '呜，我现在没接上脑子…去小本子配置页看看 key 配了没';
  say(finalText, Math.min(8000, 2000 + finalText.length * 130));
}

// 大模型 token 流式进气泡（只收自己这次提问的 id）
window.pet.onChatToken(({ id, delta }) => {
  if (id !== pendingChatId || !delta) return;
  miniReply += delta;
  say(miniReply, 60000);
});

miniChat.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.isComposing) submitMiniChat();
  else if (e.key === 'Escape') closeMiniChat();
});
miniChat.addEventListener('blur', () => closeMiniChat());

// ---------- 鼠标交互 ----------
let pressing = false;
let dragging = false;
let downX = 0, downY = 0;
let pressTimer = null;      // 长按头发的计时器
let longPressFired = false; // 本次按压已触发过长按彩蛋
let waistPress = false;     // 按在腰间小本子区域（松开才开笔记本，拖走则取消）
let dragSamples = [];       // 睡觉中被拎着晃的轨迹采样（晃醒检测）
let sleepClicks = 0;        // 睡觉中连续点击次数（8 次才醒）
let lastSleepClick = 0;

// 晃醒检测：600ms 内横向大幅来回 ≥4 次换向
function isShakeHard(samples) {
  const now = performance.now();
  const s = samples.filter((p) => now - p.t < 600);
  if (s.length < 6) return false;
  let flips = 0, travel = 0, prevSign = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i].x - s[i - 1].x;
    travel += Math.abs(d);
    const sign = d > 4 ? 1 : d < -4 ? -1 : 0;
    if (sign && prevSign && sign !== prevSign) flips++;
    if (sign) prevSign = sign;
  }
  return flips >= 4 && travel > 600;
}

// 可以被戳一戳打断的状态（在这些状态下点击会立即重新触发戳一戳）
const POKEABLE_STATES = new Set(['idle', 'walk', 'sway', 'land', 'poke', 'hop', 'qbounce', 'qsway']);

// 头部区域（姐姐形态立绘的头发范围，窗口坐标）
const HEAD_REGION = { x1: 95, y1: 95, x2: 250, y2: 270 };

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target === miniChat) return; // 点在输入框上：正常编辑，不当成点她
  if (miniChatOpen) closeMiniChat(); // 点她 = 收起输入框
  lastInteract = performance.now() / 1000;
  addStat('touming', -100); // 被注意到了，立刻恢复存在感
  // 腰间小本子区域：先记账（可能点开笔记本），但如果直接拖走就取消
  const waistPos = form === 'normal' ? WAIST : form === 'chibi' ? WAIST_CHIBI : null;
  waistPress = !!(waistPos && (state === 'idle' || state === 'walk') &&
    Math.hypot(e.clientX - sk(waistPos.x), e.clientY - sk(waistPos.y)) < 42 * sizeK);
  // 化剑/兜风/捣乱期间不响应戳/拖
  if (state === 'swordform' || state === 'swordwait' || state === 'driveform' || state === 'drivewait' ||
      state === 'mischiefform' || state === 'mischiefwait') return;
  // 收进法宝过程中：点卡牌 = 提前放她出来，其余时间不响应戳/拖
  if (state === 'seal') {    if (seal.sub === 'float') {
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
  const inHead = form === 'normal' && e.clientX >= sk(HEAD_REGION.x1) && e.clientX <= sk(HEAD_REGION.x2) &&
    e.clientY >= sk(HEAD_REGION.y1) && e.clientY <= sk(HEAD_REGION.y2);
  if (inHead) {
    pressTimer = setTimeout(() => {
      if (pressing && !dragging) {
        longPressFired = true;
        say('你压我头发了', 2000);
        logEvent('交互', '被按住头发 5 秒：你压我头发了');
        addStat('shen', -3);
      }
    }, 5000);
  }
  // 长按身体（非头非腰、非睡觉、非法宝）0.6s：弹出小输入框对她说话
  clearTimeout(chatPressTimer);
  if (!inHead && !waistPress && !isSleepState(state) && form !== 'flute' && form !== 'note') {
    chatPressTimer = setTimeout(() => {
      if (pressing && !dragging) {
        longPressFired = true; // 标记过，松开时不会再触发戳一戳
        pressing = false;
        window.pet.dragEnd();
        logEvent('交互', '长按叫出了小输入框');
        openMiniChat();
      }
    }, 600);
  }
  // 她走远的时候点她 = 叫她回来
  if (state === 'away' || state === 'gone') doBack();
  window.pet.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!pressing) return;
  // 兜底：松手事件丢了（窗口切穿透那一瞬）就补一次，别让她一直跟着鼠标走
  if (!mouseIgnored && e.buttons === 0) { window.dispatchEvent(new MouseEvent('mouseup')); return; }
  if (!dragging && Math.hypot(e.screenX - downX, e.screenY - downY) > 5) {
    dragging = true;
    waistPress = false; // 拖走了，不开笔记本
    clearTimeout(chatPressTimer); // 拖走了，不弹输入框
    stage.classList.add('dragging');
    addStat('shen', -10); // 被拎着走很没耐心
    addStat('mood', -2);
    logEvent('交互', '被拎起来了');
    dragSamples.length = 0; // 睡觉晃醒检测采样清零
    // 从走远状态直接拎回来：恢复正常大小和当前形态的正面图
    curSize = 1;
    if (state.startsWith('desk') || state.startsWith('work')) resetDesk();
    // 睡觉中被拎走：不换图不切状态，继续睡，只挪窗口
    if (!isSleepState(state)) {
      const front = FORMS[form].front;
      if (sprite.dataset.cur !== front) { sprite.dataset.cur = front; sprite.src = front; }
      enter('drag');
      say(pick(LINES.drag), 1200);
    }
  }
  if (dragging) {
    window.pet.dragMove();
    // 睡觉中被拎起来使劲晃：600ms 内来回甩 ≥4 次就晃醒
    if (isSleepState(state)) {
      dragSamples.push({ x: e.screenX, t: performance.now() });
      if (dragSamples.length > 50) dragSamples.shift();
      if (isShakeHard(dragSamples)) {
        dragging = false;
        stage.classList.remove('dragging');
        window.pet.dragEnd();
        logEvent('交互', '被使劲晃醒了');
        doWake();
        say('呜哇别晃了别晃了！', 1800);
      }
    }
  }
});

window.addEventListener('mouseup', () => {
  if (!pressing) return;
  pressing = false;
  clearTimeout(pressTimer);
  clearTimeout(chatPressTimer);
  window.pet.dragEnd();
  if (dragging) {
    dragging = false;
    stage.classList.remove('dragging');
    // 落点记为常驻位置并持久化
    window.pet.getPos().then(([x, y]) => {
      homePos = { x, y };
      window.pet.setActions({ _home: homePos });
    });
    logEvent('交互', '被安置在新的常驻位置');
    // 睡觉中拖走放下：不切状态，继续睡
    if (!isSleepState(state)) {
      facing = 1; // 从侧面图状态拖走的，回正
      enter('idle');
      idleWait = nextIdleWait(1, 3);
    }
    return;
  }
  // 睡觉中连点：点一下换个睡姿，超过 8 次才醒，偶尔嘟囔梦话
  if (state && isSleepState(state)) {
    const now = performance.now();
    sleepClicks = now - lastSleepClick < 3000 ? sleepClicks + 1 : 1;
    lastSleepClick = now;
    if (sleepClicks >= 8) {
      sleepClicks = 0;
      logEvent('交互', '被连点 8 下吵醒了');
      doWake();
      say('别点了别点了！醒啦！', 1800);
    } else {
      if (state === 'sleeping') cycleSleepPose();
      if (Math.random() < 0.3) say(pick(SLEEP_MUMBLE), 1500);
    }
    return;
  }
  if (!longPressFired && POKEABLE_STATES.has(state)) {
    if (waistPress) {
      // 腰间原地松开：打开笔记本
      waistPress = false;
      window.pet.openNotebook();
      logEvent('交互', '打开了 Kira Note');
    } else {
      doPoke(); // 原地点击 = 戳一戳，可被打断并立即重新触发
    }
  }
});

// 拖文件夹给她：识别音频 + cue 询问切分
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  const p = window.pet.getPathForFile(e.dataTransfer.files[0]);
  if (p) {
    logEvent('交互', '拖了个文件夹给我识别');
    window.pet.folderDrop(p);
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
  if ((state.startsWith('desk') || state.startsWith('work')) && id !== 'desk' && id !== 'work') resetDesk(); // 桌子状态下切别的动作，先撤桌
  if (id === 'leave') {
    applyEffect('leave');
    logEvent('交互', '你让她走了走了');
    doLeave();
    return;
  }
  // 菜单切换形态
  if (id.startsWith('form-')) {
    if (id === 'form-sleep') {
      // 睡觉形态：一直睡到被晃醒/点够 8 下/手动切走
      if (!isSleepState(state)) {
        applyEffect('sleep');
        logEvent('交互', '你让她进入睡觉形态');
        doSleep(1e9);
      }
      return;
    }
    const target = id.slice(5); // normal / chibi / flute / note / back
    const label = { normal: '姐姐', chibi: 'Q版', flute: '笛子', note: '笔记本', back: '背对' }[target];
    if (label && target !== form) {
      applyEffect('morph');
      logEvent('交互', `你让她切到${label}形态`);
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
// 脚部实测地速 ≈7.4 素材px/帧 × 24fps × 显示缩放 ≈ 109 显示px/s：WALK_SPEED 取 109 时
// 播放节奏 ≈24fps 与视频一致；若速度远高于此（如 140/280），切帧率超出 38ms 交叉淡化
// 设计节奏，相邻帧互相涂抹，帧被快进看不清（「只有一半帧在生效」的根因）
const WALK_SPEED = 109; // px/s
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  stateT += dt;

  let tx = 0, ty = 0, rot = 0, rotY = 0, sx = 1, sy = 1, skew = 0;
  const t = now / 1000;

  switch (state) {
    case 'idle': {
      if (form === 'flute' || form === 'note') {
        // 法宝待机：悬浮 + 慢摆 + 偶尔闪星光
        ty = -30 + 6 * Math.sin(t * 1.8);
        rot = 8 * Math.sin(t * 0.9);
        sy = 1 + 0.01 * Math.sin(t * 2);
        if (Math.random() < 0.008) fxStar(170 + rand(-30, 30), 280 + rand(-40, 40), rand(0.6, 1));
        break;
      }
      // 呼吸起伏 + 轻微摇晃
      sy = 1 + 0.015 * Math.sin(t * 2.2);
      rot = 0.8 * Math.sin(t * 0.9);
      if (stateT > idleWait) { idleRandom(); idleWait = nextIdleWait(2.5, 6); enterIfIdle(); }
      break;
    }
    case 'walkin': {
      // 翻牌转成走路当前帧，然后开走
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('walk', rand(1.6, 3));
      break;
    }
    case 'walk': {
      let mx = walkDir * WALK_SPEED * dt;
      if (walkEdge) {
        // 边缘夹取：渲染层估计位置到边就停（主进程同样会钳，两边一致），不原地干走
        const remain = walkEdge.tx - walkEdge.px;
        if (Math.sign(remain) !== walkDir || Math.abs(remain) <= 2) mx = 0;
        else if (Math.abs(remain) < Math.abs(mx)) mx = Math.sign(remain) * Math.abs(remain);
        walkEdge.px += mx;
        if (mx === 0) {
          walkEdge = null;
          // 姐姐形态翻牌转回正面，其它形态直接回待机
          if (form === 'normal') enter('walkout', 0.3);
          else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
          break;
        }
      }
      window.pet.moveBy(mx, 0);
      if (!walkAnimAdvance(mx)) {
        // 没有走路帧素材的形态：保持旧的走路颠簸 + 前倾
        const ph = stateT * 9;
        ty = -Math.abs(Math.sin(ph)) * 7;
        rot = Math.sin(ph) * 2.5 + walkDir * 3;
      }
      if (stateT >= stateDur) {
        // 姐姐形态翻牌转回正面，其它形态直接回待机
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
    case 'walkfarin': {
      // 翻牌转成走路当前帧，然后朝另一端开走
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('walkfar', 60);
      break;
    }
    case 'walkfar': {
      // 一直走到屏幕另一端（斜向不存在的纯水平位移），到边停
      if (!farwalk) { enter('idle'); idleWait = nextIdleWait(2, 5); break; }
      const step = WALK_SPEED * dt;
      const dx = farwalk.tx - farwalk.px;
      if (Math.abs(dx) <= step + 2) {
        window.pet.moveBy(dx, 0);
        walkAnimAdvance(dx);
        farwalk = null;
        // 姐姐形态翻牌转回正面，其它形态直接回待机
        if (form === 'normal') enter('walkout', 0.3);
        else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      } else {
        const mx = Math.sign(dx) * step;
        window.pet.moveBy(mx, 0);
        farwalk.px += mx;
        if (!walkAnimAdvance(mx)) {
          // 没有走路帧素材的形态：保持旧的走路颠簸 + 前倾
          const ph = stateT * 9;
          ty = -Math.abs(Math.sin(ph)) * 7;
          rot = Math.sin(ph) * 2.5 + walkDir * 3;
        }
      }
      if (stateT >= stateDur) { farwalk = null; facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); } // 走不到就算了
      break;
    }
    case 'gohomein': {
      // 翻牌转成走路当前帧，准备走回家
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('gohome');
      break;
    }
    case 'gohome': {
      // 朝常驻位置走回去（斜线移动）
      const dx = homeward.tx - homeward.px, dy = homeward.ty - homeward.py;
      const dist = Math.hypot(dx, dy);
      const step = 280 * dt;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        if (form === 'normal') enter('gohomeout', 0.3);
        else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        homeward.px += mx; homeward.py += my;
        if (!walkAnimAdvance(Math.hypot(mx, my))) {
          // 没有走路帧素材的形态：保持旧的走路颠簸
          ty = -Math.abs(Math.sin(stateT * 9)) * 7;
          rot = Math.sin(stateT * 9) * 2.5;
        }
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
    case 'evadein': {
      // 翻牌转成走路当前帧，准备去旁边让开
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('evade');
      break;
    }
    case 'evade': {
      // 朝避让目标点走过去（斜线移动，同 gohome）
      if (!evading) { enter('idle'); idleWait = nextIdleWait(2, 4); break; }
      const dx = evading.tx - evading.px, dy = evading.ty - evading.py;
      const dist = Math.hypot(dx, dy);
      const step = 280 * dt;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        if (form === 'normal') enter('evadeout', 0.3);
        else { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        evading.px += mx; evading.py += my;
        if (!walkAnimAdvance(Math.hypot(mx, my))) {
          // 没有走路帧素材的形态：保持旧的走路颠簸
          ty = -Math.abs(Math.sin(stateT * 9)) * 7;
          rot = Math.sin(stateT * 9) * 2.5;
        }
      }
      if (stateT > 12) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); } // 走不到就算了
      break;
    }
    case 'evadeout': {
      // 让开了，翻牌转回正面图
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
    case 'sleepin': {
      // 趴睡场景淡入盖过立绘（CSS transition 完成过渡）
      if (stateT >= stateDur) {
        zzzT = 1.2;
        // 自主入睡睡 4~10 分钟自己醒；菜单哄睡（doSleep(1e9)）才一直睡到被叫醒
        enter('sleeping', pendingSleepDur ?? rand(240, 600));
        pendingSleepDur = null;
      }
      break;
    }
    case 'sleeping': {
      // 趴睡中：呼吸缩放（只动人物层，桌子不动）+ Zzz 飘字 + 梦话 + 偶尔翻身换姿势
      sleepTop.style.transform = `scale(${1 + 0.012 * Math.sin(t * 1.6)})`;
      zzzT -= dt;
      if (zzzT <= 0) {
        // 一串 Z 从头上飘走，越飘越大；头部位置按当前睡姿查表
        const head = SLEEP_HEAD[sleepPoseFile()] || SLEEP_HEAD['sleep1.png'];
        fxEl('text', {
          x: head.x + rand(-25, 25), y: head.y + rand(-10, 10),
          'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
          'font-size': rand(16, 30), fill: '#7d6fd0', stroke: '#fff', 'stroke-width': 5, 'paint-order': 'stroke',
        }, 'fx-pop').textContent = 'Z';
        zzzT = rand(1.8, 2.8);
        if (Math.random() < 0.25) say(pick(SLEEP_MUMBLE), 1800);
      }
      flipT -= dt;
      if (flipT <= 0) {
        flipT = rand(15, 25);
        if (Math.random() < 0.5) cycleSleepPose();
      }
      if (stateT >= stateDur) doWake();
      break;
    }
    case 'sleepout': {
      // 伸个懒腰（横躺伸手图），然后场景淡出、立绘回来
      if (stateT >= stateDur) {
        sleepImg.style.opacity = 0;
        setSpriteVeiled(false);
        enter('idle');
        idleWait = nextIdleWait(3, 6);
        if (Math.random() < 0.6) say('睡得好香~', 1800);
      }
      break;
    }
    case 'sway': {
      const k = stateT / stateDur;
      rot = 9 * Math.sin(stateT * 10) * (1 - k * 0.3);
      ty = -3 * Math.abs(Math.sin(stateT * 5));
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'peekout': { // 偷偷回头：翻牌转到侧面
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, SIDE_SRC);
      if (stateT >= stateDur) enter('peekhold', rand(0.5, 0.9));
      break;
    }
    case 'peekhold': { // 瞟一眼：微微倾身
      rot = -4 + 1.5 * Math.sin(t * 3);
      if (stateT >= stateDur) enter('peekin', 0.35);
      break;
    }
    case 'peekin': { // 翻回去继续背对
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].front);
      if (stateT >= stateDur) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'brock': { // 赌气晃晃：背对着小幅快晃
      const k = stateT / stateDur;
      rot = 6 * Math.sin(stateT * 8) * (1 - k * 0.4);
      ty = -2 * Math.abs(Math.sin(stateT * 4));
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(2, 5); }
      break;
    }
    case 'legshow': { // 看腿展示中：到点撤图、立绘回来
      if (stateT >= stateDur) {
        legImg.style.opacity = 0;
        setSpriteVeiled(false);
        enter('idle');
        idleWait = nextIdleWait(3, 6);
      }
      break;
    }
    case 'peekbig': { // 大屏窥视中：等覆盖层演完（peek-end），超时兜底
      if (stateT >= stateDur) endPeekBig();
      break;
    }
    case 'fluteturn': { // 转过身去
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].back);
      if (stateT >= stateDur) enter('flutefly', 9);
      break;
    }
    case 'flutefly': {
      // 她背对着轻轻起伏；笛子绕身高速乱飞，半径和高度都在变，穿到身后时压暗
      sy = 1 + 0.012 * Math.sin(t * 2.2);
      rot = 0.8 * Math.sin(t * 0.9);
      const a = stateT * 3.2 + Math.sin(stateT * 0.7) * 1.2; // 变速公转
      const rx = 90 + 40 * Math.sin(stateT * 1.1);
      const ry = 110 + 30 * Math.sin(stateT * 0.9 + 2);
      // 轨道钳制在窗口可视区内（含旋转余量）
      const fx2 = Math.min(280, Math.max(60, 170 + Math.cos(a) * rx));
      const fy = Math.min(470, Math.max(150, 320 + Math.sin(a) * ry * 0.8));
      const behind = Math.sin(a) < -0.2;
      // 切向角 + 快速自旋
      fluteShow(fx2, fy, a * 57.3 + stateT * 300, behind);
      // 拖尾星光
      if (Math.random() < 0.12) fxEl('circle', { cx: fx2 + rand(-6, 6), cy: fy + rand(-6, 6), r: rand(1.5, 3), fill: '#cdb9ff' }, 'fx-pop');
      if (stateT >= stateDur) { fluteHide(); enter('fluteback', 0.5); }
      break;
    }
    case 'fluteback': { // 转回来
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, FORMS[form].front);
      if (stateT >= stateDur) { enter('idle'); idleWait = nextIdleWait(3, 6); }
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
        applySpriteHeight();
      });
      if (stateT >= stateDur) {
        // 被形象校验拦住的动作变身完成后接续：先取下 pendingAction 再回 idle——
        // enter() 会把 morph→非 morph 的 pendingAction 当打断残留清掉；先回 idle 态是要变身时 doMorphTo 不被 morph 态挡住
        const id = pendingAction;
        pendingAction = null;
        enter('idle');
        idleWait = nextIdleWait(3, 6);
        if (id) DISPATCH[id]();
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
      // 朝窗台走（斜线移动）
      const dx = ledge.tx - ledge.px, dy = ledge.ty - ledge.py;
      const dist = Math.hypot(dx, dy);
      const step = 300 * dt;
      // 帧图朝左：姐姐形态按移动方向镜像，其它形态维持原来的装饰性镜像
      if (dx < -1) facing = form === 'normal' ? 1 : -1;
      else if (dx > 1) facing = form === 'normal' ? -1 : 1;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        ledge.px = ledge.tx; ledge.py = ledge.ty;
        facing = 1;
        enter('onledge', rand(6, 12));
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        ledge.px += mx; ledge.py += my;
        if (!walkAnimAdvance(Math.hypot(mx, my))) {
          ty = -Math.abs(Math.sin(stateT * 9)) * 7;
          rot = Math.sin(stateT * 9) * 2.5;
        }
      }
      if (stateT > 15) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); } // 走不到就算了
      break;
    }
    case 'onledge': {
      // 沿窗台上沿来回踱步（150px/s：踱步的悠闲感保留，又不至于卡成幻灯片）
      let nx = ledge.px + ledge.dir * 150 * dt;
      if (nx < ledge.minX) { nx = ledge.minX; ledge.dir = 1; }
      if (nx > ledge.maxX) { nx = ledge.maxX; ledge.dir = -1; }
      const moved = nx - ledge.px;
      window.pet.moveBy(moved, 0);
      ledge.px = nx;
      // 帧图朝左：姐姐形态按踱步方向镜像，其它形态维持原逻辑
      facing = form === 'normal' ? -ledge.dir : ledge.dir;
      if (!walkAnimAdvance(moved)) {
        // 没有走路帧素材的形态：保持旧的踱步颠簸
        ty = -Math.abs(Math.sin(stateT * 8)) * 5;
        rot = Math.sin(stateT * 8) * 2;
      }
      if (stateT >= stateDur) { facing = 1; ledge.vy = 0; enter('jumpdown'); }
      break;
    }
    case 'jumpdown': {
      // 撑伞飘落：换伞图缓降（终端速度 ~230px/s），左右轻摆，落地换回原图
      if (ledge.vy === 0 && sprite.dataset.cur !== UMBRELLA_SRC) swapSprite(UMBRELLA_SRC);
      ledge.vy = Math.min(ledge.vy + 900 * dt, 230);
      const my = ledge.vy * dt;
      window.pet.moveBy(Math.sin(stateT * 1.6) * 40 * dt, my);
      ledge.py += my;
      rot = Math.sin(stateT * 1.2) * 5;
      tx = Math.sin(stateT * 1.3) * 4;
      // 触底检测：位置到底了就落（看位置不看时间）
      if (ledge.py >= ledge.floorY) {
        swapSprite(FORMS[form].front);
        enter('land', 0.16);
        break;
      }
      // 停滞兜底：实际位置 0.5s 没再往下（被挡住/拖住）也按落地处理
      ledge.yT = (ledge.yT || 0) + dt;
      if (ledge.yT >= 0.25) {
        ledge.yT = 0;
        window.pet.getPos().then(([, ay]) => {
          if (!ledge) return;
          if (ledge.lastY !== undefined && ledge.lastY !== null) ledge.stillN = ay < ledge.lastY + 2 ? (ledge.stillN || 0) + 1 : 0;
          ledge.lastY = ay;
        }).catch(() => {});
      }
      if ((ledge.stillN || 0) >= 2) {
        swapSprite(FORMS[form].front);
        enter('land', 0.16);
      }
      break;
    }
    case 'climbgo': {
      // 快速冲到墙边（斜线移动），赶路用冲刺速度，走路帧跟着位移快进
      const dx = climb.tx - climb.px, dy = climb.ty - climb.py;
      const dist = Math.hypot(dx, dy);
      const step = 1100 * dt;
      // 帧图朝左：按移动方向镜像
      if (dx < -1) facing = 1; else if (dx > 1) facing = -1;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        climb.px = climb.tx; climb.py = climb.ty;
        // 冲刺的取整漂移在这里校准一次：窗口 x 精确落回站位（手和脚的贴沿全靠它）
        window.pet.getPos().then(([ax]) => { if (climb) window.pet.moveBy(Math.round(climb.tx - ax), 0); });
        // 到位：换上攀爬第一帧，朝墙（左沿帧图朝右，右沿镜像）
        facing = climb.useLeft ? 1 : -1;
        swapSprite(CLIMB_SRC[0]);
        // 30% 概率拴根安全绳：下端钉在起爬点，上端拴腰间跟着爬（复用捣乱那根软绳）
        climb.rope = Math.random() < 0.3;
        climb.ropeT = 0;
        if (climb.rope) {
          const [wx, wy] = climbWaist();
          window.pet.ropeStart({ ax: wx, ay: wy, wx, wy });
        }
        enter('climbup');
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        climb.px += mx; climb.py += my;
        walkAnimAdvance(Math.hypot(mx, my));
      }
      // 走不到就算了：1s 没挪近 8px 判定卡住了（看进展不看时间）
      climb.progT += dt;
      if (climb.progT >= 0.5) {
        climb.progT = 0;
        climb.progN = climb.lastDist !== null && dist > climb.lastDist - 8 ? climb.progN + 1 : 0;
        climb.lastDist = dist;
        if (climb.progN >= 2) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); }
      }
      break;
    }
    case 'climbup': {
      // 53 帧循环爬升：36fps 切帧；两档速度（蹬腿匀速向上 / 换腿停住），窗口永不下移
      climb.fT += dt;
      if (climb.fT >= 1 / 36) { // 1.5 倍速播放（帧数不变，只加速）
        climb.fT = 0;
        climb.fi = (climb.fi + 1) % CLIMB_SRC.length;
        swapSprite(CLIMB_SRC[climb.fi]);
      }
      // 位移按渲染帧 dt 连续结算：蹬腿相匀速，换腿相 0，不再按切帧脉冲（停顿不卡）
      if (CLIMB_PUSH[climb.fi]) {
        const s = CLIMB_PUSH_SPEED * sizeK * dt;
        window.pet.moveBy(0, -s);
        climb.py -= s;
      }
      rot = 0; // 上爬不摇摆，手/脚贴沿不晃
      ty = Math.sin(stateT * 5) * 1.5; // 只留一点点上下呼吸感
      // 拴着安全绳：节流上报腰间位置，覆盖层的绳子跟着长
      if (climb.rope) {
        climb.ropeT += dt;
        if (climb.ropeT >= 0.07) {
          climb.ropeT = 0;
          const [wx, wy] = climbWaist();
          window.pet.ropeMove({ wx, wy });
        }
      }
      // 到顶沿收尾（复用同一段逻辑）
      const topOut = (stuck) => {
        swapSprite(FORMS[form].front);
        if (!stuck && climb.lieOk && climb.maxX > climb.minX) {
          window.pet.moveBy(0, climb.topPy - climb.py);
          ledge = {
            tx: climb.px, ty: climb.topPy,
            minX: climb.minX, maxX: climb.maxX,
            floorY: climb.floorY,
            dir: Math.random() < 0.5 ? -1 : 1,
            px: climb.px, py: climb.topPy, vy: 0,
          };
          facing = 1;
          say(pick(['爬上来了！', '站高高~', '歇会儿~']), 1500);
          enter('onledge', rand(6, 12));
        } else {
          ledge = { px: climb.px, py: stuck ? (climb.lastY ?? climb.py) : climb.py, vy: 0, floorY: climb.floorY };
          facing = 1;
          say(stuck ? '爬不动了，下去吧' : '上面太窄了，下去咯', 1200);
          enter('jumpdown');
        }
      };
      // 停滞检测：实际位置 0.5s 没再往上走（顶到天花板/窗没了）就停（看位置不看时间）
      climb.yT += dt;
      if (climb.yT >= 0.25) {
        climb.yT = 0;
        window.pet.getPos().then(([, ay]) => {
          if (!climb) return;
          if (climb.lastY !== null) climb.stillN = ay > climb.lastY - 2 ? climb.stillN + 1 : 0;
          climb.lastY = ay;
        }).catch(() => {});
      }
      if (climb.stillN >= 2) topOut(true);
      else if (climb.py <= climb.topPy) topOut(false);
      break;
    }
    case 'wallgoin': { // 翻牌转成走路当前帧，准备去撞墙
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('wallgo');
      break;
    }
    case 'wallgo': {
      // 朝墙走（斜线移动）
      const dx = wall.tx - wall.px, dy = wall.ty - wall.py;
      const dist = Math.hypot(dx, dy);
      const step = 280 * dt;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        wall.px = wall.tx; wall.py = wall.ty;
        wall.phase = 'wind'; wall.phaseT = 0;
        swapSprite(FORMS[form].front); // 撞墙不用走路帧，恢复立绘
        enter('wallbang');
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        wall.px += mx; wall.py += my;
        if (!walkAnimAdvance(Math.hypot(mx, my))) {
          ty = -Math.abs(Math.sin(stateT * 9)) * 7;
          rot = Math.sin(stateT * 9) * 2.5;
        }
      }
      if (stateT > 12) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); }
      break;
    }
    case 'wallbang': {
      // 撞墙循环：蓄力后撤 → 助跑撞 → 震屏回弹，撞 maxCount 次后发晕
      wall.phaseT += dt;
      const d = wall.dir; // 撞的方向
      if (wall.phase === 'wind') {
        // 后仰蓄力，稍微后撤
        rot = -d * 14 * Math.min(wall.phaseT / 0.35, 1);
        window.pet.moveBy(-d * 60 * dt, 0);
        wall.px -= d * 60 * dt;
        if (wall.phaseT >= 0.35) { wall.phase = 'charge'; wall.phaseT = 0; }
      } else if (wall.phase === 'charge') {
        // 助跑撞上去
        rot = d * 10;
        const step = 700 * dt;
        window.pet.moveBy(d * step, 0);
        wall.px += d * step;
        if (Math.abs(wall.px - wall.tx) <= step + 2) {
          // 撞上了：震屏 + 压扁 + 咚
          wall.phase = 'hit'; wall.phaseT = 0;
          wall.count++;
          fxBurst(d > 0 ? 320 : 20, 300, 10, 8, 40);
          fxText(pick(['咚！', '砰！', 'Duang！']), FOOT_X, 300, 30);
          logEvent('自主', `撞墙 ${wall.count}/${wall.maxCount}`);
        }
      } else if (wall.phase === 'hit') {
        // 震屏抖动 + 压扁，然后弹开
        window.pet.moveBy(rand(-3, 3), rand(-2, 2));
        sy = 0.84;
        sx = 1.14;
        if (wall.phaseT >= 0.28) {
          window.pet.moveBy(-d * 60, 0);
          wall.px -= d * 60;
          wall.phase = 'back'; wall.phaseT = 0;
        }
      } else if (wall.phase === 'back') {
        // 弹开退后，准备下一撞
        window.pet.moveBy(-d * 200 * dt, 0);
        wall.px -= d * 200 * dt;
        rot = -d * 6;
        if (wall.phaseT >= 0.45) {
          wall.phaseT = 0;
          if (wall.count >= wall.maxCount) { wall.phase = 'wind'; enter('walldizzy', 2.2); }
          else wall.phase = 'wind';
        }
      }
      break;
    }
    case 'walldizzy': {
      // 撞晕了：摇晃 + 头上转星星
      rot = 8 * Math.sin(stateT * 6);
      sy = 1 + 0.02 * Math.sin(t * 3);
      if (Math.random() < 0.1) fxStar(170 + rand(-50, 50), 130 + rand(-15, 15), rand(0.5, 0.9));
      if (stateT >= stateDur) { doGoHome(); }
      break;
    }
    case 'knockin': { // 翻牌转成走路当前帧，准备去敲门
      const k = Math.min(stateT / stateDur, 1);
      rotY = turnFrame(k, WALK_SRC[walkAnim.fi]);
      if (stateT >= stateDur) enter('knockgo');
      break;
    }
    case 'knockgo': {
      // 朝窗口边沿走过去（斜线移动）
      const dx = knock.tx - knock.px, dy = knock.ty - knock.py;
      const dist = Math.hypot(dx, dy);
      const step = 280 * dt;
      if (dist <= step + 2) {
        window.pet.moveBy(dx, dy);
        knock.px = knock.tx; knock.py = knock.ty;
        knock.phase = 'aim'; knock.phaseT = 0;
        // 到位：换上备敲真图（朝右 = 敲左边沿；右边沿镜像），朝向 = 敲的方向
        swapSprite(KNOCK_READY_SRC);
        facing = knock.dir;
        enter('knock');
      } else {
        const mx = dx / dist * step, my = dy / dist * step;
        window.pet.moveBy(mx, my);
        knock.px += mx; knock.py += my;
        walkAnimAdvance(Math.hypot(mx, my));
      }
      if (stateT > 12) { facing = 1; enter('idle'); idleWait = nextIdleWait(2, 4); }
      break;
    }
    case 'knock': {
      // 敲门循环：抬手后仰 → 叩上去（棒！+ 星光 + 小幅震）→ 收回，三声收工
      knock.phaseT += dt;
      const d = knock.dir; // 朝窗口的方向
      if (knock.phase === 'aim') {
        // 抬手蓄力：微微后仰抬手
        rot = -d * 10 * Math.min(knock.phaseT / 0.22, 1);
        if (knock.phaseT >= 0.22) { knock.phase = 'rap'; knock.phaseT = 0; }
      } else if (knock.phase === 'rap') {
        // 叩上去：换「咚！！」真图，前倾 + 轻轻顶一下，像真磕在边上
        rot = d * 12;
        swapSprite(KNOCK_HIT_SRC);
        if (knock.phaseT >= 0.16) {
          knock.phase = 'recoil'; knock.phaseT = 0;
          knock.count++;
          window.pet.moveBy(d * 3, 0);
          if (knock.count === 2) say(pick(LINES.knock), 1500);
        }
      } else if (knock.phase === 'recoil') {
        // 收回来（切回备敲图），缓一下敲下一声
        rot = d * 4 * (1 - knock.phaseT / 0.34);
        swapSprite(KNOCK_READY_SRC);
        if (knock.phaseT >= 0.34) {
          knock.phase = 'aim'; knock.phaseT = 0;
          if (knock.count >= knock.maxCount) enter('knockdone', 1.4);
        }
      }
      break;
    }
    case 'knockdone': {
      // 敲完了贴着边等一秒，没人理就悻悻回家
      rot = knock.dir * 3;
      if (stateT >= stateDur) doGoHome();
      break;
    }
    case 'point': {
      // 入场先往前一戳（缩放冲一下收回），然后快速小幅点戳抖动，~1.1s 换一句，四句骂完收工
      if (stateT < 0.28) {
        const punch = 1.13 - 0.13 * easeInOut(stateT / 0.28);
        sx = punch;
        sy = punch;
      } else {
        rot = Math.sin(stateT * 16) * 1.6;
      }
      ty = -Math.abs(Math.sin(stateT * 8)) * 2;
      pointState.lineT += dt;
      if (pointState.lineT > 1.15 && pointState.said < 4) {
        pointState.lineT = 0;
        pointState.said++;
        say(pick(LINES.yell), 1100);
        if (Math.random() < 0.6) fxText('💢', 220 + rand(-30, 30), 300 + rand(-20, 20), 24);
      }
      if (stateT >= 4.6) {
        swapSprite(FORMS[form].front);
        enter('idle');
        idleWait = nextIdleWait(2, 5);
      }
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
      // 覆盖层失联兜底（窗口崩溃/重载、IPC 丢失）：30s 没回来自己变回来，绝不永远隐身
      if (stateT > 30) { sprite.style.visibility = 'visible'; enter('swordback', 0.5); }
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
      // 在覆盖层上兜风，窗口里先空着；覆盖层失联兜底同 swordwait
      if (stateT > 30) { sprite.style.visibility = 'visible'; enter('driveback', 0.5); }
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
      ty = DESK_TY * sizeK * k;
      if (stateT >= stateDur) enter('deskidle', rand(7, 12));
      break;
    }
    case 'deskidle': {
      // 坐在桌后：呼吸 + 偶尔歪头
      ty = DESK_TY * sizeK;
      sy = 1 + 0.012 * Math.sin(t * 2.2);
      rot = 1.5 * Math.sin(t * 0.8);
      if (stateT >= stateDur) { hideDesk(); enter('deskout', 0.5); }
      break;
    }
    case 'deskout': {
      // 桌子撤走，立绘回位
      const k = easeInOut(stateT / stateDur);
      ty = DESK_TY * sizeK * (1 - k);
      if (stateT >= stateDur) {
        applySpriteHeight();
        enter('idle');
        idleWait = nextIdleWait(3, 6);
      }
      break;
    }
    case 'workin': {
      // 桌子升起，进入工作状态
      const k = easeInOut(stateT / stateDur);
      ty = DESK_TY * sizeK * k;
      if (stateT >= stateDur) enter('working', rand(8, 14));
      break;
    }
    case 'working': {
      // 快速捯饬：高频小幅抖动 + 烟雾 + 笛子纸张乱飞
      ty = DESK_TY * sizeK - 2 * Math.abs(Math.sin(stateT * 8));
      rot = 3 * Math.sin(stateT * 14);
      sy = 1 + 0.015 * Math.sin(stateT * 8);
      // 烟雾
      work.smokeT -= dt;
      if (work.smokeT <= 0) {
        fxEl('ellipse', {
          cx: 170 + rand(-46, 46), cy: 470 + rand(-12, 12),
          rx: rand(7, 13), ry: rand(5, 9),
          fill: '#e8e6f2', stroke: '#cfc9e0', 'stroke-width': 1,
        }, 'fx-smoke');
        work.smokeT = rand(0.3, 0.55);
      }
      // 笛子绕头乱飞
      const a = stateT * 6;
      const fx2 = 170 + Math.cos(a) * 72;
      const fy = 330 + Math.sin(a) * 46;
      fluteShow(fx2, fy, a * 57.3 + stateT * 220, Math.sin(a) < -0.3);
      // 纸张乱飞
      work.paperT -= dt;
      if (work.paperT <= 0) {
        fxEl('rect', {
          x: 170 + rand(-70, 70), y: 400 + rand(-40, 30), width: 12, height: 16,
          fill: '#fff', stroke: '#cfc9e0', 'stroke-width': 1,
          transform: `rotate(${rand(-35, 35)})`,
        }, 'fx-pop');
        work.paperT = rand(0.5, 0.9);
      }
      // 台词
      work.lineT -= dt;
      if (work.lineT <= 0) {
        say(pick(LINES.work), 1600);
        work.lineT = rand(3, 5);
      }
      if (stateT >= stateDur) { fluteHide(); hideDesk(); enter('workout', 0.5); }
      break;
    }
    case 'workout': {
      // 桌子撤走，回待机
      const k = easeInOut(stateT / stateDur);
      ty = DESK_TY * sizeK * (1 - k);
      if (stateT >= stateDur) {
        applySpriteHeight();
        enter('idle');
        idleWait = nextIdleWait(3, 6);
      }
      break;
    }
    default: {
      // 扩展动作的自定义状态：第一个认领（tick 返回 true）的扩展接管这一帧，变换经 EXT_TF 传出。
      // tick 抛错兜底回 idle——绝不让状态机卡死在某个扩展状态上（与 flySword 的兜底同理）
      for (const id in EXT_ACTIONS) {
        const ex = EXT_ACTIONS[id];
        if (!ex.tick) continue;
        EXT_TF.tx = 0; EXT_TF.ty = 0; EXT_TF.rot = 0; EXT_TF.rotY = 0;
        EXT_TF.sx = 1; EXT_TF.sy = 1; EXT_TF.skew = 0;
        let handled = false;
        try { handled = ex.tick(state, dt, t, EXT_CTX); }
        catch (e) { logEvent('系统', `扩展动作「${id}」tick 异常，已回待机`); enter('idle'); break; }
        if (handled) {
          tx = EXT_TF.tx; ty = EXT_TF.ty; rot = EXT_TF.rot; rotY = EXT_TF.rotY;
          sx = EXT_TF.sx; sy = EXT_TF.sy; skew = EXT_TF.skew;
          break;
        }
      }
      break;
    }
  }

  sprite.style.transform =
    `translateX(-50%) translate(${tx}px, ${ty}px) rotate(${rot}deg) skewX(${skew}deg) perspective(700px) rotateY(${rotY}deg) scale(${sx * facing * curSize}, ${sy * curSize})`;
  spriteX.style.transform = sprite.style.transform; // 淡化层与立绘同动

  // 气泡在独立窗口：每帧把头顶锚点（窗口局部坐标）报给主进程定位
  // 缩放 = 远近缩放 × 整体缩放，但有下限 0.8——人物变再小，字也得能看清
  const spriteH = (state.startsWith('desk') || state.startsWith('work') ? 700 : FORMS[form].height) * sizeK;
  // 睡觉场景（sleepin/sleeping/sleepout）中她的头在场景图上部，气泡贴那里；
  // 精确匹配场景态——sleepwalk 等扩展状态名也带 sleep 前缀，但人是站着的，气泡要贴头顶
  const sleepScene = state === 'sleepin' || state === 'sleeping' || state === 'sleepout';
  const headY = sleepScene ? 280 * sizeK + offY() : winH() + ty - spriteH * sy * curSize;
  const bScale = Math.max((sleepScene ? 1 : curSize) * sizeK, 0.8);
  sendBubbleAnchor(winW() / 2 + tx, headY, bScale);

  requestAnimationFrame(frame);
}

// 锚点变化才上报，避免每帧空发 IPC
let lastAnchor = { x: NaN, y: NaN, scale: NaN };
function sendBubbleAnchor(x, y, scale) {
  x = Math.round(x);
  y = Math.round(y);
  scale = Math.round(scale * 100) / 100;
  if (x === lastAnchor.x && y === lastAnchor.y && scale === lastAnchor.scale) return;
  lastAnchor = { x, y, scale };
  window.pet.bubbleAnchor(lastAnchor);
}

// idleRandom 里可能选择继续待机，此时保持 idle 状态
function enterIfIdle() {
  if (state === 'idle') stateT = 0;
}

function easeInOut(k) {
  k = Math.min(Math.max(k, 0), 1);
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

// 笔记本带话：气泡提示；typingguard 控制消息（哨兵前缀 JSON）不上屏，转给打字避让
window.pet.onNotebookSay((text) => {
  if (typeof text === 'string' && text.startsWith(NB_TYPING_PREFIX)) {
    nbOnTypingMsg(text.slice(NB_TYPING_PREFIX.length));
    return;
  }
  say(text, 1500);
});

logEvent('系统', 'Kira 起床啦');
requestAnimationFrame(frame);
