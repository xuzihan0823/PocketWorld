# PocketWorld — 浏览器里的 3D 轨道居住舱

一个可以直接动手的 3D 小房间。访客在轨道居住舱里环绕观察、控制住民走动，写日记和日程，从书柜取书阅读，播放唱片或把本地音乐做成唱片，把实体卡带插入电脑游玩内置小游戏（奶娃滑雪大冒险、团团魔法录）。

## 一、技术栈与整体架构

- **框架与构建**：`React + TypeScript + Vite`，产物为纯静态资源，部署至 Qoder Sites
- **3D 场景**：`Three.js` + `@react-three/fiber` + `@react-three/drei`，`GSAP` 负责物品动作与镜头转场的时间线
- **电脑内置小游戏**：基于 HTML5 `Canvas 2D` 的独立卡带组件，通过标准接口 `GameCartridgeProps` 按需加载到电脑屏幕
- **音频**：`Web Audio API` + `File API`，预置曲目与音效由程序合成，支持导入本地音频
- **数据**：全部保存在浏览器 `localStorage`，没有后端

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
│   │   │   ├── journal/      # 日记书页、编辑和存档
│   │   │   ├── library/      # 书柜、导入、阅读与角色取还书动作
│   │   │   ├── schedule/     # 日程存档、同步、纸页、玻璃贴纸与测试
│   │   │   ├── media/        # 电脑屏幕、卡带、唱片机、键盘与测试
│   │   │   └── shaders/      # 宇宙与木材着色器
│   │   ├── audioEngine.ts    # 房间音效与音乐播放
│   │   └── geometry.ts       # 共用几何工具
│   ├── components/computer/  # 独立滑雪页面与卡带播放器
│   ├── games/
│   │   ├── mario/            # 奶娃滑雪大冒险，保留 mario 卡带标识
│   │   └── shooter/          # 团团魔法录，保留 shooter 卡带标识
│   └── types/                # 卡带、交互物品与世界接口
├── AGENTS.md                 # 工程规范与协作流程（CLAUDE.md 引入同一份）
├── SPEC.md                   # 当前生效的产品行为与集成契约
├── PRODUCT.md                # 产品定位与设计语境
└── README.md
```

> **仓库约束**：所有素材统一放在 `assets/` 下；测试截图、录屏、预览 HTML 等展示或测试残留文件严禁存放在仓库中或提交至 Git（详见 `AGENTS.md` 第 3.1 节）。

新增日程或媒体能力时，优先在对应功能目录内维护实现和回归测试。`OrbitalScene.tsx` 负责组合场景，家具通过功能组件或上下文接入业务。场景细节见 [场景模块说明](src/scene/README.md)。

## 三、文档导航

开发前先读 **[`AGENTS.md`](./AGENTS.md)** 与 **[`SPEC.md`](./SPEC.md)**。

| 想了解 | 看这里 |
|---|---|
| 分工、目录边界、分支与 PR 流程、文档放哪 | [`AGENTS.md`](./AGENTS.md) |
| 操作方式、卡带接口、存储键、入口参数 | [`SPEC.md`](./SPEC.md) |
| 场景模块的职责与当前状态 | [场景说明](src/scene/README.md)、[场景进度](src/scene/orbital/进度文档.md) |
| 奶娃滑雪大冒险 | [说明](src/games/mario/README.md)、[进度](src/games/mario/进度文档.md) |
| 团团魔法录 | [说明](src/games/shooter/README.md)、[进度](src/games/shooter/进度文档.md) |
| Agent 技能包的安装与使用 | [技能集合](skills/README.md) |

协作要点：

1. **目录隔离**：`mario` 卡带只在 `src/games/mario/` 下开发，`shooter` 卡带只在 `src/games/shooter/` 下开发，场景与公共配置由队长维护。游戏不得污染全局样式，卸载时必须清理监听、动画循环与音频。
2. **统一卡带接口**：两个游戏入口都实现 `src/types/game.ts` 的 `GameCartridgeProps`，逻辑画布为 `800 × 600`，由外层电脑容器负责缩放。
3. **PR 交付**：每个任务从最新 `main` 开独立分支（`type/简短描述`），尽早创建 Draft PR，验证后请队长审查。**禁止直接推送 `main` 或自行合并。**
4. **进度文档**：各模块维护自己的 `进度文档.md`，只写当前状态；每个 PR 说明本次改动并链接进度文档。

## 四、本地开发与验证

使用 Node.js 24（版本写在 `.nvmrc`），首次启动先运行 `npm ci`。

```sh
npm run dev
npm run typecheck
npm run build
npm test
```

默认页面进入房间。`?game=ski` 或 `?dev=mario` 进入滑雪独立页，`?dev=shooter` 进入团团魔法录独立页。

`npm test` 先执行类型检查与生产构建，再编译游戏引擎并发现 `src/` 内的全部 `*.test.mjs`。生产构建用于检查按需加载依赖图，引擎测试包生成在被 Git 忽略的 `src/games/shooter/survival/dist/`。功能测试与对应实现就近维护。
