// 二次清底：从指定种子点洪水填充白底（不跨阴影渐变，保住白色裙摆）
const fs = require('fs');
const { PNG } = require('pngjs');
const FILE = process.argv[2];
const SEEDS = process.argv.slice(3).map((s) => s.split(',').map(Number));
function isBg(r, g, b) {
  const t = +(process.env.THRESH || 226); return r > t && g > t && b > t && Math.max(r, g, b) - Math.min(r, g, b) < +(process.env.SPREAD || 30);
}
const png = PNG.sync.read(fs.readFileSync(FILE));
const { width: W, height: H, data } = png;
const visited = new Uint8Array(W * H);
const queue = [];
for (const [sx, sy] of SEEDS) {
  const i = sy * W + sx, p = i * 4;
  if (!visited[i] && data[p + 3] > 0 && isBg(data[p], data[p + 1], data[p + 2])) { visited[i] = 1; queue.push(i); }
}
let n = 0;
while (queue.length) {
  const i = queue.pop();
  const x = i % W, y = (i / W) | 0;
  for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const ni = ny * W + nx;
    if (visited[ni]) continue;
    const p = ni * 4;
    if (data[p + 3] === 0) continue; // 已透明的不算边界但也不扩散
    if (isBg(data[p], data[p + 1], data[p + 2])) { visited[ni] = 1; queue.push(ni); }
  }
}
for (let i = 0; i < W * H; i++) if (visited[i]) { data[i * 4 + 3] = 0; n++; }
fs.writeFileSync(FILE, PNG.sync.write(png));
console.log('cleared', n, 'px');
