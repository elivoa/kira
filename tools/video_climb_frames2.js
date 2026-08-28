// 爬墙视频（绿幕版）→ 循环动画素材
// 用法: node tools/video_climb_frames2.js <srcDir> <outDir> --seq 13,15,...
// 与 v1 的差别仅在于抠绿幕：g>r+15 && g>b+15 且 g>60 判定幕布色，
// 仍走区域生长（从边缘连通，彩虹发卡等内部的绿色条纹碰不到）；
// 之后连通块去杂 → 全高竖条（幕布接缝）清除 → 边缘柔化 → 2x 降采样 → 速度表。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: node tools/video_climb_frames2.js <srcDir> <outDir> --seq a,b,c'); process.exit(1); }
let seq = [];
for (let i = 4; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--seq') seq = process.argv[++i].split(',').map(Number);
}
if (!seq.length) { console.error('need --seq'); process.exit(1); }

const CROP = { x: 100, y: 0, w: 980, h: 1764 }; // 只裁两侧多余幕布，人物全高保留
const DOWNSCALE = 2;

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort();
const read = (f) => PNG.sync.read(fs.readFileSync(path.join(srcDir, f)));

function frameDiff(a, b) {
  let s = 0, n = 0;
  const { width: W, height: H, data } = a;
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
    const i = (y * W + x) * 4, j = (y * b.width + x) * 4;
    s += Math.abs(data[i] - b.data[i]) + Math.abs(data[i + 1] - b.data[i + 1]) + Math.abs(data[i + 2] - b.data[i + 2]);
    n += 3;
  }
  return s / n;
}

function cutout(png) {
  const { width: W, height: H, data } = png;
  const cw = CROP.w, ch = CROP.h;
  const N = cw * ch;
  const alpha = new Uint8Array(N).fill(255);
  // 幕布色判定：绿主导（低饱和深绿 67,93,67 与拐角暗绿 43,59,45 都覆盖）
  const isGreen = (i) => {
    const si = ((CROP.y + ((i / cw) | 0)) * W + (CROP.x + (i % cw))) * 4;
    const r = data[si], g = data[si + 1], b = data[si + 2];
    return g > r + 16 && g > b + 8 && g > 50 && Math.abs(r - b) < 40;
  };
  // 区域生长：从裁切边缘出发吞幕布色（内部绿色小件够不到）
  const seen = new Uint8Array(N);
  const q = [];
  const seed = (x, y) => {
    const i = y * cw + x;
    if (!seen[i] && isGreen(i)) { seen[i] = 1; q.push(i); }
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
      if (!seen[ni] && isGreen(ni)) { seen[ni] = 1; q.push(ni); }
    }
  }
  // 连通块去杂：保留最大（人物），丢小团
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
  // 全高竖条（幕布接缝）清除：只吞「暗绿主导」像素（g>r 且 g>=b 且 g<165）。
  // 她的深色是蓝/中性（藏青 b>g、黑丝中性、皮肤 r>g、白裙高亮），永远不会被判成暗绿，不挨刀
  {
    const colOpaque = new Uint16Array(cw);
    for (let x = 0; x < cw; x++) {
      for (let y = 0; y < ch; y++) if (alpha[y * cw + x]) colOpaque[x]++;
    }
    for (let x = 0; x < cw; x++) {
      if (colOpaque[x] < ch * 0.6) continue;
      for (let y = 0; y < ch; y++) {
        const i = y * cw + x;
        if (!alpha[i]) continue;
        const si = ((CROP.y + y) * W + (CROP.x + x)) * 4;
        const r = data[si], g = data[si + 1], b = data[si + 2];
        if (g > r + 5 && g >= b && g < 165) alpha[i] = 0;
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
const outs = [];
for (const idx of seq) {
  n++;
  const out = cutout(read(files[idx - 1]));
  outs.push(out);
  const name = `f${String(n).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
  console.log('wrote', name, '<= frame', idx);
}
// 循环衔接交叉淡化：末帧 → 首帧 融 2 帧，消掉步态相位对齐后残余的布料跳变
const BLEND = 2;
{
  const last = outs[outs.length - 1], first = outs[0];
  for (let b = 1; b <= BLEND; b++) {
    const wFirst = b / (BLEND + 1), wLast = 1 - wFirst;
    const out = new PNG({ width: first.width, height: first.height });
    for (let i = 0; i < first.data.length; i += 4) {
      // 预乘 alpha 混合再除回，避免半透明边缘发黑
      const al = last.data[i + 3] * wLast + first.data[i + 3] * wFirst;
      if (al <= 0) { out.data[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        const v = (last.data[i + c] * last.data[i + 3] * wLast + first.data[i + c] * first.data[i + 3] * wFirst) / al;
        out.data[i + c] = Math.round(v);
      }
      out.data[i + 3] = Math.round(al);
    }
    n++;
    const name = `f${String(n).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
    console.log('wrote', name, '(blend ' + b + ')');
  }
}

// 步态速度表（kept 帧间运动量 → 均值归一 → 换腿相削底）
{
  const vd = [];
  for (let i = 0; i < seq.length; i++) {
    vd.push(frameDiff(read(files[seq[i] - 1]), read(files[seq[(i + 1) % seq.length] - 1])));
  }
  const mean = vd.reduce((s, x) => s + x, 0) / vd.length;
  const vel = vd.map((v) => {
    const vn = v / mean;
    return +Math.max(0, (vn - 0.45) / 0.55).toFixed(2);
  });
  // 淡化帧低速过渡，循环衔接点不窜
  for (let b = 0; b < BLEND; b++) vel.push(0.5);
  vel[vel.length - BLEND - 1] = 0.6;
  console.log('raw motion:', vd.map((v) => +v.toFixed(1)).join(','));
  console.log('CLIMB_VEL = [' + vel.join(', ') + ']');
}
console.log(`done: ${n} frames -> ${outDir}`);
