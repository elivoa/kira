# 动作扩展契约（src/ext/）

新动作 = 一个独立文件落地，不改任何已有文件：

- `ext/<id>.js`：桌宠侧动作逻辑，`index.html` 已在 `renderer.js` 之前预声明加载。
- `ext/ov_<id>.js`：可选，全屏覆盖层特效，`overlay.html` 已在 `overlay.js` 之后预声明加载。
- `actions.js` 已登记 32 个 id（name/forms/intrusive/w/auto），设置页、待机随机池、大模型决策自动可见。
- `<id>.js` 未落地前该动作等于不存在：待机随机池/大模型决策池按 `DISPATCH` 有无实现过滤，星盘菜单点到也空转，不会报错；文件一落地全链路自动生效。

## registerAction(def)（core.js 提供，全局可调）

```js
registerAction({
  id: 'follow',               // 必填，与 actions.js 的 key 一致
  lines: ['台词1', '台词2'],   // 可选，注册时并入 LINES.follow
  effect: { jing: -2, mood: 3 }, // 可选，触发时结算一次（addStat）；不进 EFFECTS 主表，不参与 canAfford 预检
  start(ctx) {},              // 必填：动作入口，相当于内置的 doXxx；菜单/随机池/大模型触发都从这里进
  tick(state, dt, t, ctx) {}, // 可选：自定义状态的每帧处理；state 不是自己的就 return false
  monitor(ctx) {},            // 可选：数值心跳里每秒左右调一次，条件触发类动作（w:0 auto:false 的那几个）用
});
```

触发链：`DISPATCH[id]()` → 先结算 `effect` → 调 `start(ctx)`。`start` 里通常 `ctx.enter('<id>', 时长)` 切到自己的状态，之后每帧由 `tick` 接管。

## ctx 字段表

| 字段 | 说明 |
| --- | --- |
| `enter(next, dur)` / `say(text, ms)` | 状态切换 / 冒气泡台词 |
| `logEvent(type, text)` / `addStat(key, delta)` | 写日志 / 改数值 |
| `stats` | 数值对象引用（jing/qi/shen/mood/touming），只读为主 |
| `moveBy(dx, dy)` / `getPos()` / `getStage()` | 窗口移动（相对/绝对坐标/工作区） |
| `getCursor()` / `activeWindow()` / `inputContext()` | 光标 / 前台窗口 / {typing, caret, active} |
| `swapSprite(src)` | 换立绘（记得预加载新图） |
| `fxBurst(x,y)` / `fxText(str,x,y,size)` / `fxEl(tag,attrs,cls,parent?)` | 窗口内漫画特效（340×620 逻辑画幅） |
| `walkAnimAdvance(px)` | 按位移推走路帧（仅 normal 形态生效，返回 false 时要自己颠簸） |
| `fxStart(kind, data)` | 触发 overlay 特效；`data.x/data.y` 若存在按屏幕绝对坐标处理，主进程自动换算 |
| `onFxDone(fn)` | 订阅 overlay 特效结束回执，`fn(kind)` |
| `onArrowKey(fn)` | 方向键回调 |
| `rand(a,b)` / `pick(arr)` / `nextIdleWait(a,b)` | 工具函数 |
| `tf` | 变换写出对象：`{tx, ty, rot, rotY, sx, sy, skew}`，tick 里改写，返回 true 后当帧生效 |
| `state` / `stateT` / `stateDur` / `form` | 只读 getter：当前状态/已进行秒数/总时长/形态 |
| `idleWait`（get/set）/ `lastInteract`（get） | 待机间隔 / 最近互动时间戳（秒） |

## registerOvFx(kind, fn)（overlay.js 提供，全局可调）

```js
// ext/ov_<id>.js 里：
registerOvFx('snow', (data) => {
  // data 即 renderer 侧 fxStart 的 data（x/y 已换算成覆盖层坐标）
  // 可用的全局：el(tag, attrs, parent)、smoothPath(pts)、ovlK、innerWidth/innerHeight
  // 特效结束必须调 window.pet.fxDone('snow')
});
```

桌宠侧配合：`ctx.fxStart('snow', {...})` 起特效，`ctx.onFxDone((kind) => ...)` 收回执。

## 最小示例

```js
// ext/stretch.js
registerAction({
  id: 'stretch',
  lines: ['嗯——伸个懒腰！', '好舒服~'],
  effect: { jing: 2, mood: 2 },
  start(ctx) {
    ctx.say(ctx.pick(LINES.stretch), 1500); // lines 注册时已并入全局 LINES
    ctx.enter('stretch', 2.2);
  },
  tick(state, dt, t, ctx) {
    if (state !== 'stretch') return false;
    const k = Math.min(ctx.stateT / ctx.stateDur, 1);
    ctx.tf.sy = 1 + 0.12 * Math.sin(k * Math.PI); // 拉高再弹回
    if (ctx.stateT >= ctx.stateDur) {
      ctx.enter('idle');
      ctx.idleWait = ctx.nextIdleWait(3, 6);
    }
    return true;
  },
});
```

## 收尾纪律（不遵守会出卡在半空/特效残留的事故）

1. 动作结束必须 `ctx.enter('idle')` 并顺手 `ctx.idleWait = ctx.nextIdleWait(a, b)`——状态机没有针对扩展状态的兜底，不切走就永远卡住。
2. overlay 特效结束必须 `window.pet.fxDone(kind)`；桌宠侧若开了 rAF/计时器等回执，回执里清理。
3. 自己的 `setTimeout/setInterval/requestAnimationFrame` 自己清理；`enter()` 不会替扩展动作擦屁股。
4. rAF 循环必须有超时 + 异常兜底，参照 overlay.js `flySword` 的 watchdog 模式：硬超时强制收尾、帧回调 try/catch、setInterval 墙钟推进兜底（rAF 停摆时）。
5. tick 里先判 `if (state !== '<自己的状态>') return false;`——所有扩展的 tick 每帧都会被问到。
6. monitor 里触发动作前先看 `ctx.state === 'idle'`（别打断进行中的动作）；触发走全局 `DISPATCH['<id>']()`——与菜单/随机池同一条链，effect 自动结算，不要直接调自己的 `start`。
