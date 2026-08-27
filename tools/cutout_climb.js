// 攀爬序列帧抠图：近白底(250±) → 透明底，保留原画布对齐（不裁边），缩到 512x768
// 用法: node tools/cutout_climb.js <srcDir> <outDir>
// 帧与帧之间靠同一画布天然对齐，所以不能在每张里各自裁边
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) { console.error('usage: node tools/cutout_climb.js <srcDir> <outDir>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const V_BG = 236, SPREAD_BG = 18; // 与 tools/cutout.js 同款白底判定

function processOne(src, out) {
  const png = PNG.sync.read(fs.readFileSync(src));
  const { width: W, height: H, data } = png;
  const N = W * H;
  const alpha = new Uint8Array(N).fill(255);
  const isBg = (i) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    return r > V_BG && g > V_BG && b > V_BG && Math.max(r, g, b) - Math.min(r, g, b) < SPREAD_BG;
  };

  // 边缘洪水填充：只清与边缘相连的白底（保住白裙/白丝等内部白色）
  const seen = new Uint8Array(N);
  const q = [];
  const seed = (x, y) => {
    const i = y * W + x;
    if (!seen[i] && isBg(i)) { seen[i] = 1; q.push(i); }
  };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (q.length) {
    const i = q.pop();
    alpha[i] = 0;
    const x = i % W, y = (i / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!seen[ni] && isBg(ni)) { seen[ni] = 1; q.push(ni); }
    }
  }

  // 边缘柔化：挨着透明的不透明像素按比例降 alpha
  const a0 = alpha.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!a0[i]) continue;
      let t = 0;
      if (!a0[i - 1]) t++;
      if (!a0[i + 1]) t++;
      if (!a0[i - W]) t++;
      if (!a0[i + W]) t++;
      if (t > 0) alpha[i] = Math.round(255 * (4 - t) / 4);
    }
  }

  // 2x2 盒式降采样到 512x768（同一变换作用于全部帧，对齐天然保持）
  const OW = W >> 1, OH = H >> 1;
  const outPng = new PNG({ width: OW, height: OH });
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const di = (y * OW + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const si = ((y * 2 + sy) * W + (x * 2 + sx)) * 4;
        r += data[si]; g += data[si + 1]; b += data[si + 2]; a += alpha[(y * 2 + sy) * W + (x * 2 + sx)];
      }
      outPng.data[di] = r >> 2;
      outPng.data[di + 1] = g >> 2;
      outPng.data[di + 2] = b >> 2;
      outPng.data[di + 3] = a >> 2;
    }
  }
  fs.writeFileSync(out, PNG.sync.write(outPng));
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort();
for (const f of files) {
  const m = f.match(/f(\d+)\.png$/);
  if (!m) continue;
  const out = path.join(outDir, `f${m[1]}.png`);
  processOne(path.join(srcDir, f), out);
  console.log('done', f, '->', out);
}
