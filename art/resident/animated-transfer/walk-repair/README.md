# Luna 行走修复

修复以用户提供的 Tripo 动作为基础，提取原文件第 28–52 帧的完整周期。保留原版 `luna-tripo-animated.glb`、迁移源文件与旧工作区，新增 `public/models/resident/luna-walk-repaired.glb` 和本目录的 `luna-walk-repaired.blend`。没有替换主房间角色。

## 已完成

- 1 秒循环，96 Hz 烘焙，首尾姿势一致；分布式接缝修正、短周期滤波和端点相邻切线修正，保留原动作节奏。
- 根据实际蒙皮脚底校正接触；绑定姿态的足底并不平，承重时额外修正约 14° 足底倾角，避免脚尖着地但脚跟悬起。
- 两段式腿部旋转校正，不伸长腿骨；骨盆降低 0.028 模型单位以满足平脚的可达范围，小幅左右承重转移 0.008 单位、胸肩转动 1.5°。这些是动画造型调整，并非动力学求得的真实质心。
- 保留原摆臂与肘部节奏，上臂外展避开宽裙；减轻手腕外翻，手指向绑定手型放松 25%。
- 预览支持原版／修复版、正侧背面、暂停与时间轴、半速播放、骨架和匹配速度移动网格；增加接触阴影。

## 复核数据

模型总高约 1 单位。下表为按 1 单位=1 米解释的毫米值；游戏缩放后须同步缩放距离和移动速度。原版与修复版都采样 97 次，原版对照为同一 28–52 帧片段。

| 指标 | 原片段 | 修复版 |
|---|---:|---:|
| 循环端点最大骨骼位置差 | 21.06 mm | 0 |
| 循环端点最大骨骼角度差 | 8.46° | 0° |
| 较低一脚的最大离地高度（整个周期） | 15.09 mm | 0.94 mm |
| 固定脚底区域最大水平漂移（完全承重区间） | 28.05 mm | 2.93 mm |
| 手部与裙摆最小表面距离 | 接近 0，存在交叉 | 10.94 mm |
| 单次采样手裙相交三角面对最大数 | 233 | 0 |

水平漂移假设角色以 **0.576 模型单位/秒** 沿 glTF +Z 前进。GLB 本身原地行走，根位移应由游戏控制器独占。完全承重区间：左脚 0.0833–0.375 秒，右脚 0.5833–0.875 秒；固定绑定网格的脚跟／前脚掌顶点区域，以首次接触采样为参考，测量累积偏移。进入、离开接触的阶段也保留在报告中，但不计入此全掌承重漂移值，不能将它解释为整周期无滑动。

脚底最小值与脚跟／前脚掌高度、正侧面视觉共同核对；仅最低点贴地不代表全掌贴地。手裙检查包含 BVH 候选加边与三角形交叉验证，覆盖蒙皮主要属于手部和裙摆的面；不是全身连续碰撞证明。

Three.js 独立加载 241 次全网格采样：一个 `Walk_Grounded_Loop` 动作、115 骨骼，所有坐标有限，端点骨骼世界矩阵差 0，最低表面高度 0.176 mm。端点两侧有限差分速度分量差最大约 0.045 单位/秒，包含有限采样与局部加速度，未宣称严格解析 C1 连续。

Blender 源与独立 GLB 回读均完成同一接触检查。导出 18,525 三角面、24,401 顶点、3 张贴图，9,175,132 bytes；比源多 32 个导出分裂顶点，三角面数量保持不变。未发现无效坐标、退化三角面、缺失材质或未赋权顶点。原扫描模型的开放边界仍存在。

`npm run build`（含 `tsc --noEmit`）通过，仍有原项目 large-chunk 提示，未增加依赖。浏览器完成实际加载与正侧面、时间轴、播放及移动网格检查。完整循环视频已在浏览器打开检查，审美判断以对照预览为准。

## 文件与复现

- `luna-walk-repaired.blend`：96 fps，可编辑烘焙关键帧。
- `comparison-cycle.mp4` / `review.html`：24 fps 原片段与修复片段的正侧面四栏循环。
- `final-views/`：六视图及关键帧。
- `audit-source-cycle.json`、`audit-native.json`、`audit-luna-walk-repaired.json`：接触与手裙检查。
- `three-validation.json`、`metrics.json`：运行时采样和资产检查。
- `browser-comparison.png`：实际浏览器对照页。

从工作区运行：

```powershell
blender --background --factory-startup --python src/scene/orbital/rig-transfer/repair_walk.py
blender --background --factory-startup --python src/scene/orbital/rig-transfer/audit_walk.py -- public/models/resident/luna-walk-repaired.glb art/resident/animated-transfer/walk-repair/audit-luna-walk-repaired.json
node src/scene/orbital/rig-transfer/validate-walk.mjs public/models/resident/luna-walk-repaired.glb art/resident/animated-transfer/walk-repair/three-validation.json
```

开发预览：`/src/scene/orbital/rig-transfer/preview.html?version=repaired`，原版用 `?version=original`。对照视频：`/art/resident/animated-transfer/walk-repair/review.html`。这些是 Vite 开发入口，未新增生产页面入口。

## 范围限制

本轮修复平地直行循环。裙发保留父骨随动，未添加独立惯性、回弹、运行时碰撞或自动防穿模；两个滑杆仍是固定测试偏转，验收时均归零。没有迁移坐卧、取书或主房间状态机，也未验证地形、转向、起停和交互混合。没有计算真实人体质量分布或动力学稳定性。骨骼存在不代表物理已实现。
