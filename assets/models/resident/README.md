# Luna 动画制作源

## 转椅坐姿

`Luna-Sit-ContactFixed.blend` 基于用户提供的接触修正版，加入撑扶手、后挪和收手的关键帧，保留 115 骨骼、真实转椅和接触修形修改器。第 53 帧是脚掌着地的前缘坐姿；第 65–85 帧支撑、抬髋后挪并落稳；第 98 帧双手已回到膝上。在 `ChairSit_ScootBack` 第 49–97 帧调整双侧上臂、前臂与手腕旋转。伸手时双肘向后让开，两掌略向外、掌心朝下压住扶手后再收手。离座逆放同一组关键帧。前裙随大腿抬起，后裙收进坐垫与靠背之间。源文件 SHA-256 为 `2e776a69b87a1c6bb69d5ee4518aadd68aa6a17da7583cb39d25c9383dc14221`。角色与 Mixamo 行走素材沿用既有项目输入，未收到独立许可声明；不将其标记为 CC0。

### 运行资源

- `assets/public/models/resident/luna-walk-room.glb`：保留 `Walk_Grounded_Loop`，加入 `ChairSit_Contact`（第 1–98 帧，30 fps，时间归零后 97/30 秒）。31,140 个三角形，10,406,152 bytes。
- 同目录 `luna-seat-contact.bin`：98 帧、3,251 个局部顶点的蒙皮前修形，1,911,608 bytes。不能只替换 GLB 而遗漏该文件；普通 glTF 查看器只显示骨骼动作，不会自动应用此缓存。
- GLB 与接触缓存合计 12.32 MB；源 `.blend` 不在 `assets/public/`，不进入网页构建。

原始 4096 × 4096 底色 JPEG 来自用户提供的 Tripo GLB，在 Git 提交 `2e1ff72` 的 `art/resident/animated-transfer/walk-repair/luna-walk-repaired.glb` 中也有相同副本。法线与粗糙度／金属度图保留 2048 × 2048。当前材质将法线强度设为 0.18、金属系数设为 0，并复用底色作为 0.55 强度的自发光，用来减轻室内近景的发际线和眼周暗块。

### 复建

使用 Blender 5.2.3 与 Python 3。所有中间文件必须输出到仓库外。以下路径为示例，`<外部目录>` 替换为实际绝对路径：

```text
blender --background --python scripts/bake-luna-chair.py -- --output <外部目录>
python scripts/pack-luna-chair.py --output <外部目录>
```

第二步默认从项目当前的 `luna-walk-room.glb` 复用 Walk、压缩贴图和材质。也可通过 `--original <角色GLB>` 指定来源。将输出的 `luna-room-contact.glb` 更名为 `luna-walk-room.glb`，与同一次导出的 `luna-seat-contact.bin` 一起更新到运行目录。

制作源保留细化过的裙摆、四骨骼权重和可编辑的接触修改器。制作脚本逐帧检查角色与椅子上半部的相交，并从 Blender 评估网格反解蒙皮前位移；保留原平滑法线。转椅按场景尺寸归一化并降低 0.25 m，人物比例 1.43。升降通过人物与座椅共同平移实现，不伸长腿骨。

缓存为小端：20 bytes 头（`PWSC`、uint32 版本 1、uint32 帧数、uint32 顶点数、float32 量化步长），随后为帧优先的 int16 XYZ 位移。GLB 的 `_CONTACT_ID` 对应缓存行，-1 表示不修形；轴采用 glTF 的 X/Y/Z。量化分量误差上界约为 0.99 微米（世界坐标）。骨骼采样时间与缓存第零帧必须对齐。

### 验证边界

制作脚本检查原生 98 帧的接触面；运行时单测检查时间原点、绑定、独立实例、恢复、骨长与有限坐标。网页动作和导出后网格还需单独验收，不能用原生检查替代浏览器检查。验证结果及截图放在任务 PR，临时模型、报告和录屏不提交。

## 上床三版

`luna-bed-v3.blend` 是可编辑的 24 fps、0–222 帧动作；运行时使用 [独立动画库](../../public/models/resident/luna-bed-v3.glb)，复用既有 Luna 网格、115 骨骼、贴图与 Walk。制作源包含真实床接触尺寸、角色、关键帧、相机和灯光，不进入网页构建。

### 动作与坐标

- 第 0 帧与场景的平衡站姿对齐。双手沿弧线伸向床沿，第 16–43 帧撑住床面，将髋部送上床。左、右前脚掌分别在第 13、17 帧后离地。
- 双手撑床时，分别用掌根和指腹贴合床沿弧面，拇指向床沿外侧张开。上臂和前臂分别限制绕骨段长轴的旋转，固定掌根和指腹接触时，肘部仍可自然屈伸。转髋换手时沿身体两侧收臂，再将双手搭回腹前。
- 坐到床沿后，左、右膝先后沿床沿转入，小腿提前伸展，让膝盖以较低的弧线越过床垫。八组三段裙骨共同控制裙褶。裙腰随髋，前裙横跨两条大腿，侧褶和后裙在床面收拢，这组旋转和位移一直延续到平躺。
- 第 54 帧前后坐稳，左膝先带动转髋，右腿稍后跟上。脚掌朝向随各自膝盖的弯曲平面转动。左、右脚底分别从约第 139、145 帧进入距床垫 12 mm 的接触带，脚跟继续下沉，在约第 151、157 帧落稳。第 192 帧起保持搭腹睡姿。
- 在 `Luna_Bed_V3_DirectSeat` 中编辑 `Bed_LeftHeelRoll`、`Bed_RightHeelRoll` 与两侧 `ToeRoll` 控制骨，可分别调整踝和前脚掌。导出脚本只采样原角色的变形骨骼。
- Blender 采用米制、Z 向上，角色缩放 1.43，床按运行时尺寸 1.72 × 1.40 × 2.60 拟合。制作文件使用原场地，导出器以原入口 `[-1.48, 0, 0.73]` 为根运动原点。网页由 `cabinLayout.ts` 将床放到 `[-4.05, 0, -1.897]`，入口同步平移到 `[-2.93, 0, -2.167]`，朝向 `Math.PI / 2`。动作位移由 Hips 通道负责。
- 最后睡姿保持；醒来或取消逆向采样当前动作，返回精确站姿后恢复行走。未新增闭眼或循环睡眠动作。

### 来源

沿用用户提供的二版 Luna 上床试片。二版前身为用户提供的 Plask XBot 动作，后半段重定向并按真实床适配；Mixamo「Laying Sleeping」只提供最后上身微动与搭腹手势，不包含落腿动作。Luna 与床来自项目既有 Tripo 模型。本次不新增外部模型或纹理，不把来源不明的素材声明为 CC0。运行时登记见 [来源清单](../../models.sources.json)。

### 复建与验证

使用 Blender 5.2.3：

```powershell
blender --background --python scripts/export-luna-bed.py
npm test
```

导出脚本从此制作源和既有 `luna-walk-room.glb` 的绑定矩阵重建动画库，避免 Blender 骨骼坐标轴与 glTF 的差异。GLB 包含 115 个节点、230 条通道，大小为 799,616 bytes。

床专项测试以 24、60 Hz 正放及 1.35 倍倒放检查踝部扭转、蒙皮足轴与膝弯平面的夹角、足底侧倾、屈伸和入口双脚重植。落脚时从脚底顶点首次进入 12 mm 接触带起检查水平位移小于 3 mm。

手部测试通过真实播放器检查臂腕转动的连续性。撑床及换手时，用指根横轴测量手腕侧折，检查肘部弯曲及其相对躯干的位置。承重时分别从掌根、指腹的蒙皮顶点向床面测距。从坐沿到睡稳，沿左右大腿表面向前检测裙片覆盖，同时检查前裙边缘相对大腿的位置。转身时还检查左脚与右小腿交错处的距离。采样范围及睡姿局部压入情况见[场景进度](../../../src/scene/orbital/进度文档.md)。

## 站立伸懒腰

用户提供的 Mixamo `Yawn.fbx` 为 30 FPS、1–251 帧骨骼动作。`scripts/export-luna-yawn.py` 将上身世界旋转相对绑定姿态的变化转换到 Luna 的绑定坐标，导出 `luna-yawn.glb`，232,092 bytes、54 条旋转轨道、8.33 秒。骨盆、腿和脚沿用运行时中立站姿。首次普通待机时加载，运行时淡入淡出整段动作。

复建命令为 `blender --background --python scripts/export-luna-yawn.py -- <Yawn.fbx路径>`。输入由用户下载提供，许可见来源清单中的 Adobe Mixamo FAQ。普通待机复用现有骨骼，加入小幅胸腔呼吸、上身侧摆、转头及肩臂放松。9 秒普通待机采样中，头部移动范围约 1.7 cm，双手约 6.7–7.5 cm，脚部位置固定。


## 站立环顾

Mixamo 页面按描述 `Idle Stand Looking Around` 确认的 `Looking Around`，使用 X Bot 空手站姿，完整 1–191 帧。下载设为 FBX Binary / Without Skin / 30 FPS / Keyframe Reduction none；Body Type 0、Surprise Level 50、Overdrive 50、Arm-Space 50、Trim 0–100%、Mirror 关闭。不是同名持火把动作，也不是 `Look Around — Looking Around The Body`。

复用 `scripts/export-luna-yawn.py` 的绑定姿态与肩臂方向修正：`blender --background --python scripts/export-luna-yawn.py -- "<Looking Around.fbx路径>" looking-around`。生成 `luna-looking-around.glb`：180,012 bytes，54 条上身旋转轨道，6.33 秒；无网格、纹理和根位移。骨盆、腿及脚由原中立姿态负责，环顾期间保持原地。源 FBX 留在仓库外，SHA-256 与许可入口见来源清单。

两种偶发动作独立按需加载；某一资源失败不阻塞另一动作或普通待机。时序与打断由 `standingIdle.ts` 统一管理，数值参数及产品行为见 SPEC.md。

## 书柜取书与归还

用 Blender 5.2.3 在 Luna 原骨架上制作底、中、顶三条取书动作。制作帧 0–36 以两倍时长映射到导出帧 0–72，之后为「导出帧 = 制作帧 + 36」；导出 0–180 帧、30 fps、6 秒。右手四指指腹分别贴住近侧封面。食指越过圆角，与中指一起在指根屈曲、末节展平后压住封面，拇指从书脊侧抵住包边，导出第 60 帧握稳，第 72 帧后才移动书，第 108 帧完成直线抽出，第 124 帧支撑手接稳书底，第 132 帧开始降低倾转，第 156–180 帧交接到程序闭书姿态。顶层在制作 72–96 帧沿书脊上滑指尖，随书本降低调整握点；三层到第 132 帧均先竖直接底，再转向腰腹前方。全段退步约 30 cm，侧让避开头发；末帧书本中心高 0.84 m，手掌分别覆住封面和托住底部。归还倒播对应阶段。骨骼与书本标记在同一 GLB 中，场景按书位平移，两者按同一时刻采样。

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-library.py
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-library.py -- --row 2 --blend "<仓库外目录>/Luna-书柜.blend"
```

脚本需要项目的 Node.js 依赖，用来读取运行时同款中立站姿。可选的 `--row` 为 0（底层）、1（中层）或 2（顶层），用于选择 Blender 文件中默认显示的书层。文件内保留三层的动作、书本标记、书柜尺寸参考和独立相机；在 Blender 修改关键帧后可用 `--from-blend` 从已编辑文件重新导出。运行时 `luna-library.glb` 仅包含动作、骨架和书本标记，大小 1,383,148 bytes，首次书柜互动时按需加载。`luna-library-neutral.mjs --handoff` 采样真实程序 IK 的闭合托书、封面抓握与全身姿态；烘焙末段保留手书接触，在世界坐标中衔接臂段轴向旋转，并在离线烘焙中展开连续轴角，避免最短四元数混合在半圈处换支。伸手使用向前绕开的腕部路径，腕位置只插值并求解一次，肘平面从真实中立姿态进入，仅对臂段轴向旋转渐变；未接触的掌向根据实际求解出的前臂限制折角，避免二次局部旋转插值把手掌折向肘部。烘焙按解缠后的真实旋前角分担前臂扭转，仍限于 1.75 rad，避免正弦分担在接近半圈时衰减到零；托底接力时略向内调整肘平面。网页闭合封面右手使用同样上限的精确分担，展开前半段连续淡出，阅读和双向翻页保留原公式。普通模式取书片段为 6 秒，开合封面各 1.35 秒，开书前 20% 完成烘焙到程序姿态的交接。打开、阅读和翻页由 `src/scene/orbital/library/` 的程序姿态与下述 Blender 翻页控制曲线共同驱动：闭书保持腰前平持，开封面时手掌与手指共用封面平面，右手沿铰轴移动以留出前臂空间，随后进入原有阅读和双向翻页终点；封面、浅 V 纸页与手部接触点共用变换。正向翻页为左手托书、右手带页，反向交换分工。

托底转移采用 `SUPPORT_SKIN_OFFSETS` 的书本局部接触修正：在制作帧 96–144（导出帧 132–180）加密到每帧四个采样。烘焙先保留原始手掌、手指朝向与动作，再从评估后的 Blender 姿态只重新求解左腕位置和两段手臂，保持原肘部弯曲平面；修正值依据实际蒙皮到圆角封面三角形的距离标定。导出仍为 6 秒，含 325 个采样时点，归还逆向使用同一动作。程序开合与双向翻页仍由网页姿态控制。

程序开合左手继续使用 `bookSupportPose` 的提早抬升曲线，右手闭合抓握的前臂轴向分担在展开前半段淡出；阅读和双向翻页保留原轨迹。取书左手在导出 124 帧完成接触求解并开始承重，主手在 132 帧后才转向封面；接托期间的肘部让位连续淡出到原转书姿态。不能把接近 1 的伸手混合权重或掌部代理点当作真实皮肤接触。左手从书底下方进入接托。真实手与书的三角面回归覆盖三层正逆 115–134 帧，每 0.25 帧采样，共 462 个姿态。双手进入书体的深度须小于 1 mm，从第 124 帧开始要求左手承重间隙小于 2 mm；原转书与开合接触、65°掌向、70°静态腕角及连续性阈值保留。右掌在书本局部朝 +Y，左手承重后，右手沿书脊外缘退开并绕书本局部 Z 轴换握。闭书时右掌朝 −Y、左掌朝 +Y。回归以放松时五指的自然内弯方向标定蒙皮指腹，以拇指对掌校验左右掌面符号，逐层双向检查每根手指的指腹顶点到近侧封面、拇指腹到包边，以及左掌侧到书底的距离。有限采样的范围见[场景进度文档](../../../src/scene/orbital/进度文档.md)。

### 翻页曲线制作与运行时对照

`scripts/bake-luna-page-turn.py` 创建 `PageTurnControls` 和可编辑的 `Luna_PageTurn_Controls` 动作，将纸页进度的 Bezier 控制柄、松手时点、起手与回托距离和时序、抬手高度、卷曲宽度、肘部方向与视线参数导出到 `src/scene/orbital/library/pageTurnFrames.ts`。运行时直接计算这些控制柄，纸页以从自由边向书脊传播的弯曲波替代整页刚性旋转；指尖 IK 使用当前弯曲中指的真实骨链偏移。制作时间线为 0–100 帧、100/3 fps，与网页普通模式的 3 秒翻页对应。

以下 PowerShell 命令在已激活项目 Node.js 依赖的工作区执行；`$reviewDir` 必须指向仓库外的临时目录。

```powershell
$reviewDir = $env:PI_SCRATCH_DIR
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-page-turn.py -- --blend "$reviewDir/Luna-PageTurn.blend"
node scripts/sample-luna-page-turn.mjs --output "$reviewDir/runtime-page-turn.json"
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-page-turn.py -- --runtime "$reviewDir/runtime-page-turn.json" --blend "$reviewDir/Luna-PageTurn.blend"
```

可编辑 Blender 控制器后用 `--from-blend "$reviewDir/Luna-PageTurn.blend"` 重新导出曲线，再重新采样实际运行时姿态。`--runtime` 导入正反两套 101 帧的真实蒙皮骨骼、书本变换与纸页顶点，供多视角对照；查看动作时须同时选择对应的 `Luna_PageTurn_*`、`Book_PageTurn_*`、`Sheet_PageTurn_*`，相机为 `Front`、`Left`、`Right`、`Top`、`ThreeQuarter`。这些骨骼动作是运行时的审查快照；直接改快照骨骼不会自动修改网页动作，网页使用的源仍是控制曲线与 IK 实现。

重建时先导出控制曲线，再采样网页，最后导入新采样；修改过控制器的场景在最后一步加 `--from-blend`，避免默认参数覆盖编辑值。截图、采样 JSON 与检查用 Blender 文件留在仓库外，不进入静态发布包。已有取书 GLB 不受翻页曲线导出影响。
