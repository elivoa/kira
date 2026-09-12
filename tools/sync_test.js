// sync.js mock 测试（M47 新协议）：yomi read_file 桩 + 真实本地 git（file:// bare 仓当 remote）。
// 验证：断线跳过 / read_file 拉三件套（mtime 增量、缺失跳过、分页拼接）/ git push（目录结构、
// 作者 kira-pet、无变化不推、改后再推、删文件同步删除）/ token 不落盘（含 token 的 remote URL 被重写）/
// 通知失败补发 / 无凭证跳过 / setConfig 夹紧。
// 直接跑：node tools/sync_test.js（无测试框架，断言失败即非零退出）
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const assert = require('assert');
const sync = require('../src/sync.js');

// ---------- 隔离环境：PATH 只留 git（没有 glab），摘掉 GITLAB_TOKEN——凭证用例才是密封的 ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'memsync-test-'));
const binDir = path.join(sandbox, 'bin');
fs.mkdirSync(binDir);
fs.symlinkSync('/usr/bin/git', path.join(binDir, 'git'));
process.env.PATH = binDir;
delete process.env.GITLAB_TOKEN;

const tmp = (sub) => path.join(sandbox, sub);
function gitOut(args, cwd) {
  return childProcess.execFileSync('git', args, { encoding: 'utf8', cwd: cwd || sandbox, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// ---------- yomi 桩：read_file 从内存 profile 出块（CHUNK 字节一页，练分页），sayToSession 截获 ----------
const CHUNK = 100;
function makeYomi(profile) {
  const state = { status: 'online', sessionId: 's1' };
  const sent = [];
  const metaCalls = [];
  const fullReads = [];
  const stub = {
    sent, state, metaCalls, fullReads, failNextNotify: false,
    getState: () => state,
    sayToSession: (text) => {
      if (stub.failNextNotify) { stub.failNextNotify = false; return Promise.reject(new Error('daemon 队列满了')); }
      sent.push(String(text));
      return Promise.resolve({});
    },
    readFile: (remotePath, opts) => {
      const o = opts || {};
      const name = remotePath.split('/').pop();
      const rec = profile[name];
      if (!rec) {
        const e = new Error(`Configuration error: file unavailable: ${remotePath} (missing, not a file, or outside the workspace)`);
        e.code = 'read_file_failed';
        return Promise.reject(e);
      }
      const buf = Buffer.from(rec.content, 'utf8');
      if (o.limit === 0) {
        metaCalls.push(name);
        return Promise.resolve({ data_base64: '', start_offset: 0, end_offset: 0, file_size: buf.length, mtime_ms: rec.mtime_ms });
      }
      const offset = o.offset || 0;
      const slice = buf.subarray(offset, offset + CHUNK);
      if (offset === 0) fullReads.push(name);
      return Promise.resolve({
        data_base64: slice.toString('base64'),
        start_offset: offset, end_offset: offset + slice.length,
        file_size: buf.length, mtime_ms: rec.mtime_ms,
      });
    },
  };
  return stub;
}

// ---------- 造假 home：memory 库 + 两个 skill ----------
const home = tmp('home');
fs.mkdirSync(path.join(home, '.agents/memory/topics'), { recursive: true });
fs.writeFileSync(path.join(home, '.agents/memory/MEMORY.md'), '# Memory 索引\n\n- [foo](topics/foo.md) — 测试主题\n');
fs.writeFileSync(path.join(home, '.agents/memory/topics/foo.md'), 'foo 主题细节\n');
fs.writeFileSync(path.join(home, '.agents/memory/topics/bar.md'), 'bar 主题细节\n');
fs.mkdirSync(path.join(home, '.agents/skills/lark-im'), { recursive: true });
fs.writeFileSync(path.join(home, '.agents/skills/lark-im/SKILL.md'), '# lark-im skill 内容\n');
fs.mkdirSync(path.join(home, '.agents/skills/excalidraw-diagram'), { recursive: true });
fs.writeFileSync(path.join(home, '.agents/skills/excalidraw-diagram/SKILL.md'), '# excalidraw 用法\n');

// kira 侧 profile：SKILL.md 长文（分页）、TODO.md 单页、FOOTPRINT.md 不存在
const profileSkill = '用户画像长文（分页拼接测试）。\n'.repeat(30); // >CHUNK，多页
const profileTodo = '# TODO\n- 事项一\n';
const profile = {
  'SKILL.md': { content: profileSkill, mtime_ms: 1000 },
  'TODO.md': { content: profileTodo, mtime_ms: 2000 },
};

// file:// bare 仓当 remote（离线真实 git）
const bare = tmp('remote.git');
gitOut(['init', '--bare', '-b', 'master', bare]);

const yomi = makeYomi(profile);
const cfg = { gitRemoteUrl: `file://${bare}` };
const logs = [];
sync.init({
  getConfig: () => cfg,
  persist: () => {},
  yomi,
  home,
  log: (type, text) => logs.push(text),
  onStatus: () => {},
});

function remoteFiles() {
  return gitOut(['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'master']).split('\n').filter(Boolean).sort();
}
function remoteContent(f) {
  return gitOut(['--git-dir', bare, 'show', `master:local/${f}`]);
}

(async () => {
  // 1) 断线跳过：yomi 不在线时不读文件不推 git，记 skipped
  yomi.state.status = 'off';
  const r1 = await sync.runNow('manual');
  assert.strictEqual(r1.skipped, true, '断线应跳过');
  assert.strictEqual(yomi.metaCalls.length, 0, '断线不该调 read_file');
  assert.strictEqual(yomi.sent.length, 0, '断线不该发消息');
  assert.strictEqual(cfg.lastRun.skipped, 'kira 未连接', 'lastRun 应记录跳过原因');
  console.log('✓ 断线跳过');

  // 2) 手动触发一整轮：read_file 拉取 + git push
  yomi.state.status = 'online';
  const r2 = await sync.runNow('manual');
  assert.strictEqual(r2.ok, true, '整轮应成功');
  assert.strictEqual(r2.pull.ok, true, `拉取应成功：${r2.pull.error || ''}`);
  assert.strictEqual(r2.push.ok, true, `推送应成功：${r2.push.error || ''}`);
  assert.strictEqual(r2.push.changed, true, '首轮应有变化');

  // 2a) 拉取落盘：多页拼接字节级一致、缺失文件不写、索引指针补上
  const profDir = path.join(home, '.agents/skills/kira-profile');
  assert.strictEqual(fs.readFileSync(path.join(profDir, 'SKILL.md'), 'utf8'), profileSkill, 'SKILL.md 多页拼接应等于原文');
  assert.strictEqual(fs.readFileSync(path.join(profDir, 'TODO.md'), 'utf8'), profileTodo, 'TODO.md 应等于原文');
  assert.ok(!fs.existsSync(path.join(profDir, 'FOOTPRINT.md')), 'kira 侧缺的文件不该写');
  assert.deepStrictEqual(yomi.fullReads.sort(), ['SKILL.md', 'TODO.md'], '全量读的应只有存在的两个');
  const mem1 = fs.readFileSync(path.join(home, '.agents/memory/MEMORY.md'), 'utf8');
  assert.ok(mem1.includes(sync.POINTER_LINE), '索引应补指针行');
  assert.ok(mem1.includes('- [foo](topics/foo.md) — 测试主题'), '索引原有行不能动');
  console.log('✓ read_file 拉取（多页拼接 + 缺失跳过 + 索引指针）');

  // 2b) 推送落仓：目录结构 + 作者 + 清单标注 + kira 指令
  const files1 = remoteFiles();
  assert.deepStrictEqual(files1, [
    'local/SYNC-MANIFEST.md',
    'local/memory/MEMORY.md',
    'local/memory/topics/bar.md',
    'local/memory/topics/foo.md',
    'local/skills/excalidraw-diagram/SKILL.md',
    'local/skills/lark-im/SKILL.md',
  ], '仓里应是 memory/ + skills/ + 清单的目录结构');
  assert.strictEqual(remoteContent('memory/MEMORY.md'), '# Memory 索引\n\n- [foo](topics/foo.md) — 测试主题', 'MEMORY.md 应原样（剥掉本机指针行）');
  assert.strictEqual(remoteContent('skills/lark-im/SKILL.md'), '# lark-im skill 内容', 'SKILL.md 应原样');
  const manifest = remoteContent('SYNC-MANIFEST.md');
  assert.ok(/lark-im（[^）]*需本机凭据，pod 不可用/.test(manifest), 'env 绑定 skill 应标注');
  assert.ok(!manifest.includes('excalidraw-diagram（需本机凭据'), '非 env 绑定不该标注');
  assert.ok(!manifest.includes('kira-profile'), '拉取产物不该进清单');
  const author = gitOut(['--git-dir', bare, 'log', '-1', '--format=%an <%ae>', 'master']);
  assert.strictEqual(author, 'kira-pet <kira-pet@local>', '提交作者应是 kira-pet');
  assert.strictEqual(yomi.sent.length, 1, '有变化应发一条 kira 指令');
  assert.ok(yomi.sent[0].includes('git clone') && yomi.sent[0].includes('MEMSYNC-OK'), '指令应含克隆/落盘步骤');
  assert.ok(yomi.sent[0].length <= 4000, '指令不能超 yomi 截断上限');
  console.log('✓ git push（目录结构 + 作者 + env 标注 + 一条指令）');

  // 3) 第二轮全未变：不拉不推不通知
  yomi.metaCalls.length = 0;
  yomi.fullReads.length = 0;
  yomi.sent.length = 0;
  const r3 = await sync.runNow('manual');
  assert.strictEqual(r3.pull.ok, true);
  assert.deepStrictEqual(yomi.fullReads, [], 'mtime 未变不该再全量读');
  assert.strictEqual(r3.push.changed, false, '内容未变不该推');
  assert.strictEqual(yomi.sent.length, 0, '未变不该发 kira 指令');
  assert.ok(/未变/.test(r3.pull.detail) && /无变化/.test(r3.push.detail), '日志应说明未变');
  console.log('✓ 增量判断（mtime 未变不拉、内容未变不推不通知）');

  // 3b) token 不落盘：clone 里被塞了含 token 的 remote URL 时，下轮 ensureRepo 重写成净 URL
  const cloneDir = path.join(home, '.config', 'kira', 'kira-memsync');
  gitOut(['-C', cloneDir, 'remote', 'set-url', 'origin', 'https://oauth2:SECRETTOKEN@dev.msh.team/gaobo/kira-memsync.git']);
  await sync.runNow('manual');
  assert.strictEqual(gitOut(['-C', cloneDir, 'config', 'remote.origin.url']), `file://${bare}`, 'remote URL 应被重写成净 URL');
  assert.ok(!fs.readFileSync(path.join(cloneDir, '.git', 'config'), 'utf8').includes('SECRETTOKEN'), '.git/config 不该残留 token');
  console.log('✓ token 不落盘（含 token 的 remote URL 被重写为净 URL）');

  // 4) kira 侧 mtime 变了：只重拉那一个；本地删一个 topic：推送同步删除
  profile['TODO.md'] = { content: profileTodo + '- 事项二\n', mtime_ms: 3000 };
  fs.unlinkSync(path.join(home, '.agents/memory/topics/bar.md'));
  yomi.fullReads.length = 0;
  yomi.sent.length = 0;
  const r4 = await sync.runNow('manual');
  assert.deepStrictEqual(yomi.fullReads, ['TODO.md'], '只有 mtime 变了的才重拉');
  assert.strictEqual(fs.readFileSync(path.join(profDir, 'TODO.md'), 'utf8'), profileTodo + '- 事项二\n', '重拉内容应落盘');
  assert.strictEqual(r4.push.changed, true, '删了 topic 应有变化');
  const files2 = remoteFiles();
  assert.ok(!files2.includes('local/memory/topics/bar.md'), '仓里应同步删除 bar.md');
  assert.strictEqual(yomi.sent.length, 1, '有变化应重新通知 kira');
  console.log('✓ 变化检测（mtime 变重拉单个、删文件同步删除、重新通知）');

  // 5) 通知失败下轮补发：sayToSession 挂一次，push 仍算成功；下轮无变化也补发指令
  yomi.sent.length = 0;
  yomi.failNextNotify = true;
  fs.writeFileSync(path.join(home, '.agents/memory/topics/foo.md'), 'foo 主题细节 v2\n');
  const r5 = await sync.runNow('manual');
  assert.strictEqual(r5.push.ok, true, '通知失败不该拖垮推送');
  assert.strictEqual(r5.push.changed, true);
  assert.strictEqual(yomi.sent.length, 0, '通知挂了就是没发出去');
  assert.ok(cfg.pendingKiraNotify === true, '应记下待补发');
  const r6 = await sync.runNow('manual');
  assert.strictEqual(r6.push.changed, false, '内容没变仍不推');
  assert.strictEqual(yomi.sent.length, 1, '下轮应补发 kira 指令');
  assert.ok(cfg.pendingKiraNotify === false, '补发后清标记');
  console.log('✓ 通知失败不阻断 + 下轮补发');

  // 6) 无凭证跳过：没配 gitRemoteUrl 也拿不到 token（PATH 里没有 glab、env 已摘）
  const home2 = tmp('home2');
  fs.mkdirSync(path.join(home2, '.agents/memory'), { recursive: true });
  fs.writeFileSync(path.join(home2, '.agents/memory/MEMORY.md'), '# 索引\n');
  const yomi2 = makeYomi(profile);
  const cfg2 = {};
  sync.init({ getConfig: () => cfg2, persist: () => {}, yomi: yomi2, home: home2, log: () => {}, onStatus: () => {} });
  const r7 = await sync.runNow('manual');
  assert.strictEqual(r7.pull.ok, true, '拉取不该受 git 凭证影响');
  assert.strictEqual(r7.push.ok, false, '无凭证推送应失败');
  assert.ok(/凭证/.test(r7.push.error), `失败原因应是缺凭证：${r7.push.error}`);
  console.log('✓ 无凭证跳过（拉取不受影响）');

  // 7) setConfig 间隔夹紧：小数值/超上限都按 1-168 收
  sync.setConfig({ intervalHours: 0.0001 });
  assert.strictEqual(sync.getState().intervalHours, 1, '下限应夹到 1 小时');
  sync.setConfig({ intervalHours: 999 });
  assert.strictEqual(sync.getState().intervalHours, 168, '上限应夹到 168 小时');
  console.log('✓ setConfig intervalHours 夹紧 1-168');

  // 8) 纯函数：buildRepoBundle 目录结构/env 标注、isEnvBound、ensureMemoryPointer 幂等
  const { files } = sync.buildRepoBundle(home, {});
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  assert.ok(byPath['memory/MEMORY.md'] && byPath['memory/topics/foo.md'], '应含 memory 镜像');
  assert.ok(!byPath['memory/MEMORY.md'].includes('kira-profile'), '推送镜像应剥掉本机指针行');
  assert.ok(byPath['skills/lark-im/SKILL.md'] && byPath['SYNC-MANIFEST.md'], '应含 skills + 清单');
  assert.ok(/lark-im（[^）]*需本机凭据/.test(byPath['SYNC-MANIFEST.md']), '清单应标 env 绑定');
  assert.ok(sync.isEnvBound('lark-im') && sync.isEnvBound('gitlab-auth') && !sync.isEnvBound('excalidraw-diagram'));
  const memDir = path.join(home, '.agents/memory');
  assert.strictEqual(sync.ensureMemoryPointer(memDir), 'exists', '指针已存在不该重复加');
  console.log('✓ 纯函数（buildRepoBundle / isEnvBound / ensureMemoryPointer）');

  console.log('\n全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('测试失败：', e);
  process.exit(1);
});
