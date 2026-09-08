// 动作扩展机制核心：在 renderer.js 之前加载。
// ext/<id>.js 只负责调 registerAction(def) 登记；何时触发、每帧怎么走、心跳怎么监控，
// 全由 renderer.js 消费 EXT_ACTIONS 决定。契约细节见 ext/README.md
window.EXT_ACTIONS = window.EXT_ACTIONS || {};

// def = {
//   id: 'follow',                与 actions.js 的 key 一致
//   lines: ['…'],                可选，并入 LINES[id]
//   effect: { jing: -2 },        可选，触发时结算一次（addStat）
//   start(ctx) {},               必选，动作入口（相当于内置的 doXxx）
//   tick(state, dt, t, ctx) {},  可选，自定义状态每帧处理，返回 true 表示本帧已接管
//   monitor(ctx) {},             可选，数值心跳里每秒左右调一次，条件触发类动作用
// }
function registerAction(def) {
  if (!def || !def.id || typeof def.start !== 'function') return;
  // 重复注册按文件名序后到的赢，不吭声很难查，至少留个警告
  if (window.EXT_ACTIONS[def.id]) console.warn(`[ext] 动作「${def.id}」被重复注册，后者覆盖前者`);
  window.EXT_ACTIONS[def.id] = def;
}
window.registerAction = registerAction;
