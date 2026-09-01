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
  openNotebook: () => ipcRenderer.send('open-notebook'),
  notebookSay: (text) => ipcRenderer.send('notebook-say', text),
  onNotebookSay: (fn) => ipcRenderer.on('notebook-say', (_e, text) => fn(text)),
  onNotebookTab: (fn) => ipcRenderer.on('notebook-tab', (_e, tab) => fn(tab)),
  findLedge: () => ipcRenderer.invoke('find-ledge'),
  ovIgnore: (flag) => ipcRenderer.send('ov-ignore', flag),
  mischiefStart: () => ipcRenderer.send('mischief-start'),
  mischiefDone: () => ipcRenderer.send('mischief-done'),
  onMischief: (fn) => ipcRenderer.on('fx-mischief', (_e, data) => fn(data)),
  onMischiefEnd: (fn) => ipcRenderer.on('mischief-end', () => fn()),
  nbMin: () => ipcRenderer.send('nb-min'),
  nbResizeStart: () => ipcRenderer.send('nb-resize-start'),
  nbResizeMove: () => ipcRenderer.send('nb-resize-move'),
  nbResizeEnd: () => ipcRenderer.send('nb-resize-end'),
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
