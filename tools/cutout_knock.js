// 敲门素材抠图：把 ready.png 里粘在人物右侧的玻璃条（x≥420 的半透明竖条）抹掉，
// 只留人物本体——玻璃改由 renderer 的 overlay SVG 层独立渲染（见 src/renderer.js 敲门求关注）。
// 拳头右沿（x≈418）与玻璃（x≥424）之间本来就有 2~4px 全透明缝，硬切即净，无需洪水/色距。
// 用法: node tools/cutout_knock.js <src.png> <dst.png> [cutX=420]
const fs = require('fs');
const { PNG } = require('pngjs');

const [src, dst, cutX = 420] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: node tools/cutout_knock.js <src> <dst> [cutX=420]'); process.exit(1); }

const png = PNG.sync.read(fs.readFileSync(src));
const { width: W, height: H, data } = png;
const cut = Number(cutX);

let erased = 0;
for (let y = 0; y < H; y++) {
  for (let x = cut; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] !== 0) erased++;
    data[i + 3] = 0;
  }
}
fs.writeFileSync(dst, PNG.sync.write(png));
console.log(`cut x>=${cut}: erased ${erased} px -> ${dst}`);
