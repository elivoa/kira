# Kira 桌面宠物

一只住在你 Mac 桌面上的桌宠女仆 **Kira**（Electron 实现）。银白长卷星空裙，腰间挂着 K 卡牌法宝，有多种形态（姐姐 / Q版 / 法宝 / 睡觉 / 背对），会自己做动作、会跟你互动、还会用 Kimi 聊天。

## 启动

```bash
# 1. 安装依赖
npm install

# 如果 Electron 二进制下载太慢（国内网络），用镜像：
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 2. （可选）编译窗口枚举工具，「去窗台玩」功能需要
swiftc -O tools/windows.swift -o tools/windows

# 2b. （可选）编译方向键监听工具，「连按方向键吓她」功能需要
# 运行后需在 系统设置→隐私与安全性→输入监控 里给终端/Electron 授权，没授权只影响这一条，晃鼠标检测不受影响
swiftc -O tools/keys.swift -o tools/keys

# 3. 启动
npm start
```

> `npm start` 走不通时（node 版本管理器抽风），也可以直接用本机 node 跑：
> `node node_modules/electron/cli.js .`

## 聊天功能（Kimi API）

在小本子（点她腰间的小本子）的「实时聊天」页签里和 Kira 对话，带 memory（对话历史持久化）。

key 在小本子的「配置」页签里填写保存，界面只显示掩码。所有配置（Kimi key、动作开关、频率、点击穿透、窗口位置）统一存在本机 `~/.config/kira/config.json`（**不进仓库**），也可以手动改这个文件：

```json
{ "kimiKey": "sk-kimi-...", "settings": { "_freq": 1 } }
```

没配 key 时回退本地规则应答。对话历史存于 `~/Library/Application Support/summon-pet/chat-history.json`。旧版存在 userData 下的 settings.json/config.json 会在首次启动时自动迁入 `~/.config/kira/config.json` 并删除。

## 玩法

- **戳一戳**：点她（连戳 5 下扔屎、10 下炸毛，长按头发 5 秒有彩蛋）
- **拖拽**：拎起来到处放，落点会被记为常驻位置，她玩够了会自己走回去
- **腰间小本子**：点 K 卡牌打开笔记本（实时聊天 / MR Link 格式化 / 日志 / 配置 四页签）
- **右键菜单**：星盘菜单（玻璃质感：细边深色玻璃 + 聚焦辉光；动作/变身/玩耍/法宝分类 + 小本子/设置直选，取消固定在正下方，大分组自动展开为多列网格，鼠标进入扇区即淡淡高亮）
- **点击穿透**：默认只有点在角色身上才响应，其余位置穿透到下层窗口（可在小本子配置页关）
- **吓她一跳**：光标贴着她的时候快速晃鼠标，或连着猛按方向键，她会吓得尖叫（「呜哇！撞死我了！」「鬼呀👻！」）然后背对你一顿狂奔，跑远了才停下（方向键检测需要编译 tools/keys 并授予输入监控权限）

**自主动作**（待机触发）：散步（阿飘+红灯笼）、跳、转圈、撒娇、蹦蹦跳、走了走了（默认停用，可在设置开）、去窗台玩、爬墙上去（沿活跃窗体的左/右边沿一路爬到顶部；如果窗体顶边上方有足够空间，就上去歇会儿再跳下来，不够高就爬到顶后直接跳下）、暴走（正面/侧面两种）、御剑飞行、你讨厌！、来张桌子、收进法宝、化身成剑、兜风（GT3 RS 四帧动画，她亲自开车）、捣乱（挂你鼠标上）、变身；背对形态下还有偷偷回头、赌气晃晃、背对散步、笛子乱飞（转过身表演完又转回去）。配了 Kimi key 后，每隔一段时间会由模型决策一次做什么动作、配什么台词（动作+台词配套，结合数值/时间/最近行为），日志里记为「智能」；其余时候按权重随机，记为「自主」。

**数值系统**：精（体力）/ 气（法力）/ 神（耐心）/ 心情 / 透明值，与动作、互动、冷落时长联动。太久不理她，她会变透明、会主动求关注。

**配置页**（小本子「配置」页签）：Kimi key、动作频率滑块、按形态 × 是否打扰分组的动作开关、点击穿透开关。所有配置持久化在 `~/.config/kira/config.json`。

## 目录结构

```
src/
  main.js       主进程：窗口管理、IPC、设置/日志/数值/聊天后端
  renderer.js   桌宠渲染层：动作状态机 + 全部交互
  overlay.js    全屏覆盖层：扔屎、御剑飞行、兜风、捣乱等离窗特效
  bubble.*      气泡独立窗口：台词/主动搭话，宽度不受人物窗口限制，字号缩放下限 0.8
  preload.js    contextBridge API
  actions.js    动作注册表（名称/形态/打扰性/权重）
  phrases.js    台词库（肉麻话 + 梗）
  notebook.*    小本子（四页签，含配置页）
  markdown-stream.js 聊天气泡的流式 markdown 渲染
assets/         立绘与道具图（从设定图抠出）
tools/
  cutout.js     立绘抠图工具：node tools/cutout.js <out.png> <x> <y> <w> <h> [src.png]
  cutout_drive.js 兜风四帧抠图：影棚灰底 → 透明底（纹理分割 + 卡钳锚定对齐），node tools/cutout_drive.js <src> <out> [--pocket x,y,w,h]
  cutout_climb.js 攀爬帧抠图：近白底 → 透明底 32 帧（保画布对齐 + 2x 降采样），node tools/cutout_climb.js <srcDir> <outDir>
  windows.swift macOS 窗口枚举（CGWindowList），编译后供「去窗台玩」使用
  keys.swift    方向键全局监听（CGEventTap，需输入监控权限），编译后供「吓她一跳」使用
```

## 换立绘

设定图放 `assets/source.png`，用抠图脚本重新生成各形态素材（边缘洪水填充去白底，保原图精度）：

```bash
node tools/cutout.js assets/pet.png 100 50 800 1370        # 正面
node tools/cutout.js assets/pet_back.png 1680 50 850 1370  # 背面
node tools/cutout.js assets/pet_side.png 1000 50 680 1360  # 侧面
```
