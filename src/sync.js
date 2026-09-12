// 双向记忆同步（M47 通道改造）：桌宠 ↔ kira。
// 拉：yomi wire read_file 直读 kira 的 /root/.agents/skills/user-profile/ 三件套
//     → ~/.agents/skills/kira-profile/（原子写）；limit:0 先拿 file_size+mtime_ms 当增量缓存键，
//     没变不拉；并在 ~/.agents/memory/MEMORY.md 索引维护一行指针（没有才加，不重复、不动其他行）。
// 推：~/.agents/memory/（MEMORY.md + topics/）和各 skill 的 SKILL.md 按目录结构写到
//     GitLab 私有仓 gaobo/kira-memsync 的 local/ 目录（memory/、skills/<name>/、SYNC-MANIFEST.md
//     标注 env 绑定），git commit + push（作者 kira-pet <kira-pet@local>，-c 传参不碰全局 git config）；
//     内容无变化不推；推完发一条同步指令让 kira git pull 落到 /root/.agents/skills/。
// 全程不再产生聊天分块（M43 的 65 块 base64 协议已删）：拉取是纯 RPC，推送是 git，一轮最多一条指令消息。
// 推拉各自 try/catch 记日志，互不阻断；同步窗口期会话静默（main.js 按 isActive 吞掉窗口内消息）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const FIRST_RUN_DELAY = 5 * 60 * 1000; // 启动后 5 分钟跑首轮，之后按 intervalHours
const PROFILE_FILES = ['SKILL.md', 'TODO.md', 'FOOTPRINT.md'];
const REMOTE_PROFILE_DIR = '/root/.agents/skills/user-profile';
const POINTER_LINE = '- [kira-profile](../skills/kira-profile/SKILL.md) — 用户画像由 kira 定时同步，只读勿手改';
const PULL_MAX_BYTES = 8 * 1024 * 1024; // 单文件拉取兜底：防异常内容把内存撑爆
const GIT_HOST_PATH = 'dev.msh.team/gaobo/kira-memsync.git';
const KIRA_REPO_DIR = '/root/.yomi/workspace/kira-memsync'; // kira 容器里的克隆位置（workspace 持久化）

// env 绑定（依赖本机凭据/本机状态，pod 上跑不了）的 skill：清单里标注，内容照同步但 kira 别硬用
const ENV_BOUND_NAMES = new Set([
  'argocd-login', 'argocd-test-ops.disabled', 'gitlab-auth', 'db-query', 'loki-logcli',
  'mcp-grafana', 'jpush-query', 'kimi-webbridge', 'clone-claw-machine', 'ssh-claw-instance',
  'user-token-test', 'miki-argocd-deploy', 'mr-review',
]);

let deps = null;
let running = false;
let muteUntil = 0;        // 一轮结束后短暂余音：吞掉 kira 迟到的同步应答，别冒泡刷屏
let firstTimer = null;
let intervalTimer = null;

function init(d) { deps = d; }
function home() { return (deps && deps.home) || os.homedir(); }
function log(type, text) { if (deps && deps.log) deps.log(type, text); }
function notify() { if (deps && deps.onStatus) deps.onStatus(getState()); }

function syncCfg() {
  const c = (deps && deps.getConfig && deps.getConfig()) || {};
  if (typeof c.enabled !== 'boolean') c.enabled = true;
  if (!(c.intervalHours > 0)) c.intervalHours = 24;
  return c;
}

function getState() {
  const c = syncCfg();
  return { enabled: c.enabled, intervalHours: c.intervalHours, running, lastRun: c.lastRun || null };
}

function isActive() { return running || Date.now() < muteUntil; }

// ---------- 小工具（纯函数，供 mock 测试直接调） ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 原子写：tmp + rename，进程被强杀不留半截文件（和 saveConfig 同款）
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// MEMORY.md 索引维护一行 kira-profile 指针：已提过（任何一行含 kira-profile）就不动，否则末尾追加
function ensureMemoryPointer(memoryDir) {
  const memFile = path.join(memoryDir, 'MEMORY.md');
  let text = '';
  try { text = fs.readFileSync(memFile, 'utf8'); } catch {}
  if (text.includes('kira-profile')) return 'exists';
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  atomicWrite(memFile, text + sep + POINTER_LINE + '\n');
  return 'added';
}

// env 绑定判定：名单命中或 lark-* 系列（lark-cli 授权在本机）；config.sync.envBoundExtra 可补充
function isEnvBound(name, extra) {
  if (name.startsWith('lark-')) return true;
  if (ENV_BOUND_NAMES.has(name)) return true;
  return Array.isArray(extra) && extra.includes(name);
}

// ---------- 拉：kira → 本地（yomi wire read_file，纯 RPC 不产生聊天消息） ----------
// read_file 应答：{data_base64, start_offset, end_offset, file_size, mime, mtime_ms}；
// 文件不存在时 daemon 回 read_file_failed / "file unavailable"
function isMissingErr(e) {
  return (e && e.code === 'read_file_failed') || /file unavailable/.test((e && e.message) || '');
}

// limit:0 只拿元信息（file_size + mtime_ms），当增量缓存键；缺失返回 null
async function pullMeta(name) {
  try {
    return await deps.yomi.readFile(`${REMOTE_PROFILE_DIR}/${name}`, { limit: 0 });
  } catch (e) {
    if (isMissingErr(e)) return null;
    throw e;
  }
}

// 全量读：单块默认 ≤2MiB，大文件按 end_offset 翻页（三件套都 <100KB，翻页是兜底）
async function pullContent(name) {
  const parts = [];
  let offset = 0;
  let meta = null;
  for (;;) {
    const r = await deps.yomi.readFile(`${REMOTE_PROFILE_DIR}/${name}`, offset ? { offset } : {});
    parts.push(Buffer.from(r.data_base64 || '', 'base64'));
    meta = r;
    if (!(r.end_offset > offset && r.end_offset < r.file_size)) break; // 读完或无进展都停
    offset = r.end_offset;
    if (offset > PULL_MAX_BYTES) throw new Error(`${name} 超过 8MiB，放弃`);
  }
  return { content: Buffer.concat(parts).toString('utf8'), meta };
}

async function pullProfile() {
  const dir = path.join(home(), '.agents', 'skills', 'kira-profile');
  const cfg = syncCfg();
  const cache = cfg.pullMeta || (cfg.pullMeta = {});
  const written = [];
  const unchanged = [];
  const missing = [];
  for (const name of PROFILE_FILES) {
    const meta = await pullMeta(name);
    if (!meta) { missing.push(name); delete cache[name]; continue; }
    const prev = cache[name];
    if (prev && prev.file_size === meta.file_size && prev.mtime_ms === meta.mtime_ms) {
      unchanged.push(name);
      continue;
    }
    const r = await pullContent(name);
    atomicWrite(path.join(dir, name), r.content);
    cache[name] = { file_size: r.meta.file_size, mtime_ms: r.meta.mtime_ms };
    written.push(name);
  }
  let pointer = 'none';
  if (written.length) pointer = ensureMemoryPointer(path.join(home(), '.agents', 'memory'));
  const parts = [`更新 ${written.length} 个（${written.join('、') || '无'}）`];
  if (unchanged.length) parts.push(`${unchanged.length} 个未变`);
  if (missing.length) parts.push(`kira 侧缺 ${missing.join('、')}`);
  parts.push(`索引指针${pointer === 'added' ? '已补' : pointer === 'exists' ? '已存在' : '未动'}`);
  const detail = parts.join('，');
  log('系统', `记忆同步拉取完成：${detail}`);
  return { ok: true, detail };
}

// ---------- 推：本地 → kira（GitLab 仓 gaobo/kira-memsync 中转） ----------
function repoDir() { return path.join(home(), '.config', 'kira', 'kira-memsync'); }

// GitLab 凭证：config.sync.gitlabToken → GITLAB_TOKEN 环境变量 → glab 配置文件
// （打包 app 从 Finder 启动没有 shell 环境，主要靠 glab 配置；都不动用户任何 git 全局配置）
function gitlabToken() {
  const cfg = syncCfg();
  if (typeof cfg.gitlabToken === 'string' && cfg.gitlabToken.trim()) return cfg.gitlabToken.trim();
  if ((process.env.GITLAB_TOKEN || '').trim()) return process.env.GITLAB_TOKEN.trim();
  for (const p of [
    path.join(home(), '.config', 'glab-cli', 'config.yml'),
    path.join(home(), 'Library', 'Application Support', 'glab-cli', 'config.yml'),
  ]) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/dev\.msh\.team:[\s\S]*?token:\s*(\S+)/);
      if (m) return m[1];
    } catch {}
  }
  try {
    return childProcess.execFileSync('glab', ['auth', 'token', '-h', 'dev.msh.team'], {
      encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

function remoteUrl(token) {
  const cfg = syncCfg();
  if (typeof cfg.gitRemoteUrl === 'string' && cfg.gitRemoteUrl.trim()) return cfg.gitRemoteUrl.trim(); // 测试/自建远端可覆盖
  return `https://oauth2:${token}@${GIT_HOST_PATH}`;
}

// 错误文本脱敏 + 压成一行：git 报错会把带 token 的 remote URL 一起吐出来
function redact(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('***');
  return s.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ');
}

function git(args, token) {
  try {
    return childProcess.execFileSync('git', ['-C', repoDir(), ...args], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`git ${args[0]} 失败：${redact(e.stderr || e.message, token)}`);
  }
}

// 确保本地克隆可用（同步专用仓，目录在 ~/.config/kira/kira-memsync）；返回当前分支名
function ensureRepo(url, token) {
  const dir = repoDir();
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true }); // 上次 clone 半截的话清掉重来
    fs.mkdirSync(dir, { recursive: true });
    try {
      childProcess.execFileSync('git', ['clone', url, dir], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`git clone 失败：${redact(e.stderr || e.message, token)}`);
    }
  }
  git(['remote', 'set-url', 'origin', url], token); // 每轮换新 URL：token 轮换后自愈
  return git(['symbolic-ref', '--short', 'HEAD'], token).trim() || 'master';
}

// 推送内容：memory/（MEMORY.md + topics/ 原样镜像）+ skills/<name>/SKILL.md + SYNC-MANIFEST.md
function buildRepoBundle(homeDir, opts) {
  const o = opts || {};
  const files = [];
  const memoryDir = path.join(homeDir, '.agents', 'memory');
  const skillsDir = path.join(homeDir, '.agents', 'skills');
  let memoryIndex = '';
  try { memoryIndex = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8'); } catch {}
  // kira-profile 指针行是本机索引专用的（指向只有本机才有的拉取产物），推给 kira 的镜像里剥掉，免得 kira 对着死引用
  memoryIndex = memoryIndex.split('\n').filter((l) => !l.includes('kira-profile')).join('\n');
  if (memoryIndex.trim()) files.push({ path: 'memory/MEMORY.md', content: memoryIndex });
  let topics = [];
  try { topics = fs.readdirSync(path.join(memoryDir, 'topics')).filter((f) => f.endsWith('.md')); } catch {}
  for (const f of topics.sort()) {
    try {
      files.push({ path: `memory/topics/${f}`, content: fs.readFileSync(path.join(memoryDir, 'topics', f), 'utf8') });
    } catch {}
  }
  let skillNames = [];
  try {
    skillNames = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {}
  const manifest = [
    // 不放时间戳：清单内容是「无变化不推」的判差输入，时间戳会让每轮都判成有变化（时间戳在 git commit message 里）
    '# 桌宠记忆同步清单',
    '',
    '目录约定：memory/ = Mac 本机 ~/.agents/memory/ 原样镜像（kira 侧落 /root/.agents/skills/gaobo-engineering/）；',
    'skills/<name>/SKILL.md = 各 skill 原样（kira 侧落 /root/.agents/skills/<name>/SKILL.md；引用脚本/素材不搬）。',
    '',
  ];
  for (const name of skillNames) {
    if (name === 'kira-profile') continue; // 拉取产物不回推，防环路
    const skillFile = path.join(skillsDir, name, 'SKILL.md');
    let hasSkill = false;
    try { hasSkill = fs.statSync(skillFile).isFile(); } catch {}
    const marks = [];
    if (name.endsWith('.disabled')) marks.push('本机已禁用');
    if (isEnvBound(name, o.envBoundExtra)) marks.push('需本机凭据，pod 不可用');
    manifest.push(`- ${name}${marks.length ? `（${marks.join('；')}）` : ''}${hasSkill ? '' : '（无 SKILL.md，仅目录）'}`);
    if (hasSkill) {
      try { files.push({ path: `skills/${name}/SKILL.md`, content: fs.readFileSync(skillFile, 'utf8') }); } catch {}
    }
  }
  const manifestText = manifest.join('\n') + '\n';
  files.push({ path: 'SYNC-MANIFEST.md', content: manifestText });
  return { files, manifest: manifestText };
}

// 给 kira 的同步指令：git pull + 落盘到 /root/.agents/skills/（一轮最多这一条消息，替代旧 65 块分块）
function kiraPullInstruction() {
  return `【桌宠记忆同步】Mac 本机的记忆库刚推到 GitLab 仓 gaobo/kira-memsync 的 local/ 目录，请拉下来落到你的 skills（直接跑这段 bash）：
\`\`\`bash
set -e
R=${KIRA_REPO_DIR}
[ -d "$R/.git" ] || git clone "https://oauth2:\${GITLAB_TOKEN}@dev.msh.team/gaobo/kira-memsync.git" "$R"
git -C "$R" pull --ff-only
S=/root/.agents/skills
if [ -f "$R/local/memory/MEMORY.md" ]; then
  mkdir -p "$S/gaobo-engineering"
  { printf '%s\\n' '---' 'name: gaobo-engineering' 'description: 高博的工程经验记忆库（桌宠定时从 Mac 本机 ~/.agents/memory 同步而来，执行编码任务时请优先参考；勿手改，会被下轮同步覆盖）' '---' '' '（以下为 Mac 本机 ~/.agents/memory/MEMORY.md 索引原文，同目录 topics/ 是各主题细节文件）' ''; cat "$R/local/memory/MEMORY.md"; } > "$S/gaobo-engineering/SKILL.md"
  [ -d "$R/local/memory/topics" ] && { rm -rf "$S/gaobo-engineering/topics"; cp -a "$R/local/memory/topics" "$S/gaobo-engineering/topics"; }
fi
for d in "$R"/local/skills/*/; do [ -d "$d" ] || continue; n=$(basename "$d"); mkdir -p "$S/$n"; cp "$d/SKILL.md" "$S/$n/SKILL.md"; done
[ -f "$R/local/SYNC-MANIFEST.md" ] && cp "$R/local/SYNC-MANIFEST.md" "$S/SYNC-MANIFEST.md"
echo MEMSYNC-OK
\`\`\`
看到 MEMSYNC-OK 只回「记忆同步完成」；哪步报错把错误贴回来。SYNC-MANIFEST.md 里标了哪些 skill 需本机凭据（pod 不可用），那些别硬用。`;
}

async function notifyKira(cfg) {
  try {
    await deps.yomi.sayToSession(kiraPullInstruction());
    cfg.pendingKiraNotify = false;
    return true;
  } catch (e) {
    cfg.pendingKiraNotify = true; // 本轮没通知上：下轮即使内容没变也补发
    log('系统', `记忆同步推送：git push 成功但通知 kira 失败（${e.message}），下轮补发`);
    return false;
  }
}

async function pushAll() {
  const cfg = syncCfg();
  const { files } = buildRepoBundle(home(), { envBoundExtra: cfg.envBoundExtra });
  if (!files.length) throw new Error('本地 memory/skills 都是空的，没东西可推');
  const token = gitlabToken();
  const urlOverride = typeof cfg.gitRemoteUrl === 'string' && cfg.gitRemoteUrl.trim();
  if (!token && !urlOverride) throw new Error('没有 GitLab 凭证（config.sync.gitlabToken / GITLAB_TOKEN / glab 配置都拿不到）');
  const br = ensureRepo(remoteUrl(token), token);
  // 远端有内容先对齐；空仓首次 fetch 必然失败，跳过即可。同步专用仓内容每轮重新生成，reset 不丢东西
  try {
    git(['fetch', 'origin', br], token);
    git(['reset', '--hard', `origin/${br}`], token);
  } catch {}
  const localDir = path.join(repoDir(), 'local');
  fs.rmSync(localDir, { recursive: true, force: true });
  for (const f of files) atomicWrite(path.join(localDir, f.path), f.content);
  git(['add', '-A', 'local/'], token);
  if (!git(['diff', '--cached', '--name-only'], token).trim()) {
    let detail = '内容无变化，本轮不推';
    if (cfg.pendingKiraNotify && (await notifyKira(cfg))) detail += '，已补发 kira 拉取通知';
    log('系统', `记忆同步推送：${detail}`);
    return { ok: true, detail, changed: false };
  }
  git(['-c', 'user.name=kira-pet', '-c', 'user.email=kira-pet@local', 'commit', '-m',
    `memsync: ${new Date().toISOString()}（${files.length} 个文件）`], token);
  git(['push', 'origin', `HEAD:${br}`], token);
  const notified = await notifyKira(cfg);
  const detail = `${files.length} 个文件已推到 gaobo/kira-memsync:${br}${notified ? '，已通知 kira 拉取' : '（通知 kira 失败，下轮补发）'}`;
  log('系统', `记忆同步推送完成：${detail}`);
  return { ok: true, detail, changed: true };
}

// ---------- 一轮同步 ----------
async function runNow(trigger) {
  const cfg = syncCfg();
  if (running) return { ok: false, error: '上一轮还没跑完' };
  if (!deps || !deps.yomi || deps.yomi.getState().status !== 'online') {
    const result = { t: Date.now(), trigger, skipped: 'kira 未连接' };
    cfg.lastRun = result;
    if (deps && deps.persist) deps.persist();
    log('系统', '记忆同步跳过：kira 未连接');
    notify();
    return { ok: false, skipped: true };
  }
  running = true;
  notify();
  log('系统', `记忆同步开始（${trigger === 'manual' ? '手动触发' : '定时'}）`);
  const result = { t: Date.now(), trigger };
  try {
    result.pull = await pullProfile();
  } catch (e) {
    result.pull = { ok: false, error: e.message };
    log('系统', `记忆同步拉取失败：${e.message}`);
  }
  try {
    result.push = await pushAll();
  } catch (e) {
    result.push = { ok: false, error: e.message };
    log('系统', `记忆同步推送失败：${e.message}`);
  }
  running = false;
  muteUntil = Date.now() + 15000; // 吞掉迟到的同步应答
  cfg.lastRun = result;
  if (deps && deps.persist) deps.persist();
  notify();
  return { ok: true, pull: result.pull, push: result.push };
}

// ---------- 调度：启动 5 分钟首轮，之后按 intervalHours ----------
function start() {
  stop();
  const cfg = syncCfg();
  if (!cfg.enabled) return;
  firstTimer = setTimeout(() => {
    firstTimer = null;
    runNow('timer').catch(() => {});
    intervalTimer = setInterval(() => runNow('timer').catch(() => {}), cfg.intervalHours * 3600 * 1000);
    if (intervalTimer.unref) intervalTimer.unref();
  }, FIRST_RUN_DELAY);
  if (firstTimer.unref) firstTimer.unref();
}

function stop() {
  if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
}

// 设置页改动：落盘 + 重排定时器（enabled/intervalHours 即时生效）
function setConfig(patch) {
  const cfg = syncCfg();
  if (typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled;
  if (patch.intervalHours > 0) cfg.intervalHours = Math.max(1, Math.min(168, patch.intervalHours)); // 主进程侧夹紧：UI 是 1-168，IPC 不能放进秒级轮询
  if (Array.isArray(patch.envBoundExtra)) cfg.envBoundExtra = patch.envBoundExtra;
  if (deps && deps.persist) deps.persist();
  start();
  notify();
  return getState();
}

module.exports = {
  init, start, stop, getState, setConfig, runNow, isActive,
  // 纯函数导出（mock 测试用）
  atomicWrite, ensureMemoryPointer, isEnvBound, buildRepoBundle, kiraPullInstruction, gitlabToken,
  PROFILE_FILES, POINTER_LINE, REMOTE_PROFILE_DIR,
};
