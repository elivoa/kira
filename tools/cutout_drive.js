// 兜风素材抠图 v2：影棚纯色灰底 → 透明底，四帧对齐到同一画布
// 用法: node tools/cutout_drive.js <src> <out> [--pocket x,y,w,h ...]
// 思路：CG 影棚背景/地面/阴影都是『零纹理』平滑渐变，车身和人物有纹理。
// 局部标准差(σ) + 暗色保护 → 初始掩码 → 形态学闭运算 → 最大连通块 →
// 从边缘进行洪水填充，据此判断并保留内部孔洞（挽回被抠掉的高光银漆/玻璃）→
// 用 pocket 矩形清除尾翼支架间隙 → 羽化 → 以车轮位置为基准对齐公共画布。
const fs = require('fs');
const { PNG } = require('pngjs');

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/cutout_drive.js <src> <out> [--pocket x,y,w,h ...]'); process.exit(1); }
const POCKETS = [];
for (let i = 4; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--pocket') {
    const [x, y, w, h] = process.argv[i + 1].split(',').map(Number);
    POCKETS.push({ x, y, w, h });
    i++;
  }
}

const SIGMA_T = 3.2;   // 纹理阈值：bg σ≈0~1，车漆 σ≈5+
const V_DARK = 55;     // 暗色保护（轮胎/黑色件）
const CLOSE_R = 5;     // 闭运算半径（补纹理缝隙）
const MIN_COMP = 0.02; // 保留 ≥最大连通块 2% 的组件

const png = PNG.sync.read(fs.readFileSync(src));
const { width: W, height: H, data } = png;
const N = W * H;

// ---------- 亮度与局部标准差（积分图加速） ----------
const lum = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
}
const iw = W + 1;
const iSum = new Float64Array((H + 1) * iw);
const iSq = new Float64Array((H + 1) * iw);
for (let y = 0; y < H; y++) {
  let rs = 0, rq = 0;
  for (let x = 0; x < W; x++) {
    rs += lum[y * W + x];
    rq += lum[y * W + x] * lum[y * W + x];
    iSum[(y + 1) * iw + x + 1] = iSum[y * iw + x + 1] + rs;
    iSq[(y + 1) * iw + x + 1] = iSq[y * iw + x + 1] + rq;
  }
}
const R = 3;
function rectSum(ii, x0, y0, x1, y1) {
  return ii[y1 * iw + x1] - ii[y0 * iw + x1] - ii[y1 * iw + x0] + ii[y0 * iw + x0];
}
const mask = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
  for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
    const n = (y1 - y0) * (x1 - x0);
    const s = rectSum(iSum, x0, y0, x1, y1);
    const q = rectSum(iSq, x0, y0, x1, y1);
    const mean = s / n;
    const variance = Math.max(0, q / n - mean * mean);
    const i = y * W + x;
    if (Math.sqrt(variance) >= SIGMA_T || lum[i] < V_DARK) mask[i] = 1;
  }
}

// ---------- 闭运算（可分离盒式膨胀→腐蚀） ----------
function dilate1(dst, src, w, h) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -CLOSE_R; k <= CLOSE_R; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && src[y * w + xx]) { m = 1; break; }
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -CLOSE_R; k <= CLOSE_R; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) { m = 1; break; }
      }
      dst[y * w + x] = m;
    }
  }
}
{
  const d = new Uint8Array(N);
  dilate1(d, mask, W, H);
  // 腐蚀 = 对反图膨胀再取反
  const inv = new Uint8Array(N);
  for (let i = 0; i < N; i++) inv[i] = d[i] ? 0 : 1;
  const e = new Uint8Array(N);
  dilate1(e, inv, W, H);
  for (let i = 0; i < N; i++) mask[i] = e[i] ? 0 : 1;
}

// ---------- 连通块：保留最大 + ≥2% 的组件 ----------
const label = new Int32Array(N).fill(-1);
const sizes = [];
{
  let cur = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let sz = 0;
    const q = [i];
    label[i] = cur;
    while (q.length) {
      const j = q.pop();
      sz++;
      const x = j % W, y = (j / W) | 0;
      for (const nb of [j - 1, j + 1, j - W, j + W]) {
        if (nb < 0 || nb >= N || label[nb] >= 0 || !mask[nb]) continue;
        const nx = nb % W;
        if (Math.abs(nx - x) > 1) continue; // 防跨行
        label[nb] = cur;
        q.push(nb);
      }
    }
    sizes.push(sz);
    cur++;
  }
  const maxSz = Math.max(...sizes);
  for (let i = 0; i < N; i++) {
    if (mask[i] && sizes[label[i]] < maxSz * MIN_COMP) mask[i] = 0;
  }
}

// ---------- 内部孔洞填充：从图像边缘对「非掩码」区域做洪水填充，未到达的区域均为内部 ----------
{
  const out2 = new Uint8Array(N); // 标记可从边缘到达的非掩码像素
  const q = [];
  for (let x = 0; x < W; x++) { if (!mask[x]) { out2[x] = 1; q.push(x); } if (!mask[(H - 1) * W + x]) { out2[(H - 1) * W + x] = 1; q.push((H - 1) * W + x); } }
  for (let y = 0; y < H; y++) { if (!mask[y * W]) { out2[y * W] = 1; q.push(y * W); } if (!mask[y * W + W - 1]) { out2[y * W + W - 1] = 1; q.push(y * W + W - 1); } }
  while (q.length) {
    const i = q.pop();
    const x = i % W, y = (i / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!mask[ni] && !out2[ni]) { out2[ni] = 1; q.push(ni); }
    }
  }
  for (let i = 0; i < N; i++) if (!mask[i] && !out2[i]) mask[i] = 1; // 孔洞 → 车
}

// ---------- 地板带清除：孔洞填充会把车底→底边之间的地板/阴影误判为内部 ----------
// 以车轮暗团底部为地线，地线附近的灰色带（地板、阴影、反光）整体透明
{
  let groundY = 0;
  for (let y = (H * 0.5) | 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i] && lum[i] < V_DARK && y > groundY) groundY = y;
    }
  }
  if (!groundY) groundY = H - 40;
  for (let y = Math.max(0, groundY - 30); y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || lum[i] < 58) continue; // 保住轮胎/深色件
      const rr = data[i * 4], gg = data[i * 4 + 1], bb = data[i * 4 + 2];
      const spread = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
      if (spread < 23) mask[i] = 0;
    }
  }
}

// ---------- pocket 矩形：明亮低饱和残留（尾翼支架间隙） → 透明 ----------
for (const r of POCKETS) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      const rr = data[i * 4], gg = data[i * 4 + 1], bb = data[i * 4 + 2];
      const spread = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
      if (Math.min(rr, gg, bb) > 150 && spread < 20) mask[i] = 0;
    }
  }
}

// ---------- alpha：掩码 + 3x3 盒式羽化 ----------
const a1 = new Float32Array(N);
for (let i = 0; i < N; i++) a1[i] = mask[i] ? 255 : 0;
const alpha = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += a1[yy * W + xx]; n++;
      }
    }
    alpha[y * W + x] = Math.round(s / n);
  }
}

// ---------- 内容裁切 + 卡钳锚定公共画布（含轴距归一化） ----------
// 四帧车身缩放不一（轴距差最多 12%），以黄色卡钳质心定位，按参考轴距缩放到一致，
// 前卡钳质心锚定到画布 (CANVAS_AX, CANVAS_AY)，轮底自然落在地线 CANVAS_GY 附近
let cx0 = W, cy0 = H, cx1 = 0, cy1 = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha[y * W + x] > 12) {
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
    }
  }
}
const M = 10;
cx0 = Math.max(0, cx0 - M); cy0 = Math.max(0, cy0 - M);
cx1 = Math.min(W - 1, cx1 + M); cy1 = Math.min(H - 1, cy1 + M);
const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;

// 黄色卡钳团簇（r>150 g>125 b<100，下半图，≥200px）：x 小的是前轮
const yellow = [];
for (let y = (H * 0.5) | 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (alpha[i] > 12 && data[i * 4] > 150 && data[i * 4 + 1] > 125 && data[i * 4 + 2] < 100) {
      yellow.push([x, y]);
    }
  }
}
yellow.sort((a, b) => a[0] - b[0]);
const clusters = [];
for (const p of yellow) {
  const c = clusters[clusters.length - 1];
  if (c && p[0] - c.maxX < 100) { c.pts.push(p); c.maxX = p[0]; }
  else clusters.push({ pts: [p], maxX: p[0] });
}
const cal = clusters.filter((c) => c.pts.length >= 200).map((c) => ({
  cx: c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length,
  cy: c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length,
})).sort((a, b) => a.cx - b.cx);

const REF_WB = 727; // pose1 的两卡钳质心距，作为统一轴距
const CANVAS_W = 1560, CANVAS_H = 900, CANVAS_AX = 398, CANVAS_AY = 729;
const outPng = new PNG({ width: CANVAS_W, height: CANVAS_H });
outPng.data.fill(0);
if (cal.length >= 2) {
  const wb = cal[1].cx - cal[0].cx;
  const s = REF_WB / wb;
  const fcx = cal[0].cx, fcy = cal[0].cy;
  // 双线性重采样：画布像素 → 源图坐标
  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) {
      const sx = fcx + (x - CANVAS_AX) / s + 0;
      const sy = fcy + (y - CANVAS_AY) / s + 0;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < cx0 || y0 < cy0 || x0 >= cx1 || y0 >= cy1) continue;
      const fx = sx - x0, fy = sy - y0;
      const di = (y * CANVAS_W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = c === 3 ? alpha[y0 * W + x0] : data[(y0 * W + x0) * 4 + c];
        const p01 = c === 3 ? alpha[y0 * W + x0 + 1] : data[(y0 * W + x0 + 1) * 4 + c];
        const p10 = c === 3 ? alpha[(y0 + 1) * W + x0] : data[((y0 + 1) * W + x0) * 4 + c];
        const p11 = c === 3 ? alpha[(y0 + 1) * W + x0 + 1] : data[((y0 + 1) * W + x0 + 1) * 4 + c];
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        outPng.data[di + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  fs.writeFileSync(out, PNG.sync.write(outPng));
  console.log(`cutout: ${out} content=${cw}x${ch} wb=${wb.toFixed(0)} s=${s.toFixed(3)} caliper=(${fcx.toFixed(0)},${fcy.toFixed(0)})`);
} else {
  // 没找到卡钳：按内容框简单平移对齐（兜底，帧间可能有缩放差）
  const offX = CANVAS_AX - (cx0 + cw * 0.18) ;
  const offY = CANVAS_AY + 40 - ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const dy = y + offY, dx = x + offX;
      if (dx < 0 || dy < 0 || dx >= CANVAS_W || dy >= CANVAS_H) continue;
      const si = ((cy0 + y) * W + (cx0 + x)) * 4;
      const di = (dy * CANVAS_W + dx) * 4;
      outPng.data[di] = data[si];
      outPng.data[di + 1] = data[si + 1];
      outPng.data[di + 2] = data[si + 2];
      outPng.data[di + 3] = alpha[(cy0 + y) * W + (cx0 + x)];
    }
  }
  fs.writeFileSync(out, PNG.sync.write(outPng));
  console.log(`cutout: ${out} content=${cw}x${ch} fallback(no caliper)`);
}
