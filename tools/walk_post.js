// 走路帧后处理：接点互向柔化 + 边缘雾清理
// 1) 借相接点（tools/walk_loop_align.js 输出的 JUNCTIONS 对）同相位互向混合 w：
//    相位相同不重影，把跨周期外观漂移拆成两个小步；同相位差 ≈ 视频自然周期间漂移。
// 2) alpha < 32 的边缘雾一律清零：这些 ≤12% 透明度的像素肉眼几乎不可见，但参与
//    CSS drop-shadow 计算会在白底下投出抖动光晕（阴影闪烁的来源之一）。
// 用法: node tools/walk_post.js <walkDir> <j1,j2> [w]
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [dir, js, wArg] = process.argv.slice(2);
if (!dir || !js) { console.error('usage: node tools/walk_post.js <walkDir> <j1,j2> [w]'); process.exit(1); }
const w = +(wArg || 0.35);
const junctions = js.split(',').map(Number);

const read = (f) => PNG.sync.read(fs.readFileSync(f));
const write = (f, p) => fs.writeFileSync(f, PNG.sync.write(p));

// 1) 接点互向柔化（A' = (1-w)A + wB, B' = wA + (1-w)B，预乘 alpha）
for (const j of junctions) {
  const fa = path.join(dir, `f${String(j).padStart(2, '0')}.png`);
  const fb = path.join(dir, `f${String(j + 1).padStart(2, '0')}.png`);
  const a0 = read(fa), b0 = read(fb);
  const a = read(fa), b = read(fb);
  const mix = (p, q) => {
    const d = p.data, e = q.data;
    for (let i = 0; i < d.length; i += 4) {
      const ap = d[i + 3] / 255, aq = e[i + 3] / 255;
      const ao = ap * (1 - w) + aq * w;
      if (ao > 0) for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] * ap * (1 - w) + e[i + c] * aq * w) / ao);
      d[i + 3] = Math.round(ao * 255);
    }
  };
  mix(a, b0); mix(b, a0);
  write(fa, a); write(fb, b);
  console.log(`blended f${j} <-> f${j + 1} w=${w}`);
}

// 2) 边缘雾清理
const files = fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort();
for (const f of files) {
  const p = read(path.join(dir, f));
  let n = 0;
  for (let i = 3; i < p.data.length; i += 4) {
    if (p.data[i] > 0 && p.data[i] < 32) { p.data[i] = 0; n++; }
  }
  if (n) write(path.join(dir, f), p);
}
console.log('haze cleaned on', files.length, 'frames');
