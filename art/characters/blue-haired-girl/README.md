# 蓝发少女：可编辑制作版

本版本尚未达到“高精度复原”验收标准，不应替换 PocketWorld 的默认角色。脸部神态、刘海分叉、发尾节奏、胸前褶皱与手足关节仍需人工精修。工程、蒙皮、表情及导出文件可以继续使用；六个动作是变形检查动作，不是已完成的游戏动画。

## 参考与造型

用户已确认 `references/board.png` 为本次唯一外观依据。正面全身确定比例，面部特写确定五官，侧面和背面补全体积。未使用其他生成角色或外部模型替代参考人物。参考板中的兔子不在本次人体重建范围。

约 1.43 m、5.7 头身，初始 A-Pose。人体采用体素融合后的连续可编辑网格；头部采用参数化四边面曲面，眼眶为真实几何开口，虹膜为贴合三维眼球的曲面。头发采用具有透镜形截面和厚度的独立发束。裙装拆为罩片、肩带、腰边、主裙及两层荷叶边，蝴蝶结包含独立布面与飘带；裙内补全棉布内衬。

以上是本轮程序化原生建模的实现方式，不能等同于完成了人工雕刻与生产级重拓扑。尤其面部和四肢尚未形成适合大幅表演的完整关节环线。

## 文件

- `character.blend`：原生可编辑对象、细分修改器、完整骨骼、NLA 动作、表情和打包纹理。隐藏的 `REFERENCE · user board` 集合中保留参考板。
- `character.glb`：以米为单位，Y 向上、+Z 为正面；内嵌纹理，无外部解码器依赖。
- `renders/front.png`、`side.png`、`back.png`、`three-quarter.png`、`face.png`：Blender 实际渲染。
- `renders/threejs-*`：项目所用 Three.js 版本加载最终 GLB 的实际截图，包括表情与动作。
- `textures/`：面部腮红、虹膜、头发渐变及布料底色纹理。
- `rig-interface.json`：人形骨骼名、29 条三段发链、8 条三段裙链、表情名与手持挂点。
- `validation-blender.json`、`validation-webgl.json`、`validation-gltf.json`：导出检查数据。

## 动作与运行时接口

骨架共 165 根骨骼，包含双手五指的三段指链、眼球、头发及裙摆。每顶点最多四个骨骼权重。`Blink`、`Smile`、`MouthOpen` 为形变键，`Neutral` 的中性状态以所有表情权重归零为准；眼球方向由 `Eye.L`、`Eye.R` 控制。

GLB 包含 `Idle`、`Walk`、`Sit`、`LieDown`、`HoldObject`、`EyeLook` 六个检查片段。手持动作未与实际道具进行接触验收，坐姿裙边仍有折叠与局部拉伸，躺姿尚未对床面、头发和裙摆进行接触修正。形变数据可播放不代表动作质量通过验收。

Three.js 中用 `GLTFLoader` 加载，用 `SkeletonUtils.clone` 创建角色实例，再用 `AnimationMixer` 播放片段。表情需要遍历各 `SkinnedMesh.morphTargetDictionary`，按名称设置对应权重。两个 `Grip.*` 节点用于后续校准握持位置。

发链和裙链已经蒙皮，但没有实现 Spring Bone、碰撞约束或实时布料系统。`rig-interface.json` 仅描述接入点，不会自动产生物理效果。

## PocketWorld 替换边界

候选运行文件另存于 `public/models/resident/blue-haired-girl.glb`。现有 `luna.glb` 和默认加载路径保持不变。

目前 `ResidentModel.tsx` 会基于旧的单网格、颜色与特定坐标临时重建骨骼。不能把本文件改名为 `luna.glb` 直接覆盖：新模型需要改用原生蒙皮，适配骨骼的静止旋转、髋高、手掌接触、坐卧与书柜交互，并处理原兔子独立资产。该运行时替换尚未实施。

## 验证范围与剩余差距

Khronos glTF 校验和 Blender 重新导入用于确认格式、骨骼、权重和纹理完整性。Three.js/Chrome 检查用于确认实际加载、动画采样及表情可运行；未进行手机性能验收，也未完成所有时刻与方向的碰撞扫描。

当前仍存在较多独立绘制批次，需要在保留 Blender 对象编辑性的同时合并运行网格。人物相似度和变形质量优先于这项优化；因此本版本保持制作版状态。

## 继续制作

在仓库根目录，通过本机 Blender 后台模式运行 `scripts/blender/build_blue_character.py`，然后运行 `rig_blue_character.py`。重建脚本默认拒绝覆盖已有 `character.blend`；只有主动传入 `-- --overwrite-generated` 才覆盖。已在 Blender 手工修改的版本应先另存。

`export_blue_character.py` 从当前工程重新导出，保留工程中的高密度网格，运行文件对人体做减面。它也会更新多视角图。`check_blue_character.py` 在新场景中重新导入 GLB 检查。无需安装新的项目运行依赖。
