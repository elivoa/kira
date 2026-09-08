const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  moveBy: (dx, dy) => ipcRenderer.send('move-by', dx, dy),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  openMenu: () => ipcRenderer.send('context-menu'),
  getPos: () => ipcRenderer.invoke('get-pos'),
  getCursor: () => ipcRenderer.invoke('get-cursor'),
  onArrowKey: (fn) => ipcRenderer.on('arrow-key', () => fn()),
  getStage: () => ipcRenderer.invoke('get-stage'),
  throwPoop: () => ipcRenderer.send('poop'),
  onPoop: (fn) => ipcRenderer.on('fx-poop', (_e, data) => fn(data)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  setActions: (patch) => ipcRenderer.send('set-actions', patch),
  onSettings: (fn) => ipcRenderer.on('settings-changed', (_e, s) => fn(s)),
  getStats: () => ipcRenderer.invoke('get-stats'),
  saveStats: (s) => ipcRenderer.send('save-stats', s),
  logAppend: (entry) => ipcRenderer.send('log-append', entry),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.send('clear-logs'),
  onLog: (fn) => ipcRenderer.on('log-new', (_e, entry) => fn(entry)),
  setMouseIgnore: (flag) => ipcRenderer.send('mouse-ignore', flag),
  swordStart: () => ipcRenderer.send('sword-start'),
  swordDone: () => ipcRenderer.send('sword-done'),
  onSword: (fn) => ipcRenderer.on('fx-sword', (_e, data) => fn(data)),
  onSwordEnd: (fn) => ipcRenderer.on('sword-end', () => fn()),
  driveStart: () => ipcRenderer.send('drive-start'),
  driveDone: () => ipcRenderer.send('drive-done'),
  onDrive: (fn) => ipcRenderer.on('fx-drive', (_e, data) => fn(data)),
  onDriveEnd: (fn) => ipcRenderer.on('drive-end', () => fn()),
  peekStart: () => ipcRenderer.send('peek-start'),
  peekDone: () => ipcRenderer.send('peek-done'),
  onPeek: (fn) => ipcRenderer.on('fx-peek', (_e, data) => fn(data)),
  onPeekEnd: (fn) => ipcRenderer.on('peek-end', () => fn()),
  openNotebook: (tab) => ipcRenderer.send('open-notebook', tab),
  notebookSay: (text) => ipcRenderer.send('notebook-say', text),
  onNotebookSay: (fn) => ipcRenderer.on('notebook-say', (_e, text) => fn(text)),
  onNotebookTab: (fn) => ipcRenderer.on('notebook-tab', (_e, tab) => fn(tab)),
  findLedge: () => ipcRenderer.invoke('find-ledge'),
  ovIgnore: (flag) => ipcRenderer.send('ov-ignore', flag),
  mischiefStart: () => ipcRenderer.send('mischief-start'),
  mischiefDone: () => ipcRenderer.send('mischief-done'),
  onMischief: (fn) => ipcRenderer.on('fx-mischief', (_e, data) => fn(data)),
  onMischiefEnd: (fn) => ipcRenderer.on('mischief-end', () => fn()),
  // 扩展特效通用通道：以后新 overlay 特效只走 fx-ext，不再加专用 IPC。
  // data.x/data.y 约定为屏幕绝对坐标，主进程换算成覆盖层坐标后转发
  fxStart: (kind, data) => ipcRenderer.send('fx-ext', kind, data),
  onFxExt: (fn) => ipcRenderer.on('fx-ext', (_e, kind, data) => fn(kind, data)),
  // seq 可选：特效会话令牌（防打断后重开时旧回执串台），不带 seq 的老特效不受影响
  fxDone: (kind, seq) => ipcRenderer.send('fx-ext-done', kind, seq),
  onFxExtDone: (fn) => ipcRenderer.on('fx-ext-done', (_e, kind, seq) => fn(kind, seq)),
  // 攀爬安全绳：桌宠侧报腰间坐标，覆盖层侧收坐标画绳/收绳
  ropeStart: (d) => ipcRenderer.send('rope-start', d),
  ropeMove: (d) => ipcRenderer.send('rope-move', d),
  ropeEnd: () => ipcRenderer.send('rope-end'),
  onRope: (fn) => ipcRenderer.on('rope-update', (_e, d) => fn(d)),
  onRopeEnd: (fn) => ipcRenderer.on('rope-clear', () => fn()),
  nbMin: () => ipcRenderer.send('nb-min'),
  nbResizeStart: () => ipcRenderer.send('nb-resize-start'),
  nbResizeMove: () => ipcRenderer.send('nb-resize-move'),
  nbResizeEnd: () => ipcRenderer.send('nb-resize-end'),
  getNotebookBounds: () => ipcRenderer.invoke('get-notebook-bounds'),
  chatSend: (text, id) => ipcRenderer.invoke('chat-send', text, id),
  chatInject: (userText, replyText) => ipcRenderer.invoke('chat-inject', userText, replyText),
  // 流式 token 订阅，返回取消订阅函数
  onChatToken: (fn) => {
    const h = (_e, data) => fn(data);
    ipcRenderer.on('chat-token', h);
    return () => ipcRenderer.removeListener('chat-token', h);
  },
  chatHistory: () => ipcRenderer.invoke('chat-history'),
  chatProactive: () => ipcRenderer.invoke('chat-proactive'),
  getHistoryDays: () => ipcRenderer.invoke('history-days'),
  getHistoryDay: (key) => ipcRenderer.invoke('history-day', key),
  getChatConfig: () => ipcRenderer.invoke('get-chat-config'),
  setChatConfig: (patch) => ipcRenderer.send('set-chat-config', patch),
  // 飞书机器人
  getFeishuConfig: () => ipcRenderer.invoke('get-feishu-config'),
  setFeishuConfig: (patch) => ipcRenderer.send('set-feishu-config', patch),
  getFeishuLog: () => ipcRenderer.invoke('get-feishu-log'),
  feishuSend: (text) => ipcRenderer.invoke('feishu-send', text),
  getFeishuHistory: () => ipcRenderer.invoke('feishu-history'),
  feishuHandshake: () => ipcRenderer.invoke('feishu-handshake'),
  // kira 链接（yomi wire 协议）
  getYomiConfig: () => ipcRenderer.invoke('get-yomi-config'),
  setYomiConfig: (patch) => ipcRenderer.send('set-yomi-config', patch),
  yomiSend: (text) => ipcRenderer.invoke('yomi-send', text),
  yomiListSessions: () => ipcRenderer.invoke('yomi-list-sessions'),
  yomiHistory: () => ipcRenderer.invoke('yomi-history'),
  onYomiStatus: (fn) => ipcRenderer.on('yomi-status', (_e, s) => fn(s)),
  // kira 消息泡泡（独立窗口）
  onKiraBubbleShow: (fn) => ipcRenderer.on('kira-bubble-show', (_e, d) => fn(d)),
  kiraBubbleDismiss: () => ipcRenderer.send('kira-bubble-dismiss'),
  kiraBubbleOpen: () => ipcRenderer.send('kira-bubble-open'),
  kiraBubbleIgnore: (flag) => ipcRenderer.send('kb-ignore', flag),
  kbOpenLink: (href) => ipcRenderer.send('kb-open-link', href),
  // 归一化飞书消息（事件/轮询/小本子发言的回答）：{t, role, content, id, source}
  onFeishuMsg: (fn) => {
    const h = (_e, m) => fn(m);
    ipcRenderer.on('feishu-msg', h);
    return () => ipcRenderer.removeListener('feishu-msg', h);
  },
  onFeishuStatus: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on('feishu-status', h);
    return () => ipcRenderer.removeListener('feishu-status', h);
  },
  onFeishuLog: (fn) => {
    const h = (_e, d) => fn(d);
    ipcRenderer.on('feishu-log-new', h);
    return () => ipcRenderer.removeListener('feishu-log-new', h);
  },
  // 飞书来消息（桌宠窗口冒泡提醒用）
  onFeishuIncoming: (fn) => ipcRenderer.on('feishu-incoming', (_e, d) => fn(d)),
  decideAction: (ctx) => ipcRenderer.invoke('decide-action', ctx),
  onMenuAction: (fn) => ipcRenderer.on('menu-action', (_e, id) => fn(id)),
  onPowerState: (fn) => ipcRenderer.on('power-state', (_e, d) => fn(d)),
  getPowerState: () => ipcRenderer.invoke('get-power-state'),
  activeWindow: () => ipcRenderer.invoke('active-window'),
  inputContext: () => ipcRenderer.invoke('input-context'),
  getPathForFile: (f) => webUtils.getPathForFile(f),
  folderDrop: (p) => ipcRenderer.send('folder-drop', p),
  // 星盘右键菜单（overlay 侧）
  onMenuOpen: (fn) => ipcRenderer.on('menu-open', (_e, data) => fn(data)),
  menuSelect: (id) => ipcRenderer.send('menu-select', id),
  menuClosed: () => ipcRenderer.send('menu-closed'),
  // 气泡独立窗口：桌宠侧发台词/锚点/收关闭回执，气泡侧收台词/缩放、报穿透与关闭
  bubbleSay: (data) => ipcRenderer.send('bubble-say', data),
  bubbleAnchor: (a) => ipcRenderer.send('bubble-anchor', a),
  onBubbleSay: (fn) => ipcRenderer.on('bubble-say', (_e, d) => fn(d)),
  onBubbleScale: (fn) => ipcRenderer.on('bubble-scale', (_e, s) => fn(s)),
  bubbleIgnore: (flag) => ipcRenderer.send('bubble-ignore', flag),
  bubbleDismiss: () => ipcRenderer.send('bubble-dismissed'),
  onBubbleDismissed: (fn) => ipcRenderer.on('bubble-dismissed', () => fn()),
  bubbleHidden: () => ipcRenderer.send('bubble-hidden'),
  onBubbleHidden: (fn) => ipcRenderer.on('bubble-hidden', () => fn()),
});
