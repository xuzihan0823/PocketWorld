# PocketWorld — 浏览器里的 3D 微缩数字空间

一个等轴测（Isometric Diorama）非像素风 3D 交互房间项目。访客可以在精致的微缩房间内自由观察、点击物品触发丝滑的镜头推进过渡，在房间的复古电脑里体验内置小游戏（奶娃滑雪大冒险、团团魔法录），或将自己的本地音频文件转化为实体音乐光盘放入唱片机播放。

## 一、技术栈与整体架构

- **框架与构建**：`React + TypeScript + Vite`（支持一键导出纯静态产物部署至 Qoder Sites）
- **3D 场景与相机动画**：`Three.js` + `@react-three/fiber` + `@react-three/drei` + `GSAP`（负责等轴测箱庭房间渲染、光线氛围与点击物品时的平滑推镜过渡）
- **电脑内置小游戏**：基于 HTML5 `Canvas 2D` 实现高帧率独立卡带组件，通过标准接口 `GameCartridgeProps` 嵌入电脑屏幕内
- **音频与光盘系统**：基于 `Web Audio API` + `File API`（支持预置曲目与本地音频拖入自动生成光盘动画及频谱律动）

## 二、目录结构与模块边界

场景功能按目录聚合，组件、状态、样式和测试放在同一功能内。公共接口集中在 `src/types/`，小游戏通过卡带接口接入场景。

```text
PocketWorld/
├── assets/                   # 统一素材目录（运行时模型 assets/public/ 与游戏素材 assets/games/）
├── scripts/
│   └── test.mjs              # 测试准备与执行入口
├── skills/                   # 项目协作与 Three.js 开发技能集
├── src/
│   ├── main.tsx              # 页面启动与独立游戏入口选择
│   ├── App.tsx               # 应用编排、全局快捷键与本地音乐导入
│   ├── scene/
│   │   ├── orbital/          # 当前轨道居住舱的场景编排与模型
│   │   │   ├── library/      # 书柜、导入、阅读与角色取还书动作
│   │   │   ├── schedule/     # 日程存档、同步、纸页、玻璃贴纸与测试
│   │   │   ├── media/        # 电脑屏幕、卡带、唱片机、键盘与测试
│   │   │   └── shaders/      # 宇宙与木材着色器
│   │   ├── audioEngine.ts    # 房间音效与音乐播放
│   │   └── geometry.ts       # 共用几何工具
│   ├── components/computer/  # 独立滑雪页面与卡带播放器
│   ├── games/
│   │   ├── mario/            # 奶娃滑雪大冒险，保留 mario 卡带标识
│   │   └── shooter/          # 团团魔法录与独立调试入口
│   └── types/                # 卡带、交互物品与世界接口
├── AGENT.md                  # 工程规范与协作流程
├── SPEC.md                   # 产品交互与技术约定
└── README.md
```

> **仓库约束**：所有素材统一放在 `assets/` 下；测试截图、录屏、预览 HTML 等展示或测试残留文件严禁存放在仓库中或提交至 Git（详见 `AGENT.md` 第 3.1 节）。

新增日程或媒体能力时，优先在对应功能目录内维护实现和回归测试。`OrbitalScene.tsx` 负责组合场景，家具通过功能组件或上下文接入业务。场景细节见 [场景模块说明](src/scene/README.md)。

## 三、多人协作与接口约定
> 开发前请务必先阅读 **[`AGENT.md`](./AGENT.md)**（工程与防冲突铁律）与 **[`SPEC.md`](./SPEC.md)**（产品交互与小游戏细则）。

1. **目录隔离**：
   - 负责**马里奥小游戏**的成员仅在 `src/games/mario/` 下开发；
   - 负责**打飞机小游戏**的成员仅在 `src/games/shooter/` 下开发；
   - 严禁直接污染全局样式或未清理的 `window` 键盘监听（组件卸载时必须移除所有 `keydown/keyup` 监听与 `requestAnimationFrame` 循环）。
2. **统一卡带接口**：
   两个游戏入口组件均接收 `src/types/game.ts` 中定义的 `GameCartridgeProps`，默认逻辑画布尺寸为 `800 × 600`（外层电脑显示器容器会自动等比缩放并加上复古屏幕滤镜）。
3. **分支规范**：
   每人基于最新 `main` 创建独立功能分支（如 `feat/game-mario`、`feat/game-shooter`、`feat/room-scene`），推送后尽早创建 Draft PR，完成验证再提交审查。**队员必须通过 PR 交付，禁止直接推送 `main` 或自行合并；由队长审查并统一合并。** 具体流程见 `AGENT.md` 第 6 节，提交说明使用仓库 PR 模板。
4. **进度与玩法设计**：
   两名队员分别维护自己游戏目录下的 `进度文档.md`，写清已有功能、当前阶段和待办，整理最新状态并删除冗余内容。PR 必须说明本次提交内容并链接进度文档。核心玩法允许完全重设计，技术接口、嵌入方式、暂停/静音/退出与清理机制保持稳定，集成变更由队长协调。

## 四、本地开发与验证

使用 Node.js 24，首次启动先运行 `npm ci`。

```sh
npm run dev
npm run typecheck
npm run build
npm test
```

默认页面进入房间。`?game=ski` 或 `?dev=mario` 进入滑雪独立页，`?dev=shooter` 进入团团魔法录独立页。

`npm test` 先构建生产产物，再编译游戏引擎并发现 `src/` 内的全部 `*.test.mjs`。生产构建用于检查按需加载依赖图，引擎测试包生成在被 Git 忽略的 `src/games/shooter/survival/dist/`。功能测试与对应实现就近维护。
