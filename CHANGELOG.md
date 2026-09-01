# Changelog

## 2026-09-01

### 睡觉：一直睡到被叫醒

- 自主入睡不再定时自醒（原 14~22s 自动起床），和菜单哄睡一致改成无限时：不戳/不晃就一直睡；叫醒方式不变（连点 8 下、拎起来使劲晃、菜单）
- 睡姿轮换放慢：翻身间隔 6~9s → 15~25s

### 修：化身成剑/兜风偶尔永远卡死

- 根因（剑转圈回不来）：flySword 返航段速度恒定 1700px/s、转向速率有限（≈6 rad/s），转弯半径 ≈283px，比 50px 的到达判定圈大得多——接近家时角度不对就绕家转圈锁定，永远进不了到达圈。修复：返航速度随距离衰减（v = min(1700, max(dist*4, 240))），转弯半径 v/6 随距离缩小（近处 40 < 50），螺旋进家门，与 driveCar 接人段的减速思路一致
- 加固（帧循环鲁棒性）：flySword/driveCar 原实现帧循环全挂 rAF、无超时无异常兜底，循环一断 `swordDone`/`driveDone` 永远不发，桌宠侧卡在 swordwait/drivewait 永远隐身（全屏透明覆盖层在 macOS 上易被判定遮挡而停 rAF）。修复：桌宠窗口 + 覆盖层 `backgroundThrottling: false`；帧循环拆出 tick 加 400ms 定时器看门狗（位移全按墙钟结算，重复调用无害）+ 硬超时强制收尾 + try/catch 异常收尾；桌宠侧 swordwait/drivewait 加 30s 失联自愈

### 爬墙概率拴安全绳

- 向上爬（climbup）开始时有 30% 概率在腰间拴一根安全绳：下端钉在起爬点、上端跟着腰间位置爬升，复用捣乱那根软绳的 verlet 链条 + Catmull-Rom 平滑画法（没有捣乱的笔记本）；两端钉死、绳长比直线距离略长，垂出自然弧度
- 通道：桌宠侧节流（~14fps）报腰间屏幕坐标 → 主进程换算覆盖层坐标转发 → 覆盖层单实例绳层；离开 climbup 的任何路径（到顶/爬不动/被拖走/菜单切动作）都在 `enter()` 统一收绳淡出

### 星盘菜单右键 = 确定

- 菜单展开后，右键点在扇区环带/按钮/枢纽上与左键等价（激活/进入子层级/返回），不必换手；右键点空白处保留原行为（换位置重新展开）

### 小本子成为系统正常窗口

- 打开小本子（Kira Note）时 `app.dock.show()`：app 从 UIElement 后台代理变回普通前台应用，有 Dock 图标、能 Cmd+Tab 切到、Mission Control/窗口列表可见；关掉后 `app.dock.hide()` 恢复纯托盘形态
- 根因：桌宠/气泡/覆盖层三个窗口全是 `skipTaskbar: true`，Electron 会把整个 app 降为 UIElement（lsappinfo 实测验证），此前小本子即使开着也切不到

### 打包分发与自动更新

- electron-builder 出 macOS 安装包（dmg + zip，Apple Silicon），`npm run dist` 本机出包、`npm run release` 直接发 GitHub Releases（地址在 `package.json` 的 `build.publish`）
- `install.sh` 一键安装：`curl | bash` 下载最新 release 的 dmg 装到 /Applications 并去 Gatekeeper 隔离（应用未签名）；`--user` 装 ~/Applications 免管理员
- 自写轻量更新器 `src/updater.js`：启动 30s 后静默查 latest-mac.yml，发现新版后台下载 zip，气泡 + 弹窗确认后 detached shell 脚本等进程退出替换 .app 重启——不走 electron-updater 是因为它强制 Apple Developer ID 签名（$99/年），未签名应用更新不落盘
- 托盘菜单显示版本号 + 检查更新入口（有就绪更新时变为「重启更新到 vX」）；小本子配置页加版本号 + 检查更新按钮
- 打包适配：tools 三个 swift 二进制（windows/keys/caret）打进 asar.unpacked 随包分发；缺失时回退编译到 userData/tools（原逻辑写 asar 内只读路径必败）；启动编译由 `npm run build-tools` 统一负责
- 应用图标：chibi 设定图裁头部生成 build/icon.png

## 2026-08-31

### 走路序列帧换新素材

- 走路帧全部替换：新源视频（1176x1764@24fps，97 帧）走路段 f4~f96 全部 93 帧都用上，`tools/video_walk_frames.js` 直接复用抠图（裁框/背景模型与旧视频一致，人物并集 bbox 相同）
- 循环相位对齐：视频步态周期非整数（93 帧 ≈3.65 周期），首尾直接相接相位不同必跳。新增 `tools/walk_loop_align.js`：用脚底间距极小值定周期锚点（27/24/25 帧），各周期保持自然长度原样连接（**不复制帧**——复制帧是 42ms 冻结，表现为「第一步完美、第二步卡顿」，已踩坑）；首端（上周期末尾）与尾端（新周期开头）残段用同相位桥接成完整周期；**桥接相位须脚+胳膊双锁**——脚用 spread 波形（RGB 帧差对 ±2 帧相位误差不敏感不可用于选址；且 AI 视频手臂摆动与步频不同步，脚对上时胳膊可能反相——「每 4 步胳膊错乱」的根因），胳膊用上半身前缘 armSig，跨周期候选联合评分（本视频周期 B 桥接最优）→ 4 整周期共 100 帧，回卷 = 视频自身的连续帧；接点柔化/边缘雾清理由 `tools/walk_post.js` 完成。全帧步进均值 7.5，接点 9.9 均在自然步态家族内
- 步幅标定更新：支撑脚相对身体后移 ≈9.7 素材px/帧（头肩质心验证人物原地走），WALK_PX_PER_FRAME 12.3 → 5.9；WALK_N 24 → 100
- 步幅再标定（脚部实测，1s/帧前进合成图 + 40px 网格验证）：全帧运动量是错误信号（手臂/头发/裙摆占大头），底部鞋印连通块逐帧跟踪支撑脚，中位地速 7.4 素材px/帧 ≈ 4.54 显示px/帧——5.9 偏大 30% 导致支撑脚持续前滑（「腿一会在前一会在后」的根因）。WALK_PX_PER_FRAME 5.9 → 4.54，WALK_SPEED 140 → 109（≈24fps 自然率）。曾试 minterpolate 定点插帧 + WALK_VEL 变速推帧，效果不佳已撤回，最终只保留两个常数的修正
- 播放修复（「只有一半帧在生效」）：① WALK_SPEED 280 → 140，切帧节奏回到 ≈24fps 自然率（280 时 48fps，超出 38ms 交叉淡化设计节奏——index.html 注释里本就写着这个不变量——相邻帧互相涂抹）；② 走路帧相位不再每次 enter 重置 f01，100 帧长条靠多场走路接续播完；③ 各处翻牌过渡从固定 WALK_SRC[0] 改为当前相位帧，尾帧有机会出场
- 帧序列验证方法：`--remote-debugging-port=9222` 启动后 CDP hook `walkAnimAdvance` 记录 (t, fi)，可证伪序列级跳帧/冻结（本次 489 条日志：+1 步进全程完美，问题在内容衔接而非序列）
- 阴影闪烁修复（白底下阴影明暗抖动）：`#spriteX` 交叉淡化层不再挂 drop-shadow（此前淡出旧帧与新帧同时投影，每次切帧阴影加倍/恢复，24fps 下即闪烁）；`tools/walk_post.js` 顺带把 alpha<32 的边缘雾清零（不可见但参与投影计算）
- 测试设施：新增 `src/walk_test.html`（stub window.pet + 真实 renderer.js），配合 `tools/shot.js` 可脚本化驱动 doWalk 连续截图验证动作连续性

### 新动作「走到另一边」

- `walkfar`：朝更远那侧屏幕边缘一直走，到边翻牌转回正面停下；同款翻牌起步 + 走路帧（相位接续），走路帧状态集合纳入 `walkfar`
- 菜单「动作」分类、待机随机池（w=6）、大模型 `do_action` 工具 enum 同步加入；数值影响 jing-6/mood+2

### 散步到边缘即停

- 「走一走」此前到屏幕边缘后窗口被钳住但帧照切，等于原地干走；现在起步时记录边缘位置（getStage + getPos 异步），渲染层估计位移到边即停（mx 夹到 0），翻牌转回正面/回待机，与主进程钳制一致

### 动作切换图层叠加修复

- 桌子状态下切别的动作会叠图（桌子 SVG + 700px 放大立绘盖在新动作上）：`resetDesk` 原来只在右键菜单处理器里调，而自主 idleRandom、大模型决策的 DISPATCH 路径都绕过它。改为在 `enter()` 统一护栏：目标状态不在 desk/work 链内且 `#desk` 存在时一律 `resetDesk()`（撤桌 + 恢复立绘高度），覆盖所有切换路径

### 腿部抖动修复历程（结论：素材不动）

- 试过三种路线均被否后撤回：① minterpolate 插帧 + 全帧运动量变速表；② 接触点地速变速切帧；③ 素材侧鞋位移位校正（接触点掰恒速线，±19px 放开后鞋裙错位明显）
- 最终保留的只有**脚部实测标定**：WALK_PX_PER_FRAME 5.9 → 4.54、WALK_SPEED 140 → 109（鞋印跟踪中位地速 7.4 素材px/帧，支撑脚前滑 30% 的根因修正），素材本身不做任何变形

### 脚部残影清理

- 新增 `tools/walk_feet_clean.js`：抠图在鞋周留下一圈半透明中性灰雾边（白底像地影、黑底发光，新 MR 的阴影余量让它更显眼）+ 零星噪点。清理规则只动 y>700 脚部区：① 半透明（alpha 16~240）且中性灰（sp<25）且非亮白（min<210）的清零——白袜/金饰/裙蕾丝不受影响；② 不与主体相连的 <30px 孤立小团清零。全片清灰雾 6.8 万 px、噪点 2.7 千 px，鞋边变利落

## 2026-08-25

### 聊天流式输出

- Kimi API 改为 SSE 流式请求，回答逐 token 实时渲染；token 带请求 id，防并发串话
- 请求改用 Node `https` 模块：Electron 主进程全局 fetch 走 Chromium network service，在 SSE 长连接上会崩（流空读、回复丢失）
- 请求加 `thinking: {type: 'disabled'}`：模型思考走 `reasoning_content` 通道不进正文，会把 max_tokens 烧光导致整段空白；同时保留 reasoning 作为兜底；max_tokens 300 → 800 防长回复截断

### 独立流式渲染模块 `src/markdown-stream.js`

- 块级增量渲染：追加式输出只有最后一个顶层块会变，已封口块渲染一次即冻结，每 token 只重渲尾块
- markdown-it（CommonMark）+ KaTeX：支持 inline/block 公式（`$…$`/`$$…$$`/`\(…\)`/`\[…\]`），`throwOnError: false` 半截公式不炸
- 平滑吐字：移植 kimiapi `packages/x/stream/smoother.go` 的 PD 控制器（Kp=0.8 / Kd=0.4 / 目标水位 40 字 / 乘性因子 1.05），按缓冲水位自适应吐字节奏，服务端突发不跳变、枯竭不抢跑；MAX_DELAY 90ms（约为 kimiapi 的 1.7 倍速）
- 等待期「正在输入…」呼吸点动画

### 星盘右键菜单

- 原生菜单替换为 overlay 全屏层上的径向菜单：以点击处为圆心展开，锚定屏幕不随人物移动
- 一级 4 分类（动作/变身/玩耍/法宝）+ ✕ 取消，点击分类扩展二级圆环，中心枢纽 ✦/↩ 返回
- 动效：错峰弹射飞出、悬停发光、图标呼吸、双虚线环反向旋转、缩回圆心关闭
- 层级：菜单期间 overlay 提为 screen-saver relativeLevel+1 压过人物（Electron 的 dock 级实际更低，勿用），关闭后复原；菜单期间不点击穿透；10s 无人碰自动关闭

### 笔记本（Kira Note）

- 窗口位置/大小持久化到 `~/.config/kira/config.json` 的 `notebookBounds`，重开恢复，离屏自动回退
- 设置窗口并入「配置」页签（Kimi key、动作开关/频率/点击穿透），删除独立 settings 窗口
- 聊天历史迁移到 `~/.config/kira/chat-history.json`

### 聊天历史按日分文件 + 历史页签

- 存储改为 `~/.config/kira/history/YYYY-MM-DD.json` 每天一个文件；旧单文件历史迁移为 `legacy.json`（页内显示「更早」）
- 新增「历史」页签：默认只显示最近 2 天，不同日期用日期 banner 隔开（今天/昨天带标注）
- 右缘 Time Machine 式导航条：日期圆点竖排，hover 展开信息卡（日期/条数/首条提问预览）；点日期只看那一天，再点返回最近 2 天

### 修复

- `open-notebook` 把 IPC event 当 tab 透传，`did-finish-load` 时 send 序列化失败打挂主进程（从桌宠侧打开笔记本必崩）
