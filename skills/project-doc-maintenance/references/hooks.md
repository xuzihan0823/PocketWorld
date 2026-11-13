# 定期维护 hooks

技能包包含 Codex、Claude Code 的命令 hooks，以及 DSH、Pi 的原生适配器。运行需要 Node.js 24 和 Git。项目级安装后，在目标项目注册所需宿主。

## 安装与注册

先用 Skills CLI 安装到项目，目标工具可选择 `codex`、`claude-code` 和 `pi`。DSH 从项目的 `.agents/skills/` 发现同一技能包。

```sh
npx --yes skills add xuzihan0823/PocketWorld --skill project-doc-maintenance --agent codex claude-code pi --yes
node .agents/skills/project-doc-maintenance/scripts/setup-hooks.mjs --hosts codex,claude,pi,dsh
```

安装范围默认是当前项目，省略 `-g`。hooks 注册默认也使用项目配置。DSH 生成 `.dsh/project-doc-maintenance.patch.yml`，启动时通过 `--patch` 显式加载。以下使用已有的 Web profile，按实际使用的 profile 调整，并遵守本机后台运行规则。

```sh
dsh --profile web --patch .dsh/project-doc-maintenance.patch.yml
```

DSH Desktop 的现有实例需要由支持 `--patch` 的启动入口加载该覆盖层，生成配置后先检查实际启动方式。项目 patch 按本机仓库路径生成，其他成员在各自检出目录重新注册。

已有 preset 也可作为显式选择。使用 `--hosts dsh --dsh-preset agent.cordis.yml` 指定实际启用的插件行列表，注册器追加受管理插件行。该选项写入指定文件，文件所在位置决定其配置范围。

注册器合并已有 hooks，保留其他设置，备份原配置到 Git 元数据目录，重复执行更新同一组配置。检测到同名非受管理 Pi 扩展、无效 JSON 或不匹配的 DSH 配置格式时报告具体问题。多文件写入失败会恢复已写入的配置。

Codex 写入 `.codex/hooks.json`，Claude Code 写入 `.claude/settings.json`，Pi 写入 `.pi/extensions/project-doc-maintenance.ts`，DSH 默认写入 `.dsh/project-doc-maintenance.patch.yml`。DSH 的运行文件保存在仓库共享的 Git 元数据目录，配置引用其绝对路径，任务 worktree 清理后仍可使用。DSH 按仓库区分插件行，只作用于相应仓库及其 worktree，其他机器需分别注册。全局安装的技能先安装一份到目标项目，便于生成项目内的 hooks 路径。

按宿主要求完成信任或审阅并重载。Codex 的项目配置需受信任，Claude Code 的 hooks 变更按其审阅流程生效，Pi 重载扩展，DSH 新建使用相应 preset 的会话。

## 触发和核对

- 会话开始时恢复该会话的检查状态，并提醒适用的项目维护流程。
- 发生文件或提交变化后，默认每 10 次检查机会提醒核对规范、交互契约及原 PR。Codex、Claude Code 和 Pi 按工具结果检查，DSH 按模型步骤边界检查。
- Codex、Claude Code 和 Pi 在上下文整理前提醒核对。DSH 通过步骤检查和结束检查衔接。
- 有待核对变更时，结束检查要求继续完成一次维护。Codex、Claude Code 通过 Stop，DSH 通过 turn-stopping，Pi 通过 agent_before_settle 请求继续。

提醒会带当前会话的 24 位检查标识。AI 先完成相关文档及 PR 的核对，记录实际更新或无需调整的理由，再从任务工作区运行确认命令。将示例中的标识替换为 hook 给出的值。

```sh
node .agents/skills/project-doc-maintenance/scripts/maintenance.mjs ack --session 0123456789abcdef01234567 --note '已核对交互契约与原 PR，记录本轮验证范围' --document AGENTS.md
```

`--document` 可以重复，填写实际核对过的仓库内文件。纯内部调整可在具体说明中记录原因。检查状态按宿主、会话、Agent 标识和 worktree 隔离，存入 Git 元数据目录，配置备份及核对说明保留在本机。

确认记录表示已对当前变更作出核对声明。脚本通过变更指纹发现后续修改，文档语义和 PR 内容由维护者及审查者验证。hook 使用固定提示，文件内容、工具输出和核对备注都按数据处理。

为避免无限续跑，同一变更最多触发一次结束续跑，未经确认的一轮最多续跑三次。宿主已处于 Stop 续跑、用户中断、执行错误或 Pi 无法继续时遵守宿主控制。持续未核对的内容需在交付中明确报告。

## 检测

注册后增加 `--check` 检查配置是否完整，DSH 使用相同的 preset 参数。

```sh
node .agents/skills/project-doc-maintenance/scripts/setup-hooks.mjs --hosts codex,claude,pi,dsh --check
```

该检查证明注册配置符合本包要求。实际触发需在宿主中核对会话开始提示、修改后的定期提醒和结束续跑。可在当前 worktree 的 `git rev-parse --git-path project-doc-maintenance` 所指目录检查 `host`、`lastEvent`、`lastSeen` 和 `reviewedAt`，以确认真实事件到达。

Codex 与 Claude Code 的专用工具路径可能绕过工具 hooks，DSH 与 Pi 的事件接口也随版本演进。先在安装的版本中验收实际事件，按对应接口处理差异。

接口依据见 [Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Claude Code hooks](https://code.claude.com/docs/en/hooks) 和 [Pi 扩展接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。DSH 使用当前安装包公开的 `agent/created`、`agent/pre-step`、`agent/turn-stopping` 与 `Agent.inject/steer` 接口。
