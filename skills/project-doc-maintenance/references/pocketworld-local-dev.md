# PocketWorld 本地开发流程

复用当前项目的 Node.js、npm、Vite、独立 worktree、模块沙盒和 PR 交付方式。执行前检查当前分支的 `package.json`、锁文件及相关模块 README，命令随实际脚本调整。

## 开发环境与依赖

当前本机使用 Node.js 24。其他成员先核对项目要求，涉及 `node:fs` 的 `globSync` 和 Node.js 24 测试入口时使用兼容版本。包管理器沿用 npm 和 `package-lock.json`。

同一台机器的新 worktree 可以复用主检出目录的 `node_modules`。确认依赖声明和锁文件一致、目录有效且当前 worktree 没有自己的依赖目录或链接后，用软链接接入。将以下示例中的主检出路径替换为本机实际位置，在任务 worktree 中执行。

```sh
main_checkout='/path/to/PocketWorld'
ln -s "$main_checkout/node_modules" node_modules
```

需要改变依赖或锁文件时，由维护负责人协调，在任务工作区准备隔离依赖。共享依赖更新会影响使用它的其他 worktree，先确认使用情况。

其他成员的机器按本机环境和锁文件执行 `npm ci --no-audit --no-fund`，随后按相同流程开发。依赖目录涉及本地平台与架构，使用本机安装结果。已有依赖目录需要重建时先确认其归属，`npm ci` 会重新安装该目录。

## 预览与调试

每个任务使用独立端口，通过 `--strictPort` 让冲突直接报错。先核对端口占用及所属任务，再后台启动开发服务，保存日志和进程信息。下面的端口为示例，确认可用后使用。

```sh
preview_log="$(mktemp -t pocketworld-preview)"
nohup npm run dev -- --host 127.0.0.1 --port 5188 --strictPort >"$preview_log" 2>&1 &
preview_pid=$!
printf 'preview pid=%s log=%s\n' "$preview_pid" "$preview_log"
```

从日志确认成功启动和实际访问地址。按本次修改选择以下入口。

| 入口 | 验证用途 |
| --- | --- |
| `/` | 完整房间、家具和模块集成 |
| `/?game=ski` 或 `/?dev=mario` | 滑雪游戏独立入口 |
| `/?dev=shooter` | 射击游戏独立沙盒 |

独立入口适合快速迭代，涉及房间集成的改动还要检查根入口。前端交互和手机适配记录实际使用的浏览器、视口或设备。HTTP 成功只证明入口可请求。

验证结束后定向停止本任务的服务。核对保存的 npm 进程及该端口对应的 Vite 子进程，确认命令和工作目录后清理，并检查端口已释放。只终止 npm 父进程可能保留 Vite，清理时覆盖实际监听进程。其他任务的服务由其所有者维护。

## 类型、构建与测试

先查看当前 `package.json` 的脚本。基础入口如下。

```sh
npm exec --no -- tsc --noEmit
npm run build
```

若当前分支提供 `npm run typecheck`，使用该入口。若提供 `npm test`，先阅读脚本的准备工作及覆盖范围，按项目要求执行；当它已包含类型检查和构建时，一次成功执行可作为相应验证证据。

只有 `dev`、`build`、`preview` 的版本按模块 README 准备产物，再运行与改动相关的 `node --test`。某些游戏测试依赖预先生成的引擎包或生产构建，目录整理后的版本可能改用统一入口。使用当前工作区的文件和脚本，核对准备条件后执行。

纯文档或技能说明修改检查差异、链接与技能格式。技能分发内容变化时，在临时目录执行 npx 安装并核对随包参考资料，随后更新原 PR 的验证记录。

## 交付衔接

验证结果和未验证项写入当前草稿 PR。完成后提交审查，合入 `main` 后按 [开发与交付流程](delivery-workflow.md) 及时清理已交付分支和工作区。
