# 场景模块

当前页面由 `src/App.tsx` 组合 `orbital/OrbitalScene.tsx`。场景以功能目录组织，业务状态、交互视图、样式和测试就近维护。

## 职责分布

- `orbital/OrbitalScene.tsx` 组合镜头、灯光、舱室、家具、住民与交互表面。
- `orbital/useWorldController.ts` 管理世界状态、动作适配器和转场生命周期。
- `orbital/journal/` 管理实体翻页、纸面编辑、逐页日期和天气、存档及迁移。
- `orbital/library/` 管理书柜存档、文本导入、实体书和取还书动作。
- `orbital/schedule/` 管理日程迁移、同步、纸页、贴纸、纸团和相关测试。
- `orbital/media/` 管理电脑屏幕布局、游戏卡带加载与拖放、唱片交互、实体键盘和相关测试。
- `orbital/` 根目录保留舱室、家具、住民、交互基础组件、材质与场景样式。
- `orbital/chairMotion.ts` 管理坐下、升降、滑行和起身的顺序；`chairAnimation.ts` 采样坐姿与局部接触缓存。资源与复建方法见 [Luna 制作源](../../assets/models/resident/README.md)。
- `orbital/media/RecordPlayer.tsx` 保留唱机/唱片的原有几何，`record-motion.ts` 统一管理舱室局部坐标路径、唱臂和串行播放阶段；架位在本次会话中稳定，音乐淡入淡出不影响房间音效。
- `audioEngine.ts` 提供音乐播放、静音、环境与脚步音效。
- `geometry.ts` 提供场景共用的几何工具。

## 模块接入

跨模块的数据接口定义在 `src/types/`。日程通过 `ScheduleProvider` 和 `useSchedule` 接入家具与纸面，书柜通过 `useLibrary` 接入应用和住民。媒体模块通过 `GameCartridgeProps` 按需加载 `src/games/*/index.tsx`。

新增功能优先复用 `ObjectHandle`、`Primitives` 和已有世界动作。运行时模型放在根目录 `assets/public/models/`，游戏与静态素材统一放在 `assets/games/`。

## 验证

在项目根目录运行 `npm test`，统一入口自动准备生产产物与引擎测试包，再运行功能回归。开发时可用 `node --test src/scene/orbital/media/*.test.mjs src/scene/orbital/schedule/*.test.mjs` 单独检查媒体和日程。

场景当前能力与限制见 [进度文档](orbital/进度文档.md)，已做过的验证见 [验收记录](orbital/验收记录.md)。对外的操作与集成约定见根目录 [SPEC.md](../../SPEC.md)。
