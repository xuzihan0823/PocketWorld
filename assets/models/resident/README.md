# Luna 动画制作源

## 转椅坐姿

`Luna-Sit-ContactFixed.blend` 基于用户提供的接触修正版，调整了落座深度与小腿轨迹，保留 115 骨骼、坐下动作、真实转椅和接触修形修改器。源文件 SHA-256：`a9b60ea23722f85dcf3d9bdb419eca4ed7bbafb8028778442f85e0aaf09af3ab`。角色与 Mixamo 行走素材沿用既有项目输入，未收到独立许可声明；不将其标记为 CC0。

### 运行资源

- `assets/public/models/resident/luna-walk-room.glb`：保留 `Walk_Grounded_Loop`，加入 `ChairSit_Contact`（第 1–68 帧，30 fps，时间归零后 67/30 秒）。31,140 个三角形，10,267,804 bytes。
- 同目录 `luna-seat-contact.bin`：68 帧、2,716 个局部顶点的蒙皮前修形，1,108,148 bytes。不能只替换 GLB 而遗漏该文件；普通 glTF 查看器只显示骨骼动作，不会自动应用此缓存。
- 相对原运行模型合计增加 3,097,320 bytes；源 `.blend` 不在 `assets/public/`，不进入网页构建。

原始 4096 × 4096 底色 JPEG 来自用户提供的 Tripo GLB，在 Git 提交 `2e1ff72` 的 `art/resident/animated-transfer/walk-repair/luna-walk-repaired.glb` 中也有相同副本。法线与粗糙度／金属度图保留 2048 × 2048。当前材质将法线强度设为 0.18、金属系数设为 0，并复用底色作为 0.55 强度的自发光，用来减轻室内近景的发际线和眼周暗块。

### 复建

使用 Blender 5.2.3 与 Python 3。所有中间文件必须输出到仓库外。以下路径为示例，`<外部目录>` 替换为实际绝对路径：

```text
blender --background --python scripts/bake-luna-chair.py -- --output <外部目录>
python scripts/pack-luna-chair.py --output <外部目录>
```

第二步默认从 Git 基线 `6f6df88` 读取原 Walk 与压缩贴图，也可通过 `--original <原始GLB>` 指定输入。动画重建后，把输出 `luna-room-contact.glb` 与 `luna-seat-contact.bin` 作为运行资源。打包脚本沿用 2K 基线材质，发布前需按上段的来源与参数恢复 4K 底色和当前材质。

制作脚本仅细化裙摆接触区，先限制为四骨骼权重，再从 Blender 评估网格反解蒙皮前位移；保留原平滑法线。转椅按场景尺寸归一化并降低 0.25 m，人物比例 1.43。升降通过人物与座椅共同平移实现，不伸长腿骨。

缓存为小端：20 bytes 头（`PWSC`、uint32 版本 1、uint32 帧数、uint32 顶点数、float32 量化步长），随后为帧优先的 int16 XYZ 位移。GLB 的 `_CONTACT_ID` 对应缓存行，-1 表示不修形；轴采用 glTF 的 X/Y/Z。量化分量误差小于 1.2 微米（世界坐标）。骨骼采样时间与缓存第零帧必须对齐。

### 验证边界

制作脚本检查原生 68 帧的接触面；运行时单测检查时间原点、绑定、独立实例、恢复、骨长与有限坐标。网页动作和导出后网格还需单独验收，不能用原生检查替代浏览器检查。验证结果及截图放在任务 PR，临时模型、报告和录屏不提交。

## 上床三版

`luna-bed-v3.blend` 是可编辑的 24 fps、0–222 帧动作；运行时使用 [独立动画库](../../public/models/resident/luna-bed-v3.glb)，复用既有 Luna 网格、115 骨骼、贴图与 Walk。制作源包含真实床接触尺寸、角色、关键帧、非破坏性 2-bone IK 控制器（`IK_LeftFoot`、`IK_RightFoot`、`IK_LeftHand`、`IK_RightHand`）与 Pole 目标（`Pole_LeftKnee`、`Pole_RightKnee`、`Pole_LeftElbow`、`Pole_RightElbow`）、相机和灯光，不进入网页构建。

### 动作与坐标

- 第 0 帧精确匹配运行态中立站姿，随后微屈膝并轻看向枕侧作预备，左手先撑向床沿稳定重心、缓步落座床边（0–42 帧），左腿先屈膝抬跨被面、右腿错拍约 10–14 帧跟进（46–98 帧），骨盆与肩背先落床缓冲再轻落头部于枕面，双手不对称舒展搭放进入舒缓睡姿（95–222 帧）。
- 在 `Luna_Retarget` 上绑定双臂双腿非破坏性 2-bone IK、关节限位与连续极向量求解，并配合真网格射线与 BVH 接触守护优化裙摆（`Dress_*`）垂落及发束（`Hair_*`）贴枕轨迹；全 223 帧身体网格与床面零 BVH 重叠，手、脚、骨盆、后背、头部、裙摆与发束均保持正安全间隙。
- Blender 米制 Z 向上；角色缩放 1.43，床按运行时 contact-fit 1.72 × 1.40 × 2.60。运行时入口为 `[-1.48, 0, 0.73]`、朝向 `Math.PI / 2`。外层位置固定，全部上床根运动由 Hips 通道负责。
- 最后睡姿保持；醒来或取消逆向采样当前动作，返回精确站姿后恢复行走。未新增闭眼或循环睡眠动作。

### 来源

沿用用户提供的二版/三版 Luna 上床制作源。二版前身为用户提供的 Plask XBot 动作与 Mixamo「Laying Sleeping」上身收尾；本轮在 `luna-bed-v3.blend` 内使用 Blender 2-bone IK 与 Pole 目标重做肢体与裙摆姿态后导出。Luna 与床来自项目既有 Tripo 模型。本次不新增外部模型或纹理，不把来源不明的素材声明为 CC0。运行时登记见 [来源清单](../../models.sources.json)。

### 复建与验证

使用 Blender 5.2.3：

```powershell
blender --background assets/models/resident/luna-bed-v3.blend --python scripts/export-luna-bed.py
npm test
```

导出脚本从此制作源和既有 `luna-walk-room.glb` 的绑定矩阵重建动画库，避免 Blender 骨骼坐标轴与 glTF 的差异。不需要临时试片目录。GLB 仅有 115 节点、230 通道，799,616 bytes（SHA-256：`932c8848921ed8517d66506faaee669de8a98f2ad19f34d14d53e3a5e1af6f00`），无网格、蒙皮或图片。

床专项测试覆盖中立首帧、单层根运动、恢复 Walk、暂坐足轴、全段半帧右踝连续性（最大半帧步长 0.04438 rad < 0.08 rad）、30/60/120 Hz、后台时间截断、反向取消与减少动态效果；全 223 帧网格审计确认身体与床零 BVH 重叠、11 项接触最小间隙均 ≥ +1.52 mm，48 Hz 关节角加加速度峰值 295,749 deg/s³。渲染验收图等中间产物存放在仓库外，不随代码提交。

## 站立伸懒腰

用户提供的 Mixamo `Yawn.fbx` 为 30 FPS、1–251 帧骨骼动作。`scripts/export-luna-yawn.py` 将上身世界旋转相对绑定姿态的变化转换到 Luna 的绑定坐标，导出 `luna-yawn.glb`，232,092 bytes、54 条旋转轨道、8.33 秒。骨盆、腿和脚沿用运行时中立站姿。首次普通待机时加载，运行时淡入淡出整段动作。

复建命令为 `blender --background --python scripts/export-luna-yawn.py -- <Yawn.fbx路径>`。输入由用户下载提供，许可见来源清单中的 Adobe Mixamo FAQ。普通待机复用现有骨骼，加入小幅胸腔呼吸、上身侧摆、转头及肩臂放松。9 秒普通待机采样中，头部移动范围约 1.7 cm，双手约 6.7–7.5 cm，脚部位置固定。


## 站立环顾

Mixamo 页面按描述 `Idle Stand Looking Around` 确认的 `Looking Around`，使用 X Bot 空手站姿，完整 1–191 帧。下载设为 FBX Binary / Without Skin / 30 FPS / Keyframe Reduction none；Body Type 0、Surprise Level 50、Overdrive 50、Arm-Space 50、Trim 0–100%、Mirror 关闭。不是同名持火把动作，也不是 `Look Around — Looking Around The Body`。

复用 `scripts/export-luna-yawn.py` 的绑定姿态与肩臂方向修正：`blender --background --python scripts/export-luna-yawn.py -- "<Looking Around.fbx路径>" looking-around`。生成 `luna-looking-around.glb`：180,012 bytes，54 条上身旋转轨道，6.33 秒；无网格、纹理和根位移。骨盆、腿及脚由原中立姿态负责，环顾期间保持原地。源 FBX 留在仓库外，SHA-256 与许可入口见来源清单。

两种偶发动作独立按需加载；某一资源失败不阻塞另一动作或普通待机。时序与打断由 `standingIdle.ts` 统一管理，数值参数及产品行为见 SPEC.md。
