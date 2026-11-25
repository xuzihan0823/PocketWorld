# 场景模块

当前页面由 `src/App.tsx` 组合 `orbital/OrbitalScene.tsx`。场景以功能目录组织，业务状态、交互视图、样式和测试就近维护。

## 职责分布

- `orbital/camera/` 由 `CameraManager` 统一写入 R3F 活动相机。构图锚点定义在 `CameraPresets.ts`，投影切换、输入、碰撞及渐隐各自独立。物品相机消费场景事务的进度，舱体结构节点按楼层及墙面提供遮挡与碰撞候选。
- `orbital/OrbitalScene.tsx` 组合镜头、灯光、舱室、家具、住民与交互表面。`orbital/cabinView.ts` 负责双层全景和楼层取景，`orbital/cabinStairs.ts` 与 `orbital/CabinStructure.tsx` 共用楼梯尺寸、踏步高度和层间走位。`orbital/stairGait.ts` 按楼梯进度采样上下楼动作，由 `orbital/residentRig.ts` 驱动肩、肘、腕，并将各套服装的脚底对齐踏面。「快速上楼」通过住民控制器清除当前行走目标，黑屏期间将人物移到二层平台并切换机位。
- `orbital/HabitatShell.tsx` 载入两面实体舱壁、拼花地板和固定陈设；`orbital/SpacecraftHull.tsx` 与 `orbital/spacecraftFlight.ts` 负责轨道飞船外壳、开场推近运镜、长按加速绕地与时间倍速，以及 `orbit ↔ cabin` 剖面切入过渡；`orbital/Cosmos.tsx` 渲染完整 360° 宇宙星空、银河、太阳、地球与轨道微粒背景。初始构图与横竖屏取景由 `orbital/cabinView.ts` 计算。
- `orbital/useWorldController.ts` 管理世界状态、动作适配器和转场生命周期。
- `orbital/OrbitalScene.tsx` 控制场景首次挂载和家具、设备、玩偶、猫的加载批次。舱外巡航的预取与入舱共用舱体加载缓存。服装 GLB 和座椅接触缓存分别由 `orbital/wardrobe/residentAssets.ts` 管理。启动顺序见 [SPEC.md](../../SPEC.md#4-轻量化与资源约定)。
- `orbital/wardrobe/` 管理住民装扮选择和模型资源。点击高衣柜或在近处按提示键会走近并拉开柜门。衣柜按「日常装」「蝴蝶结外套」「丁香针织开衫」的顺序显示缩略图和穿着状态，确认试穿后保存选择。旧装扮标识回退到日常装。[模型与坐姿修形](../../assets/models/resident/README.md)
- `orbital/journal/` 管理实体翻页、纸面编辑、逐页日期和天气、存档及迁移。
- `orbital/library/` 管理书柜存档、文本导入、实体书和取还书动作。
- `orbital/schedule/` 管理日程迁移、同步、纸页、贴纸、纸团和相关测试。
- `orbital/clock/` 管理床头黄铜闹钟的 3D 动态表盘指针、闹钟与倒计时设定、经典版合成闹铃与特供版内置音频开头铃声、本机持久化及相关测试。
- `orbital/media/` 管理电脑屏幕布局、游戏卡带单击插入、拖放与加载、唱片交互、实体键盘和相关测试。电脑与卡带的全景入口由 `OrbitalResidents` 检查电脑椅已坐稳；坐稳后 `Q` 使用电脑、`E` 起身，进出电脑保留坐姿。
- `orbital/` 根目录保留舱室、家具、住民、交互基础组件、材质与场景样式。
- `orbital/chairMotion.ts` 管理固定椅的入座、离座与取消；`chairAnimation.ts` 采样坐姿与局部接触缓存。资源与复建方法见 [Luna 制作源](../../assets/models/resident/README.md)。
- `orbital/seatedIdle.ts` 在生活舱的入座动作结束后采样托腮与晃腿，并在起身前淡出。[动捕来源和复建方法](../../assets/models/resident/README.md#坐姿待机)
- `orbital/media/RecordPlayer.tsx` 保留唱机/唱片的原有几何，`record-motion.ts` 统一管理舱室局部坐标路径、唱臂和串行播放阶段；架位在本次会话中稳定，音乐淡入淡出不影响房间音效。
- `audioEngine.ts` 提供音乐播放、静音、环境、脚步和团子音效。三首 C418 预置唱片通过 Vite 导入 MP3 地址，选片时复用本地导入唱片的 HTMLAudio 播放链路，不在首屏预加载音乐；第四张唱片仍为合成曲目。[唱片与闹铃来源](../../assets/audio/README.md)，[团子音效来源](../../assets/audio/cat/README.md)。
- `geometry.ts` 提供场景共用的几何工具。

## 模块接入

跨模块的数据接口定义在 `src/types/`。日程通过 `ScheduleProvider` 和 `useSchedule` 接入家具与纸面，书柜通过 `useLibrary` 接入应用和住民。媒体模块通过 `GameCartridgeProps` 按需加载 `src/games/*/index.tsx`。

新增功能优先复用 `ObjectHandle`、`Primitives` 和已有世界动作。运行时模型放在根目录 `assets/public/models/`，游戏与静态素材统一放在 `assets/games/`。

## 内置藏书

`orbital/library/catalog.ts` 保存三本内置书的正文与元数据。`book-01`《最后一片叶子》为欧·亨利公版英文作品 *The Last Leaf* 的完整中文自译，依据 [Wikisource《The Trimmed Lamp》1907 年版，第 198–208 页](https://en.wikisource.org/wiki/The_Trimmed_Lamp_%281907%29/The_Last_Leaf) 的英文原文生成，不采用现有现代中文译本；其余两本《窗外的地球》《微光旅行札记》保持 PocketWorld 原创正文。正文直接随构建打包，阅读不请求外部网站。

内置书沿用固定 ID 和中层书位。读取旧存档时以内置版本更新书名、作者和正文；仅正文变化的内置书重置字符书签，其他书的正文和书签保持不变。读取不写存储，后续正常操作在 Web Lock 内保存。专项回归运行 `node --test src/scene/orbital/library/library.test.mjs`。

## 舱体模型

[可编辑 Blender 场景](../../assets/models/cabin/open-cabin.blend) 按舱壁、拼花地板、收纳、墙饰、书柜上架和编织物分组，浅橡木拼花贴图以及拖鞋的绒面颜色和法线贴图均已打包在文件中。在仓库根目录运行以下命令可重新生成 [运行时模型](../../assets/public/models/cabin/open-cabin.glb)。导出脚本切分拼花地板和固定陈设，将全景窗收进一层后墙，在一层书桌椅下方生成带编织棉纹理与流苏边的复古牛仔蓝平织地毯（并入 `Rugs` 以支持地面点击行走），并在二层右侧生成带复古灰绿墙裙和浅木框舷窗的整面侧墙。衣柜单独导出为 `Interactable_Wardrobe`，沿这面墙安装。上下两层共用同一套楼板底座与拼花木地板网格，通过高度差堆叠，并与左侧楼梯平台衔接。衣柜门框内沿在柜门关闭时挡住柜内视线。楼梯、开放平台和栏杆由运行时几何生成。

```sh
blender --background assets/models/cabin/open-cabin.blend --python scripts/export-open-cabin.py
```

`assets/public/models/replaced/` 下的家具运行模型（长桌、书柜、床、唱机、复古电脑、舱门、台灯、盆栽与收纳盒）可通过 `scripts/recolor-replaced-furniture.py` 按 3D 空间 UV 区域与色相聚类批量重绘为多彩中古治愈配色，同时保留原始法线、粗糙度/金属度与烘焙光影：

```sh
blender --background --factory-startup --python scripts/recolor-replaced-furniture.py
```

生活舱二层左前角的[落地沙发制作源](../../assets/models/furniture/floor-sofa.blend)独立保存了坐靠软包、滚边、搭毯和流苏。布料贴图已打包，修改后在仓库根目录重新导出即可。

```sh
blender --background assets/models/furniture/floor-sofa.blend --python scripts/export-floor-sofa.py
```

右墙书柜旁的[脚踏垃圾桶制作源](../../assets/models/furniture/trash-can.blend)由 `scripts/build-trash-can.py` 程序化生成并打包贴图，在仓库根目录运行以下命令可重建 `.blend` 并导出[运行时模型](../../assets/public/models/furniture/trash-can.glb)。

```sh
blender --background --factory-startup --python scripts/build-trash-can.py
```

书桌左后方的[桌面黑胶唱片架制作源](../../assets/models/furniture/vinyl-rack.blend)由 `scripts/build-vinyl-rack.py` 程序化生成并打包贴图（胡桃木 30° 斜铣凹槽、炭灰羊毛毡垫、7 根拉丝黄铜弓形分隔杆与双后横杆、镂空铜框胡桃木端板与锥形铜套支脚，与 `record-motion.ts` 共用六架位坐标），在仓库根目录运行以下命令可重建 `.blend` 并导出[运行时模型](../../assets/public/models/furniture/vinyl-rack.glb)。

```sh
blender --background --factory-startup --python scripts/build-vinyl-rack.py
```

电脑右侧的复古游戏卡带套件（[奶娃滑雪大冒险卡带](../../assets/models/furniture/cartridge-mario.blend)、[团团魔法录卡带](../../assets/models/furniture/cartridge-shooter.blend)、[双槽斜倾胡桃木展示架](../../assets/models/furniture/cartridge-stand.blend)与[奶油胡桃木卡带扩展坞](../../assets/models/furniture/cartridge-dock.blend)）由 `scripts/build-game-cartridges.py` 程序化生成并打包 16-bit 像素封绘与 PBR 贴图，在仓库根目录运行以下命令可一次重建全部 `.blend` 并导出 `assets/public/models/furniture/cartridge-*.glb`。

```sh
blender --background --factory-startup --python scripts/build-game-cartridges.py
```

舱内三只坐姿毛绒娃娃的制作源（[奶油垂耳兔](../../assets/models/furniture/plush-bunny.blend)、[焦糖泰迪熊](../../assets/models/furniture/plush-bear.blend)、[雾蓝胖企鹅](../../assets/models/furniture/plush-penguin.blend)）由 `scripts/build-plush-dolls.py` 程序化生成并打包贴图，在仓库根目录运行以下命令可一次重建全部 `.blend` 并导出对应的 `assets/public/models/furniture/plush-*.glb` 运行时模型（也支持 `-- --only bunny|bear|penguin` 单独生成）。

```sh
blender --background --factory-startup --python scripts/build-plush-dolls.py
```

书桌旁的[固定椅制作源](../../assets/models/furniture/fixed-desk-chair.blend)以米为单位，座面朝 Blender 的 −Y 方向。四条木腿、木框架、扶手和软包可分别编辑。用以下命令重建制作源和[运行时模型](../../assets/public/models/furniture/fixed-desk-chair.glb)。场景直接使用导出的尺寸与原点，以匹配 Luna 的坐姿接触点。

```sh
blender --background --factory-startup --python scripts/build-fixed-desk-chair.py
```

包裹生活舱的[轨道飞船外壳制作源](../../assets/models/cabin/spacecraft-hull.blend)由 `scripts/build-spacecraft-hull.py` 程序化生成并打包贴图，在仓库根目录运行以下命令可重建 `.blend` 并导出[运行时模型](../../assets/public/models/cabin/spacecraft-hull.glb)。

```sh
blender --background --factory-startup --python scripts/build-spacecraft-hull.py
```

## 验证

在项目根目录运行 `npm test`，统一入口自动准备生产产物与引擎测试包，再运行功能回归。开发时可用 `node --test src/scene/orbital/media/*.test.mjs src/scene/orbital/schedule/*.test.mjs` 单独检查媒体和日程。

场景当前能力与限制见 [进度文档](orbital/进度文档.md)，已做过的验证见 [验收记录](orbital/验收记录.md)。对外的操作与集成约定见根目录 [SPEC.md](../../SPEC.md)。
