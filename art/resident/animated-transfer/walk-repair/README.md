# Luna 行走与主场景接入

以用户提供的 Tripo 动作为基础，提取第 28–52 帧为 1 秒循环，96 Hz 烘焙。新版网格、115 根骨骼和修复动画现已接入主房间，替换旧静态模型的程序化重建骨骼。原迁移文件保存在上级目录，当前可编辑源为本目录 `luna-walk-repaired.blend` / `luna-walk-repaired.glb`。

## 当前版本

- 分布式接缝、短周期滤波和端点相邻切线修正；根据实际蒙皮脚底修正约 14° 足底倾角、两段腿骨与骨盆高度，不伸长腿骨。小幅肩胯配合属于动作造型，不是动力学求解。
- 在胸腔坐标系中增加克制的反向摆臂与肘部跟随，修正手臂/前臂和宽裙的接触，减轻手腕外翻，手指向绑定手型放松 50%，局部裙片在手部经过时内收。`arms-side.mp4` 左侧为前一轮、右侧为当前手臂版本。
- 生产模型 `public/models/resident/luna-walk-room.glb` 为 8,278,632 bytes、18,525 三角面、24,401 顶点，三张贴图均为 2K。4K 编辑 GLB 为 9,193,276 bytes；生产版只重编码底色并重新打包，保留全部几何和动画。
- `ResidentModel.tsx` 为每个房间克隆骨骼、共享几何与材质；`residentRig.ts` 混合导出动作与双脚落地站姿，并适配原有坐卧、跳跃、转椅及取书控制。独立白兔跟随手掌，取书前放到木台。
- GLB 原地行走，位移由游戏控制器独占。原步幅对应 `0.576` 模型单位/秒，主场景缩放 `1.43` 后速度约 `0.824` 场景单位/秒；步态和脚步声按实际位移推进，腾空时不触发行走声。

## 验证与限制

当前 `audit-arms-forearms.json` 以 Blender 回读 GLB，385 次采样检查手部及前臂与裙摆表面：最小间距约 **1.326 mm**，相交三角面对最大数 **0**，循环端点骨骼位置和角度差为 **0**。距离按 1 模型单位=1 米解释；游戏缩放后同步缩放。检查区域由蒙皮权重确定，含 BVH 候选和三角形交叉验证，不是全身连续碰撞证明。

完全承重阶段固定脚跟/前脚掌区域的最大水平漂移约 **2.922 mm**（假设向 glTF +Z 以 0.576 单位/秒移动）；左脚区间 0.0833–0.375 秒、右脚 0.5833–0.875 秒。进入/离开接触不计入该值，不能解释为整周期无滑动。较低一脚的最大离地高度约 0.942 mm。

`three-validation.json` 对生产 GLB 进行 Three.js 独立加载与 241 次全网格采样：单个 `Walk_Grounded_Loop`，115 骨骼，所有坐标有限，最低表面高度约 0.176 mm，端点骨骼矩阵差 0。角色回归另检查双脚站姿、完整权重下导出动作一致、跨房间骨骼独立、交互控制与蒙皮关节对齐以及恢复行走。

`npm test` 的类型检查、生产构建及 228 项测试全部通过，保留既有 large-chunk 提示，没有新增运行依赖。浏览器实测主场景加载、坐下/起身、躺床、取书和翻页；截图见 `src/scene/orbital/review/luna-room-bed.jpg`、`luna-room-book.jpg`。

原扫描网格的开放边界仍存在；没有表情、逐指抓握、裙发惯性或布料物理，没有全部交互姿态的自动防穿模。实体手机、Safari、地形适应及长期压力测试未验收。

## 复现与历史证据

在项目根目录运行（离线资产处理需要 Blender 和 FFmpeg）：

```powershell
blender --background --factory-startup --python src/scene/orbital/rig-transfer/repair_walk.py
python src/scene/orbital/rig-transfer/prepare_room_glb.py art/resident/animated-transfer/walk-repair/luna-walk-repaired.glb public/models/resident/luna-walk-room.glb
blender --background --factory-startup --python src/scene/orbital/rig-transfer/audit_walk.py -- art/resident/animated-transfer/walk-repair/luna-walk-repaired.glb --samples 385 --include-forearms art/resident/animated-transfer/walk-repair/audit-arms-forearms.json
node src/scene/orbital/rig-transfer/validate-walk.mjs public/models/resident/luna-walk-room.glb art/resident/animated-transfer/walk-repair/three-validation.json
npm test
```

开发预览：`/src/scene/orbital/rig-transfer/preview.html?version=repaired`；原版用 `?version=original`。对照页：`/art/resident/animated-transfer/walk-repair/review.html`。这些入口不加入生产页面。

`comparison-cycle.mp4`、`final-views/`、`audit-native.json`、`audit-luna-walk-repaired.json`、`metrics.json`、`browser-comparison.png` 保留前一轮足底修复记录，不作为当前手臂验收。`audit-source-cycle.json` 为原片段对照。旧报告中的资产路径保留采样时的位置。
