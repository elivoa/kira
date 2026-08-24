// 从设定图抠出立绘：裁剪 → 边缘洪水填充去白底 → 边缘柔化 → 自动裁边
// 用法: node tools/cutout.js <out.png> <x> <y> <w> <h> [src.png]
const fs = require('fs');
const { PNG } = require('pngjs');

const SRC = process.argv[7] || (__dirname + '/../assets/source.png');
const OUT = process.argv[2] || (__dirname + '/../assets/pet.png');

// 立绘在原图中的大致范围（原图 2560x1440）
const CROP = {
  x: +(process.argv[3] ?? 100),
  y: +(process.argv[4] ?? 50),
  w: +(process.argv[5] ?? 800),
  h: +(process.argv[6] ?? 1370),
};

// 判定“接近白底”的阈值：亮度高且RGB接近
function isBg(r, g, b) {
  return r > 236 && g > 236 && b > 236 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = png;

// 1. 裁剪
const cw = CROP.w, ch = CROP.h;
const buf = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((CROP.y + y) * W + (CROP.x + x)) * 4;
    const di = (y * cw + x) * 4;
    buf[di] = data[si]; buf[di + 1] = data[si + 1];
    buf[di + 2] = data[si + 2]; buf[di + 3] = 255;
  }
}

// 2. 从边缘洪水填充，只把与边缘相连的白底变透明（保住白色裙子等内部区域）
const visited = new Uint8Array(cw * ch);
const queue = [];
function seed(x, y) {
  const i = y * cw + x;
  if (visited[i]) return;
  const p = i * 4;
  if (isBg(buf[p], buf[p + 1], buf[p + 2])) { visited[i] = 1; queue.push(i); }
}
for (let x = 0; x < cw; x++) { seed(x, 0); seed(x, ch - 1); }
for (let y = 0; y < ch; y++) { seed(0, y); seed(cw - 1, y); }
while (queue.length) {
  const i = queue.pop();
  const x = i % cw, y = (i / cw) | 0;
  const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  for (const [nx, ny] of nb) {
    if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
    const ni = ny * cw + nx;
    if (visited[ni]) continue;
    const p = ni * 4;
    if (isBg(buf[p], buf[p + 1], buf[p + 2])) { visited[ni] = 1; queue.push(ni); }
  }
}
for (let i = 0; i < cw * ch; i++) if (visited[i]) buf[i * 4 + 3] = 0;

// 3. 边缘柔化：与透明像素相邻的不透明像素按周围透明比例降 alpha，减轻白边锯齿
const alpha = new Uint8Array(cw * ch);
for (let i = 0; i < cw * ch; i++) alpha[i] = buf[i * 4 + 3];
for (let y = 1; y < ch - 1; y++) {
  for (let x = 1; x < cw - 1; x++) {
    const i = y * cw + x;
    if (alpha[i] === 0) continue;
    let t = 0;
    if (alpha[i - 1] === 0) t++;
    if (alpha[i + 1] === 0) t++;
    if (alpha[i - cw] === 0) t++;
    if (alpha[i + cw] === 0) t++;
    if (t > 0) buf[i * 4 + 3] = Math.round(255 * (4 - t) / 4);
  }
}

// 4. 按不透明区域裁边
let minX = cw, minY = ch, maxX = 0, maxY = 0;
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    if (buf[(y * cw + x) * 4 + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
const M = 6; // 边缘留白
minX = Math.max(0, minX - M); minY = Math.max(0, minY - M);
maxX = Math.min(cw - 1, maxX + M); maxY = Math.min(ch - 1, maxY + M);
const ow = maxX - minX + 1, oh = maxY - minY + 1;
const out = new PNG({ width: ow, height: oh });
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const si = ((minY + y) * cw + (minX + x)) * 4;
    const di = (y * ow + x) * 4;
    out.data[di] = buf[si]; out.data[di + 1] = buf[si + 1];
    out.data[di + 2] = buf[si + 2]; out.data[di + 3] = buf[si + 3];
  }
}
fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(`cutout done: ${ow}x${oh} -> ${OUT}`);
