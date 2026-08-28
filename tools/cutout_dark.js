// 黑底图抠图：边缘洪水填充去近黑底 → 自动裁边
// 用法: node tools/cutout_dark.js <src.png> <out.png>
const fs = require('fs');
const { PNG } = require('pngjs');

const SRC = process.argv[2];
const OUT = process.argv[3];

// 判定「接近黑底」：整体暗且 RGB 接近（保住深蓝蝴蝶结等有色暗部）
function isBg(r, g, b) {
  return r < 48 && g < 48 && b < 48 && Math.max(r, g, b) - Math.min(r, g, b) < 26;
}

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = png;

const visited = new Uint8Array(W * H);
const queue = [];
function seed(x, y) {
  const i = y * W + x;
  if (visited[i]) return;
  const p = i * 4;
  if (isBg(data[p], data[p + 1], data[p + 2])) { visited[i] = 1; queue.push(i); }
}
for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
while (queue.length) {
  const i = queue.pop();
  const x = i % W, y = (i / W) | 0;
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const ni = ny * W + nx;
    if (visited[ni]) continue;
    const p = ni * 4;
    if (isBg(data[p], data[p + 1], data[p + 2])) { visited[ni] = 1; queue.push(ni); }
  }
}
for (let i = 0; i < W * H; i++) if (visited[i]) data[i * 4 + 3] = 0;

// 自动裁边
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const out = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((minY + y) * W + (minX + x)) * 4;
    const di = (y * cw + x) * 4;
    data.copy(out.data, di, si, si + 4);
  }
}
fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(`cutout done: ${cw}x${ch} -> ${OUT}`);
