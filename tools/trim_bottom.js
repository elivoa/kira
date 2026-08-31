// 统一裁掉 PNG 底部 N 行（多帧同一裁切，保画布对齐）
// 用法: node tools/trim_bottom.js <dir> <rows>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const [dir, rowsS] = process.argv.slice(2);
const rows = +rowsS;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
  const p = path.join(dir, f);
  const png = PNG.sync.read(fs.readFileSync(p));
  const out = new PNG({ width: png.width, height: png.height - rows });
  png.data.copy(out.data, 0, 0, png.width * (png.height - rows) * 4);
  fs.writeFileSync(p, PNG.sync.write(out));
}
console.log('trimmed', rows, 'rows in', dir);
