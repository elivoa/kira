// 走路循环相位对齐（v2：脚底间距信号定周期）。
// AI 视频的步态周期非整数（93 帧 ≈3.65 周期），首尾直接相接相位不同必跳；
// 全帧段匹配又会被外观漂移带偏，故用脚底间距（bottom band 前景 spread）的
// 极小值作周期锚点（并步相），信号干净单调。
// 构造：中间完整周期按自然长度原样连接（不复制帧——复制帧是 42ms 冻结，肉眼可察；
// 循环闭环只要求接点相位连续，不要求各周期等长）；首端（上一周期末尾）与尾端
// （新一周期开头）两个残段，用首个完整周期的同相位中段桥接成一个完整周期。
// 所有原始帧全部使用，回卷 = 视频自身的连续帧。
// 用法: node tools/walk_loop_align.js <srcDir> <start> <end>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [srcDir, S, E] = process.argv.slice(2);
const start = +S, end = +E;
if (!srcDir || !start || !end) { console.error('usage: node tools/walk_loop_align.js <srcDir> <start> <end>'); process.exit(1); }

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort();
const pngCache = new Map();
function png(idx) {
  if (!pngCache.has(idx)) pngCache.set(idx, PNG.sync.read(fs.readFileSync(path.join(srcDir, files[idx - 1]))));
  return pngCache.get(idx);
}
function gray(idx) {
  const { width: W, height: H, data } = png(idx);
  const g = new Float32Array((W >> 3) * (H >> 3));
  let k = 0;
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
    const i = (y * W + x) * 4;
    g[k++] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return g;
}
function diff(a, b) {
  const ga = gray(a), gb = gray(b);
  let s = 0;
  for (let i = 0; i < ga.length; i++) s += Math.abs(ga[i] - gb[i]);
  return s / ga.length;
}
// 脚底间距：bottom band（源 y≥1500）前景像素 maxX-minX
function spread(idx) {
  const { width: W, height: H, data } = png(idx);
  let minX = 1e9, maxX = -1;
  for (let y = 1500; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (252 - mn > 14) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  return maxX - minX;
}

// 1. 周期锚点：spread 极小值（并步相）
const sp = [];
for (let t = start; t <= end; t++) sp.push([t, spread(t)]);
const mins = [];
for (let i = 2; i < sp.length - 2; i++) {
  if (sp[i][1] <= sp[i - 1][1] && sp[i][1] <= sp[i - 2][1] && sp[i][1] < sp[i + 1][1] && sp[i][1] < sp[i + 2][1]) mins.push(sp[i][0]);
}
console.log('minima:', mins.join(','), 'periods:', mins.slice(1).map((m, i) => m - mins[i]).join(','));
if (mins.length < 3) { console.error('锚点不足，无法对齐'); process.exit(1); }

// 2. 周期划分：完整周期 [m0..m1) [m1..m2) ... + 首残段 [start..m0) + 尾残段 [lastMin..end]
const cycles = [];
for (let i = 0; i < mins.length - 1; i++) {
  const c = [];
  for (let f = mins[i]; f < mins[i + 1]; f++) c.push(f);
  cycles.push(c);
}
const head = []; // 首残段（上一周期末尾相位）
for (let f = start; f < mins[0]; f++) head.push(f);
const tail = []; // 尾残段（新一周期开头相位）
for (let f = mins[mins.length - 1]; f <= end; f++) tail.push(f);

const L = Math.max(...cycles.map((c) => c.length));
console.log('cycle lens:', cycles.map((c) => c.length).join(','), ' head', head.length, ' tail', tail.length, ' -> L =', L);

// 3. 周期保持自然长度（复制帧会造成 42ms 冻结卡顿，肉眼可察）。
// 循环闭环只要求接点相位连续，不要求各周期等长。

// 4. 首尾残段拼接成完整周期：tail（相位 0..t-1）+ 桥接 + head（相位 L-h..L-1）
// 桥接相位必须同时锁脚与胳膊（已踩坑：spread 只锁脚，AI 视频里手臂摆动与步频
// 不同步，脚相位对上时胳膊可能是反相的 → 胳膊位置错乱跳变）。
// 脚用 spread（值+沿方向贴合局部斜率），胳膊用上半身边界前缘 armSig（前摆手/书）；
// 在每条完整周期里取 offset=tail.length 的窗口，选两接点综合代价最小者。
{
  const CROPX = 190, CROPY = 24;
  const armSig = (idx) => {
    const { width: W, data } = png(idx);
    let minX = 1e9;
    for (let y = 380; y < 950; y += 2) for (let x = 0; x < 986; x += 2) {
      const si = ((CROPY + y) * W + (CROPX + x)) * 4;
      const mn = Math.min(data[si], data[si + 1], data[si + 2]);
      if (252 - mn > 14 && x < minX) minX = x;
    }
    return minX;
  };
  const spOf = (t) => sp[t - start][1];
  const headSlope = spOf(head[0]) - spOf(head[0] + 1);
  let best = null, bestCost = 1e9;
  for (let ci = 0; ci < cycles.length; ci++) {
    const m0 = mins[ci], ref = cycles[ci];
    const s = m0 + tail.length; // tail[0] 是极小值即相位 0，offset 严格确定
    if (s + 6 > m0 + ref.length - 1) continue;
    // 终点按 spread 沿连续选
    let e = s, bd = 1e9;
    for (let c = s + 6; c <= Math.min(s + 12, m0 + ref.length - 1); c++) {
      const d = Math.abs((spOf(c) - spOf(head[0])) - headSlope);
      if (d < bd) { bd = d; e = c; }
    }
    // 代价：胳膊接点差为主，spread 步进超出自然家族（|Δ|>46）惩罚
    const dam = Math.abs(armSig(s) - armSig(tail[tail.length - 1])) + Math.abs(armSig(e) - armSig(head[0]));
    const dsp1 = Math.abs(spOf(s) - spOf(tail[tail.length - 1]));
    const dsp2 = Math.abs(spOf(e) - spOf(head[0]));
    const cost = dam + Math.max(0, dsp1 - 46) * 2 + Math.max(0, dsp2 - 46) * 2;
    console.log(`  候选 周期${ci + 1} 桥 ${s}..${e}: armΔ和=${dam} spreadΔ=${dsp1}/${dsp2} cost=${cost}`);
    if (cost < bestCost) { bestCost = cost; best = [s, e]; }
  }
  const bridge = [];
  for (let f = best[0]; f <= best[1]; f++) bridge.push(f);
  console.log(`bridge: ${best[0]}..${best[1]} (${bridge.length}f, cost ${bestCost})`);
  cycles.push([...tail, ...bridge, ...head]);
}

const seq = cycles.flat();
const vd = [];
for (let i = 0; i < seq.length; i++) vd.push(+diff(seq[i], seq[(i + 1) % seq.length]).toFixed(1));
const mx = Math.max(...vd);
console.log('out frames:', seq.length, ' max step (incl wrap):', mx, ' mean:', (vd.reduce((s, v) => s + v, 0) / vd.length).toFixed(1));
console.log('worst:', vd.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([v, i]) => `${seq[i]}->${seq[(i + 1) % seq.length]}:${v}`).join('  '));
// 借相接点在输出序列中的 1 基下标（供抠图后互向柔化用）
const j1 = seq.length - cycles[cycles.length - 1].length + tail.length; // tail末 -> 桥首
const j2 = seq.length - head.length; // 桥末 -> head首
console.log('JUNCTIONS=' + j1 + ',' + j2);
console.log('SEQ=' + seq.join(','));
