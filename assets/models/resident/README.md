# Luna 动画制作源

## 第二套 · 蝴蝶结外套

[可编辑角色](./Luna-Ribbon.blend)使用用户提供的蝴蝶结外套、短裤与长袜模型，五官参照日常装绘制，下巴尖端略微上提，两侧过渡成圆弧。下巴前缘随头骨转动，往颈部逐渐恢复颈骨权重。贴图已打包。游戏中的角色使用 91 根骨骼，保留独立的手指与头发骨链。底色图在 Blender 中由原始 4096 × 4096 缩至 2048 × 2048，从日常装读取底色倍率、全身底色补光和法线强度，并复用同一套暖桃色肤色着色。服装卡片使用该运行时材质的全身渲染。

`scripts/fit-luna-ribbon.py` 接收已绑定的 `Luna-Ribbon.glb`，用 NumPy 基于两套骨架的局部绑定偏移重定向动作。走路与地毯动作按实际蒙皮校准高度，固定椅按坐垫轮廓生成独立接触缓存。取书及沙发动作随第二套模型载入，生活舱动作独立加载。

```sh
python scripts/fit-luna-ribbon.py /path/to/Luna-Ribbon.glb --motions assets/public/models/resident --output assets/public/models/resident
```

## 生活舱日常动作

地毯的盘腿坐地使用 MotionSmith Take 2 原地版，盘腿起身、捡东西、揉眼睛、托腮思考和向高处取物均使用 Take 1。摘取姿态来自 UE5 Manny 的 30 fps 骨骼动画。脚底和骨盆按 Luna 日常装的实际蒙皮校准。盘腿时，裙装的前幅分别越过左右膝，中间略低，末端向下折落。侧幅绕向膝外侧，后摆在地毯上摊开。入座和起身时沿动作过渡。脸部手势保留原片时序，腕位按 Luna 的脸型缩放。书架目录使用托下巴动作的抬手段并保持姿势。拾物在 1.9 秒把纸团交给右手。拾娃娃复用同一动作，起身后双手托住，放下时反向播放。高处取物在书本接触前交回书柜原动作。

五条待机同样按日常装导出。从 [Feminine Idle](https://cosindra.ai/motionsmith/motions/idle-feminine) Take 1 提取躯干与左臂，并按日常装调整掌面朝向和腰侧落点。[Neck Stretch](https://cosindra.ai/motionsmith/motions/idle-neck-stretch) Take 2 使用胸部以上旋转。[Seated Dozing Idle](https://cosindra.ai/motionsmith/motions/seated-dozing-idle) Take 1 保留点头回抬的节奏，用躯干辅助前倾。[Seated Idle](https://cosindra.ai/motionsmith/motions/sit-chair-idle) Take 5 和 [Floor Sitting Idle](https://cosindra.ai/motionsmith/motions/sit-floor-idle) Take 1 保留原片的视线方向，用淡入淡出形成转头。三段坐姿只叠加脊柱、颈或头的相对旋转。叠加时保留原坐姿接触和地毯蒙皮。

原片放在仓库外同一个目录，每个文件保留 MotionSmith 的默认名。使用 Node.js 24 重建日常装的动画 GLB。

```bash
node scripts/bake-luna-cabin-actions.mjs /path/to/downloads
```

来源、Take 和源文件校验值见[素材登记](../../models.sources.json)。

### 小熊抱起节奏

[Luna-Bear-Pickup.blend](./Luna-Bear-Pickup.blend) 保存三套衣装的原拾取动作、重排时间后的 `bearPickUp` 和 `Timing` 场景中的 `Bear_Pickup_Timing` 曲线。小熊抱起由约 3.97 秒缩短至 3.05 秒；弯腰、收尾更快，接触附近放缓，再连贯抬起。约 1.46 秒开始抬离地面。原姿势、脚底和双手接触路径保留，放下及其他娃娃、纸团仍使用原 `pickUp`。

在 Blender 的 `Timing` 场景调整 `seconds` 曲线，再重导。横轴是原片 30 fps 帧号，纵轴是新片秒数，必须严格递增；此脚本仅重排时间，不导出角色网格或新的骨骼姿势。运行时片段复用原姿势数据，只增加采样时间与动画声明。接触求解、淡入淡出使用同次导出的 `bearPickupTiming.ts` 换算原片时间，取消时沿新片倒放。

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/retime-bear-pickup.py -- --scratch "$env:PI_SCRATCH_DIR" --from-blend
```

省略 `--from-blend` 会从当前运行模型和原 `pickUp` 重建制作源及默认节奏。原动作包经其他脚本重建后，须最后执行上述重导以恢复小熊片段。`--output-dir` 与 `--timing-output` 可指向仓库外以核对重导。相关回归：`bearPickup.test.mjs`、`contactHands.test.mjs`、`plushCarry.test.mjs`。

## 楼梯步态

Luna 上、下楼各取 MotionSmith Take 1 中连续的左右两步。原文件均为 UE5 Manny 骨架、30 fps。帧号从 0 开始，上楼两个步段的边界为 48、64、80，下楼为 57、76、94，分别取脚趾开始离开踏面的帧。导出脚踝推进与抬升、脚掌俯仰、躯干倾斜、双膝屈曲、髋踝相对位置和双侧肩、肘、腕的运动方向。运行时按腿长和踏面尺寸重定向，并在首末级与平台衔接。两个方向都用支撑踝定位骨盆，按原片的前移曲线跨过左右脚换重的瞬间。骨盆至颈部的倾角驱动躯干，头部俯仰单独采样。上楼时，骨盆的抬升曲线限制承重腿伸直时身体的上升速度。下楼时，骨盆的降高曲线控制左右脚换重。前脚掌靠近踏板前缘，后跟越过台阶后逐渐下降，落脚时膝盖保留原片的轻微弯曲。[上楼原片](https://cosindra.ai/motionsmith/motions/walk-upstairs) · [下楼原片](https://cosindra.ai/motionsmith/motions/walk-downstairs)

[步态曲线](./luna-stair-gait.json)约 18.5 KB，随应用打包。原始 GLB 保存在仓库外，来源与文件校验值见[素材清单](../../models.sources.json)。从仓库根目录运行下列命令可重建曲线。

```bash
node scripts/bake-luna-stairs.mjs /path/to/MotionSmith_walk_upstairs_take1.glb /path/to/MotionSmith_walk_downstairs_take1.glb
```

## 丁香针织开衫绑定

衣柜第三套采用用户提供的 Tripo 文件 `anime girl 3d model.glb`。开衫、胸前蝴蝶结、条纹长袜与蓝色长发沿用原网格和 UV。日常装的虹膜、高光、眼睑、鼻尖、双颊和唇形已按新头部正面与刘海边界重新绘入底色。下巴尖端略微上提，沿下颌两侧逐渐收回。下巴前缘随头骨运动，颈部保持平滑过渡。第三格的预览标识为 `cardigan`。

[Blender 制作源](./Luna-Cardigan.blend)内置贴图、骨架、袖侧修形与动作。[运行模型](../../public/models/resident/luna-cardigan.glb)使用 Luna 的 115 根骨骼。制作源打开时显示自然站姿，上臂外展约 18°。领口主要随胸廓，袖山向锁骨和上臂逐渐过渡，侧腰略收以留出袖口间距。行走时，左右臂按日常装的肩肘轨迹与对侧脚交替摆动，手掌朝向按开衫网格上的指根定位。手臂靠近衣身时才触发对应侧的衣料修形。后腰罗纹和下摆褶边以骨盆为支撑，平滑分配左右腿的影响。两侧袖子和手指独立绑定，发束随头部和发链运动，袜底保存步态支撑点。固定椅的[接触缓存](../../public/models/resident/luna-cardigan-seat.bin)按新网格对坐垫和扶手采样 98 帧。编辑网格或坐姿时须同时更新缓存及 `_CONTACT_ID`。

肘上袖筒以同侧上臂为支撑，在肘弯附近平滑过渡到前臂。袖筒中段原先混入的胸椎权重会在抬手时把布面拉向身体，产生塌陷与扭曲；当前绑定已在 Blender 中修正，肩口、领口和袖口保留原有过渡。三层取还书的真实蒙皮回归见 `src/scene/orbital/cardiganElbow.test.mjs`。

重新导出手动编辑后的权重：

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/repair-luna-cardigan-elbows.py
```

脚本读取上述制作源，首次处理未标记的旧源时重建两侧袖部权重；已修正的源只导出当前编辑值，不重复叠加修复。导出时逐点核对 Blender 与 GLB 的绑定坐标，并处理 UV 接缝副本，只更新 `JOINTS_0` / `WEIGHTS_0`。顶点顺序、拓扑、贴图、形态键、骨架、动画和 `_CONTACT_ID` 保持不变，原座椅缓存继续使用。`--source`、`--base`、`--blend`、`--output` 可用于仓库外对照导出。

## 云朵连帽衫制作源（已下架）

[Blender 制作源](./Luna-CloudHoodie.blend)采用用户提供的 Tripo 模型 `1115d436-5d3e-444c-be63-a6141e1f346c.glb`。用户未附独立角色许可声明。蓝发、云朵发饰、五官、连帽衫和短裤沿用这份模型。底色图在原 UV 上调整了唇线与眼部高光。袖子与衣身粘连的部分沿腋下拆开，补入两侧布面，以便抬臂取书。下颌尖端已收短并拓圆，主要随头骨运动。贴臂站姿下，衣侧在前臂压到的位置内收，袖子前后两侧的衣料保留蓬度，长袖在肘部上下保留椭圆截面，袖口权重从前臂渐变至手腕，使手腕弯曲时袖口保持开口。制作源包含 115 根骨骼、10 个角色动作和 4 张打包贴图。

在 Blender 场景菜单选择 `Hoodie | Cloth Simulation`，回到第 1 帧后连续播放到第 72 帧，即可重算布料。衣身、左袖、右袖各有一个 Cloth 修改器。衣身固定在肩部和髋部罗纹，袖筒固定在肩口和袖口。两侧前臂从略微张开的位置收至腰侧，躯干及手臂碰撞体限制布料的活动空间。

将最后 10 帧的平均位移映射到衣身、袖筒及口袋，再按站姿和步态为刺绣布面留出间距。制作源通过两个相对形态键 `SleeveContact_L`、`SleeveContact_R` 混合烘焙的结果。在 Blender 中可分别调节两侧，0 为放松，1 为贴臂受压。每个动作带有对应的衣料权重曲线。

双脚在堆袜下沿裁去原鞋面、鞋底和鞋跟。新袜脚按 Luna 的足跟、内侧足弓和前掌轮廓接入，沿切口采样袜色，并匹配两侧 98 个边界点的位置、法线与骨骼权重。行走动作以袜底重新求解双腿 IK。走停混合阶段按袜脚几何的 `soleContacts` 支撑点修正脚尖高度。

## 雪花裙装制作源（已下架）

[Luna-Snowflower.blend](./Luna-Snowflower.blend) 是生活舱雪花裙装的可编辑制作源。造型与原贴图来自用户提供的 Tripo 文件 `ab1c7402-ed3c-428e-bf63-d4d73a8b9d7d.glb`，未附独立许可声明。脚踝以下按 Luna 的裸脚尺寸重建为连续的包脚袜，保留原小腿、袜口和蝴蝶结。新袜脚贴图已与原始底色、法线、粗糙度／金属度贴图一起打包。脚踝接缝的袜脚粗糙度按小腿对应贴图取样设为 0.53，两侧用相同的补光和高光色。

面部按用户提供的《蓝发少女与雪花裙装》原画精修。眼睑、蓝色虹膜、唇色和肤色使用独立 UV 与材质 `Luna | Snowflower Face`。虹膜与皮肤各有粗糙度，鼻尖和双唇的起伏直接做在网格上。额前发束单独修正了混入发色的肤色斑。相关贴图均已打包，可在 Blender 中继续绘制。

文件默认打开站立姿势的脸部近景。在骨架的 Action Editor 中可选择行走、站立、转椅落座、低沙发落座、环顾、伸懒腰、三层取书或上床。角色沿用 Luna 的 115 个骨骼及父子关系，五官跟随头骨，下颌向颈部渐变。手指、发束和裙骨按角色位置对齐，取书时前裙骨随抬膝量调整。袜脚分别使用小腿、脚掌与脚趾权重，脚踝接缝两侧权重一致。26 节发骨的 `hairDrape` 和 `hairSway` 分别控制每节的下垂补偿和回摆幅度，导出至 GLB 节点的 `extras`。发中和发尾的权重高于发根，后发的回摆大于脸侧发束。更新材质和发骨参数时保留 GLB 网格、动作及 `_CONTACT_ID` 索引。

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

- `assets/public/models/resident/luna-walk-room.glb`：保留 `Walk_Grounded_Loop`，加入 `ChairSit_Contact`（第 1–98 帧，30 fps，时间归零后 97/30 秒）。31,140 个三角形，7,100,588 bytes（含自然站姿与沙发手势片段）。
- 同目录 `luna-seat-contact.bin`：98 帧、3,251 个局部顶点的蒙皮前修形，1,911,608 bytes。不能只替换 GLB 而遗漏该文件；普通 glTF 查看器只显示骨骼动作，不会自动应用此缓存。
- GLB 与接触缓存合计 9.01 MB；源 `.blend` 不在 `assets/public/`，不进入网页构建。

原始 4096 × 4096 底色 JPEG 来自用户提供的 Tripo GLB，在 Git 提交 `2e1ff72` 的 `art/resident/animated-transfer/walk-repair/luna-walk-repaired.glb` 中也有相同副本。当前运行时与 `Luna-ArmContact.blend` 底色已在 Blender 中缩为 2048 × 2048；法线图维持原有 2048 × 2048 数据，粗糙度图以同尺寸单通道 PNG 保存，实际使用的绿色通道逐像素不变。当前材质将法线强度设为 0.18、金属系数设为 0，并复用底色作为 0.55 强度的自发光，用来减轻室内近景的发际线和眼周暗块。

### 人物贴图 2K 上限

在仓库根目录运行 `blender --background --python scripts/resize-luna-textures.py`。脚本只缩小日常装、蝴蝶结外套与丁香开衫中最长边超过 2048 的图片，保持宽高比；同步打包对应 Blender 制作源。GLB 中仅替换缩放图片的 bufferView，校验其余二进制数据和模型描述不变，避免重新导出网格破坏 `_CONTACT_ID`、修形或动画。已达上限的图片不重新编码，重复执行不会改写资源。可用 `-- --report <仓库外路径>` 保存处理报告。完成其他模型制作脚本后，应再运行此命令，确保运行资源符合 2K 上限。

包含自然站姿与沙发手势片段后，日常装 GLB 为 6.77 MiB，蝴蝶结外套为 6.28 MiB；丁香开衫为 7.46 MiB。两张底色由 4096² 降为 2048²，各减少 75% 像素；文件体积不按像素数等比下降，仍包含未改动的贴图、几何和动作。

### 数据贴图无损整理

运行 `blender --background --python scripts/resize-luna-textures.py -- --optimize-roughness`，在 2K 上限处理后，进一步整理日常装和外套的粗糙度 PNG。脚本要求这些图片仅用于粗糙度／金属度槽且金属度系数为 0，保留绿色粗糙度值，合并未使用通道并编码为 8-bit 灰度 PNG；浏览器解码后各色通道复用同一数值。单通道减少文件中的重复数据，不承诺按通道数降低 GPU 内存。对应制作源同步打包灰度数据，底色、法线、网格、动作和材质参数保持原样。PNG 行序与 Blender 像素行序相反，复建脚本显式翻转行序；重复执行不会改写资源。

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

## 坐姿待机

懒人沙发托腮采用 CMU `13_04` 的左肘弯曲和头部转向（120 Hz，第 1573–2149 帧）。桌前固定椅晃腿采用 CMU `01_06` 坐在高处时的左右膝屈伸（120 Hz，第 985–1357 帧）。两段均从原始记录取坐稳后的片段，并导出为 10 Hz 曲线，托腮的放手段略放慢。网页沿原曲线时序混合下述 Blender 搭腿与托腮姿态，并求解固定椅的小腿摆角。懒人沙发保留原有骨盆、贴地双脚和坐垫承重。三套衣装坐稳时双手分搭大腿或裙面；托腮时左手顺着脸侧抬起，右手继续搭腿。固定椅保留臀部与膝位。

下载 [13_04.amc](https://mocap.cs.cmu.edu/subjects/13/13_04.amc) 和 [01_06.amc](https://mocap.cs.cmu.edu/subjects/01/01_06.amc) 到仓库外的同一目录，从仓库根目录运行以下命令生成 `src/scene/orbital/seatedIdleFrames.ts`。

```sh
python3 scripts/extract-luna-seated-idles.py <AMC目录>
```

动捕由 CMU Graphics Lab 在 NSF EIA-0196217 资助下制作，允许在商业作品中使用及改编。原始或转换后的数据适用数据库条款。 [CMU Motion Capture Database](https://mocap.cs.cmu.edu/)

## 自然垂臂与沙发手势

[`Luna-Relaxed-Poses.blend`](Luna-Relaxed-Poses.blend) 保存三套衣装各自的 `Relaxed_everyday`、`Relaxed_ribbon`、`Relaxed_cardigan` 场景。每个场景的第 1 帧为自然站姿，第 31 帧为双手搭腿，第 61 帧为左手托腮；这是可编辑姿态库，运行时过渡仍使用原走停、落座与 CMU 手势时序。

`scripts/bake-luna-rest.py` 从 Blender 骨骼求值导出 `Luna_Relaxed_Standing`、`Luna_Sofa_Lap`、`Luna_Sofa_Cheek` 三个旋转片段，追加到各自运行模型。站定时日常装与蝴蝶结外套上臂相对竖直方向外展约 9.44°，丁香开衫单独外展约 16.97°，前臂稍向外打开；三套均保持掌心朝内，环顾只驱动躯干和头颈。拖动视角与滚轮缩放只打断装饰待机，不撤掉基础站姿。沙发落座后段逐渐进入搭腿，托腮时右手保持原接触，起身沿原时轴退出。减少动态效果时保留自然站姿和双手搭腿。原模型二进制数据、UV 拆点、形态键、骨权与接触缓存不变。

使用 `--from-blend --update-standing` 可以仅按脚本重做第 1 帧站姿，保留第 31／61 帧的沙发手势。导出按当前 bufferView 的实际偏移计算原始数据边界，兼容贴图缩小后的 GLB。

开衫右手的 `RightHandMiddle1` 绑定位置偏向掌内，不能单独用它到手腕的向量判断真实掌向。制作时以食指、无名指和小指指根的平均位置确定掌轴，结合真实蒙皮复核接触；腕部旋转相对真实绑定姿态分担到前臂。回归见 `src/scene/orbital/relaxedPoses.test.mjs`。

从仓库根目录运行以下命令，将中间输出留在仓库外。修改源文件的关键姿态后，使用 `--from-blend` 重新导出到临时目录，核对后替换对应三套运行 GLB，并更新素材清单。

```powershell
node scripts/sample-luna-rest.mjs . "$env:PI_SCRATCH_DIR/rest-reference.json"
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-rest.py -- --root . --input "$env:PI_SCRATCH_DIR/rest-reference.json" --blend "$env:PI_SCRATCH_DIR/Luna-Relaxed-Poses.blend" --output-dir "$env:PI_SCRATCH_DIR/rest-models"
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-rest.py -- --root . --from-blend --blend assets/models/resident/Luna-Relaxed-Poses.blend --output-dir "$env:PI_SCRATCH_DIR/rest-models"
```

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

## 站立伸懒腰

用户提供的 Mixamo `Yawn.fbx` 为 30 FPS、1–251 帧骨骼动作。`scripts/export-luna-yawn.py` 将上身世界旋转相对绑定姿态的变化转换到 Luna 的绑定坐标，导出 `luna-yawn.glb`，232,092 bytes、54 条旋转轨道、8.33 秒。骨盆、腿和脚沿用运行时中立站姿。首次普通待机时加载，运行时淡入淡出整段动作。

复建命令为 `blender --background --python scripts/export-luna-yawn.py -- <Yawn.fbx路径>`。输入由用户下载提供，许可见来源清单中的 Adobe Mixamo FAQ。普通待机与额外动作的节奏及打断条件见 SPEC.md。

丁香针织开衫使用 `luna-cardigan.glb` 内嵌的 `Luna_Yawn`。其伸展修复的可编辑源为 [Luna-Cardigan-Stretch.blend](./Luna-Cardigan-Stretch.blend)：535 个局部袖面顶点从胸廓牵引改为随上臂运动，在肘部平滑过渡到前臂；6.2–8.25 秒的双侧上臂和前臂减少轴向扭转，手掌随前臂展开，收手关键帧采用约 0.1 秒的四元数平滑。动作仍为 8.33 秒，前半段遮嘴及其他动作保持原样。

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/repair-cardigan-yawn.py
```

首次制作从运行 GLB 导入，以逆绑定矩阵恢复真实绑定基准；节点初始姿势不能代替蒙皮绑定姿势。已有制作源时导出当前编辑结果，不重复叠加修复。脚本只更新袖部 `JOINTS_0` / `WEIGHTS_0` 及六条上臂、前臂、手腕旋转轨道，保留几何、UV、形态键、贴图、其余动作和 `_CONTACT_ID`。与袖部及掌向修复合并后，运行模型为 7,821,600 bytes、12 条动作，保留新增的自然站姿、沙发搭腿与托腮；双方袖部权重一致，联合导出只改变六条伸懒腰旋转轨道，其余二进制数据逐字节保留。`cardigan-sleeve-binding.py` 沿用已有肘部修复的局部平滑权重规则。与其他人物分支合并时，先核对制作源中的权重，再以合并后的 GLB 为 `--base` 导出，避免覆盖另一批蒙皮修复。专项回归为 `node --test src/scene/orbital/cardiganStretch.test.mjs`。


## 历史站立环顾素材

Mixamo 页面按描述 `Idle Stand Looking Around` 确认的 `Looking Around`，使用 X Bot 空手站姿，完整 1–191 帧。下载设为 FBX Binary / Without Skin / 30 FPS / Keyframe Reduction none；Body Type 0、Surprise Level 50、Overdrive 50、Arm-Space 50、Trim 0–100%、Mirror 关闭。不是同名持火把动作，也不是 `Look Around — Looking Around The Body`。

复用 `scripts/export-luna-yawn.py` 的绑定姿态与肩臂方向修正：`blender --background --python scripts/export-luna-yawn.py -- "<Looking Around.fbx路径>" looking-around`。生成非运行时素材 `assets/models/resident/luna-looking-around.glb`：180,012 bytes，54 条上身旋转轨道，6.33 秒；无网格、纹理和根位移。源 FBX 留在仓库外，SHA-256 与许可入口见来源清单。

站立环顾已从待机调度、加载和播放中移除；上述素材仅供历史制作参考，不随站点发布。开衫模型内的历史片段保留但不再绑定。伸懒腰仍按需加载；偏头、拢手和松弛站姿由运行时直接计算。时序与打断由 `standingIdle.ts` 统一管理，数值参数及产品行为见 SPEC.md。

## 书柜取书与归还

用 Blender 5.2.3 在 Luna 原骨架上制作底、中、顶三条取书动作。制作帧 0–36 以两倍时长映射到导出帧 0–72，之后为「导出帧 = 制作帧 + 36」；导出 0–180 帧、30 fps、6 秒。右手四指指腹分别贴住近侧封面。食指越过圆角，与中指一起在指根屈曲、末节展平后压住封面，拇指从书脊侧抵住包边，导出第 60 帧握稳，第 72 帧后才移动书，第 108 帧完成直线抽出，第 124 帧支撑手接稳书底，第 132 帧开始降低倾转，第 156–180 帧交接到程序闭书姿态。顶层在制作 72–96 帧沿书脊上滑指尖，随书本降低调整握点；三层到第 132 帧均先竖直接底，再转向腰腹前方。全段退步约 30 cm，侧让避开头发；末帧书本中心高 0.84 m，手掌分别覆住封面和托住底部。归还倒播对应阶段。骨骼与书本标记在同一 GLB 中，场景按书位平移，两者按同一时刻采样。

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-library.py
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-library.py -- --row 2 --blend "<仓库外目录>/Luna-书柜.blend"
```

脚本需要项目的 Node.js 依赖，用来读取运行时同款中立站姿。可选的 `--row` 为 0（底层）、1（中层）或 2（顶层），用于选择 Blender 文件中默认显示的书层。文件内保留三层的动作、书本标记、书柜尺寸参考和独立相机；在 Blender 修改关键帧后可用 `--from-blend` 从已编辑文件重新导出。运行时 `luna-library.glb` 仅包含动作、骨架和书本标记，大小 1,383,148 bytes，首次书柜互动时按需加载。`luna-library-neutral.mjs --handoff` 采样真实程序 IK 的闭合托书、封面抓握与全身姿态；烘焙末段保留手书接触，在世界坐标中衔接臂段轴向旋转，并在离线烘焙中展开连续轴角，避免最短四元数混合在半圈处换支。伸手使用向前绕开的腕部路径，腕位置只插值并求解一次，肘平面从真实中立姿态进入，仅对臂段轴向旋转渐变；未接触的掌向根据实际求解出的前臂限制折角，避免二次局部旋转插值把手掌折向肘部。烘焙按解缠后的真实旋前角分担前臂扭转，仍限于 1.75 rad，避免正弦分担在接近半圈时衰减到零；托底接力时略向内调整肘平面。网页闭合封面右手使用同样上限的精确分担，展开前半段连续淡出，阅读和双向翻页保留原公式。普通模式取书片段为 6 秒，开合封面各 1.35 秒，开书前 20% 完成烘焙到程序姿态的交接。打开、阅读和翻页由 `src/scene/orbital/library/` 的程序姿态与下述 Blender 翻页控制曲线共同驱动：闭书保持腰前平持，开封面时手掌与手指共用封面平面，右手沿铰轴移动以留出前臂空间，随后进入原有阅读和双向翻页终点；封面、浅 V 纸页与手部接触点共用变换。正向翻页为左手托书、右手带页，反向交换分工。

托底转移采用 `SUPPORT_SKIN_OFFSETS` 的书本局部接触修正：在制作帧 96–144（导出帧 132–180）加密到每帧四个采样。烘焙先保留原始手掌、手指朝向与动作，再从评估后的 Blender 姿态只重新求解左腕位置和两段手臂，保持原肘部弯曲平面；修正值依据实际蒙皮到圆角封面三角形的距离标定。导出仍为 6 秒，含 325 个采样时点，归还逆向使用同一动作。程序开合与双向翻页仍由网页姿态控制。

程序开合左手继续使用 `bookSupportPose` 的提早抬升曲线，右手闭合抓握的前臂轴向分担在展开前半段淡出；阅读和双向翻页保留原轨迹。取书左手在导出 124 帧完成接触求解并开始承重，主手在 132 帧后才转向封面；接托期间的肘部让位连续淡出到原转书姿态。不能把接近 1 的伸手混合权重或掌部代理点当作真实皮肤接触。左手从书底下方进入接托。真实手与书的三角面回归覆盖三层正逆 115–134 帧，每 0.25 帧采样，共 462 个姿态。双手进入书体的深度须小于 1 mm，从第 124 帧开始要求左手承重间隙小于 2 mm；原转书与开合接触、65°掌向、70°静态腕角及连续性阈值保留。右掌在书本局部朝 +Y，左手承重后，右手沿书脊外缘退开并绕书本局部 Z 轴换握。闭书时右掌朝 −Y、左掌朝 +Y。回归以放松时五指的自然内弯方向标定蒙皮指腹，以拇指对掌校验左右掌面符号，逐层双向检查每根手指的指腹顶点到近侧封面、拇指腹到包边，以及左掌侧到书底的距离。有限采样的范围见[场景进度文档](../../../src/scene/orbital/进度文档.md)。

### 丁香开衫掌面校准

[`Luna-Cardigan-Book-Hands.blend`](Luna-Cardigan-Book-Hands.blend) 保存两侧 `PalmBearing` 掌部导引，以及 `Cardigan_Book_Hands_0`、`_1`、`_2` 三层取书动作（0–180 帧，30 fps）。掌轴按真实指根横排和掌侧蒙皮校准，避免偏向掌内的右中指指根误导腕部朝向。导引的 `openPadDepth` 属性用于放松手指后的指垫厚度；修改后须复查掌侧皮肤到封面或书底的接触。

`scripts/bake-cardigan-library-hands.py` 从 Blender 导引导出 `cardiganPalms.ts`，供开合、阅读和翻页 IK 使用；三层手臂旋转导出到 `cardiganPickup.ts`，由 `libraryMotion.ts` 按原 GLB 时钟采样，归还倒放。书本和未涉及的骨骼仍使用原动作。验证以变形后的掌侧三角面判断朝向，分别检查指垫、拇指与承重掌面；不能仅用手骨到中指指根的方向代替真实手掌。

从可编辑源重导到仓库外，核对两份数据后再替换对应 `src/scene/orbital/library/` 文件：

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-cardigan-library-hands.py -- --from-blend assets/models/resident/Luna-Cardigan-Book-Hands.blend --palm-output "$env:PI_SCRATCH_DIR/cardiganPalms.ts" --pickup-output "$env:PI_SCRATCH_DIR/cardiganPickup.ts"
node --test src/scene/orbital/library/bookMotion.test.mjs src/scene/orbital/library/library.test.mjs
```

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


### 丁香开衫楼梯、盘腿与抱熊接触

`Luna-Cardigan-Contact-Hands.blend` 保存 `Contact_up`、`Contact_down` 两个 65 帧循环和 `Contact_grip` 掌面/指形导引。掌轴由食指、无名指、小指指根平均得到，避开偏向掌内的中指根。`Bear_Contact_0/1` 的 Y/Z 位置是相对于小熊半高/半深的接触位置；`Right/Left_0/1_tangent/normal` 控制接近和抱稳时的掌面方向。`Bear_Cradle` 自定义属性控制抬升、前后间距、抬起弧线和肩部可达距离。手指姿态从 Blender 动作导出，运行时只为动态小熊位置求解腕部接触。兔子、企鹅和前两套服装继续使用原握法。

导出 `luna-cardigan-hands.glb` 为 143,388 bytes，只含上肢旋转、骨架和导引，不含角色网格或贴图。楼梯按原双步时钟采样上肢，不改骨盆和腿脚。抱熊按导出的掌向、指形和真实蒙皮表面拟合玩偶，抱持中心同时受肩部可达距离约束。创建接触播放器前须像正式动作链一样先应用人物基础姿态。

`Luna-Cardigan-Floor-Hands.blend` 保存完整角色及 30 FPS 的 `floorSit` / `floorStand` 动作。`bake-luna-floor-hands.py` 只替换这两条动作的肩、臂、腕、指旋转，入座末段渐入接触，起身初段释放。`luna-cabin-actions-cardigan.glb` 共 791,940 bytes、11 条动作；基包取自既有开衫动作适配资源，仅改两条动作的 76 条上肢通道，其余动作、骨盆腿脚、采样时间与原始数据保持一致。来源及原包校验值见 `assets/models.sources.json`。

从可编辑源重导无需临时采样 JSON；在项目根目录执行，输出与报告放到仓库外：

```powershell
$reviewDir = $env:PI_SCRATCH_DIR
Copy-Item assets/models/resident/Luna-Cardigan-Contact-Hands.blend "$reviewDir/contact-source.blend"
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-contact-hands.py -- --root . --from-blend --blend "$reviewDir/contact-source.blend" --output "$reviewDir/luna-cardigan-hands.glb"
Copy-Item assets/models/resident/Luna-Cardigan-Floor-Hands.blend "$reviewDir/floor-source.blend"
blender --background --factory-startup --python-exit-code 1 --python scripts/bake-luna-floor-hands.py -- --root . --from-blend --base assets/public/models/resident/luna-cabin-actions-cardigan.glb --blend "$reviewDir/floor-source.blend" --output "$reviewDir/luna-cabin-actions-cardigan.glb" --report "$reviewDir/floor-report.json"
node --test src/scene/orbital/contactHands.test.mjs src/scene/orbital/floorHands.test.mjs
```

重新制作楼梯时，`node scripts/sample-luna-contact-hands.mjs . <仓库外JSON>` 采样原步态，再通过 `bake-luna-contact-hands.py --input <JSON>` 烘焙。不要把显示层 1.43 倍缩放重复计入本地骨骼变换。

回归检查真实掌侧皮肤：楼梯全周期掌轴/前臂夹角小于 8°，腿脚轨迹与原求解逐点一致；盘腿最近接触小于 4 mm、中位小于 15 mm；小熊接近阶段最近间隙小于 8 mm、抱稳小于 4.5 mm、中位小于 15 mm，同时检查皮肤穿入及 30/60/120 Hz 正反播放连续性。距离限于有限采样，不能替代网页多角度检查。角色网格未改动；通用 QA 的原有装饰孤岛、共面重叠和 UV 拆点提示保留，不宣称整个源素材的通用 QA 全绿。
