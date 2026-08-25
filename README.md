# Kira 桌面宠物

一只住在你 Mac 桌面上的桌宠女仆 **Kira**（Electron 实现）。银白长卷星空裙，腰间挂着 K 卡牌法宝，有三种形态（姐姐 / Q版 / 卡牌），会自己做动作、会跟你互动、还会用 Kimi 聊天。

## 启动

```bash
# 1. 安装依赖
npm install

# 如果 Electron 二进制下载太慢（国内网络），用镜像：
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 2. （可选）编译窗口枚举工具，「去窗台玩」功能需要
swiftc -O tools/windows.swift -o tools/windows

# 3. 启动
npm start
```

> `npm start` 走不通时（node 版本管理器抽风），也可以直接用本机 node 跑：
> `node node_modules/electron/cli.js .`

## 聊天功能（Kimi API）

在小本子（点她腰间的小本子）的「实时聊天」页签里和 Kira 对话，带 memory（对话历史持久化）。

key 配置在本机 `~/Library/Application Support/summon-pet/config.json`（**不进仓库**）：

```json
{ "kimiKey": "sk-kimi-..." }
```

没配 key 时回退本地规则应答。对话历史存于 `~/Library/Application Support/summon-pet/chat-history.json`。

## 玩法

- **戳一戳**：点她（连戳 5 下扔屎、10 下炸毛，长按头发 5 秒有彩蛋）
- **拖拽**：拎起来到处放，落点会被记为常驻位置，她玩够了会自己走回去
- **腰间小本子**：点 K 卡牌打开笔记本（实时聊天 / MR Link 格式化 / 日志 三页签）
- **右键菜单**：全部动作手动触发 + 设置 + 数值查看
- **点击穿透**：默认只有点在角色身上才响应，其余位置穿透到下层窗口（可在设置里关）

**自主动作**（待机随机播放）：散步（阿飘+红灯笼）、跳、转圈、撒娇、蹦蹦跳、走了走了、去窗台玩、暴走（正面/侧面两种）、御剑飞行、你讨厌！、来张桌子、收进法宝、化身成剑、兜风（保时捷敞篷）、捣乱（挂你鼠标上）、变身。

**数值系统**：精（体力）/ 气（法力）/ 神（耐心）/ 心情 / 透明值，与动作、互动、冷落时长联动。太久不理她，她会变透明、会走了走了、会主动求关注。

**设置页**：动作频率滑块、按形态 × 是否打扰分组的动作开关、点击穿透开关。配置持久化在 `~/Library/Application Support/summon-pet/settings.json`。

## 目录结构

```
src/
  main.js       主进程：窗口管理、IPC、设置/日志/数值/聊天后端
  renderer.js   桌宠渲染层：动作状态机 + 全部交互
  overlay.js    全屏覆盖层：扔屎、御剑飞行、兜风、捣乱等离窗特效
  preload.js    contextBridge API
  actions.js    动作注册表（名称/形态/打扰性/权重）
  phrases.js    台词库（肉麻话 + 梗）
  notebook.*    小本子（三页签）
  settings.*    设置页
assets/         立绘与道具图（从设定图抠出）
tools/
  cutout.js     立绘抠图工具：node tools/cutout.js <out.png> <x> <y> <w> <h> [src.png]
  windows.swift macOS 窗口枚举（CGWindowList），编译后供「去窗台玩」使用
```

## 换立绘

设定图放 `assets/source.png`，用抠图脚本重新生成各形态素材（边缘洪水填充去白底，保原图精度）：

```bash
node tools/cutout.js assets/pet.png 100 50 800 1370        # 正面
node tools/cutout.js assets/pet_back.png 1680 50 850 1370  # 背面
node tools/cutout.js assets/pet_side.png 1000 50 680 1360  # 侧面
```
