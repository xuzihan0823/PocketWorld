# 项目文档维护技能

`project-doc-maintenance` 提供多人项目的文档维护与开发交付流程，参考 planning-with-files 的持久化和协作方式，覆盖协作规范、产品规范、公共接口与跨模块交互契约，以及本地开发、提交推送、草稿 PR 和合并后清理。技能先识别目标仓库已有结构，PocketWorld 的适配规则随技能一起分发。

## 通过 npx 安装

在需要使用技能的项目根目录执行。以下命令从已合并到默认分支的版本安装到当前项目，`--agent` 可改成 Skills CLI 支持的目标工具名称。

省略 `-g` 使用项目级安装，技能位于项目的 `.agents/skills/`，选定工具按 Skills CLI 规则使用该目录或项目内链接。四宿主 hooks 的默认注册也写入项目配置，DSH 使用启动时显式加载的项目 patch。

```sh
npx --yes skills add xuzihan0823/PocketWorld --skill project-doc-maintenance --agent codex --yes
```

技能源文件位于 `skills/project-doc-maintenance/`。在源码工作区中也可以使用本地目录安装，以验证尚未合并的版本。

```sh
npx --yes skills add ./skills/project-doc-maintenance --agent codex --yes
```

安装来源、目标工具及选项遵循 [Skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)，技能目录布局遵循其 [分发规范](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md)。

## 安装后的使用

请 AI 使用 `project-doc-maintenance`，并给出需要执行的任务。例如“检查本次修改涉及哪些规范和交互契约，并同步到当前 PR”，或“按现有目录初始化文档维护机制，先完善电脑与小游戏的契约”。

技能先读取现有规范和调用链，再按任务更新相应资料。PocketWorld 的任务进展沿用 PR，模块整体状态沿用已有进度文档。项目专属路径通过符号和真实入口重新确认。

开发交付沿用一任务一分支和独立 worktree，尽早推送并创建草稿 PR，后续更新同一 PR。本机 worktree 在依赖一致时复用主检出目录的依赖，其他成员按锁文件安装并遵循相同的预览和验证流程。内容合入 `main` 后，核对额外提交及工作区文件，再及时清理已交付分支和 worktree。

技能文件由安装命令分发，项目文档在 AI 执行授权任务时维护。宿主的技能发现、自动触发和 hooks 能力需按实际使用方式确认。

## 定期维护 hooks

技能随包提供 Codex、Claude Code、DSH 和 Pi 的维护检查。项目级安装后按 [hooks 注册说明](project-doc-maintenance/references/hooks.md) 注册对应宿主，完成配置审阅和重载。

发生变更后定期提醒维护，结束前要求核对并记录结果。检查按会话和 worktree 隔离，配有重复续跑保护。配置检测与真实宿主触发分别验证。
