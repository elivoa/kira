# Changelog

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
