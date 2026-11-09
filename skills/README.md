# PocketWorld 项目技能集合

`project-doc-maintenance` 提供多人项目的文档维护与开发交付流程，参考 planning-with-files 的持久化和协作方式，覆盖协作规范、产品规范、公共接口与跨模块交互契约，以及本地开发、提交推送、草稿 PR 和合并后清理。技能先识别目标仓库已有结构，PocketWorld 的适配规则随技能一起分发。

集合还包含从本机技能库复制的 24 个 `threejs-*` 技能及其参考文件，按原内容分发。Three.js 开发任务按范围选用相关技能，并遵守 PocketWorld 的项目规范。

## 通过 npx 安装

在需要使用技能的项目根目录执行。以下命令从已合并到默认分支的版本安装到当前项目，`--agent` 可改成 Skills CLI 支持的目标工具名称。

省略 `-g` 使用项目级安装，技能位于项目的 `.agents/skills/`，选定工具按 Skills CLI 规则使用该目录或项目内链接。四宿主 hooks 的默认注册也写入项目配置，DSH 使用启动时显式加载的项目 patch。

```sh
npx --yes skills add xuzihan0823/PocketWorld --skill project-doc-maintenance --agent codex --yes
```

安装整个集合时，用引号包围 `*`，同时安装项目文档维护与全部 Three.js 技能。目标工具可按实际需要调整，DSH 使用项目中的共享技能目录。

```sh
npx --yes skills add xuzihan0823/PocketWorld --skill '*' --agent codex claude-code pi --yes
```

也可以按名称选择，例如安装 R3F、场景与交互技能。

```sh
npx --yes skills add xuzihan0823/PocketWorld --skill threejs-r3f threejs-scene threejs-interaction --agent codex --yes
```

技能源文件统一位于 `skills/`，每个技能目录包含自己的 `SKILL.md` 和所需参考资料。在源码工作区中也可以使用本地目录安装整个集合，以验证尚未合并的版本。

```sh
npx --yes skills add ./skills --skill '*' --agent codex --yes
```

安装来源、目标工具及选项遵循 [Skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)，技能目录布局遵循其 [分发规范](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md)。

## 安装后的使用

请 AI 使用 `project-doc-maintenance`，并给出需要执行的任务。例如“检查本次修改涉及哪些规范和交互契约，并同步到当前 PR”，或“按现有目录初始化文档维护机制，先完善电脑与小游戏的契约”。

技能先读取现有规范和调用链，再按任务更新相应资料。PocketWorld 的任务进展沿用 PR，模块整体状态沿用已有进度文档。项目专属路径通过符号和真实入口重新确认。

开发交付沿用一任务一分支和独立 worktree，尽早推送并创建草稿 PR，后续更新同一 PR。本机 worktree 在依赖一致时复用主检出目录的依赖，其他成员按锁文件安装并遵循相同的预览和验证流程。内容合入 `main` 后，核对额外提交及工作区文件，再及时清理已交付分支和 worktree。

技能文件由安装命令分发，项目文档在 AI 执行授权任务时维护。宿主的技能发现、自动触发和 hooks 能力需按实际使用方式确认。

## Three.js 技能范围

| 任务范围 | 技能 |
| --- | --- |
| 整体规划、React 与 HTML 集成 | `threejs-web`、`threejs-r3f`、`threejs-html` |
| 场景、几何、资源加载 | `threejs-scene`、`threejs-geometry`、`threejs-assets` |
| 材质、灯光、着色器、后处理 | `threejs-materials`、`threejs-lighting`、`threejs-shaders`、`threejs-postprocessing` |
| 动画、交互、物理、粒子与音频 | `threejs-animation`、`threejs-interaction`、`threejs-physics`、`threejs-particles`、`threejs-audio` |
| 性能、调试、测试、无障碍与部署 | `threejs-performance`、`threejs-debugging`、`threejs-testing`、`threejs-accessibility`、`threejs-deployment` |
| 产品展示、空间数据、WebGPU 与 XR | `threejs-product-viewer`、`threejs-spatial-data`、`threejs-webgpu`、`threejs-xr` |

从 [Three.js 任务索引](threejs-web/references/routing.md) 选择所需技能。PocketWorld 使用已有 React Three Fiber 场景，先检查项目安装的 React、Fiber、Drei 和 Three.js 版本，再读取与本次任务直接相关的指导。

## 定期维护 hooks

技能随包提供 Codex、Claude Code、DSH 和 Pi 的维护检查。项目级安装后按 [hooks 注册说明](project-doc-maintenance/references/hooks.md) 注册对应宿主，完成配置审阅和重载。

发生变更后定期提醒维护，结束前要求核对并记录结果。检查按会话和 worktree 隔离，配有重复续跑保护。配置检测与真实宿主触发分别验证。
