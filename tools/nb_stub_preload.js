// notebook 调试页截图验证用的桩 preload：window.pet 显式方法表（contextBridge 克隆不了 Proxy）
const { contextBridge } = require('electron');

const noop = () => {};
const pObj = (v) => () => Promise.resolve(v);

contextBridge.exposeInMainWorld('pet', {
  chatHistory: pObj([]),
  chatSend: pObj({}),
  checkUpdate: pObj({}),
  clearLogs: noop,
  feishuHandshake: pObj({}),
  feishuSend: pObj({}),
  getChatConfig: pObj({}),
  getFeishuConfig: pObj({}),
  getFeishuHistory: pObj([]),
  getFeishuLog: pObj({ logs: [] }),
  getYomiConfig: pObj({ unlocked: true, enabled: true, wsUrl: 'wss://niko-gaobo-ws.dev.kimi.team', sessionId: 'sess_test', status: 'online' }),
  yomiSend: pObj({ ok: true }),
  yomiListSessions: pObj([]),
  yomiHistory: pObj([]),
  onYomiStatus: () => noop,
  getHistoryDay: pObj([]),
  getHistoryDays: pObj([]),
  getLogs: pObj([]),
  getSettings: pObj({}),
  getVersion: pObj('0.0.0-test'),
  logAppend: noop,
  menuSelect: (id) => { document.title = 'SELECT:' + id; },
  nbMin: noop,
  nbResizeEnd: noop,
  nbResizeMove: noop,
  nbResizeStart: noop,
  notebookSay: noop,
  onChatToken: () => noop,
  onFeishuMsg: () => noop,
  onFeishuStatus: () => noop,
  onLog: () => noop,
  onNotebookTab: () => noop,
  setActions: noop,
  setChatConfig: noop,
  setFeishuConfig: noop,
});
