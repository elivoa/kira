// 全屏覆盖层：承接「你讨厌！」扔屎特效（点击穿透，不参与交互）
const ov = document.getElementById('ov');
const SVG_NS = 'http://www.w3.org/2000/svg';

// 桌宠整体缩放系数（settings._size × 屏幕基数 _screenK）：覆盖层里的人物/道具图也要跟着变大变小
let ovlK = 1;
let cachedSize = 1; // settings._size 缓存（菜单「大小」当前档位标星用）
const readK = (s) => ((s && s._size) || 1) * ((s && s._screenK) || 1);
window.pet.getSettings().then((s) => { ovlK = readK(s); cachedSize = (s && s._size) || 1; });
window.pet.onSettings((s) => { ovlK = readK(s); cachedSize = (s && s._size) || 1; });

function resize() {
  ov.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  ov.setAttribute('width', innerWidth);
  ov.setAttribute('height', innerHeight);
}
resize();
addEventListener('resize', resize);

function el(tag, attrs, parent = ov) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

// 屎的渐变，只建一次
function ensureDefs() {
  if (document.getElementById('poopGrad')) return;
  const defs = el('defs', {});
  const g = el('radialGradient', { id: 'poopGrad', cx: '40%', cy: '30%', r: '75%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#a8743c' }, g);
  el('stop', { offset: '100%', 'stop-color': '#7a4a20' }, g);
}

// 经典冰淇淋屎：三层椭圆 + 顶部弯尖
function makePoop() {
  ensureDefs();
  const g = el('g', {});
  const fill = 'url(#poopGrad)';
  const stroke = '#5c3a1a';
  el('ellipse', { cx: 0, cy: 26, rx: 34, ry: 14, fill, stroke, 'stroke-width': 3 }, g);
  el('ellipse', { cx: 0, cy: 8, rx: 26, ry: 12, fill, stroke, 'stroke-width': 3 }, g);
  el('ellipse', { cx: 0, cy: -8, rx: 17, ry: 9, fill, stroke, 'stroke-width': 3 }, g);
  el('path', { d: 'M0 -34 Q12 -20 4 -10 Q-6 -16 0 -34 Z', fill, stroke, 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  return g;
}

const easeOut = (k) => 1 - Math.pow(1 - k, 3);

// 扔屎：抛物线飞到屏幕中间 → 啪叽 → 0.5~1s 后往下流 → 留几秒 → 淡出
function throwPoop(fromX, fromY) {
  const tx = innerWidth / 2;
  const ty = innerHeight * 0.45;
  const layer = el('g', {});
  const poop = makePoop();
  layer.appendChild(poop);

  const cx = (fromX + tx) / 2;              // 抛物线控制点
  const cy = Math.min(fromY, ty) - 260;
  const FLIGHT = 650, SPLAT_AT = FLIGHT;
  const dripDelay = 500 + Math.random() * 500;
  let landed = false;
  let dripped = false;
  const t0 = performance.now();

  function q(t) { // 二次贝塞尔
    const u = 1 - t;
    return [u * u * fromX + 2 * u * t * cx + t * t * tx, u * u * fromY + 2 * u * t * cy + t * t * ty];
  }

  function frame(now) {
    const ms = now - t0;

    if (!landed) {
      const k = Math.min(ms / FLIGHT, 1);
      const [x, y] = q(k);
      poop.setAttribute('transform', `translate(${x},${y}) rotate(${k * 360 * (fromX < tx ? 1 : -1)}) scale(${0.6 + 0.4 * k})`);
      if (k >= 1) {
        landed = true;
        poop.setAttribute('transform', `translate(${tx},${ty}) scale(1.3,0.65)`);
        setTimeout(() => poop.setAttribute('transform', `translate(${tx},${ty}) scale(1)`), 130);
        // 啪叽拟声词 + 溅射小点
        el('text', {
          x: tx, y: ty - 60, 'text-anchor': 'middle',
          'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
          'font-size': 40, fill: '#5c3a1a', stroke: '#fff', 'stroke-width': 8, 'paint-order': 'stroke',
          class: 'fx-pop',
        }, layer).textContent = '啪叽';
        for (let i = 0; i < 7; i++) {
          const a = Math.PI * (0.15 + 0.7 * Math.random());
          const dx = Math.cos(a) * 38 * (Math.random() < 0.5 ? -1 : 1);
          el('circle', {
            cx: tx + dx, cy: ty - Math.abs(Math.sin(a)) * 26,
            r: 3 + Math.random() * 4, fill: '#7a4a20', opacity: 0.9, class: 'fx-pop',
          }, layer);
        }
      }
    } else if (!dripped && ms > SPLAT_AT + dripDelay) {
      dripped = true;
      // 往下流 3 条屎痕：stroke-dashoffset 从全长走到 0 = 流下来的效果
      for (const dx of [-20, 2, 22]) {
        const len = 90 + Math.random() * 140;
        const x = tx + dx;
        const y = ty + 26;
        const path = el('path', {
          d: `M${x},${y} C${x + 7},${y + len * 0.3} ${x - 7},${y + len * 0.6} ${x + (Math.random() * 14 - 7)},${y + len}`,
          fill: 'none', stroke: '#7a4a20', 'stroke-width': 9 + Math.random() * 4,
          'stroke-linecap': 'round', opacity: 0.92,
        }, layer);
        const total = path.getTotalLength();
        path.style.strokeDasharray = total;
        path.style.strokeDashoffset = total;
        path.getBoundingClientRect(); // 强制布局，让过渡生效
        path.style.transition = `stroke-dashoffset ${1 + Math.random() * 0.6}s ease-in`;
        path.style.strokeDashoffset = '0';
      }
    }

    // 全程 ~5s，淡出收尾
    const FADE_AT = SPLAT_AT + dripDelay + 3600;
    if (ms > FADE_AT) {
      const k = Math.min((ms - FADE_AT) / 600, 1);
      layer.setAttribute('opacity', 1 - k);
      if (k >= 1) { layer.remove(); return; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.pet.onPoop(({ fromX, fromY }) => throwPoop(fromX, fromY));

// ---------- 化身成剑 ----------
// 剑在全屏极速飞行，撞边反弹带火花，最后飞回出发点
function ensureSwordDefs() {
  if (document.getElementById('bladeGrad')) return;
  const defs = el('defs', {});
  const g = el('linearGradient', { id: 'bladeGrad', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#e8ecf8' }, g);
  el('stop', { offset: '50%', 'stop-color': '#aab2cc' }, g);
  el('stop', { offset: '100%', 'stop-color': '#dfe4f4' }, g);
}

// 真剑素材（assets/fly_sword.png：音符银刃 + 藏青柄 + K 坠彩虹穗，内容已裁到 bbox），剑尖朝左，基准宽 190
function makeSword() {
  const g = el('g', {});
  const W = 190, H = W * 436 / 1449;
  el('image', { href: '../assets/fly_sword.png', x: -W / 2, y: -H / 2, width: W, height: H }, g);
  return g;
}

function flySword(homeX, homeY) {
  const layer = el('g', {});
  // 剑光拖尾
  const trail = el('path', { fill: 'none', stroke: '#b9a8ff', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.35 }, layer);
  const sword = makeSword();
  const swordWrap = el('g', { transform: `scale(${ovlK})` }, layer); // 剑随整体缩放
  swordWrap.appendChild(sword);


  const SPEED = 1700;
  const FLY_MS = 8000;
  let x = homeX, y = homeY;
  const a = Math.random() * Math.PI * 2;
  let vx = Math.cos(a) * SPEED, vy = Math.sin(a) * SPEED;
  const pts = [];
  const t0 = performance.now();
  let last = t0;

  // 撞边火花：冲击环 + 几点火星，偶尔「叮」
  function spark(sx, sy) {
    el('circle', { cx: sx, cy: sy, r: 26, fill: 'none', stroke: '#fff', 'stroke-width': 4, class: 'fx-pop' }, layer);
    for (let i = 0; i < 5; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 22;
      el('line', {
        x1: sx, y1: sy,
        x2: sx + Math.cos(ang) * r, y2: sy + Math.sin(ang) * r,
        stroke: '#ffe9a8', 'stroke-width': 3, 'stroke-linecap': 'round', class: 'fx-pop',
      }, layer);
    }
    if (Math.random() < 0.4) {
      el('text', {
        x: sx, y: sy - 30, 'text-anchor': 'middle',
        'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
        'font-size': 30, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 7, 'paint-order': 'stroke',
        class: 'fx-pop',
      }, layer).textContent = '叮';
    }
  }

  let done = false;
  // 到达/兜底收尾只走一次：闪光，通知桌宠变回来
  function arrive() {
    if (done) return;
    done = true;
    clearInterval(watchdog);
    el('circle', { cx: homeX, cy: homeY, r: 46, fill: '#fff', opacity: 0.9, class: 'fx-pop' }, layer);
    setTimeout(() => layer.remove(), 500);
    window.pet.swordDone();
  }

  function tick(now) {
    if (done) return;
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const ms = now - t0;

    // 硬兜底：任何路径都不能让剑永远飞（坐标出 NaN、回不了家等），到点强制回来
    if (ms > 20000) { arrive(); return; }

    if (ms < FLY_MS) {
      x += vx * dt; y += vy * dt;
      // 撞边反弹
      if (x < 60) { x = 60; vx = Math.abs(vx); spark(x, y); }
      else if (x > innerWidth - 60) { x = innerWidth - 60; vx = -Math.abs(vx); spark(x, y); }
      if (y < 60) { y = 60; vy = Math.abs(vy); spark(x, y); }
      else if (y > innerHeight - 60) { y = innerHeight - 60; vy = -Math.abs(vy); spark(x, y); }
    } else {
      // 返航：朝出发点加速转向。速度随距离衰减——恒定 1700px/s 时转弯半径 ≈283px，
      // 比 50px 的到达圈大得多，角度不对就会绕家转圈永远回不来（已踩坑）；
      // 减速后转弯半径 = v/6 随距离缩小，螺旋进家门（近处 v=240 → 半径 40 < 50）
      const dx = homeX - x, dy = homeY - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 50) { arrive(); return; }
      const v = Math.min(SPEED, Math.max(dist * 4, 240));
      const w = Math.min(dt * 6, 1);
      vx += (dx / dist * v - vx) * w;
      vy += (dy / dist * v - vy) * w;
      const sp = Math.hypot(vx, vy) || 1;
      vx = vx / sp * v; vy = vy / sp * v;
      x += vx * dt; y += vy * dt;
    }

    pts.push([x, y]);
    if (pts.length > 12) pts.shift();
    trail.setAttribute('d', 'M' + pts.map((p) => p.join(',')).join(' L'));
    // 剑尖朝运动方向（素材剑尖朝左，+180 对齐速度方向）
    const ang = Math.atan2(vy, vx) * 180 / Math.PI + 180;
    sword.setAttribute('transform', `translate(${x},${y}) rotate(${ang})`);
  }

  function frame(now) {
    // 兜底：帧循环任何异常都自动收尾，绝不让桌宠卡在 swordwait
    try { tick(now); } catch (e) { arrive(); return; }
    if (!done) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // rAF 停摆（窗口被判定遮挡等）时的推进兜底：位移全按墙钟结算，重复调用无害
  const watchdog = setInterval(() => {
    if (done) return;
    try { tick(performance.now()); } catch (e) { arrive(); }
  }, 400);
}

window.pet.onSword(({ x, y }) => flySword(x, y));

// ---------- 兜风 ----------
// GT3 RS 四帧序列（Kira 已在车里，素材由 tools/cutout_drive.js 抠图并对齐到统一画布）：
// drive_4 = 她探身指路的兴奋帧（进场/接人/互动时用），drive_1/3/2 = 巡航循环帧
const DRIVE_FRAMES = ['drive_1', 'drive_2', 'drive_3', 'drive_4'];
const TALK_F = 3;             // drive_4 的索引
const CRUISE_SEQ = [0, 2, 1]; // 巡航循环：drive_1 → drive_3 → drive_2

function makeCar() {
  const g = el('g', {});
  const CAR_W = 460 * ovlK, CAR_H = CAR_W * 900 / 1560; // 素材画布 1560x900，车随整体缩放
  const GROUND = 850 / 900; // 车轮地线在画布中的纵向比例（组原点在车轮着地点）
  const imgs = DRIVE_FRAMES.map((name, i) => {
    const im = el('image', {
      href: `../assets/${name}.png`,
      x: -CAR_W / 2, y: -CAR_H * GROUND, width: CAR_W, height: CAR_H,
    }, g);
    if (i > 0) im.setAttribute('visibility', 'hidden');
    return im;
  });
  let cur = 0;
  g.show = (i) => { // 切帧：只留一帧可见
    if (i === cur) return;
    imgs[cur].setAttribute('visibility', 'hidden');
    imgs[i].setAttribute('visibility', 'visible');
    cur = i;
  };
  return g;
}

function driveCar(homeX) {
  const layer = el('g', {});
  const car = makeCar();
  layer.appendChild(car);

  const roadY = innerHeight - 56;
  const CRUISE = 800;
  // 从离她近的一侧边缘进场，起步就快，马上能看见车
  const fromLeft = homeX <= innerWidth / 2;
  let x = fromLeft ? -520 : innerWidth + 520;
  let dir = fromLeft ? 1 : -1;
  let v = 700;
  let sub = 'enter';
  let laps = 0;
  let honkT = 2;
  let animT = 0, animIdx = 0; // 巡航帧循环
  const t0 = performance.now();
  let last = t0;
  car.show(TALK_F); // 进场：她探身指路
  // 进场立刻按一声喇叭，预告车来了
  honk(fromLeft ? 140 : innerWidth - 140, roadY - 190);

  function honk(px, py) {
    el('text', {
      x: px, y: py, 'text-anchor': 'middle',
      'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
      'font-size': 30, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 7, 'paint-order': 'stroke',
      class: 'fx-pop',
    }, layer).textContent = '滴滴';
  }

  let done = false;
  let driveDoneSent = false;
  const sendDone = () => { if (!driveDoneSent) { driveDoneSent = true; window.pet.driveDone(); } };
  // 收尾只走一次：保证桌宠一定收到 driveDone，绝不卡在 drivewait
  function finish() {
    if (done) return;
    done = true;
    clearInterval(watchdog);
    sendDone();
    layer.remove();
  }

  function tick(now) {
    if (done) return;
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const ms = now - t0;

    // 硬兜底：到点强制收（rAF 停摆之外的异常路径也覆盖）
    if (ms > 25000) { finish(); return; }

    if (sub === 'enter') {
      v = Math.min(v + 1600 * dt, 1000);
      x += dir * v * dt;
      if ((dir > 0 && x > 400) || (dir < 0 && x < innerWidth - 400)) sub = 'cruise';
    } else if (sub === 'cruise') {
      v = Math.max(v - 1600 * dt, CRUISE);
      x += dir * v * dt;
      if (x > innerWidth - 260) { dir = -1; laps++; }
      if (x < 260) { dir = 1; laps++; }
      honkT -= dt;
      if (honkT <= 0) { if (Math.random() < 0.4) honk(x, roadY - 190); honkT = 2 + Math.random() * 2.5; }
      // 巡航帧循环：她换着姿势开车
      animT += dt;
      if (animT >= 0.22) {
        animT = 0;
        animIdx = (animIdx + 1) % CRUISE_SEQ.length;
        car.show(CRUISE_SEQ[animIdx]);
      }
      if (laps >= 4 || ms > 9000) { sub = 'pickup'; car.show(TALK_F); }
    } else if (sub === 'pickup') {
      // 开回出发点接她
      const dist = homeX - x;
      dir = dist >= 0 ? 1 : -1;
      v = Math.min(Math.max(Math.abs(dist) * 4, 140, 800), 800);
      if (Math.abs(dist) < 30) {
        sub = 'exit';
        car.show(0); // 放下她：切回正常驾驶帧
        sendDone();
      } else {
        x += dir * v * dt;
      }
    } else if (sub === 'exit') {
      // 放下她之后加速离场
      v = Math.min(v + 2200 * dt, 1500);
      x += dir * v * dt;
      if (x < -520 || x > innerWidth + 520) { finish(); return; }
    }

    // 悬挂颠簸 + 翻转朝向（车头方向 = 前进方向，原图朝左）
    const bob = sub === 'pickup' && v < 300 ? 0 : 2.5 * Math.sin(now / 55);
    car.setAttribute('transform', `translate(${x},${roadY + bob}) scale(${-dir},1)`);
  }

  function frame(now) {
    try { tick(now); } catch (e) { finish(); return; }
    if (!done) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // rAF 停摆兜底：位移全按墙钟结算，定时器重复调用无害
  const watchdog = setInterval(() => {
    if (done) return;
    try { tick(performance.now()); } catch (e) { finish(); }
  }, 400);
}

window.pet.onDrive(({ x }) => driveCar(x));

// ---------- 暗中观察 ----------
// 半张超级大的脸从屏幕侧边探出来：带回弹滑入 → 悬停轻轻起伏 + 气泡台词 → 滑走
const PEEK_LINES = ['盯——', '让我看看你在干嘛', '偷看一眼…', '嘿嘿，发现你了', '在忙吗？', '我无所不在~'];
const peekStyle = document.createElement('style');
peekStyle.textContent = '@keyframes peekbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}';
document.head.appendChild(peekStyle);
let peeking = false;

window.pet.onPeek(({ side, y }) => {
  if (peeking) { window.pet.peekDone(); return; } // 防叠罗汉
  peeking = true;
  peekFace(side === 'left' ? 'left' : 'right', y);
});

function peekFace(side, y) {
  // 大脸高度钉死屏高 70%（≥2/3）：这是全屏特效，不跟人物缩放（ovlK）缩
  const H = Math.round(innerHeight * 0.7);
  const img = new Image();
  img.src = '../assets/head_big.png';
  img.onload = () => {
    const W = Math.round(H * img.naturalWidth / img.naturalHeight);
    // 图右侧的墙沿竖线（约 94.6% 处）对齐屏幕边：她从屏幕外扒着边沿探出头来
    const off = Math.round(W * 0.054);
    const top = Math.min(Math.max(Math.round(y - H / 2), 10), innerHeight - H - 10);
    const fromX = (side === 'left' ? -1 : 1) * Math.round(W * 0.55);
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;top:${top}px;${side}:${-off}px;width:${W}px;height:${H}px;` +
      `pointer-events:none;opacity:0;transform:translateX(${fromX}px);` +
      'transition:opacity .45s ease,transform .55s cubic-bezier(.2,1.25,.4,1);' +
      'filter:drop-shadow(0 10px 30px rgba(20,20,50,.45));';
    // 镜像层：原图扒的是右边的沿，从左侧来时镜像到左边；img 层做悬浮起伏
    const flip = document.createElement('div');
    flip.style.cssText = 'width:100%;height:100%;' + (side === 'left' ? 'transform:scaleX(-1);' : '');
    img.style.cssText = 'width:100%;height:100%;animation:peekbob 2.6s ease-in-out infinite;';
    flip.appendChild(img);
    box.appendChild(flip);
    // 气泡台词：贴在探进来的脸旁边
    const bub = document.createElement('div');
    bub.textContent = PEEK_LINES[Math.floor(Math.random() * PEEK_LINES.length)];
    bub.style.cssText = `position:fixed;top:${top + Math.round(H * 0.12)}px;${side}:${Math.round(W * 0.55)}px;` +
      'pointer-events:none;background:rgba(255,255,255,.95);color:#5b5680;font:600 17px "PingFang SC",sans-serif;' +
      'padding:9px 16px;border-radius:16px;box-shadow:0 4px 14px rgba(80,60,160,.25);opacity:0;transition:opacity .3s ease;';
    document.body.appendChild(box);
    document.body.appendChild(bub);
    void box.offsetWidth; // reflow 让滑入过渡生效
    box.style.opacity = '1';
    box.style.transform = 'translateX(0)';
    setTimeout(() => { bub.style.opacity = '1'; }, 650);
    setTimeout(() => {
      bub.style.opacity = '0';
      box.style.opacity = '0';
      box.style.transform = `translateX(${fromX}px)`;
    }, 3100);
    setTimeout(() => {
      box.remove();
      bub.remove();
      peeking = false;
      window.pet.peekDone();
    }, 3600);
  };
  img.onerror = () => { peeking = false; window.pet.peekDone(); };
}

// ---------- 捣乱 ----------
// 小本子直接盖住鼠标指针（哪里都点不穿），人物用绳子挂在鼠标下面按单摆物理甩动
// 使劲晃鼠标把她甩掉地，然后归位
const MISCHIEF_YELLS = ['啊', '疼', '你弄疼我了！', '干嘛！', '呜哇哇'];
const LAND_YELLS_1 = ['呜', '好痛…', '呜哇哇', '哎哟…'];
const LAND_YELLS_2 = ['你给我等着！', '哼！', '下次还敢（嘴硬）', '呜呜，欺负人…'];
const ROPE_LEN = 104; // 绳长
const ROPE_N = 10;    // 软绳链条段数（多一点才圆滑）
const ROPE_MIN = 50;  // 滚轮调绳长：下限
const ROPE_MAX = 320; // 滚轮调绳长：上限

// Catmull-Rom 转贝塞尔，把链条画成平滑曲线（不然一节节的很僵硬）
function smoothPath(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function mischief(startX, startY) {
  const layer = el('g', {});
  // 星月夜笔记本真图（assets/note.png，1023x1468≈1:1.44）压住鼠标，代替手绘版；随整体缩放
  const bookG = el('g', {}, layer);
  el('rect', { x: -44 * ovlK, y: -66 * ovlK, width: 96 * ovlK, height: 138 * ovlK, rx: 8 * ovlK, fill: 'rgba(20,20,60,.28)' }, bookG); // 投影
  el('image', { href: '../assets/note.png', x: -50 * ovlK, y: -74 * ovlK, width: 98 * ovlK, height: 98 * ovlK * 1468 / 1023 }, bookG);
  // 软绳（verlet 链条）+ 挂在下面的人物
  const rope = el('path', { fill: 'none', stroke: '#6b5a3a', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layer);
  const charG = el('g', {}, layer);
  el('image', { href: '../assets/chibi.png', x: -52 * ovlK, y: 0, width: 104 * ovlK, height: 104 * ovlK * 1125 / 1012 }, charG);

  function textPop(str, x, y, size = 30) {
    el('text', {
      x, y, 'text-anchor': 'middle',
      'font-family': '"PingFang SC", sans-serif', 'font-weight': 900, 'font-style': 'italic',
      'font-size': size, fill: '#1a1a2e', stroke: '#fff', 'stroke-width': 7, 'paint-order': 'stroke',
      class: 'fx-pop',
    }, layer).textContent = str;
  }

  let mx = startX, my = startY;   // 鼠标原始位置
  let ax = startX, ay = startY;   // 平滑后的锚点（迟缓跟随，防止一抖就甩飞）
  // 软绳链条：pts[0] 是锚点，pts[ROPE_N] 是人物
  // 滚轮调绳长：ropeTarget 是目标绳长，ropeLen 每帧平滑趋近它，段长按当前绳长实时重算
  let ropeLen = ROPE_LEN;
  let ropeTarget = ROPE_LEN;
  const pts = Array.from({ length: ROPE_N + 1 }, (_, i) => ({
    x: startX, y: startY + (ROPE_LEN / ROPE_N) * i, px: startX, py: startY + (ROPE_LEN / ROPE_N) * i,
  }));
  let shaking = false;
  let done = false;
  const samples = [];
  const t0 = performance.now();
  let last = t0;

  function onMove(e) {
    mx = e.clientX; my = e.clientY;
    samples.push({ x: mx, t: performance.now() });
    if (samples.length > 60) samples.shift();
  }
  function onDown() {
    if (done || shaking) return;
    // 笔记本盖在指针上，点哪里都点在她本子上
    textPop(MISCHIEF_YELLS[(Math.random() * MISCHIEF_YELLS.length) | 0], mx, my - 140);
  }
  function onWheel(e) {
    if (done || shaking) return;
    // 上滚绳变短、下滚绳变长；deltaY 按量累计，触控板细滚动也平滑
    ropeTarget = Math.min(ROPE_MAX, Math.max(ROPE_MIN, ropeTarget + e.deltaY * 0.4));
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('wheel', onWheel);
  window.pet.ovIgnore(false); // 挂住期间：覆盖层全程捕获，指针处真的点不穿

  // 晃掉检测：500ms 内横向大幅来回 ≥4 次换向
  function isShaken() {
    const now = performance.now();
    const s = samples.filter((p) => now - p.t < 500);
    if (s.length < 6) return false;
    let flips = 0, travel = 0, prevSign = 0;
    for (let i = 1; i < s.length; i++) {
      const d = s[i].x - s[i - 1].x;
      travel += Math.abs(d);
      const sign = d > 4 ? 1 : d < -4 ? -1 : 0;
      if (sign && prevSign && sign !== prevSign) flips++;
      if (sign) prevSign = sign;
    }
    return flips >= 4 && travel > 900;
  }

  let fallVx = 0, fallVy = 0, fallX = 0, fallY = 0;
  let landed = false;
  let slideT = 0; // 落地滑行计时
  let fallAng = 0, fallAngV = 0; // 抛飞时的姿态角与角速度（绕头顶绳结点）
  let charAng = 0; // 悬挂时的姿态角（带角阻尼，缓慢趋近绳角）
  let charX = startX, charY = startY + ROPE_LEN; // 位置（带惯性阻尼，不跟绳子乱跳）

  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mousedown', onDown);
    window.removeEventListener('wheel', onWheel);
    window.pet.ovIgnore(true); // 恢复穿透
    layer.style.transition = 'opacity .5s';
    layer.style.opacity = 0;
    setTimeout(() => layer.remove(), 550);
    window.pet.mischiefDone();
  }

  // 兜底：帧循环任何异常都自动收尾，绝不让覆盖层卡在捕获态
  function frame(now) {
    try { frameInner(now); } catch (e) { finish(); }
  }

  function frameInner(now) {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;

    if (!shaking) {
      // 绳长平滑趋近滚轮目标值，段长实时重算（只改约束目标，单摆手感不变）
      ropeLen += (ropeTarget - ropeLen) * Math.min(dt * 6, 1);
      const SEG = ropeLen / ROPE_N;
      // 锚点迟缓跟随鼠标：鼠标小抖不会直接拽飞她
      ax += (mx - ax) * Math.min(dt * 8, 1);
      ay += (my - ay) * Math.min(dt * 8, 1);
      // 软绳 verlet：除锚点外全部重力积分（高阻尼，动作更缓），再逐段做长度约束
      // 重坠物模型：小人有重量有惯性，锚点传下来的约束力对末端大幅衰减；
      // 但重力保持全额（自然下垂），且绳长超 1.5 倍时强制拉满（绳子永不断开）
      for (let i = 1; i <= ROPE_N; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.92, vy = (p.y - p.py) * 0.92;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + 1600 * dt * dt;
      }
      for (let iter = 0; iter < 3; iter++) {
        pts[0].x = ax; pts[0].y = ay + 66; // 锚点钉在笔记本下沿（B5 竖版底边）
        for (let i = 0; i < ROPE_N; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          // 末端：约束力衰减到 0.15，但拉伸超过 1.5 倍绳长时不再衰减
          const fix = (d - SEG) / d * (i + 1 === ROPE_N && d <= SEG * 1.5 ? 0.15 : 1);
          b.x -= dx * fix;
          b.y -= dy * fix;
        }
      }
      const rx = pts[ROPE_N].x, ry = pts[ROPE_N].y;
      // 位置惯性阻尼：绳末端猛动，她也只依惯性缓跟
      charX += (rx - charX) * Math.min(dt * 6, 1);
      charY += (ry - charY) * Math.min(dt * 6, 1);
      // 笔记本压住指针（轻微晃动）
      const wob = 2.5 * Math.sin(now / 280);
      bookG.setAttribute('transform', `translate(${ax + wob},${ay}) rotate(${wob})`);
      // 软绳画成平滑曲线（末端画到阻尼后的小人位置，绳子不断）
      const drawPts = pts.slice();
      drawPts[ROPE_N] = { x: charX, y: charY };
      rope.setAttribute('d', smoothPath(drawPts));
      // 她沿最末段绳角倾斜（角阻尼：缓慢趋近，不跟绳子急转）
      const targetAng = Math.atan2(charX - pts[ROPE_N - 1].x, charY - pts[ROPE_N - 1].y) * 180 / Math.PI * 0.7;
      charAng += (targetAng - charAng) * Math.min(dt * 8, 1);
      charG.setAttribute('transform', `translate(${charX},${charY}) rotate(${charAng})`);

      if (isShaken()) {
        // 被甩出去了：沿鼠标横向速度抛飞，笔记本和绳子脱手
        shaking = true;
        const recent = samples.filter((p) => now - p.t < 200);
        fallVx = recent.length > 1 ? Math.max(-700, Math.min(700, (recent[recent.length - 1].x - recent[0].x) * 8)) : 400;
        fallVy = -260;
        fallX = charX; fallY = charY;
        bookG.style.transition = 'opacity .25s';
        bookG.style.opacity = 0;
        rope.style.opacity = 0;
        textPop('呜哇——', charX, charY - 60, 34);
        window.pet.ovIgnore(true);
      } else if (now - t0 > 25000) {
        // 捣乱够了自己回去
        finish();
        return;
      }
    } else {
      // 抛飞落地：重力 + 翻滚（第一版手感）
      fallVy += 3000 * dt;
      fallX += fallVx * dt;
      fallY += fallVy * dt;
      const ground = innerHeight - 80;
      if (fallY >= ground) {
        // 落地后趴着出溜一段：摩擦减速，滑停时嘴硬一句再走
        if (!landed) {
          landed = true;
          fallY = ground;
          textPop(LAND_YELLS_1[(Math.random() * LAND_YELLS_1.length) | 0], fallX, ground - 100, 26);
        }
        fallVx *= Math.max(0, 1 - 4 * dt); // 地面摩擦
        if (Math.abs(fallVx) < 20) fallVx = 0;
        fallX = Math.min(innerWidth - 60, Math.max(60, fallX + fallVx * dt));
        charG.setAttribute('transform', `translate(${fallX},${fallY - 40}) rotate(70)`);
        slideT += dt;
        if (slideT > 0.9) {
          textPop(LAND_YELLS_2[(Math.random() * LAND_YELLS_2.length) | 0], fallX, ground - 110, 24);
          finish();
          return;
        }
        requestAnimationFrame(frame);
        return;
      }
      charG.setAttribute('transform', `translate(${fallX},${fallY}) rotate(${(now / 100 % 6.28) * 57})`);
      return requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.pet.onMischief(({ x, y }) => mischief(x, y));

// ---------- 攀爬安全绳 ----------
// 捣乱那根软绳的变种：同一套 verlet 链条 + smoothPath，但没有笔记本，且两端都钉住——
// 下端钉在起爬点，上端拴在她腰上跟着爬。桌宠侧节流报腰间坐标，这边只管画。
const CLIMB_ROPE_N = 14;
let climbRope = null;

function ropeUpdate(d) {
  if (d.start || !climbRope) {
    if (climbRope) climbRope.layer.remove();
    const layer = el('g', {});
    const path = el('path', { fill: 'none', stroke: '#6b5a3a', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layer);
    // 两端的绳结：画个小圆点，更像「拴住了」
    const knotA = el('circle', { r: 3.5, fill: '#6b5a3a' }, layer);
    const knotW = el('circle', { r: 3.5, fill: '#6b5a3a' }, layer);
    climbRope = { layer, path, knotA, knotW, ax: d.ax, ay: d.ay, wx: d.wx, wy: d.wy, pts: null, last: performance.now() };
    requestAnimationFrame(ropeFrame);
    return;
  }
  climbRope.wx = d.wx;
  climbRope.wy = d.wy;
}

function ropeClear() {
  if (!climbRope) return;
  const r = climbRope;
  climbRope = null;
  r.layer.style.transition = 'opacity .4s';
  r.layer.style.opacity = 0;
  setTimeout(() => r.layer.remove(), 450);
}

function ropeFrame(now) {
  const r = climbRope;
  if (!r) return;
  const dt = Math.min((now - r.last) / 1000, 0.033);
  r.last = now;
  // 绳长比两端直线距离略长，垂出自然弧度；她越爬越高，绳子跟着放长
  const dist = Math.hypot(r.wx - r.ax, r.wy - r.ay);
  const seg = (dist * 1.08 + 36) / CLIMB_ROPE_N;
  if (!r.pts) {
    r.pts = Array.from({ length: CLIMB_ROPE_N + 1 }, (_, i) => {
      const x = r.ax + (r.wx - r.ax) * i / CLIMB_ROPE_N;
      const y = r.ay + (r.wy - r.ay) * i / CLIMB_ROPE_N;
      return { x, y, px: x, py: y };
    });
  }
  // verlet 积分（跳过两个钉死的端点），再逐段做长度约束
  for (let i = 1; i < CLIMB_ROPE_N; i++) {
    const p = r.pts[i];
    const vx = (p.x - p.px) * 0.92, vy = (p.y - p.py) * 0.92;
    p.px = p.x; p.py = p.y;
    p.x += vx;
    p.y += vy + 1600 * dt * dt;
  }
  for (let iter = 0; iter < 3; iter++) {
    r.pts[0].x = r.ax; r.pts[0].y = r.ay;
    r.pts[CLIMB_ROPE_N].x = r.wx; r.pts[CLIMB_ROPE_N].y = r.wy;
    for (let i = 0; i < CLIMB_ROPE_N; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = Math.hypot(dx, dy) || 1;
      const fix = (d2 - seg) / d2;
      // 端点段只动内侧点（端点钉死），中间段对半分
      if (i === 0) { b.x -= dx * fix; b.y -= dy * fix; }
      else if (i === CLIMB_ROPE_N - 1) { a.x += dx * fix; a.y += dy * fix; }
      else { a.x += dx * fix / 2; a.y += dy * fix / 2; b.x -= dx * fix / 2; b.y -= dy * fix / 2; }
    }
  }
  r.path.setAttribute('d', smoothPath(r.pts));
  r.knotA.setAttribute('cx', r.ax); r.knotA.setAttribute('cy', r.ay);
  r.knotW.setAttribute('cx', r.wx); r.knotW.setAttribute('cy', r.wy);
  requestAnimationFrame(ropeFrame);
}

window.pet.onRope(ropeUpdate);
window.pet.onRopeEnd(ropeClear);

// ---------- 扩展特效注册表 ----------
// ext/ov_<id>.js 用 registerOvFx(kind, fn) 挂特效；桌宠侧 fxStart(kind, data) 经主进程转发到这里。
// 特效结束由特效自己调 window.pet.fxDone(kind)，桌宠动作才能收尾
const EXT_FX = {};
function registerOvFx(kind, fn) {
  if (EXT_FX[kind]) console.warn(`[ext] overlay 特效「${kind}」被重复注册，后者覆盖前者`);
  EXT_FX[kind] = fn;
}
window.registerOvFx = registerOvFx;
window.pet.onFxExt((kind, data) => {
  const fn = EXT_FX[kind];
  // 没注册 handler（ov_ 文件缺失）时立即回执：桌宠侧在等 fxDone 收尾，不能干等到兜底
  if (!fn) { window.pet.fxDone(kind); return; }
  try { fn(data); } catch (e) { window.pet.fxDone(kind); }
});

// ---------- 星盘右键菜单 ----------
// 以右键点击时的鼠标位置为圆心展开圆形菜单（锚定屏幕坐标，人物走开菜单不动）。
// 一级为分类 + 小本子/设置直选项，「取消」固定在正下方；中心枢纽顶层 ✦ 关闭、子层 ↩ 返回。
// 鼠标进入某项的扇区即聚焦并淡淡高亮（光楔 + 按钮发光），离得足够远才取消高亮。
const menuLayer = document.getElementById('menuLayer');

const MENU_TREE = [
  { id: 'act', icon: '🐾', label: '动作', children: [
    { id: 'walk', icon: '🐾', label: '走一走' },
    { id: 'walkfar', icon: '🚶‍♀️', label: '走到另一边' },
    { id: 'hop', icon: '🐇', label: '跳一下' },
    { id: 'sway', icon: '💗', label: '撒个娇' },
    { id: 'point', icon: '👉', label: '指人发火' },
    { id: 'leave', icon: '👋', label: '走了走了' },
  ] },
  { id: 'form', icon: '✨', label: '变身', children: [
    { id: 'morph', icon: '🎭', label: '变个身' },
    { id: 'form-normal', icon: '👩', label: '姐姐形态' },
    { id: 'form-chibi', icon: '🐣', label: 'Q版形态' },
    { id: 'form-flute', icon: '🪈', label: '笛子形态' },
    { id: 'form-note', icon: '📓', label: '笔记本形态' },
    { id: 'form-sleep', icon: '😴', label: '睡觉形态' },
    { id: 'form-back', icon: '🙉', label: '背对形态' },
  ] },
  { id: 'play', icon: '🎈', label: '玩耍', children: [
    { id: 'goledge', icon: '🪟', label: '去窗台玩' },
    { id: 'climb', icon: '🧗', label: '爬墙上去' },
    { id: 'dash', icon: '💨', label: '暴走模式' },
    { id: 'fly', icon: '🕊️', label: '御剑飞行' },
    { id: 'sword', icon: '⚔️', label: '化身成剑' },
    { id: 'drive', icon: '🚗', label: '去兜风' },
    { id: 'flutefly', icon: '🪈', label: '笛子乱飞' },
    { id: 'peekbig', icon: '👀', label: '暗中观察' },
    { id: 'knock', icon: '🚪', label: '敲门求关注' },
    { id: 'sleep', icon: '😴', label: '睡觉' },
    { id: 'mischief', icon: '😈', label: '捣乱' },
    { id: 'wallbang', icon: '🧱', label: '撞墙' },
    { id: 'work', icon: '💼', label: '工作模式' },
    { id: 'poop', icon: '💩', label: '你讨厌！' },
    { id: 'desk', icon: '🪑', label: '来张桌子' },
  ] },
  { id: 'act2', icon: '🎪', label: '杂耍', children: [
    { id: 'juggle', icon: '🤹', label: '抛接球' },
    { id: 'magic', icon: '🎩', label: '变魔术' },
    { id: 'yoyo', icon: '🪀', label: '溜溜球' },
    { id: 'dance', icon: '🕺', label: '蹦迪' },
    { id: 'trampoline', icon: '🤸', label: '蹦床' },
    { id: 'roll', icon: '🍥', label: '打滚' },
    { id: 'slide', icon: '🛝', label: '滑滑梯' },
    { id: 'exercise', icon: '🏋️', label: '做早操' },
    { id: 'stretch', icon: '🙆', label: '伸懒腰' },
    { id: 'photo', icon: '📸', label: '自拍' },
  ] },
  { id: 'act3', icon: '🏞️', label: '出门', children: [
    { id: 'follow', icon: '🐕', label: '跟屁虫' },
    { id: 'sit', icon: '🧎', label: '坐下陪你' },
    { id: 'kite', icon: '🪁', label: '放风筝' },
    { id: 'umbrellawalk', icon: '☔', label: '打伞散步' },
    { id: 'umbrellafly', icon: '🌂', label: '雨伞飞天' },
    { id: 'stargaze', icon: '🌟', label: '数星星' },
    { id: 'snow', icon: '❄️', label: '接雪花' },
    { id: 'lantern', icon: '🏮', label: '放灯笼' },
    { id: 'swing', icon: '🎠', label: '荡秋千' },
    { id: 'fish', icon: '🎣', label: '钓鱼' },
  ] },
  { id: 'act4', icon: '🎮', label: '游戏', children: [
    { id: 'hide', icon: '🫣', label: '捉迷藏' },
    { id: 'rps', icon: '✊', label: '石头剪刀布' },
    { id: 'arrowdodge', icon: '⌨️', label: '方向键逗宠' },
    { id: 'tightrope', icon: '🎪', label: '走钢丝' },
    { id: 'sleepwalk', icon: '💤', label: '梦游' },
    { id: 'meditate', icon: '🧘', label: '打坐' },
    { id: 'balloon', icon: '🎈', label: '气球漂流' },
    { id: 'confetti', icon: '🎉', label: '撒花' },
    { id: 'tomato', icon: '🍅', label: '番茄钟' },
  ] },
  { id: 'sys', icon: '🃏', label: '法宝', children: [
    { id: 'seal', icon: '🃏', label: '收进法宝' },
    { id: 'stats', icon: '📊', label: '看看状态' },
    { id: 'quit', icon: '🚪', label: '退出' },
  ] },
  { id: 'notebook', icon: '📖', label: '小本子' },
  { id: 'settings', icon: '⚙️', label: '设置', children: [
    { id: 'size', icon: '📏', label: '大小', children: [
      { id: 'size:0.6', icon: '🤏', label: '迷你' },
      { id: 'size:0.8', icon: '🐣', label: '偏小' },
      { id: 'size:1', icon: '🧍', label: '标准' },
      { id: 'size:1.25', icon: '🐱', label: '偏大' },
      { id: 'size:1.5', icon: '🦣', label: '巨大' },
    ] },
    { id: 'debug', icon: '🐾', label: '调试动作' },
    { id: 'settings', icon: '⚙️', label: '设置' },
  ] },
  { id: '_close', icon: '✕', label: '取消' },
];

let menuState = null; // { cx, cy, root, hub, ring1, ring2, sector, sectors, sectorHalf, focusSel, farR, level }
let menuIdleTimer = null;
let holdTrack = null; // 右键按住开菜单的跟手跟踪（见 startHoldTrack）

// 10s 没人碰菜单就自动退出；悬停/点击任何菜单项都会重置计时
function armMenuIdle() {
  clearTimeout(menuIdleTimer);
  menuIdleTimer = setTimeout(() => closeMenu(), 10000);
}

// 关闭菜单：所有项缩回圆心后移除；notify 时通知主进程恢复覆盖层穿透
function closeMenu(notify = true) {
  if (!menuState) return;
  stopHoldTrack();
  clearTimeout(menuIdleTimer);
  menuIdleTimer = null;
  const { root } = menuState;
  menuState = null;
  root.querySelectorAll('.rm-item').forEach((it) => {
    it.style.transitionDelay = '0ms';
    it.style.opacity = '0';
    it.style.transform = `translate(${-parseFloat(it.dataset.dx)}px, ${-parseFloat(it.dataset.dy)}px) scale(0)`;
  });
  root.querySelectorAll('.rm-hub, .rm-ring, .rm-backdrop, .rm-sector, .rm-dim').forEach((e2) => {
    e2.style.transition = 'opacity .22s';
    e2.style.opacity = '0';
  });
  setTimeout(() => root.remove(), 160);
  if (notify) window.pet.menuClosed();
}

// 给「大小」分类的当前档位打 ✓：最接近 settings._size 的档位标星（用缓存值，同步不等 IPC）
function markCurrentSize() {
  const cat = MENU_TREE.flatMap((c) => [c, ...(c.children || [])]).find((c) => c.id === 'size');
  if (!cat) return;
  const v = cachedSize || 1;
  let best = cat.children[0];
  for (const item of cat.children) {
    if (Math.abs(parseFloat(item.id.slice(5)) - v) < Math.abs(parseFloat(best.id.slice(5)) - v)) best = item;
  }
  for (const item of cat.children) {
    item.label = item.label.replace(/ ✓$/, '') + (item === best ? ' ✓' : '');
  }
}

// kira 配置缓存：主菜单的「Kira」入口只在配置好（unlocked + enabled）时出现
let kiraConfigured = false;
function refreshKiraConfigured() {
  window.pet.getYomiConfig().then((c) => {
    kiraConfigured = !!(c && c.unlocked && c.enabled && c.wsUrl);
  });
}
refreshKiraConfigured();

function openMenu(x, y) {
  closeMenu(false); // 已有菜单先静默关掉，由本次重新锚定
  markCurrentSize(); // 给「大小」分类的当前档位打上 ✓（菜单项是静态树，每次开前重标）
  refreshKiraConfigured(); // 顺手刷 kira 入口显隐（下次开菜单生效）
  const M = MENU_TREE.length > 8 ? 210 : 185; // 最大外半径 + 余量，防贴边（一级超过 8 项时圆盘半径更大）
  const cx = Math.min(Math.max(x, M), innerWidth - M);
  const cy = Math.min(Math.max(y, M), innerHeight - M);
  const root = document.createElement('div');
  root.className = 'rm-root';
  menuLayer.appendChild(root);

  const backdrop = document.createElement('div');
  backdrop.className = 'rm-backdrop';
  // 点击扇区环带 = 直接激活该项（不必精确点球）；点在菜单外才关
  backdrop.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (holdTrack) holdTrack.state = 'done'; // 已有新按压，按住跟踪作废
    const st = menuState;
    const sel = st && sectorAt(e.clientX - st.cx, e.clientY - st.cy);
    if (sel) activate(sel.item);
    else closeMenu();
  });
  // 菜单展开时右键按下：空白处换位置重新展开（扇形上的激活留给松手，标记菜单式交互）
  backdrop.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (holdTrack) holdTrack.state = 'done';
    const st = menuState;
    const sel = st && sectorAt(e.clientX - st.cx, e.clientY - st.cy);
    if (!sel) openMenu(e.clientX, e.clientY);
  });
  // 按住右键拖拽、松手选中：松手时扇形在环带上就激活；在圆心小圆里松手不算点击
  backdrop.addEventListener('mouseup', (e) => {
    if (e.button !== 2) return;
    if (holdTrack) holdTrack.state = 'done';
    const st = menuState;
    if (!st) return;
    const d = Math.hypot(e.clientX - st.cx, e.clientY - st.cy);
    if (d < 26) return; // 圆心小圆里松手：取消语义，不算点击
    const sel = sectorAt(e.clientX - st.cx, e.clientY - st.cy);
    if (sel) activate(sel.item);
  });
  root.appendChild(backdrop);

  // 装饰双环（反向慢旋），尺寸随当前环半径调整
  const ring1 = document.createElement('div');
  const ring2 = document.createElement('div');
  ring1.className = 'rm-ring r1';
  ring2.className = 'rm-ring r2';
  for (const r of [ring1, ring2]) {
    r.style.left = `${cx}px`;
    r.style.top = `${cy}px`;
    root.appendChild(r);
  }

  const hub = document.createElement('button');
  hub.className = 'rm-hub';
  hub.style.left = `${cx}px`;
  hub.style.top = `${cy}px`;
  root.appendChild(hub);

  // 背景薄纱：垫在菜单项下面、装饰环上面，极淡一层统一菜单区域的底色
  const dim = document.createElement('div');
  dim.className = 'rm-dim';
  dim.style.left = `${cx}px`;
  dim.style.top = `${cy}px`;
  root.appendChild(dim);

  // 扇区高亮光楔：指向当前聚焦项，层级压在菜单项下面
  const sector = document.createElement('div');
  sector.className = 'rm-sector';
  sector.style.left = `${cx}px`;
  sector.style.top = `${cy}px`;
  root.appendChild(sector);

  menuState = { cx, cy, root, hub, ring1, ring2, dim, sector, sectors: [], sectorHalf: 0, focusSel: null, farR: 0, level: 0 };
  root.addEventListener('mousemove', onMenuHover);
  armMenuIdle();
  startHoldTrack(); // 本次若是右键按住开菜单，启用轮询跟手
  renderLevel(MENU_TREE, 0);
}

// 扇区判定：给定相对圆心坐标，返回命中的扇区（在环带内且角度最近）；不在环带返回 null
function sectorAt(dx, dy) {
  const st = menuState;
  if (!st || !st.sectors.length) return null;
  const d = Math.hypot(dx, dy);
  if (d > st.farR || d < 26) return null;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best = null;
  let bestDiff = Infinity;
  for (const s of st.sectors) {
    let diff = Math.abs(ang - s.angle) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

// 扇区悬停：按最近角度判定鼠标落在哪项的扇区，聚焦并淡淡高亮；
// 只有鼠标离得足够远（超出菜单圈外一截）或回到枢纽上才取消高亮
function onMenuHover(e) {
  const st = menuState;
  if (!st || !st.sectors.length) return;
  armMenuIdle(); // 在扇区里移动也算有人碰
  const ht = holdTrack;
  if (ht && ht.state !== 'done') {
    if (e.buttons & 2) {
      ht.state = 'done'; // 按住中事件也能到达（按压点在覆盖层上）：原生事件够用，停掉轮询
    } else if (ht.state === 'hold') {
      // 按住拖动的松手瞬间：光标还停在按住时高亮的扇区上 = 选中它；
      // 在圆心死区/远处松手时 focusSel 为 null，天然符合「不算点击」
      ht.state = 'done';
      const sel = sectorAt(e.clientX - st.cx, e.clientY - st.cy);
      if (st.focusSel && sel === st.focusSel) { activate(sel.item); return; }
    } else {
      ht.state = 'done'; // 事件正常流入，是单击开场而非按住
    }
  }
  setMenuFocus(sectorAt(e.clientX - st.cx, e.clientY - st.cy));
}

// 右键按住开菜单的跟手跟踪。
// 根因：星盘由桌宠窗口的 contextmenu 触发，macOS 把一次按压的整条拖拽事件流
// （mousemove/mouseup）都路由给 mousedown 所在的窗口——右键不松手拖动时事件全进了
// 桌宠窗口，覆盖层一个都收不到，所以高亮不跟手。这里改为轮询光标位置：
// 光标动过却持续收不到真实 mousemove = 右键还按着（事件被桌宠窗口吃掉），
// 用轮询坐标驱动高亮；之后第一个「右键已松」的 mousemove 即松手瞬间（见 onMenuHover）。
function startHoldTrack() {
  stopHoldTrack();
  if (typeof window.pet.getCursor !== 'function') return; // 测试页 stub 没有该通道
  const ht = { state: 'watch', movedAt: 0, lx: null, ly: null, ax: null, ay: null, timer: 0 };
  holdTrack = ht;
  ht.timer = setInterval(() => {
    if (!menuState || holdTrack !== ht || ht.state === 'done') { stopHoldTrack(); return; }
    window.pet.getCursor().then((pt) => {
      const st = menuState;
      if (!st || holdTrack !== ht || ht.state === 'done') return;
      const lx = pt.x - window.screenX; // 屏幕绝对坐标 → 覆盖层本地坐标
      const ly = pt.y - window.screenY;
      if (ht.lx === null) { ht.lx = lx; ht.ly = ly; return; } // 首拍只建基准，不算移动
      const moved = lx !== ht.lx || ly !== ht.ly;
      ht.lx = lx;
      ht.ly = ly;
      if (ht.state === 'watch') {
        if (moved && !ht.movedAt) ht.movedAt = performance.now();
        // 光标动过却持续 ~150ms 收不到真实 mousemove，才认定右键仍按住：
        // 排除普通单击后事件尚未流入的窗口期，避免把正常悬停误判成按住
        if (!ht.movedAt || performance.now() - ht.movedAt <= 150) return;
        ht.state = 'hold';
      }
      if (!moved && ht.ax === lx && ht.ay === ly) return; // 已按该位置刷过高亮
      ht.ax = lx;
      ht.ay = ly;
      armMenuIdle(); // 按住拖动也算有人碰
      setMenuFocus(sectorAt(lx - st.cx, ly - st.cy));
    });
  }, 40);
}

function stopHoldTrack() {
  if (!holdTrack) return;
  clearInterval(holdTrack.timer);
  holdTrack = null;
}

function setMenuFocus(sel) {
  const st = menuState;
  if (!st || st.focusSel === sel) return;
  if (st.focusSel) st.focusSel.el.classList.remove('focus');
  st.focusSel = sel;
  if (sel) {
    sel.el.classList.add('focus');
    const h = st.sectorHalf;
    // conic-gradient 0deg 在正上方、顺时针为正，换算菜单角度（0°=右、y 向下）
    st.sector.style.background = `conic-gradient(from ${sel.angle + 90 - h}deg, rgba(255, 190, 120, 0.25) 0deg ${h * 2}deg, transparent ${h * 2}deg 360deg)`;
    st.sector.style.opacity = '1';
  } else {
    st.sector.style.opacity = '0';
  }
}

function renderLevel(items, level) {
  const st = menuState;
  if (!st) return;
  st.level = level;
  st.focusSel = null;
  st.sectors = [];
  st.sector.style.opacity = '0';
  // 主层：配置了 kira 的话，在「小本子」前面插入 Kira 入口（动态项，不进静态树）
  if (level === 0 && kiraConfigured) {
    items = [...items];
    const idx = items.findIndex((i) => i.id === 'notebook');
    items.splice(idx >= 0 ? idx : items.length - 1, 0, { id: 'kira', icon: '🤖', label: 'Kira' });
  }
  // 旧项缩回圆心后移除
  for (const it of st.root.querySelectorAll('.rm-item')) {
    it.style.transitionDelay = '0ms';
    it.style.opacity = '0';
    it.style.transform = `translate(${-parseFloat(it.dataset.dx)}px, ${-parseFloat(it.dataset.dy)}px) scale(0)`;
    setTimeout(() => it.remove(), 240);
  }
  armMenuIdle(); // 每次切换层级也重置闲置计时

  // 大分组（>8 项）摆圆盘太挤：改网格列表，一行一个，向两边扩展。
  // 一级菜单永远摆圆盘（星盘的一圈效果是灵魂，项数再多也均布圆周）
  if (items.length > 8 && level > 0) return renderListLevel(items, level);

  st.hub.style.display = '';
  st.hub.textContent = level === 0 ? '✦' : '↩';
  st.hub.onclick = () => { if (level === 0) closeMenu(); else renderLevel(MENU_TREE, 0); };
  st.hub.oncontextmenu = (e) => { e.preventDefault(); st.hub.onclick(); }; // 右键同样确定
  st.hub.onmouseenter = armMenuIdle;

  const r = items.length <= 4 ? 98 : items.length <= 6 ? 116 : items.length <= 8 ? 132 : 152;
  st.farR = r + 90; // 超出这个距离才取消扇区高亮
  st.ring1.style.width = st.ring1.style.height = `${r * 2 + 74}px`;
  st.ring2.style.width = st.ring2.style.height = `${r * 2 + 40}px`;
  st.sector.style.width = st.sector.style.height = `${r * 2 + 92}px`;
  st.dim.style.width = st.dim.style.height = `${r * 2 + 150}px`;
  // 网格模式里用 visibility 藏掉的装饰件，回圆盘模式要恢复
  for (const e of [st.ring1, st.ring2, st.sector, st.dim]) e.style.visibility = '';

  // 均布圆周；末项是「取消」时整体旋转，让取消固定在正下方（90°）
  const hasClose = items[items.length - 1].id === '_close';
  const step = 360 / items.length;
  const start = hasClose ? 90 - step * (items.length - 1) : -90;
  st.sectorHalf = step / 2;

  items.forEach((item, i) => {
    const aDeg = start + step * i;
    const a = (aDeg * Math.PI) / 180;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    const it = document.createElement('div');
    it.className = 'rm-item';
    it.style.left = `${st.cx + dx - 32}px`;
    it.style.top = `${st.cy + dy - 32}px`;
    it.style.opacity = '0';
    it.style.transform = `translate(${-dx}px, ${-dy}px) scale(0)`;
    it.dataset.dx = dx;
    it.dataset.dy = dy;
    it.innerHTML = `<button class="rm-btn"><span class="rm-icon" style="animation-delay:${i * 0.18}s">${item.icon}</span><span class="rm-label">${item.label}</span></button>`;
    it.querySelector('button').addEventListener('click', () => activate(item));
    it.querySelector('button').addEventListener('contextmenu', (e) => { e.preventDefault(); activate(item); }); // 右键同样确定
    it.addEventListener('mouseenter', armMenuIdle); // 碰到就算有人碰
    st.root.appendChild(it);
    st.sectors.push({ el: it, angle: aDeg, item });
    // 错峰从圆心飞出
    requestAnimationFrame(() => requestAnimationFrame(() => {
      it.style.transitionDelay = `${i * 14}ms`;
      it.style.opacity = '1';
      it.style.transform = 'translate(0px, 0px) scale(1)';
    }));
  });
}

// 激活一个菜单项（球体点击和扇区点击共用）
function activate(item) {
  const st = menuState;
  if (!st) return;
  if (item.id === '_close') closeMenu();
  else if (item.id === '_back') renderLevel(MENU_TREE, 0);
  else if (item.children) renderLevel(item.children, st.level + 1);
  else {
    window.pet.menuSelect(item.id);
    closeMenu();
  }
}

// 大分组多列网格（替代单列长列表）：每列最多 7 行，整体居中展开；首格是返回
function renderListLevel(items, level) {
  const st = menuState;
  st.hub.style.display = 'none'; // 返回做成首格，枢纽藏掉
  const CELL_W = 168, CELL_H = 38, GAP_X = 12, GAP_Y = 8, PER_COL = 7;
  const cells = [{ id: '_back', icon: '↩', label: '返回' }, ...items];
  const nCols = Math.ceil(cells.length / PER_COL);
  const nRows = Math.ceil(cells.length / nCols);
  const gridW = nCols * CELL_W + (nCols - 1) * GAP_X;
  const gridH = nRows * CELL_H + (nRows - 1) * GAP_Y;
  const gx = Math.min(Math.max(st.cx, gridW / 2 + 20), innerWidth - gridW / 2 - 20);
  const startY = Math.min(Math.max(st.cy - gridH / 2, 16), Math.max(16, innerHeight - gridH - 16));
  // 装饰环/扇区/压暗盘在网格模式下没有意义，藏掉（用 visibility：0px 会留下 1px 边框点）
  for (const e of [st.ring1, st.ring2, st.sector, st.dim]) e.style.visibility = 'hidden';
  st.farR = 0;

  cells.forEach((item, i) => {
    const col = (i / nRows) | 0;
    const row = i % nRows;
    const left = gx - gridW / 2 + col * (CELL_W + GAP_X);
    const top = startY + row * (CELL_H + GAP_Y);
    const ccx = left + CELL_W / 2, ccy = top + CELL_H / 2;
    const it = document.createElement('div');
    it.className = 'rm-item pill' + (i === 0 ? ' backrow' : '');
    it.style.left = `${left}px`;
    it.style.top = `${top}px`;
    it.style.opacity = '0';
    it.style.transform = `translate(${st.cx - ccx}px, ${st.cy - ccy}px) scale(0)`;
    it.dataset.dx = ccx - st.cx; // 收回时缩向圆心
    it.dataset.dy = ccy - st.cy;
    it.innerHTML = `<button class="rm-pill"><span class="rm-icon">${item.icon}</span><span class="rm-label">${item.label}</span></button>`;
    it.querySelector('button').addEventListener('click', () => activate(item));
    it.querySelector('button').addEventListener('contextmenu', (e) => { e.preventDefault(); activate(item); }); // 右键同样确定
    it.addEventListener('mouseenter', () => {
      armMenuIdle();
      st.root.querySelectorAll('.rm-item.pill.focus').forEach((e2) => e2.classList.remove('focus'));
      it.classList.add('focus');
    });
    st.root.appendChild(it);
    // 错峰从圆心飞出
    requestAnimationFrame(() => requestAnimationFrame(() => {
      it.style.transitionDelay = `${i * 10}ms`;
      it.style.opacity = '1';
      it.style.transform = 'translate(0px, 0px) scale(1)';
    }));
  });
}

window.pet.onMenuOpen(({ x, y }) => openMenu(x, y));
