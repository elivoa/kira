
const { contextBridge } = require('electron');
let showFn = null;
contextBridge.exposeInMainWorld('pet', {
  onKiraBubbleShow(fn) { showFn = fn; },
  kiraBubbleDismiss() { document.title = 'DISMISS'; },
  kiraBubbleOpen() { document.title = 'OPEN'; },
  kiraBubbleIgnore() {},
  __fire(text) { if (showFn) showFn({ text }); },
});
