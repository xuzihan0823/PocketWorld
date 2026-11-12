# 带原始行走动画的裙发骨骼迁移

后续行走修复及主场景接入已完成，编辑版为 `walk-repair/luna-walk-repaired.glb`，运行版为 `public/models/resident/luna-walk-room.glb`，见 [修复交付与验证](walk-repair/README.md)。此文以下描述保留的原始迁移版本；独立预览默认打开修复版，可切换回原版。

已完成独立资产迁移，尚未替换房间默认角色。本版本只播放用户提供的 Tripo 动画，不调用旧版 Walk/SitCycle 等动作生成逻辑，也不复制它们的修正形变。旧文件与旧工作区保持可回退。

- 输出：[luna-tripo-animated.glb](luna-tripo-animated.glb)，9,739,952 bytes。
- 可编辑源：[luna-tripo-animated.blend](luna-tripo-animated.blend)。
- 骨骼来源：`feat/tripo-hair-dress-rig` 工作区的 `luna-tripo-transitions.glb`，SHA-256 记录在 [迁移报告](transfer-report.json)。
- 动画来源：用户提供的 `tripo_convert_916fb9a1-fd20-4e37-a8b9-05c108736b06.glb`；保留原来的一个约 4.9583 秒动作。

## 迁移内容

保留新文件的全部 65 根人体及手指骨骼，迁入 26 根 `Hair_*` 与 24 根 `Dress_*`，共 115 根。头发链挂在 `mixamorig:Head`，裙摆链挂在 `mixamorig:Hips`。根据逆绑定矩阵重建辅助骨的局部静态变换，保留旧骨骼的附加元数据。

使用绑定姿态位置匹配、UV 消歧转移旧版裙发权重：6,144 个头发顶点、5,616 个裙摆顶点。位置匹配最大误差 2.40e-7；每顶点最多四个骨骼影响，权重归一化。新 GLB 的其他身体权重保持原样。旧版额外补洞面和专用动作形变不移植，输出仍为 18,525 三角面、24,369 顶点。

直接追加 glTF 骨骼节点、逆绑定矩阵和蒙皮属性，保留原二进制段，因此原动作关键帧、人体骨骼变换、位置、UV、法线、索引、材质与嵌入贴图数据不重新编码。辅助骨改变裙发的变形归属，运动中的裙发外形会相应变化，不等于逐顶点复现原动画表面。

## 验证

- Blender 5.2.3 独立回读：115 骨骼、1 动作、3 图片；无无效坐标、退化三角形或未赋权顶点。见 [metrics.json](metrics.json)。
- Three.js 48 Hz 共 239 次采样：原 65 骨骼世界矩阵最大误差为 **0**；所有采样顶点有限。绑定姿态完整表面最大误差 **3.74e-7**。
- 裙发旋转测试：头发带动 6,141 个顶点，裙摆带动 5,616 个顶点；区域外位移均为 **0**。见 [three-validation.json](three-validation.json)。
- 已打开检查六视图与六个动作帧：[多视图](views/contact_sheet.png)、[动作采样](views/animation_contact_sheet.png)。
- 内置浏览器实际加载确认 115 骨骼、原始行走、暂停/重播、绑定姿态、骨架显示、裙发滑杆及正侧面观察。见 [浏览器截图](browser-preview.jpg)。未做完整连续视频审美验收。
- `npm run build`（含 TypeScript）通过；保留现有大 chunk 提示，未增加依赖。

## 使用与复现

在项目根目录运行 Vite 后打开 `/src/scene/orbital/rig-transfer/preview.html`。预览只使用 GLB 内的原动作；滑杆是临时蒙皮测试，不保存至文件，也不模拟物理。静态生产构建当前不包含此开发预览入口。

迁移脚本：`src/scene/orbital/rig-transfer/transfer.py`。使用 Blender 后台运行并传入 `--target`、`--donor`、`--output`、`--report`。脚本会拒绝人体绑定矩阵不匹配、缺少匹配顶点等情况，避免盲目套骨架。

运行回归：`node src/scene/orbital/rig-transfer/validate.mjs <原动画GLB> <输出GLB> <报告JSON>`。

## 后续边界

此轮交付骨架与权重迁移。原动作的手与裙摆穿模、脚步观感和首尾姿势差仍需微调；没有加入自动碰撞或裙发物理。旧版对 SitCycle、Walk 的特定修正不能直接套用到这段新动作。未迁入任何坐卧、取书动画，也未更换主场景控制器；游戏内切换、交互姿态和坐椅位置将在接入阶段另行验证。

贴图保持用户原文件质量，未在这一步压缩。GLB 可独立导入 Blender/Three.js；编辑器约束或游戏运行时碰撞不会因骨架存在而自动获得。
