// 矩形区域内清浅色像素（清脚下阴影用，深色脚不受影响）
const fs = require('fs');
const { PNG } = require('pngjs');
const FILE = process.argv[2];
const [x0, y0, x1, y1] = process.argv.slice(3, 7).map(Number);
const png = PNG.sync.read(fs.readFileSync(FILE));
const { width: W, data } = png;
let n = 0;
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const p = (y * W + x) * 4;
    if (data[p + 3] === 0) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r > 185 && g > 180 && b > 185 && Math.max(r, g, b) - Math.min(r, g, b) < 55) { data[p + 3] = 0; n++; }
  }
}
fs.writeFileSync(FILE, PNG.sync.write(png));
console.log('cleared', n, 'px');
