# Luna 动画制作源

## 地毯旁的懒人沙发

落座主段取自 CMU Graphics Lab 的 75_20「low sit」。源动作为 60 Hz，烘焙使用第 95–261 帧（从 1 计数），保留下降和落座后的回稳段，以 30 Hz 导出。骨盆位移按 Luna 身形和座面校准，双腿 IK 固定原站姿脚掌，前裙三段裙骨沿腿面逐段弯折，两侧朝膝盖收拢，后摆越过软垫前缘后下垂，起身从当前样本逆放。坐垫的承重形变由同一播放时间驱动。[官方动作目录](https://mocap.cs.cmu.edu/search.php?subjectnumber=75) · [免费使用条件](https://mocap.cs.cmu.edu/)

将[主体骨架](https://mocap.cs.cmu.edu/subjects/75/75.asf)和[原始角度数据](https://mocap.cs.cmu.edu/subjects/75/75_20.amc)放入同一个仓库外目录。将环境变量 `CMU_SUBJECT_75` 设为该目录，再从仓库根目录运行下列命令，以实际运行站姿为基准复建动作。文件校验值与致谢见[素材登记](../../models.sources.json)。

```sh
node scripts/luna-library-neutral.mjs > /tmp/luna-neutral.json
blender --background --python scripts/bake-luna-sofa.py -- "$CMU_SUBJECT_75" /tmp/luna-neutral.json
```

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

## 日常裙装的站姿修形

[`Luna-ArmContact.blend`](Luna-ArmContact.blend) 打开时显示放松后的站姿，可在 `Luna_Surface` 的 Shape Keys 中分别调节 `LeftArmContact` 和 `RightArmContact`。两侧修形对应裙侧的受压和腋下过渡。运行时按同侧上臂、前臂朝下的程度和前伸幅度调节权重，抬手时释放。固定椅、沙发和取阅书籍使用已有接触姿势。

在仓库根目录复建可编辑文件及运行时 GLB：

```bash
reviewDir=$(mktemp -d)
git show 80d880c:assets/public/models/resident/luna-walk-room.glb > "$reviewDir/luna-base.glb"
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/sculpt-luna-arm-contact.py -- --base "$reviewDir/luna-base.glb"
```

直接在 Blender 修改形态键后，给同一命令追加 `--from-blend assets/models/resident/Luna-ArmContact.blend` 将修改导出。打包只添加稀疏目标，保留原始顶点顺序、坐姿接触索引、骨骼、动作和贴图数据。偏头与拢手的角度来自 Luna 本地动作试演，由网页按时间包络播放。

## 云朵连帽衫服装（衣柜换装）

[`Luna-CloudHoodie.blend`](Luna-CloudHoodie.blend) 基于用户提供的浅蓝云朵连帽衫 Tripo GLB 制作，完整绑定到 Luna 既有 115 骨骼（`Luna_ContactCorrected_Baked`），保持骨骼休息矩阵与全套室内动作（`Walk_Grounded_Loop`、`ChairSit_Contact`、`luna-yawn.glb`、`luna-looking-around.glb`、`luna-sofa-low-sit.glb`、`luna-library.glb`）原生兼容，按需在点击床左侧衣柜、靠近按 `E` 或访问 `?outfit=hoodie` 时加载。

- **面部精修与下颌权重校准**：补齐右眉上方刘海 4 面微小缝隙、沿 `-Y` 轻雕 `+1.8 mm` 柔和鼻梁轮廓，并将整段下巴与下颌顶点完整归入 `mixamorig:Head` 刚性头骨区消除垂颈尖角；在 2K 底色贴图上按 3D 网格重心坐标精准绘制柔和鼻尖点、珊瑚粉微笑嘴角、眼下暖桃腮红、清晰眉睫与双眼高光点，同时先解包后重新打包修改后的贴图并把材质自发光降至 `0.32`、粗糙度抬升至 `0.68–0.96`，在保持暖桃肤色微调的同时清晰呈现五官层次。
- **平底针织袜脚**：在脚踝（`z = 0.084`）处移除原高跟靴，以 Luna 原始光脚模板重塑无分趾圆润平底针织袜脚并精确保留 `+16°` 绑定跖屈角与脚踝/脚掌/脚趾权重，使站立和行走时双脚掌贴地放平。
- **放下手臂时的袖型**。沿原模粘连的两侧袖缝切至腋下，将袖内侧和衣身侧面分别补成连续布片。两片共用袖窿，内侧使用抓绒贴图。双臂放松下垂到髋侧。左右接触修形根据呼吸和重心变化压缩袖内壁、侧腰及裤边，保留袖筒厚度。罗纹袖口由前臂和手腕带动，裸手随骨骼运动。
- **抬手时的袖型**。导出后通过 `scripts/finish-luna-cloud-hoodie.mjs` 烘焙伸懒腰的 15 个局部修形样本。随后 `scripts/refine-luna-hoodie-folds.py` 根据每个姿势的实际骨骼变换，恢复侧腰和袖筒体积，重建弯肘横截面与接缝法线。浏览器在相邻样本间插值。
- **在 Blender 中查看或编辑**。打开制作源后，默认场景“Luna · 云朵连帽衫”包含成品网格、115 骨骼、17 个修形与内嵌纹理。时间轴以 15 fps 回放 198 帧。前 72 帧是自然站定和一个呼吸周期，第 73 帧开始伸懒腰。袖缝平滑与一级细分用于工作室近景，F12 可用内置相机和灯光渲染。游戏采用细分前的低模和稀疏修形。版型和布料代理分别保存在 `Hoodie_Pattern`、`Hoodie_ClothSim` 场景。
- **运行资源**：
  - `assets/public/models/resident/luna-cloud-hoodie.glb`，10,327,892 字节（9.85 MiB），45,610 个三角面、43,330 个导出顶点。包含走路和固定椅坐姿动画、左右臂接触修形、伸展修形及椅面接触编号。
  - `assets/public/models/resident/luna-cloud-hoodie-seat.bin`，645,056 字节，98 帧、1,097 个椅面接触顶点。
- **复建命令**。使用 Blender 5.3、项目指定的 Node.js 与已安装的项目依赖。命令会依次运行网格制作、修形和最终打包。

```powershell
blender --background --factory-startup --python-exit-code 1 `
  --python scripts/build-luna-cloud-hoodie.py -- `
  --input "<用户提供的云朵连帽衫.glb>" `
  --review-dir "<仓库外诊断渲染目录>"
```

## 站立伸懒腰

用户提供的 Mixamo `Yawn.fbx` 为 30 FPS、1–251 帧骨骼动作。`scripts/export-luna-yawn.py` 将上身世界旋转相对绑定姿态的变化转换到 Luna 的绑定坐标，导出 `luna-yawn.glb`，232,092 bytes、54 条旋转轨道、8.33 秒。骨盆、腿和脚沿用运行时中立站姿。首次普通待机时加载，运行时淡入淡出整段动作。

复建命令为 `blender --background --python scripts/export-luna-yawn.py -- <Yawn.fbx路径>`。输入由用户下载提供，许可见来源清单中的 Adobe Mixamo FAQ。普通待机与额外动作的节奏及打断条件见 SPEC.md。


## 站立环顾

Mixamo 页面按描述 `Idle Stand Looking Around` 确认的 `Looking Around`，使用 X Bot 空手站姿，完整 1–191 帧。下载设为 FBX Binary / Without Skin / 30 FPS / Keyframe Reduction none；Body Type 0、Surprise Level 50、Overdrive 50、Arm-Space 50、Trim 0–100%、Mirror 关闭。不是同名持火把动作，也不是 `Look Around — Looking Around The Body`。

复用 `scripts/export-luna-yawn.py` 的绑定姿态与肩臂方向修正：`blender --background --python scripts/export-luna-yawn.py -- "<Looking Around.fbx路径>" looking-around`。生成 `luna-looking-around.glb`：180,012 bytes，54 条上身旋转轨道，6.33 秒；无网格、纹理和根位移。骨盆、腿及脚由原中立姿态负责，环顾期间保持原地。源 FBX 留在仓库外，SHA-256 与许可入口见来源清单。

环顾和伸懒腰各自按需加载；偏头、拢手和松弛站姿由运行时直接计算。时序与打断由 `standingIdle.ts` 统一管理，数值参数及产品行为见 SPEC.md。

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
