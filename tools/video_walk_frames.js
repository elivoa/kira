// 走路视频（浅色影棚背景版）→ 循环动画素材
// 用法: node tools/video_walk_frames.js <srcDir> <outDir> --seq 40,42,...
// 抠图算法（v3）：幕布是均匀中性白（251~253，spread≤2），按像素与背景色的
// 距离 d=252-min(r,g,b) 生成 alpha：d≤LO 透明，d≥HI 不透明，中间线性柔边。
// 四级背景判定，逐级放宽：
//   1) 严格背景：边缘出发 d≤LO 连通；
//   2) 平滑洪水：从严格背景沿「相邻像素 d 差≤3」的地形蔓延（d≤HI）——幕布阴影渐变
//      是平滑的，衣料轮廓是画出来的硬边（d 一步跳 15+），故鞋下灰影、发周雾环被吞
//      而白袜白裙不被漏进去；鞋区（crop y≥1380）另开中性影洪水（sp<12、d≤52），
//      穿过影体灌进被影体围住的地板缝；
//   3) 封闭浅色区（d≤HI 且未被洪水到达）：≥70% 像素 d≤3 判幕布口袋（不限大小），否则
//      判衣料内部 → 强制不透明；衣料内部 d≤3 且 sp≤3 的 ≥40px 色斑（发隙小封闭白斑）
//      再挖掉，衣料高光斑零散细小不受影响；
//   4) 柔边只留紧贴实色 2px 内的渐变，其余 keyed 雾一律清零；鞋区非实色一律透明
//      （鞋底浅紫灰包边 d≈72 是实色，不受影响）。
//   5) 暖色救援（v4）：肤色暖（r>g>b，r−b 通常 >10），幕布/地影中性（r−b≈0）。
//      r−b≥10 且 min≥200 的亮暖像素（淡肤色手/指衬白幕时会落进 keyed 区被吃）
//      不参与洪水、不判背景、强制不透明；白裙白袜冷调（b≥r）、地影中性不受影响。
// 地影仍用分段保险带清除；当前素材取走路段 4~96 全 93 帧，尾部闭环用 tools/walk_tail_blend.js 融合。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: node tools/video_walk_frames.js <srcDir> <outDir> --seq a,b,c'); process.exit(1); }
let seq = [];
for (let i = 4; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--seq') seq = process.argv[++i].split(',').map(Number);
}
if (!seq.length) { console.error('need --seq'); process.exit(1); }

// 统一裁切框（不做逐帧 trim）：并集 bbox x[224,1150] y[40,1686] 外扩，脚底 y≈1665 贴底
const CROP = { x: 190, y: 24, w: 986, h: 1672 };
const DOWNSCALE = 2;
// 背景距离双阈值：幕布 d≤2，前景主体 d≥10，谷底 3~9
const LO = 3, HI = 14;
// 幕布口袋判定：封闭区内 ≥70% 像素 d≤3（小口袋不限大小）；大而平（≥55% d≤2.5）兜底
const POCKET_MIN = 150, POCKET_FLAT = 0.55, POCKET_NEAR_BG = 0.7;
// 平滑洪水步长与鞋区严格带起点（crop 坐标）
const FLOOD_STEP = 3, FOOT_ZONE_Y = 1380;
// 暖色救援阈值：r−b≥WARM_RB 且 min(r,g,b)≥WARM_MIN 判亮暖肤色，不做背景
const WARM_RB = 10, WARM_MIN = 200;

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
  // 每像素背景距离与 keyed alpha；sp 为色彩离散度（幕布/阴影中性 sp≤3，衣料白色带蓝灰 sp 更大）
  const dv = new Int16Array(N);
  const sp = new Uint8Array(N);
  const warm = new Uint8Array(N);
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const si = ((CROP.y + ((i / cw) | 0)) * W + (CROP.x + (i % cw))) * 4;
    const r = data[si], g = data[si + 1], b = data[si + 2];
    const mn = Math.min(r, g, b);
    const d = 252 - mn;
    dv[i] = d;
    sp[i] = Math.max(r, g, b) - mn;
    if (r - b >= WARM_RB && r >= g && mn >= WARM_MIN) warm[i] = 1;
    alpha[i] = d <= LO ? 0 : d >= HI ? 255 : Math.round(255 * (d - LO) / (HI - LO));
  }
  // 第1级 严格背景：从裁切边缘经 d≤LO 可达
  const bg = new Uint8Array(N);
  {
    const q = [];
    const seed = (x, y) => {
      const i = y * cw + x;
      if (!bg[i] && dv[i] <= LO) { bg[i] = 1; q.push(i); }
    };
    for (let x = 0; x < cw; x++) { seed(x, 0); seed(x, ch - 1); }
    for (let y = 0; y < ch; y++) { seed(0, y); seed(cw - 1, y); }
    while (q.length) {
      const i = q.pop();
      const x = i % cw, y = (i / cw) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (!bg[ni] && dv[ni] <= LO) { bg[ni] = 1; q.push(ni); }
      }
    }
  }
  // 第2级 平滑洪水：沿 d 差≤FLOOD_STEP 的平滑地形蔓延（吞阴影渐变/雾环，硬轮廓挡下）
  {
    const q = [];
    for (let i = 0; i < N; i++) if (bg[i]) q.push(i);
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const x = i % cw, y = (i / cw) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (bg[ni] || dv[ni] > HI || warm[ni]) continue;
        if (Math.abs(dv[ni] - dv[i]) > FLOOD_STEP) continue;
        bg[ni] = 1;
        q.push(ni);
      }
    }
  }
  // 第2b级 鞋区中性影洪水（只限 crop y≥FOOT_ZONE_Y）：地影/地板缝是中性灰（sp<12）且平滑，
  // 放宽 d 上限到 52 让洪水穿过影体，灌进被影体围住的地板缝；浅紫裙边 sp≈25、
  // 鞋底包边 d≈62+、白袜被硬轮廓挡住，都不受影响
  {
    const q = [];
    for (let i = 0; i < N; i++) {
      if (bg[i] && ((i / cw) | 0) >= FOOT_ZONE_Y) q.push(i);
    }
    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const x = i % cw, y = (i / cw) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || ny < FOOT_ZONE_Y) continue;
        const ni = ny * cw + nx;
        if (bg[ni] || dv[ni] > 52 || sp[ni] >= 12 || warm[ni]) continue;
        if (Math.abs(dv[ni] - dv[i]) > FLOOD_STEP) continue;
        bg[ni] = 1;
        q.push(ni);
      }
    }
  }
  // 第3级 封闭浅色区（d≤HI 且未被洪水到达）：近平白判幕布口袋（保留 keyed），否则判衣料（不透明）
  const opaque = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (dv[i] > HI) opaque[i] = 1;
  {
    const label = new Int32Array(N).fill(-1);
    const nearBgCnt = [], flatCnt = [], sizes = [];
    for (let i = 0; i < N; i++) {
      if (label[i] >= 0 || bg[i] || dv[i] > HI) continue;
      const id = sizes.length;
      let sz = 0, flat = 0, nearBg = 0;
      const q = [i];
      label[i] = id;
      while (q.length) {
        const j = q.pop();
        sz++;
        if (dv[j] <= 2.5) flat++;
        if (dv[j] <= 3) nearBg++;
        const x = j % cw, y = (j / cw) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const ni = ny * cw + nx;
          if (label[ni] < 0 && !bg[ni] && dv[ni] <= HI) { label[ni] = id; q.push(ni); }
        }
      }
      sizes.push(sz); flatCnt.push(flat); nearBgCnt.push(nearBg);
    }
    for (let i = 0; i < N; i++) {
      const id = label[i];
      if (id < 0) continue;
      const isPocket = nearBgCnt[id] / sizes[id] >= POCKET_NEAR_BG
        || (sizes[id] >= POCKET_MIN && flatCnt[id] / sizes[id] >= POCKET_FLAT);
      if (!isPocket) { alpha[i] = 255; opaque[i] = 1; } // 白衣/白发/白袜内部
    }
  }
  // 暖色救援：亮暖肤色（淡手/指）强制不透明，不被洪水/口袋/keyed 雾吃掉
  for (let i = 0; i < N; i++) {
    if (warm[i]) { alpha[i] = 255; opaque[i] = 1; }
  }
  // 第3b级 衣料内部的纯幕布色斑：d≤3 且 sp≤3（高度接近幕布色）的连通块 ≥40px 一律挖掉
  // （发隙/卷发间的小封闭白斑；衣料高光斑零散且 <40px，保留）
  {
    const label = new Int32Array(N).fill(-1);
    const sizes = [];
    const bgLike = (i) => !bg[i] && dv[i] <= 3 && sp[i] <= 3;
    for (let i = 0; i < N; i++) {
      if (label[i] >= 0 || !bgLike(i)) continue;
      const id = sizes.length;
      let sz = 0;
      const q = [i];
      label[i] = id;
      while (q.length) {
        const j = q.pop();
        sz++;
        const x = j % cw, y = (j / cw) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const ni = ny * cw + nx;
          if (label[ni] < 0 && bgLike(ni)) { label[ni] = id; q.push(ni); }
        }
      }
      sizes.push(sz);
    }
    for (let i = 0; i < N; i++) {
      const id = label[i];
      if (id < 0 || sizes[id] < 40) continue;
      alpha[i] = dv[i] <= LO ? 0 : Math.round(255 * (dv[i] - LO) / (HI - LO));
      opaque[i] = 0;
    }
  }
  // 第4级 柔边约束：keyed 雾只留紧贴实色 2px 内的；鞋区（crop y≥FOOT_ZONE_Y）非实色一律透明
  {
    const near = opaque.slice();
    for (let pass = 0; pass < 2; pass++) {
      const cur = near.slice();
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const i = y * cw + x;
          if (cur[i]) continue;
          let t = false;
          for (let dy = -1; dy <= 1 && !t; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
              if (cur[ny * cw + nx]) { t = true; break; }
            }
          }
          if (t) near[i] = 1;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (opaque[i]) continue;
      if (!near[i] || ((i / cw) | 0) >= FOOT_ZONE_Y) alpha[i] = 0;
    }
  }
  // 地影保险带（分两段）：源 y≈1665 是人物最低点（鞋底），1560~1648 段清浅灰中性影
  // （保住鞋底平台的浅紫灰边 min≈180~190），1648 以下只剩地影，凡浅色一律清
  for (let y = 1560; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (!alpha[i] || warm[i]) continue;
      const si = ((CROP.y + y) * W + (CROP.x + x)) * 4;
      const r = data[si], g = data[si + 1], b = data[si + 2];
      const mn = Math.min(r, g, b);
      if (y > 1648 ? mn > 150 : (mn > 200 && Math.max(r, g, b) - mn < 22)) alpha[i] = 0;
    }
  }
  // 连通块去杂：保留最大（人物），丢小团（残影碎点、噪声鬼点等）
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
  // 边缘柔化：只降不升（keyed 柔边保持原样，保险带造成的硬边变柔）
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
      if (t > 0) alpha[i] = Math.min(alpha[i], Math.round(255 * (4 - t) / 4));
    }
  }
  // 2x 盒式降采样（RGB 按 alpha 加权，避免半透明边带白边）
  const ow = (cw / DOWNSCALE) | 0, oh = (ch / DOWNSCALE) | 0;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const xx = x * 2 + sx, yy = y * 2 + sy;
        const si = ((CROP.y + yy) * W + (CROP.x + xx)) * 4;
        const av = alpha[yy * cw + xx];
        a += av;
        r += data[si] * av; g += data[si + 1] * av; b += data[si + 2] * av;
        wsum += av;
      }
      const di = (y * ow + x) * 4;
      if (wsum) {
        out.data[di] = Math.round(r / wsum);
        out.data[di + 1] = Math.round(g / wsum);
        out.data[di + 2] = Math.round(b / wsum);
      } else {
        const si = ((CROP.y + y * 2) * W + (CROP.x + x * 2)) * 4;
        out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2];
      }
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

// 步态速度表（kept 帧间运动量 → 均值归一 → 换腿相削底；末项卷回首帧验证闭环）
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
  console.log('raw motion:', vd.map((v) => +v.toFixed(1)).join(','), '(last = wrap to first)');
  console.log('WALK_VEL = [' + vel.join(', ') + ']');
}
console.log(`done: ${n} frames -> ${outDir}`);
