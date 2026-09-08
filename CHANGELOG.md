# Changelog

## 2026-09-07

### kira 消息泡泡（独立窗口）

- kira 的回答改走一个新的独立窗口 `kira_bubble.html`（星空紫渐变 + 呼吸光晕，与主动搭话粘性气泡同款 UI、无边框圆角带尾巴），不再用跟随人物的粘性气泡
- 初始位置定在人物头顶上方后**锁死不再跟随**（anchorKiraBubble 只锚一次）；框的边缘可拖动（-webkit-app-region: drag，文字部分 no-drag）；内容 markdown 渲染且**可选中**（user-select: text）；单击（没选中文字时）关闭，双击直达小本子 kira tab
- 截图工具 `tools/kira_bubble_shot.js`（桩 preload 验证渲染，注意透明窗口 capturePage 空白是 macOS 特性，截图要加底色）

### 主菜单加「Kira」入口（配置好才显示）

- 一级菜单在「小本子」前动态插入 🤖 Kira：只有 config.yomi 配置好（unlocked + enabled + wsUrl）才出现；点开直达小本子的 kira 对话 tab。配置缓存每次开菜单时后台刷新
- 机器人 tab 显隐同步放宽：在线或配置好（启用+地址+会话）都显示，不再只有在线才亮

### 星盘菜单支持「按住右键拖拽，松手选中」标记菜单交互

- 按住右键移动：扇形照常高亮（已有 hover）；松手时扇形在环带上就激活（点分类进子层、点叶子直接触发），松手位置在圆心小圆（半径 26px 内）就不算点击（取消语义，菜单留着）
- 右键在扇形上的激活从 contextmenu 按下挪到 mouseup 松手（避免按下/松手双重触发）；左键行为不变

### kira 气泡色调：哑光石板蓝

- 暗色皮肤下原浅底渐变太白刺眼。调成哑光石板蓝渐变（#c3c9de→#a8b0cc + #8f97b8 边 + #23263a 字）——比我的深底亮但不晃眼，同一石板色系浑然一体

### kira tab 滚动分页

- 全量历史缓存在 botHistory，首屏只渲染最新 15 条（不再一次全渲）；滚到顶部动态加载更早的一批（15 条/批，保持视口不跳），到顶显示「没有更早的消息」

### 修：打开小本子时 kira tab 不显示

- loadYomiConfig 原来只在切到配置页时调，打开小本子时 yomiState 停在初始 'off'，tab 被藏，点一下设置页才出现。打开本子时就调一次（跟 loadFeishuConfig 同排）——配置好就一直有

### 机器人消息：markdown 渲染 + kira 浅底左对齐

- 根因：ListMessages 的 role 字段是 `kind` 不是 `role`，listMessages 映射全错，kira 的历史消息全被错标为「我」——所以 markdown 全走了 textContent 原文显示。改用 `m.kind` 判定；tool 类消息（psql/logcli 原始输出）不上屏
- 背景互换：kira 消息浅底渐变左对齐、我的消息深底右对齐（原 kira 深底、我浅底）
- 注：MarkdownStream 渲染引擎（markdown-it + KaTeX）本来就在，这次只是角色分类修对了

### 修：kira 连接器「发完就跑」——常驻连接 + 回推解析 + 心跳保活

- 根因三层：① 回推事件解析错了——这个 daemon 版本的 assistant 文本走 `event.model.end`（不是 internal.message_added），回复全漏，用户看不到 kira 的回答。改成 model.end 按 session 缓存最新一条、`agent.lifecycle.stopped` 时一次性吐；用户消息走 `event.user.message` ② 看门狗误杀——「90s 无帧 terminate」在 daemon 空闲时把好连接每 90 秒杀一次（kira 观测到 reset 与看门狗同频实锤）。改成心跳保活：60s 发 `ping`（daemon 回 `pong` 实测生效），150s 完全无回应才杀 ③ 重连不够皮实：指数退避加 jitter（±30%），重连后按 lastEventId 水位 `subscribe` 回放漏掉的事件（会话连续性），断连上报带 close code + reason
- 验证：kira 侧 16 分钟观测零 reset（旧节奏 8–20 分钟一次）；「回推OK」双向实测通过

## 2026-09-07

### 星盘菜单加「大小」分类

- 右键 → 设置 → 二级圆圈三项：**大小**（迷你/偏小/标准/偏大/巨大五档，与配置页滑块同一套 _size 语义，当前档位标 ✓，选中即调）、**调试动作**（直达小本子调试动作页）、**设置**（打开小本子配置页）；一级菜单回到 10 项圆盘
- 菜单展开动画提速：单项过渡 0.3s→0.16s（透明度 0.22s→0.1s），错峰延迟圆盘 40ms→14ms、网格 22ms→10ms，关闭移除 260ms→160ms（总展开 ~700ms→~330ms）

## 2026-09-05

### 修：@kira 路由匹配不到 + 输入法 IME 合成问题

- 前缀路由原来只认「kira，」标点分隔，用户习惯的「@kira 你好」（@+空格）匹配不到，全漏到她本人那里去了。改成 `@kira`（@ 后空格/标点都行）或「kira，」才路由给机器人；不带 @ 的「kira 你好」仍留给她本人
- 输入法 IME 合成问题（打拼音时按 Enter 把未合成完的文字直接提交，出现「k ir a」这种拆开的内容）：小本子输入框和桌宠小输入框的 Enter 都加 `!e.isComposing` 守卫

### 桌宠上直接 @kira 说话（前缀路由）

- 聊天通道（小本子实时聊天 + 长按她身体的小输入框）输入以「kira，」或「@kira」开头，就路由给 kira 机器人（yomi.handleNotebook → SendMessage 到绑定私聊 session），kira 的回答直接显示在同一个聊天里，同时经 SubscribeAll 事件流回小本子机器人 tab；kira 没连上时提示
- 修 yomi.js 的 ws 连接 bug：`require('ws')` 没有 `connect`（和探针同错），导致客户端一直连不上 daemon（07:36 后断线再没回来）

### 「链接 kira」配置区默认隐藏，暗号解锁

- 不是所有人都有 kira 机器人：配置页的「链接 kira」区块默认 display:none；在小本子聊天输入框输入暗号「kira牛逼」即解锁（config.yomi.unlocked 持久化），解锁后配置区出现并正常使用
- 本机已配好 kira 的配置同时置 unlocked=true（自己不受影响）

### 链接 kira（yomi wire 协议）上线，替代飞书 SDK 直连

- 新链路：`src/yomi.js`——WebSocket（HTTP/1.1 Upgrade + Bearer token）+ 4 字节大端长度前缀 JSON 帧；Hello 握手 → SubscribeAll 全事件流订阅 + 断线指数退避重连。daemon 在 staging 集群（niko 部署，pod niko-gaobo），入口 `wss://niko-gaobo-ws.dev.kimi.team`（ingress 本身没毛病，早前 502 是 curl 走 HTTP/2 的误诊）
- **kira → 桌宠**：SubscribeAll 事件里滤 internal.message_added 的 assistant 消息 → 人物粘性气泡同步展示（kira 说话立刻知道）
- **桌宠 → kira**：小本本机器人 tab（kira 在线才显示）发言 → SendMessage 到绑定私聊 session → daemon 回答进飞书；历史从 ListMessages 拉
- 配置页新增「链接 kira」区：wsUrl/token/sessionId/开关/状态/列会话挑选绑定；连上后首次握手自动发一句「蓝牙连上了」（重连不刷屏）
- 踩坑记录：ReqMethod 无参变体必须发字符串（"hello"/"subscribe_all"），方法名必须 snake_case；HTTP/2 下 WS 握手必 502（h2 没有 Upgrade 头）；办公网到 pod 网段（10.3.x.x）不通、系统代理 7890 会劫内网 IP
- 探针 `tools/yomi_probe.js` 可复用：`node tools/yomi_probe.js wss://niko-gaobo-ws.dev.kimi.team <token> --list-sessions`

## 2026-09-04

### 跨屏跟随：拖到哪块屏就按哪块屏的大小

- 之前屏幕基数在创建窗口时算一次就缓存，她在大屏上仍是按小屏算的尺寸。新增所在屏变化检测：自主移动节流 500ms 一查；跨屏拖拽途中只记标记（窗口跟手不动），松手落定后统一 refreshScreenK + applyWindowSize + 广播 _screenK 给 renderer/overlay
- resize 加「duang duang」弹性动画：阻尼振荡（振幅 e^-6t 衰减的 cos 12t）0.75s 弹两三次从旧尺寸弹到新尺寸，窗口和渲染层同步逐帧广播 _screenK，锚定与 applyWindowSize 一致收尾无跳变

### 暗中观察大脸不跟人物缩放

- peekbig 的大脸高度原先是「屏高 55% × 整体缩放」，屏幕自适应后（0.48）只剩 1/4 屏高。改成钉死屏高 70%（≥2/3）——全屏特效不按人物缩放缩

### 人物大小跟随屏幕自适应

- 屏幕基数 screenK = min(工作区高/5/512, 工作区宽/5/340)：人物（340×512 逻辑画幅）高宽都不超过屏 1/5，取较小的约束——大屏大、小屏小（本机 2056×1231 工作区 → 人物高 246px 正好 1/5）
- 实际缩放 = screenK × 配置页缩放滑块（滑块仍是用户微调）；主进程算好随 settings 下发（_screenK），renderer/overlay 统一使用；窗口创建和 applyWindowSize 时刷新，跨屏拖拽途中不重算防抖动

## 2026-09-03

### 御剑飞行时长 10~30s

- 巡航从按趟数（2~3 趟 ≈5s）改成按时间：巡航 8~28s 随机，加起飞/滑翔各 0.9s 全程 10~30s；到点从当前高度直接滑翔，不再等掉头

### 睡眠节奏：不再一直睡

- 上次把自主入睡改成睡到被戳醒为止，结果 25s 冷落就入睡 + 永不自醒 = 她几乎永远在睡。调整：冷落 2 分钟才入睡（原 25s），自主入睡睡 4~10 分钟自己醒（回到玩耍节奏）；「一直睡到被叫醒」只保留给菜单哄睡（doSleep(1e9) 路径不变）

## 2026-09-02

### 御剑飞行换新素材（人物 + 真剑踏板）

- 新素材接入：`assets/fly_char.png`（驭剑姿人物，1020×1455）、`assets/fly_sword.png`（音符银刃，1515×1023），均按 alpha>10 的内容 bbox 裁剪（人物 737×1228、剑 1449×436），脚底/剑身对齐原契约
- 防裁切联调（全程截图验证，`tools/fly_shot.js` + 桩 preload 离屏捕捉窗内画面）：剑宽 210 + 抬升 28 + 巡航倾角上限 12°——剑穗垂在图底，宽度 240 或倾角 17° 时穗尖会戳出窗口底边（旧踏板同病，只是图扁看不出来）；起飞上升段前 40% 淡入遮掉从窗底升入的硬切；7 个时间点全帧程序化贴边扫描零裁切，脚底-剑身接触逐帧目视确认
- 化身成剑（flySword）的剑素材同步换成新剑（同一素材族，旧 sword_blade.png 宽高比 648/1447 → 新 436/1449）

### 动作调整：去掉转个圈、变身随机化、修御剑飞行背向 bug

- 去掉「转个圈」（spin）：actions 注册表、星盘菜单、renderer 状态机/台词/数值/心情权重/可戳状态、大模型 do_action 枚举全链路移除
- 「变个身」从 normal↔chibi 二人转改成随机变另一个形态（FORMS 全部 5 种排除当前形态）
- 修：御剑飞行掉头后背向飞——fly 用的侧脸素材靠 facing 镜像朝向，巡航掉头只翻了 dir 和翻牌 rotY，facing 没交接（dash 侧面版有 `facing = -d.dir`，fly 漏了）；翻牌完成瞬间补上 `facing = -f.dir`。harness 实测：takeoff→cruise 两次掉头→glide→land 全链路，背向违例 0、立绘正确恢复

### 小本子「调试动作」页

- 书脊新 tab：60 个动作按形态分组平铺成按钮墙（名字 + id），点一下走星盘菜单同一条 menu-select 链强制演一次；设置里关掉的/不进随机池的调暗但照样能点（调试就是强制触发）
- 验证工具 `tools/notebook_shot.js` + `tools/nb_stub_preload.js`（桩 window.pet 离屏渲染，60 按钮/触发链已验证；contextBridge 克隆不了 Proxy，桩必须显式方法表）

### Code review 加固轮（两个 reviewer 并行）

- 地基：start() 异常隔离（effect 已结算不能白扣）；registerAction/registerOvFx 重复注册警告 + 撞内置动作 id 拒收；overlay 缺 handler 时立即 fxDone 回执（原来设计性干等）；ctx.onFxDone 改单订阅 Set 分发（原来每 start 累加一个 IPC 监听）；monitor 异常每 id 记一次日志；气泡锚点 startsWith('sleep') 收紧为精确场景态（sleepwalk 不再错位半屏）；网格模式藏装饰环改 visibility（0px 留边框点）
- fxDone 会话令牌（seq）×12 对：fxStart 带自增 seq、ov 拆旧开新、回执只认当前会话——修掉「打断后快速重开」旧回执串台（balloon 提前现身/kite 秒收/stargaze 干等）和「防叠罗汉立即回执」重开即收尾两个病类
- 动作：hide 永久隐身路径（唯一 Critical，拖拽/菜单切走后 tick 和回执双丢）补 300ms 打断看门狗；sleepwalk 惊醒动画死代码（wake 先清 sess 再 enter）；roll/slide/dance/photo/umbrellawalk/umbrellafly 立绘残留看门狗；cheer/kite/umbrellawalk/umbrellafly/fish 异步 start 竞态 + 重入 interval 泄漏（await 前放占位、落地前校验状态）；ov_tightrope 补场次守卫；arrowdodge 跳跃 y 漂移缓回；balloon fxStart 未发出时 35s→3s 兜底
- 验证：34 个 ext 文件语法全过；harness 全量 32 动作 + 打断路径零错误；hide 打断现身/confetti 快速重开不串台/8 对 seq 回执计时断言全部 PASS；README 收尾纪律补 7~12 条（状态命名、异步 start、换立绘、隐身、seq 范式）

### 菜单配色：深蓝紫 → 奶油暖色

- 按钮面奶油白（rgba(255,251,243,.92)）+ 暖深棕文字，悬停/聚焦暖杏色（rgba(255,227,186,.96)）；装饰环、扇区高光楔、枢纽光晕同步从蓝紫换成暖杏；压暗盘从暗紫盘换成明亮暖纱（按钮本身已近不透明，压暗不再需要深色），后按反馈把暖纱调到极淡（0.34→0.1）防晃眼；阴影从黑改成暖棕调

### 菜单可读性：压暗盘 + 按钮近不透明

- 菜单常在她自己身上展开，亮色立绘把半透明玻璃按钮的字吃掉了。修复：按钮底色 0.62→0.88（hover 0.95）、阴影加深；菜单背后垫一层径向渐变压暗盘（.rm-dim，跟随圆盘半径、网格模式隐藏、随菜单一起淡出）

### 修：星盘一级菜单恢复圆盘

- 加了「杂耍/出门/游戏」三个分类后一级变成 10 项，踩到菜单「>8 项转网格列表」的兜底，一圈的星盘效果没了。修复：列表兜底只作用于二级及以下的分组，一级永远摆圆盘；圆盘半径加 9~10 项档（152px），防贴边余量随一级项数自适应
- 菜单截图工具 `tools/menu_shot.js`（配合 menu_test.html 离屏渲染验证一级圆盘/二级网格）；menu_test.html 的 stub 补齐新增的 ext 特效钩子

## 2026-09-01

### 动作扩容到 60 个（+32）

- 扩展架构：`src/ext/core.js` 的 `registerAction({id, lines, effect, start, tick, monitor})` 契约，renderer 主循环 `default` 分支分发给扩展 tick、数值心跳调扩展 monitor、DISPATCH/LINES 自动合并；overlay 侧 `registerOvFx(kind, fn)` + 通用 `fx-ext` IPC 通道（坐标自动换算）；随机池/大模型池过滤 `!DISPATCH[id]`，ext 文件缺失时动作自动不存在。契约文档在 `src/ext/README.md`
- 新动作 32 个（`src/ext/`，44 个文件）：陪伴（跟屁虫/坐下陪你/梦游/伸懒腰）、杂耍（抛接球/变魔术/溜溜球/蹦迪/蹦床/打滚/滑滑梯/做早操）、户外（放风筝/打伞散步/雨伞飞天/数星星）、节庆（撒花/接雪花/放灯笼/自拍）、游戏（捉迷藏/石头剪刀布/方向键逗宠/走钢丝）、关怀（深夜催睡/提醒喝水/番茄钟/打字打call，monitor 条件触发不进随机池）、修仙（荡秋千/打坐/钓鱼）、气球漂流
- 星盘菜单加「杂耍/出门/游戏」三个分类（29 个可手动触发；催睡/喝水/打call 为条件触发不进菜单）；card.png 闲置素材启用（变魔术）
- 验收：44 文件语法全过、id/kind 交叉一致、临时测试页 32 动作逐个强制触发零报错（测试页已删，`KIRA_TEST_PAGE` env 开关保留在 main.js）

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
