# 当前检查点

新版 Luna 已接入主场景。编辑源为本目录 `luna-walk-repaired.blend` / `luna-walk-repaired.glb`；生产模型为 `public/models/resident/luna-walk-room.glb`，仅把底色缩至 2K。

当前证据：`arms-side.mp4`、`audit-arms-forearms.json`（385 次手与前臂/裙面采样）、`three-validation.json`（生产 GLB 的 241 次全网格采样），以及 `src/scene/orbital/review/luna-room-bed.jpg`、`luna-room-book.jpg`。`npm test` 包含类型检查、生产构建及 226 项测试，全部通过。

`comparison-cycle.mp4`、`final-views/`、`audit-native.json`、`audit-luna-walk-repaired.json`、`metrics.json`、`browser-comparison.png` 是前一轮足底修复证据，手臂以当前报告和 `arms-side.mp4` 为准。旧报告中的文件路径是采样时的位置；源文件现已移入 `art/`。

没有未收集的渲染任务。预览为 Vite 开发入口，生产入口仍是主房间。裙发物理、全部姿态防穿模、实体手机/Safari 与长期压力测试未实现或未验收。复现方法和边界见 README.md。
