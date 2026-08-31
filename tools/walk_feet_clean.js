// 走路帧脚部残影清理：抠图在鞋周留下一圈半透明中性灰雾边（白底像地影、黑底发光），
// 另有零星小噪点。规则（只动 y>700 脚部区，裙摆蕾丝上方不碰）：
//   1) 半透明（alpha 16~240）且中性灰（sp<25）且非亮白（min<210）→ 清零
//      （藏青鞋边的白底混色雾、地影雾都在此类；白袜 mn>220、金饰 sp 大、裙蕾丝亮白不受影响）
//   2) 脚部区孤立小团（<30px 且不与主体相连）→ 清零（噪点碎斑）
// 用法: node tools/walk_feet_clean.js <walkDir>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/walk_feet_clean.js <walkDir>'); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort();
const Y0 = 700;

let totalHaze = 0, totalBlob = 0;
for (const f of files) {
  const p = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  const { width: W, height: H, data } = p;
  const N = W * H;
  // 1) 中性灰雾清零
  let haze = 0;
  for (let y = Y0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = data[i + 3];
      if (a <= 16 || a >= 240) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mn = Math.min(r, g, b), sp = Math.max(r, g, b) - mn;
      if (sp < 25 && mn < 210) { data[i + 3] = 0; haze++; }
    }
  }
  // 2) 孤立小团清理：脚部区 alpha>16 的连通块，<30px 且不与跨过 Y0 上方的主体相连
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const touchMain = [];
  for (let y = Y0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (label[idx] >= 0 || data[idx * 4 + 3] <= 16) continue;
      const id = sizes.length;
      let sz = 0, touch = false;
      const q = [idx];
      label[idx] = id;
      while (q.length) {
        const j = q.pop();
        sz++;
        if ((j / W | 0) === Y0 && data[(j - W) * 4 + 3] > 16) touch = true; // 与上方主体相连
        const jx = j % W, jy = (j / W) | 0;
        for (const [nx, ny] of [[jx + 1, jy], [jx - 1, jy], [jx, jy + 1], [jx, jy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (label[ni] < 0 && data[ni * 4 + 3] > 16) { label[ni] = id; q.push(ni); }
        }
      }
      sizes.push(sz); touchMain.push(touch);
    }
  }
  let blob = 0;
  for (let y = Y0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const id = label[idx];
      if (id >= 0 && sizes[id] < 30 && !touchMain[id]) { data[idx * 4 + 3] = 0; blob++; }
    }
  }
  if (haze || blob) fs.writeFileSync(path.join(dir, f), PNG.sync.write(p));
  totalHaze += haze; totalBlob += blob;
}
console.log('灰雾清理:', totalHaze, 'px，噪点团清理:', totalBlob, 'px');
