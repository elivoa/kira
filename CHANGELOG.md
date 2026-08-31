# Changelog

## 2026-08-31

### 走路序列帧换新素材

- 走路帧全部替换：新源视频（1176x1764@24fps，97 帧）走路段 f4~f96 全部 93 帧都用上，`tools/video_walk_frames.js` 直接复用抠图（裁框/背景模型与旧视频一致，人物并集 bbox 相同）
- 循环相位对齐：视频步态周期非整数（93 帧 ≈3.65 周期），首尾直接相接相位不同必跳。新增 `tools/walk_loop_align.js`：用脚底间距极小值定周期锚点（27/24/25 帧），各周期保持自然长度原样连接（**不复制帧**——复制帧是 42ms 冻结，表现为「第一步完美、第二步卡顿」，已踩坑）；首端（上周期末尾）与尾端（新周期开头）残段用同相位桥接成完整周期；**桥接相位须脚+胳膊双锁**——脚用 spread 波形（RGB 帧差对 ±2 帧相位误差不敏感不可用于选址；且 AI 视频手臂摆动与步频不同步，脚对上时胳膊可能反相——「每 4 步胳膊错乱」的根因），胳膊用上半身前缘 armSig，跨周期候选联合评分（本视频周期 B 桥接最优）→ 4 整周期共 100 帧，回卷 = 视频自身的连续帧；接点柔化/边缘雾清理由 `tools/walk_post.js` 完成。全帧步进均值 7.5，接点 9.9 均在自然步态家族内
- 步幅标定更新：支撑脚相对身体后移 ≈9.7 素材px/帧（头肩质心验证人物原地走），WALK_PX_PER_FRAME 12.3 → 5.9；WALK_N 24 → 100
- 播放修复（「只有一半帧在生效」）：① WALK_SPEED 280 → 140，切帧节奏回到 ≈24fps 自然率（280 时 48fps，超出 38ms 交叉淡化设计节奏——index.html 注释里本就写着这个不变量——相邻帧互相涂抹）；② 走路帧相位不再每次 enter 重置 f01，100 帧长条靠多场走路接续播完；③ 各处翻牌过渡从固定 WALK_SRC[0] 改为当前相位帧，尾帧有机会出场
- 帧序列验证方法：`--remote-debugging-port=9222` 启动后 CDP hook `walkAnimAdvance` 记录 (t, fi)，可证伪序列级跳帧/冻结（本次 489 条日志：+1 步进全程完美，问题在内容衔接而非序列）
- 阴影闪烁修复（白底下阴影明暗抖动）：`#spriteX` 交叉淡化层不再挂 drop-shadow（此前淡出旧帧与新帧同时投影，每次切帧阴影加倍/恢复，24fps 下即闪烁）；`tools/walk_post.js` 顺带把 alpha<32 的边缘雾清零（不可见但参与投影计算）
- 测试设施：新增 `src/walk_test.html`（stub window.pet + 真实 renderer.js），配合 `tools/shot.js` 可脚本化驱动 doWalk 连续截图验证动作连续性

### 新动作「走到另一边」

- `walkfar`：朝更远那侧屏幕边缘一直走，到边翻牌转回正面停下；同款翻牌起步 + 走路帧（相位接续），走路帧状态集合纳入 `walkfar`
- 菜单「动作」分类、待机随机池（w=6）、大模型 `do_action` 工具 enum 同步加入；数值影响 jing-6/mood+2

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
