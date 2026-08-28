// 爬墙视频帧 → 循环动画素材
// 用法: node tools/video_climb_frames.js <srcDir> <outDir>
// 流程：从运动曲线中识别停顿段（去掉开头和结尾的停顿），为动作段的首尾帧选择最相似的一对（用于循环衔接），
// 再裁剪掉右侧飞鸟区域，采用区域生长法去除灰色墙面（bg 均值为 220，局部差值较小时扩展），
// 使用连通块去除噪点，进行边缘柔化和 2x 降采样，并将输出帧重新编号为 f01..fNN。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: node tools/video_climb_frames.js <srcDir> <outDir>'); process.exit(1); }

// 实测参数：墙面 lum 218-222 均匀、她亮部 230-250、飞鸟在 x>=1130
const CROP = { x: 660, y: 0, w: 450, h: 1080 }; // 裁掉右侧飞鸟和她的右侧空墙
const STILL_T = 2.0;      // 相邻帧均差低于此值 = 停顿
const KEEP_START = 5;     // 从运动曲线看 f001-f004 是开场停顿，动作从 f005 起
const OPTS = { from: 0, to: 0, step: 2, seq: '' };
for (let i = 4; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--from') OPTS.from = +process.argv[++i];
  else if (process.argv[i] === '--to') OPTS.to = +process.argv[++i];
  else if (process.argv[i] === '--step') OPTS.step = +process.argv[++i];
  else if (process.argv[i] === '--seq') OPTS.seq = process.argv[++i];
}
const LUM_LO = 200, LUM_HI = 232, SPREAD_BG = 22, DIFF_A = 10;
const DOWNSCALE = 2;      // 1080p → 540p

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort();
const read = (f) => PNG.sync.read(fs.readFileSync(path.join(srcDir, f)));

// ---------- 配对首尾（在 KEEP_START 后的动作段里找最相似的一对，距离尽量长） ----------
function frameDiff(a, b) {
  let s = 0, n = 0;
  for (let y = CROP.y; y < CROP.y + CROP.h; y += 8) {
    for (let x = CROP.x; x < CROP.x + CROP.w; x += 8) {
      const i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
      s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return s / n;
}
const N0 = KEEP_START, N1 = files.length; // 动作段 [N0, N1]
let best = { s: N0, e: N1, d: Infinity };
const heads = [], tails = [];
for (let i = N0; i <= Math.min(N0 + 14, N1); i++) heads.push(i);
for (let i = Math.max(N0 + 40, N1 - 20); i <= N1; i++) tails.push(i);
const cache = {};
for (const s of heads) {
  for (const e of tails) {
    const d = frameDiff(cache[s] || (cache[s] = read(files[s - 1])), cache[e] || (cache[e] = read(files[e - 1])));
    if (d < best.d) best = { s, e, d };
  }
}
console.log(`loop pair: f${String(best.s).padStart(3, '0')} ~ f${String(best.e).padStart(3, '0')} diff=${best.d.toFixed(2)}`);
const s0 = OPTS.from || best.s, e0 = OPTS.to || best.e;
let seq = [];
if (OPTS.seq) seq = OPTS.seq.split(',').map(Number);
else for (let i = s0; i <= e0; i += OPTS.step) seq.push(i);
console.log('selected frames:', seq.length);

// ---------- 抠图 ----------
function cutout(png) {
  const { width: W, height: H, data } = png;
  const cw = CROP.w, ch = CROP.h;
  const N = cw * ch;
  const alpha = new Uint8Array(N).fill(255);
  const lum = new Float32Array(N);
  const spread = new Uint8Array(N);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((CROP.y + y) * W + (CROP.x + x)) * 4;
      const r = data[si], g = data[si + 1], b = data[si + 2];
      const i = y * cw + x;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      spread[i] = Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  const isBg = (i) => lum[i] >= LUM_LO && lum[i] <= LUM_HI && spread[i] <= SPREAD_BG;
  // 区域生长：从边缘出发，亮度局部差 ≤DIFF_A 才扩张（防从她亮部边缘漏进去）
  const seen = new Uint8Array(N);
  const q = [];
  const seed = (x, y) => {
    const i = y * cw + x;
    if (!seen[i] && isBg(i)) { seen[i] = 1; q.push(i); }
  };
  for (let x = 0; x < cw; x++) { seed(x, 0); seed(x, ch - 1); }
  for (let y = 0; y < ch; y++) { seed(0, y); seed(cw - 1, y); }
  while (q.length) {
    const i = q.pop();
    alpha[i] = 0;
    const x = i % cw, y = (i / cw) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const ni = ny * cw + nx;
      if (!seen[ni] && isBg(ni) && Math.abs(lum[ni] - lum[i]) <= DIFF_A) { seen[ni] = 1; q.push(ni); }
    }
  }
  // 连通块去杂：保留最大连通块（人物），丢弃小团（墙面残影/鸟毛）
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  let cur = 0;
  for (let i = 0; i < N; i++) {
    if (!alpha[i] || label[i] >= 0) continue;
    let sz = 0;
    const q2 = [i];
    label[i] = cur;
    while (q2.length) {
      const j = q2.pop();
      sz++;
      const x = j % cw, y = (j / cw) | 0;
      for (const nb of [j - 1, j + 1, j - cw, j + cw]) {
        if (nb < 0 || nb >= N || label[nb] >= 0 || !alpha[nb]) continue;
        const nx = nb % cw;
        if (Math.abs(nx - x) > 1) continue;
        label[nb] = cur;
        q2.push(nb);
      }
    }
    sizes.push(sz);
    cur++;
  }
  const maxSz = Math.max(...sizes);
  for (let i = 0; i < N; i++) {
    if (alpha[i] && sizes[label[i]] < maxSz * 0.02) alpha[i] = 0;
  }
  // her-ish 参考图（肤色/白裙阴影这类中性灰也是「她」，绝不能用颜色规则误吃，只用于竖条接触边）
  const bMinusR = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const si = ((CROP.y + ((i / cw) | 0)) * W + (CROP.x + (i % cw))) * 4;
    bMinusR[i] = data[si + 2] - data[si];
  }
  const herish = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!alpha[i]) continue;
    if (lum[i] < 110 || lum[i] > 238 || spread[i] > 26 || bMinusR[i] > 6) herish[i] = 1;
  }
  // 墙边竖条清除：全高贯通（>80%）的不透明列只可能是墙面接缝/墙边条，她的身形占不满全高。
  // 条内中性灰像素吃透，herish 4px 邻域留一丝（抓手贴条的发丝/手指接触线不断）
  {
    const colOpaque = new Uint16Array(cw);
    for (let x = 0; x < cw; x++) {
      for (let y = 0; y < ch; y++) if (alpha[y * cw + x]) colOpaque[x]++;
    }
    for (let x = 0; x < cw; x++) {
      if (colOpaque[x] < ch * 0.8) continue;
      for (let y = 0; y < ch; y++) {
        const i = y * cw + x;
        if (!alpha[i]) continue;
        if (lum[i] < 130 || lum[i] > 238 || spread[i] > 24 || bMinusR[i] > 8) continue;
        let nearHer = false;
        outer: for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
            if (herish[yy * cw + xx]) { nearHer = true; break outer; }
          }
        }
        if (!nearHer) alpha[i] = 0;
      }
    }
  }
  // 边缘柔化
  const a0 = alpha.slice();
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      if (!a0[i]) continue;
      let t = 0;
      if (!a0[i - 1]) t++;
      if (!a0[i + 1]) t++;
      if (!a0[i - cw]) t++;
      if (!a0[i + cw]) t++;
      if (t > 0) alpha[i] = Math.round(255 * (4 - t) / 4);
    }
  }
  // 2x 盒式降采样
  const ow = (cw / DOWNSCALE) | 0, oh = (ch / DOWNSCALE) | 0;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const xx = x * 2 + sx, yy = y * 2 + sy;
        const si = ((CROP.y + yy) * W + (CROP.x + xx)) * 4;
        r += data[si]; g += data[si + 1]; b += data[si + 2];
        a += alpha[yy * cw + xx];
      }
      const di = (y * ow + x) * 4;
      out.data[di] = r >> 2;
      out.data[di + 1] = g >> 2;
      out.data[di + 2] = b >> 2;
      out.data[di + 3] = a >> 2;
    }
  }
  return out;
}

fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const idx of seq) {
  n++;
  const out = cutout(read(files[idx - 1]));
  const name = `f${String(n).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
  console.log('wrote', name, '<= frame', idx);
}

// ---------- 步态速度表：kept 帧之间的运动量 → 归一化（均值=1） → 换腿相削底为 0 ----------
// 渲染层按 v[i]*SPEED*dt 上移：撑蹬相快、换腿相停，锚点（抓手/蹬脚）在屏幕上不漂
{
  const vd = [];
  for (let i = 0; i < seq.length; i++) {
    const a = read(files[seq[i] - 1]);
    const b = read(files[(seq[(i + 1) % seq.length]) - 1]);
    vd.push(frameDiff(a, b));
  }
  const mean = vd.reduce((s, x) => s + x, 0) / vd.length;
  const vel = vd.map((v) => {
    const vn = v / mean;
    return +Math.max(0, (vn - 0.45) / 0.55).toFixed(2); // <0.45 均值 → 0（换腿相停住）
  });
  console.log('raw motion:', vd.map((v) => +v.toFixed(1)).join(','));
  console.log('CLIMB_VEL = [' + vel.join(', ') + ']');
}
console.log(`done: ${n} frames -> ${outDir}`);
