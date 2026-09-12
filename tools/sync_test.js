// sync.js mock 测试（M43）：yomi 桩验证 拉取写入本地 / 推送分块完整 / 断线跳过 / 手动触发 / 索引指针不重复。
// 直接跑：node tools/sync_test.js（无测试框架，断言失败即非零退出）
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const sync = require('../src/sync.js');

// ---------- yomi 桩：模拟 kira 侧行为（读文件分段回传 / 收块 / 重组确认） ----------
const PULL_PART = 2500; // 与 sync.js 的 PULL_PART_SIZE 一致
function makeYomi(profile) {
  const state = { status: 'online', sessionId: 's1' };
  const sent = [];
  const listeners = [];
  const pull = { name: null, part: 0 }; // 当前在传的文件和已发段号
  const reply = (text) => setTimeout(() => {
    listeners.forEach((fn) => fn({ role: 'assistant', content: text, sessionId: 's1' }));
  }, 5);
  const respond = (text) => {
    const m = text.match(/SYNC-BEGIN (\S+) 段号\/总段数/);
    if (m) { // 拉取首段请求
      pull.name = m[1];
      pull.part = 0;
    } else if (text === '继续' && pull.name) {
      // 下一段
    } else if (text.includes('数据包发完了')) {
      reply('同步完成'); // 推送收尾：kira 重组落盘后的确认
      return;
    } else {
      return; // 推送头部/各块：sync 不等待应答，不用回
    }
    const content = profile[pull.name];
    if (content == null) { reply(`«SYNC-MISSING ${pull.name}»`); return; }
    const total = Math.max(1, Math.ceil(content.length / PULL_PART));
    pull.part += 1;
    const seg = content.slice((pull.part - 1) * PULL_PART, pull.part * PULL_PART);
    reply(`«SYNC-BEGIN ${pull.name} ${pull.part}/${total}»\n${seg}\n«SYNC-END»`);
  };
  return {
    sent, state,
    getState: () => state,
    sayToSession: (text) => { const t = String(text).slice(0, 4000); sent.push(t); respond(t); return Promise.resolve({}); },
    onMsg: (fn) => listeners.push(fn),
  };
}

// ---------- 造一个假的 home：memory 库 + 两个 skill ----------
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memsync-test-'));
fs.mkdirSync(path.join(home, '.agents/memory/topics'), { recursive: true });
fs.writeFileSync(path.join(home, '.agents/memory/MEMORY.md'), '# Memory 索引\n\n- [foo](topics/foo.md) — 测试主题\n');
fs.writeFileSync(path.join(home, '.agents/memory/topics/foo.md'), 'foo 主题细节\n');
fs.mkdirSync(path.join(home, '.agents/skills/lark-im'), { recursive: true });
fs.writeFileSync(path.join(home, '.agents/skills/lark-im/SKILL.md'), '# lark-im skill 内容\n');
fs.mkdirSync(path.join(home, '.agents/skills/excalidraw-diagram'), { recursive: true });
// 大文件：把推送包撑到多块，验证块序号/重组（行内容带序号，gzip 压不成单块）
const bigSkill = Array.from({ length: 4000 }, (_, i) => `第 ${i} 行 excalidraw 用法说明 ${i * 7919}`).join('\n');
fs.writeFileSync(path.join(home, '.agents/skills/excalidraw-diagram/SKILL.md'), bigSkill);

// kira 侧 user-profile：SKILL.md 长文（3 段）、TODO.md 单段、FOOTPRINT.md 不存在
const profileSkill = '用户画像长文\n'.repeat(600); // 6600 字符 → 3 段
const profileTodo = '# TODO\n- 事项一\n';
const yomi = makeYomi({ 'SKILL.md': profileSkill, 'TODO.md': profileTodo });

const cfg = {};
const logs = [];
sync.init({
  getConfig: () => cfg,
  persist: () => {},
  yomi,
  home,
  log: (type, text) => logs.push({ type, text }),
  onStatus: () => {},
});
yomi.onMsg((m) => sync.onYomiMessage(m));

(async () => {
  // 1) 断线跳过：yomi 不在线时不发任何消息，记 skipped
  yomi.state.status = 'off';
  const r1 = await sync.runNow('manual');
  assert.strictEqual(r1.skipped, true, '断线应跳过');
  assert.strictEqual(yomi.sent.length, 0, '断线不该发消息');
  assert.strictEqual(cfg.lastRun.skipped, 'kira 未连接', 'lastRun 应记录跳过原因');
  console.log('✓ 断线跳过');

  // 2) 手动触发一整轮：拉取 + 推送
  yomi.state.status = 'online';
  const r2 = await sync.runNow('manual');
  assert.strictEqual(r2.ok, true, '整轮应成功');
  assert.strictEqual(r2.pull.ok, true, `拉取应成功：${r2.pull.error || ''}`);
  assert.strictEqual(r2.push.ok, true, `推送应成功：${r2.push.error || ''}`);

  // 2a) 拉取写入本地：三件套原子落盘（FOOTPRINT.md 缺）、长文多段拼接字节级一致
  const profDir = path.join(home, '.agents/skills/kira-profile');
  assert.strictEqual(fs.readFileSync(path.join(profDir, 'SKILL.md'), 'utf8'), profileSkill, 'SKILL.md 多段拼接应等于原文');
  assert.strictEqual(fs.readFileSync(path.join(profDir, 'TODO.md'), 'utf8'), profileTodo, 'TODO.md 应等于原文');
  assert.ok(!fs.existsSync(path.join(profDir, 'FOOTPRINT.md')), 'kira 侧缺的文件不该写');
  // MEMORY.md 索引指针：加了一行，其他行不动
  const mem1 = fs.readFileSync(path.join(home, '.agents/memory/MEMORY.md'), 'utf8');
  assert.ok(mem1.includes(sync.POINTER_LINE), '索引应补指针行');
  assert.ok(mem1.includes('- [foo](topics/foo.md) — 测试主题'), '索引原有行不能动');
  console.log('✓ 拉取写入本地（含 3 段长文拼接 + 缺失文件跳过 + 索引指针）');

  // 2b) 推送分块完整：头部 + N 块 + 收尾，块重组后内容齐全
  const header = yomi.sent.find((t) => t.includes('接下来分'));
  const finalMsg = yomi.sent.find((t) => t.includes('数据包发完了'));
  assert.ok(header && finalMsg, '推送应有头部和收尾指令');
  const chunks = yomi.sent.filter((t) => t.startsWith('[MEMSYNC 块 '));
  const n = parseInt(header.match(/接下来分 (\d+) 块/)[1], 10);
  assert.strictEqual(chunks.length, n, '块数应与头部声明一致');
  chunks.forEach((t, i) => assert.ok(t.startsWith(`[MEMSYNC 块 ${i + 1}/${n}]`), '块序号应连续'));
  assert.ok(chunks.every((t) => t.length <= 4000), '单条消息不能超 yomi 截断上限');
  const b64 = chunks.map((t) => t.slice(t.indexOf('\n') + 1)).join('');
  const bundle = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
  const byPath = Object.fromEntries(bundle.files.map((f) => [f.path, f.content]));
  assert.ok(byPath['gaobo-engineering/SKILL.md'].includes('- [foo](topics/foo.md) — 测试主题'), 'gaobo-engineering/SKILL.md 应含 MEMORY.md 内容');
  assert.strictEqual(byPath['gaobo-engineering/topics/foo.md'], 'foo 主题细节\n', 'topics 应原样打包');
  assert.strictEqual(byPath['lark-im/SKILL.md'], '# lark-im skill 内容\n', 'skill 内容应原样打包');
  assert.strictEqual(byPath['excalidraw-diagram/SKILL.md'], bigSkill, '大 skill 多块重组后应字节级一致');
  assert.ok(byPath['SYNC-MANIFEST.md'].match(/lark-im（[^）]*需本机凭据，pod 不可用/), 'env 绑定 skill 应标注');
  assert.ok(!byPath['SYNC-MANIFEST.md'].includes('excalidraw-diagram（需本机凭据'), '非 env 绑定不该标注');
  console.log(`✓ 推送分块完整（${n} 块，gzip+base64 重组校验通过）`);

  // 2c) 索引指针不重复添加：再跑一轮，指针仍只有一行
  await sync.runNow('manual');
  const mem2 = fs.readFileSync(path.join(home, '.agents/memory/MEMORY.md'), 'utf8');
  const count = mem2.split('\n').filter((l) => l.includes('kira-profile')).length;
  assert.strictEqual(count, 1, '指针行不能重复添加');
  console.log('✓ 手动触发 + 索引指针不重复');

  // 3) 纯函数单测：parsePullReply 缺文件/坏格式、chunkText、isEnvBound
  assert.strictEqual(sync.parsePullReply('«SYNC-MISSING X.md»', 'X.md').status, 'missing');
  assert.strictEqual(sync.parsePullReply('随便回了一句', 'X.md').status, 'bad');
  const p = sync.parsePullReply('«SYNC-BEGIN X.md 1/2»\nabc\n«SYNC-END»', 'X.md');
  assert.deepStrictEqual([p.status, p.part, p.total, p.content], ['ok', 1, 2, 'abc']);
  assert.deepStrictEqual(sync.chunkText('abcdefg', 3), ['abc', 'def', 'g']);
  assert.ok(sync.isEnvBound('lark-im') && sync.isEnvBound('gitlab-auth') && !sync.isEnvBound('excalidraw-diagram'));
  console.log('✓ 纯函数（parsePullReply / chunkText / isEnvBound）');

  console.log('\n全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('测试失败：', e);
  process.exit(1);
});
