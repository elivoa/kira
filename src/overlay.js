// 全屏覆盖层：承接「你讨厌！」扔屎特效（点击穿透，不参与交互）
const ov = document.getElementById('ov');
const SVG_NS = 'http://www.w3.org/2000/svg';

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

// 银刃金镡紫柄的剑，剑尖朝 -y（配合朝向旋转）
function makeSword() {
  ensureSwordDefs();
  const g = el('g', {});
  el('polygon', { points: '0,-78 8,-56 8,30 -8,30 -8,-56', fill: 'url(#bladeGrad)', stroke: '#8a8fa8', 'stroke-width': 1.5 }, g);
  el('line', { x1: 0, y1: -54, x2: 0, y2: 28, stroke: '#f4f6ff', 'stroke-width': 1.5, opacity: 0.8 }, g);
  el('rect', { x: -17, y: 30, width: 34, height: 8, rx: 3.5, fill: '#e8c86a', stroke: '#a8842a', 'stroke-width': 1.5 }, g);
  el('rect', { x: -6, y: 38, width: 12, height: 27, rx: 4, fill: '#2c2a54', stroke: '#1a1836', 'stroke-width': 1.5 }, g);
  el('circle', { cx: 0, cy: 71, r: 6.5, fill: '#7d6fd0', stroke: '#e6e0ff', 'stroke-width': 2 }, g);
  return g;
}

function flySword(homeX, homeY) {
  const layer = el('g', {});
  // 剑光拖尾
  const trail = el('path', { fill: 'none', stroke: '#b9a8ff', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.35 }, layer);
  const sword = makeSword();
  layer.appendChild(sword);

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

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const ms = now - t0;

    if (ms < FLY_MS) {
      x += vx * dt; y += vy * dt;
      // 撞边反弹
      if (x < 60) { x = 60; vx = Math.abs(vx); spark(x, y); }
      else if (x > innerWidth - 60) { x = innerWidth - 60; vx = -Math.abs(vx); spark(x, y); }
      if (y < 60) { y = 60; vy = Math.abs(vy); spark(x, y); }
      else if (y > innerHeight - 60) { y = innerHeight - 60; vy = -Math.abs(vy); spark(x, y); }
    } else {
      // 返航：朝出发点加速转向
      const dx = homeX - x, dy = homeY - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 50) {
        // 到达：闪光，通知桌宠变回来
        el('circle', { cx: homeX, cy: homeY, r: 46, fill: '#fff', opacity: 0.9, class: 'fx-pop' }, layer);
        setTimeout(() => layer.remove(), 500);
        window.pet.swordDone();
        return;
      }
      const w = Math.min(dt * 6, 1);
      vx += (dx / dist * SPEED - vx) * w;
      vy += (dy / dist * SPEED - vy) * w;
      const sp = Math.hypot(vx, vy);
      vx = vx / sp * SPEED; vy = vy / sp * SPEED;
      x += vx * dt; y += vy * dt;
    }

    pts.push([x, y]);
    if (pts.length > 12) pts.shift();
    trail.setAttribute('d', 'M' + pts.map((p) => p.join(',')).join(' L'));
    // 剑尖朝运动方向
    const ang = Math.atan2(vy, vx) * 180 / Math.PI + 90;
    sword.setAttribute('transform', `translate(${x},${y}) rotate(${ang})`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.pet.onSword(({ x, y }) => flySword(x, y));

// ---------- 兜风 ----------
// 保时捷敞篷（真车侧面图）载着坐在驾驶座的大头，在屏幕底部来回巡游，最后回到出发点
function makeCar() {
  const g = el('g', {});
  const CAR_W = 440, CAR_H = CAR_W * 974 / 2054;
  const HEAD_W = 110, HEAD_H = HEAD_W * 195 / 235;
  // 完整车身（最底层），车头朝左；组原点在车轮着地点
  el('image', { href: '../assets/car.png', x: -CAR_W / 2, y: -CAR_H, width: CAR_W, height: CAR_H }, g);
  // 大头：坐在座舱里，下半截伸到车门下沿之下
  el('image', { href: '../assets/head.png', x: 24, y: -205, width: HEAD_W, height: HEAD_H }, g);
  // 车门遮罩条：同一张车图裁出车门区域压在大头底部，形成坐在车里的半遮掩效果
  const cp = el('clipPath', { id: 'sillClip' }, g);
  el('rect', { x: -36, y: -150, width: 176, height: 64 }, cp);
  el('image', { href: '../assets/car.png', x: -CAR_W / 2, y: -CAR_H, width: CAR_W, height: CAR_H, 'clip-path': 'url(#sillClip)' }, g);
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
  const t0 = performance.now();
  let last = t0;
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

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const ms = now - t0;

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
      if (laps >= 4 || ms > 9000) sub = 'pickup';
    } else if (sub === 'pickup') {
      // 开回出发点接她
      const dist = homeX - x;
      dir = dist >= 0 ? 1 : -1;
      v = Math.min(Math.max(Math.abs(dist) * 4, 140, 800), 800);
      if (Math.abs(dist) < 30) {
        sub = 'exit';
        window.pet.driveDone();
      } else {
        x += dir * v * dt;
      }
    } else if (sub === 'exit') {
      // 放下她之后加速离场
      v = Math.min(v + 2200 * dt, 1500);
      x += dir * v * dt;
      if (x < -520 || x > innerWidth + 520) { layer.remove(); return; }
    }

    // 悬挂颠簸 + 翻转朝向（车头方向 = 前进方向，原图朝左）
    const bob = sub === 'pickup' && v < 300 ? 0 : 2.5 * Math.sin(now / 55);
    car.setAttribute('transform', `translate(${x},${roadY + bob}) scale(${-dir},1)`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.pet.onDrive(({ x }) => driveCar(x));
