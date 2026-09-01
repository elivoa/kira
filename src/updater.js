// 轻量自动更新：查 GitHub Releases 的 latest-mac.yml，发现新版后台下载 zip，
// 用户确认后起一个 detached shell 脚本等本进程退出，替换 .app 并重新打开。
// 不走 electron-updater 是因为它强制要求 Apple Developer ID 签名（$99/年），未签名应用更新不落盘。
const { app, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// 与 package.json build.publish 保持一致
const REPO = 'elivoa/kira';
const LATEST_YML_URL = `https://github.com/${REPO}/releases/latest/download/latest-mac.yml`;

let log = () => {};
let say = () => {};
let onState = () => {};
let state = { phase: 'idle', version: null, zip: null }; // idle/checking/downloading/ready

function setState(s) {
  state = s;
  onState(getState());
}

function init(hooks) {
  log = hooks.log || log;
  say = hooks.say || say;
  onState = hooks.onState || onState;
}

// https GET，跟随 302；dest 给了就写文件，否则收 buffer 返回字符串
function fetch(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'kira-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error('重定向次数过多'));
        return resolve(fetch(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (!dest) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
        res.on('error', reject);
        return;
      }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', reject);
    }).on('error', reject);
  });
}

function semverGt(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) await dialog.showMessageBox({ message: '开发模式不检查更新', detail: '打包安装后才会启用自动更新。' });
    return;
  }
  if (state.phase === 'checking' || state.phase === 'downloading') return;
  if (state.phase === 'ready') {
    const r = await dialog.showMessageBox({
      type: 'info',
      message: `Kira v${state.version} 已下载完成`,
      detail: '立即重启完成更新？（约几秒钟）',
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) applyUpdate();
    return;
  }
  setState({ phase: 'checking', version: null, zip: null });
  try {
    const yml = await fetch(LATEST_YML_URL);
    const latest = (yml.match(/^version:\s*(\S+)/m) || [])[1];
    const file = (yml.match(/^\s+-?\s*url:\s*(\S+)/m) || [])[1] || (yml.match(/^path:\s*(\S+)/m) || [])[1];
    if (!latest || !file) throw new Error('latest-mac.yml 解析失败');
    if (!semverGt(latest, app.getVersion())) {
      setState({ phase: 'idle', version: null, zip: null });
      log('更新', `已是最新版本 v${app.getVersion()}`);
      if (manual) await dialog.showMessageBox({ message: `已是最新版本（v${app.getVersion()}）` });
      return;
    }
    log('更新', `发现新版本 v${latest}（当前 v${app.getVersion()}），开始后台下载`);
    say(`发现新版本 v${latest}！我这就去下载～`);
    setState({ phase: 'downloading', version: latest, zip: null });
    const zip = path.join(os.tmpdir(), `kira-update-${latest}.zip`);
    await fetch(`https://github.com/${REPO}/releases/latest/download/${file}`, zip);
    setState({ phase: 'ready', version: latest, zip });
    log('更新', `v${latest} 下载完成，等待重启更新`);
    say(`新版本 v${latest} 下载好了，重启一下就能换新装！`);
    const r = await dialog.showMessageBox({
      type: 'info',
      message: `Kira v${latest} 已下载完成`,
      detail: '立即重启完成更新？（约几秒钟）',
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) applyUpdate();
  } catch (e) {
    setState({ phase: 'idle', version: null, zip: null });
    log('更新', `检查更新失败：${e.message}`);
    if (manual) await dialog.showMessageBox({ type: 'warning', message: '检查更新失败', detail: e.message });
  }
}

// 解压 zip，spawn detached 替换脚本后退出本进程
async function applyUpdate() {
  if (state.phase !== 'ready') return;
  try {
    const target = path.resolve(app.getPath('exe'), '..', '..', '..'); // Kira.app
    const extractDir = path.join(os.tmpdir(), `kira-update-${state.version}`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    await new Promise((resolve, reject) =>
      execFile('/usr/bin/ditto', ['-x', '-k', state.zip, extractDir], (err) => (err ? reject(err) : resolve())));
    const appName = fs.readdirSync(extractDir).find((f) => f.endsWith('.app'));
    if (!appName) throw new Error('更新包里没有 .app');
    const newApp = path.join(extractDir, appName);

    const script = [
      '#!/bin/bash',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      'sleep 0.5',
      // 目标目录可写就直接换；装 /Applications 且无权限时弹一次系统授权框
      `if [ -w "${target}" ] && [ -w "$(dirname "${target}")" ]; then`,
      `  rm -rf "${target}.old" && mv "${target}" "${target}.old" && cp -R "${newApp}" "${target}" && xattr -dr com.apple.quarantine "${target}"`,
      'else',
      `  osascript -e 'do shell script "rm -rf \\"${target}.old\\" && mv \\"${target}\\" \\"${target}.old\\" && cp -R \\"${newApp}\\" \\"${target}\\" && xattr -dr com.apple.quarantine \\"${target}\\"" with administrator privileges'`,
      'fi',
      // 替换成功后清掉旧版备份（失败了留着 .old 还能手动回滚，所以只在 cp 成功时清）
      `[ -d "${target}" ] && rm -rf "${target}.old"`,
      `open "${target}"`,
    ].join('\n');
    const scriptPath = path.join(extractDir, 'apply.sh');
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref();
    log('更新', '重启应用完成更新…');
    app.quit();
  } catch (e) {
    setState({ phase: 'idle', version: null, zip: null });
    log('更新', `更新失败：${e.message}`);
    await dialog.showMessageBox({ type: 'error', message: '更新失败', detail: e.message });
  }
}

function getState() {
  return { ...state, current: app.getVersion() };
}

module.exports = { init, checkForUpdates, applyUpdate, getState };
