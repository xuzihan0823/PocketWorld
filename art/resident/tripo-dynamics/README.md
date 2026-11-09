# Tripo 第二阶段：局部表面精修与裙发动态

本阶段继续使用 `feat/tripo-hair-dress-rig` 和 PR #27。当前已在 Windows 完成腋下补面、局部权重、抬臂与坐卧姿势修正及技术验收。原模型、第一版成果、全部 103 根骨骼保留；主房间继续使用旧角色。本轮不接入主场景、不合并。

## 当前交付与历史基线

| 文件 | 用途 |
| --- | --- |
| [luna-tripo-dynamics.blend](luna-tripo-dynamics.blend) | 当前可编辑工程，贴图打包，四段骨骼动画及五个形状键的 NLA 动画 |
| [luna-tripo-dynamics.glb](../../../public/models/resident/luna-tripo-dynamics.glb) | 一个 Skin、一个网格、103 根骨骼、四段动画、五个姿势修正目标 |
| [polish/index.html](polish/index.html) | 本轮交互对比页；本地打开可切换三视角、精修前后、静态/动态及移动瞬态 |
| [polish/](polish/) | 72 张三视角对比图、当前完整场景截图及 Windows JSON 验收结果 |
| [polish_tripo_dynamics.py](../../../scripts/blender/polish_tripo_dynamics.py) | 从提交 8b3c2eb 的第二阶段工程作局部精修和导出 |
| [validate_tripo_polish.py](../../../scripts/blender/validate_tripo_polish.py) | 当前资产的骨架/原表面保持、蒙皮、NLA、姿势和 GLB 回读验证 |
| [SecondaryMotion.ts](../../../src/scene/orbital/secondary/SecondaryMotion.ts) | 原有 120 Hz 弹簧、旋转限制与八个身体胶囊；本轮未改 |
| [ResidentLab.tsx](../../../src/scene/orbital/secondary/ResidentLab.tsx) | `?dev=resident`，含正/侧/背近景、动作、开关、检查时刻及表面诊断 |
| [secondary.test.mjs](../../../src/scene/orbital/secondary/secondary.test.mjs) | 使用实际 GLB 的八项运行时回归 |
| [check-resident-lab.mjs](../../../scripts/check-resident-lab.mjs)、[check-resident-polish.mjs](../../../scripts/check-resident-polish.mjs) | 本机 Chrome 功能验收、同条件截图及接触计数 |

本目录根部原有 JSON、PNG 和 WebM 是上一轮 Mac 的历史记录，不代表当前 Windows 验证。当前记录统一放在 `polish/`。提交 [8b3c2eb](https://github.com/xuzihan0823/PocketWorld/tree/8b3c2eb/art/resident/tripo-dynamics) 保留精修前第二阶段工程；[第一版资源](../tripo-secondary/README.md) 和原模型未改动。旧 `refine_tripo_dynamics.py`、`validate_tripo_dynamics.py` 对应精修前第二阶段，当前请用上表的 polish 脚本。

没有修改 `ResidentModel.tsx`、`OrbitalResidents.tsx`、主入口或房间动作。独立测试使用 GLTFLoader 原生 SkinnedMesh 和 AnimationMixer；旧房间的运行时绑骨流程不能直接替换路径使用本模型。

## 本轮模型修改

保留 53 根人体骨骼、26 根头发骨骼和 24 根裙摆骨骼的名称、静态矩阵与父子关系。没有创建、移动或删除骨骼。

- 仅调整 87 个身体顶点的权重，移除局部孤立串权重，平滑肩腋过渡。每点 1–4 个影响，归一化，无漏绑或裙发/四肢串权重。
- 沿肩腋及上胸局部开口边界补 134 个有效三角面。保留原 18,525 个三角面、24,877 个 Blender 顶点的静态坐标、原 UV 与法线；补面复用原贴图附近色块。总面数 18,659。
- 加入三个渐进抬臂形状键 `Axilla_Raise_1/2/3`，修正上举过渡、保持及回落时的腋下塌陷、侧胸拉扯。三个目标在不同抬臂幅度间混合，局部最大修正位移约 0.0113 模型单位。
- 加入 `Sit_Clearance`、`LieDown_Clearance`，对坐卧测试姿势中的长发下部、裙摆作局部接触修正，向邻域渐弱。最大修正位移约 0.0302 模型单位；零权重时恢复原静态外形。
- 四段动作仍为 Blender 实际制作的 Walk、ArmsUp、Sit、LieDown。五个形状键都写入实际 glTF 动画，不依赖浏览器临时修网格。

没有缩小裙摆、删除发束或减面。三张嵌入贴图与精修前逐字节一致。GLB 因 UV/法线/形状键属性拆分为 25,206 个顶点；这是导出属性拆分，不是重新简化模型。

当前 Blender 5.2 的 NLA 导出曾将形状键轨道采样为常量。脚本在常规导出后，直接采样工程中实际 Key F-curves，写入标准 glTF weights 通道并紧凑重排缓冲区。保存后的 Blender NLA 重载播放、Three.js 中间帧、保持、回落和动作切换均已检查。骨骼动画与三个嵌入图像不受此步骤修改。

## 动态与基础动画

沿用世界空间尾点弹簧、1/120 秒固定步长、指数阻尼、旋转限制和八个身体胶囊。顺序仍为：恢复基础骨骼旋转 → 更新 AnimationMixer 与角色位置 → 保存基础姿势 → 叠加裙发弹簧和碰撞。

头发根部/后续关节限制为 18°/28°，裙摆 10°/16°。控制器不改骨骼平移、缩放、父子关系或蒙皮权重。姿势修正由 Mixer 驱动，关闭运行时动态时也存在；“静态对比”同时关闭头发、裙摆和碰撞三个开关，表示基础动画。

```ts
const motion = new SecondaryMotion(character);
motion.advance(frameDelta, dt => {
  mixer.update(dt);
  updateCharacterPosition(dt);
});
motion.configure({ hair: false, dress: true, collisions: true });
```

同一个 Mixer 不要在回调外重复更新。换动作/跳时刻时依次 reset、采样动作、captureBasePose；卸载 dispose。复制模型用 SkeletonUtils.clone，每实例独立控制器。大于 100 ms 的间隔或约 0.3 模型单位瞬移会复位；切换开关清理历史速度。

八个胶囊覆盖头部、双肩、上下躯干、骨盆和双大腿。每节辅助骨骼的中点/末端做四轮投影，再约束长度与角度。它们没有完整网格体积、自碰撞、手臂全段/手掌、地面或家具碰撞。

## Windows 验收

实际环境：Windows 11 build 26200；Node 24.14.0、npm 11.12.0；Blender 5.2.3 LTS，MCP addon 1.8 / protocol 15；Chrome 156.0.8078.75；项目 Three.js r169。本轮通过连接 Windows Blender 的 MCP 执行模型处理与验证，不将后台 Blender CLI 路径列为已验证方式。

记录：[Blender](polish/blender-validation.json)、[glTF Validator](polish/gltf-validation.json)、[Chrome](polish/browser-validation.json)、[三视角与接触对比](polish/comparison-validation.json)、[修复范围](polish/repair.json)。

| 动作 | 显著拉伸边，8b3c2eb → 当前 | 最大单边长度比，8b3c2eb → 当前 |
| --- | ---: | ---: |
| Walk | 0 → 0 | 2.117 → 2.117 |
| ArmsUp | 5 → 0 | 3.967 → 3.262 |
| Sit | 0 → 0 | 2.726 → 2.558 |
| LieDown | 0 → 0 | 1.565 → 2.442 |

显著拉伸边指长度超过静态两倍且增量超过 0.015 模型单位。表格取多个过渡、保持和回落时刻的最大值；它不意味着所有折角消失，躺姿局部最大长度比也没有全面下降。

浏览器对实际变形后的网格进行接触诊断。下表为动作第 2 秒、关闭三个运行时开关，穿入八个近似胶囊深度超过 0.001 模型单位的顶点数：

| 姿势 | 头发，精修前 → 当前 | 裙摆，精修前 → 当前 |
| --- | ---: | ---: |
| Sit | 130 → 4 | 225 → 0 |
| LieDown | 129 → 0 | 16 → 0 |

坐姿剩余头发最大深度约 0.001009；躺姿最大约 0.000595。开启三项开关并稳定两秒后，本轮坐卧的上述计数相同。胶囊诊断不等于精确人体表面检测，更不能据此宣称整个模型无穿模。抬臂头发仍与肩部近似胶囊重叠，任意新动作也不受这些特定姿势修正保证。

其他已执行验证：

- 原静态位置、UV、原三角面、103 根骨骼和三张贴图保持；权重有限且归一化，无漏绑。GLB 回读静态最大误差约 `3.20e-7`，姿势最大误差 `4.77e-7` 模型单位。
- 重新加载保存的 Blender 工程，骨骼与 Key 启用同名 NLA 轨道，四段动作的修正权重正确。
- Khronos glTF Validator：0 errors、2 warnings。两项警告与基线相同：运行时生成切线、蒙皮网格不是根节点。
- 八项实际 GLB 回归通过：原七项覆盖固定步帧率一致性、停止收敛、旋转限制、静态一致性、独立开关、反复切换、后台/瞬移及实例隔离；第八项覆盖形状键中间帧、保持、回落、动作切换和停止不残留。
- Chrome 五种状态含站立正常渲染；暂停、检查时刻、开关、移动、加载失败重试、减少动态偏好、390×844 模拟视口通过。无页面异常或模型请求失败；原应用 favicon 404 单独记录。
- 180 帧动画/模拟 CPU 更新平均约 0.274 ms、最大 3.4 ms，不含 GPU，不能作为实体手机性能结论。
- `npm run build`（包含 `tsc --noEmit`）通过，`git diff --check` 通过。实验室按需 JS 约 17.05 kB / gzip 7.01 kB。既有 Three.js vendor 大块提示仍在。

GLB 当前 10,728,168 bytes（10.23 MiB），比精修前增加 1,381,484 bytes（14.8%），主要来自五个姿势修正目标；工程 9,137,490 bytes。未增加应用依赖。GLB 超出仓库建议的 10 MB，原 4096² 颜色贴图也未降采样；本轮优先保留资产质量，在独立测试入口加载，正式接入前再处理资源预算。

## 复现与预览

```powershell
npm.cmd ci --no-audit --no-fund
node --test src/scene/orbital/secondary/secondary.test.mjs
npm.cmd run build
npm.cmd run dev -- --host 127.0.0.1 --port 8941 --strictPort
# 打开 http://127.0.0.1:8941/?dev=resident；检查结束后停止自己的服务进程
```

自动浏览器检查使用本机可解析的 Playwright 和 Chrome。可通过 `PLAYWRIGHT_MODULE` 指定外部验证工具安装目录的模块 file URL，`CHROME_PATH` 指定实际安装的 chrome.exe；无需修改应用依赖。`LAB_URL` 可覆盖地址，`LAB_OUT` 可覆盖输出目录。

```powershell
node scripts/check-resident-lab.mjs
# BASELINE_GLB 指向从 8b3c2eb 提取的 GLB；不指定时只生成当前版
node scripts/check-resident-polish.mjs
```

对比脚本生成三种姿势 × 三个视角 × 静态/动态 × 固定/移动 × 前/后共 72 张图。固定姿势保持第 2 秒、动态稳定 2 秒；移动比较从第 2 秒沿同一轨迹推进 0.6 秒，观察瞬态惯性。躺姿正面从上方查看，背面从下方查看，后者隐藏床板和地板避免遮挡。

在 Blender 工程中，同时启用骨架和 Shape Keys 的一个同名 NLA 轨道，其余静音。Walk 为 30 fps、1–37 帧；其他动作 1–121 帧，约 0.8 秒过渡、保持后回落。这些是变形诊断片段，不是正式走路、阅读或上床动作。

重建须先从 Git 提取 `8b3c2eb:art/resident/tripo-dynamics/luna-tripo-dynamics.blend` 与同提交的 `public/models/resident/luna-tripo-dynamics.glb`，放在工作区临时目录中，保持相同 basename。用 Python `subprocess.check_output(['git', 'show', ...])` 后 `Path.write_bytes` 保存，避免旧版 PowerShell 的文本重定向破坏二进制。基线 Blend SHA-256 为 `4ee16afb8bf86c50ef22dbd6e7582e6fa6607f135ce229c07f66780bd78b1c2b`。

在 Blender Python 中通过 importlib 加载 `polish_tripo_dynamics.py`，调用 `build(workspace, baseline_blend)`；再加载 `validate_tripo_polish.py`，调用 `validate(workspace, baseline_blend)`。输入基线只读，输出当前第二阶段路径，不触碰原模型或第一版。脚本会校验输入哈希。不要以已经精修的工程作为重建基线。

## 当前边界与后续

肩腋局部开口已补齐、主要塌陷减少，但近景仍可见原低面数折角和烘焙色斑；此轮是针对指定姿势的局部精修，不是任意极限动作的全套美术验收。裙发没有完整布料体积/自碰撞，仍可能局部穿模。没有改变原头发长度、裙摆宽度或静态外形来掩盖问题。

原测试入口、弹簧参数和独立开关保留。主房间替换、正式动作融合/IK/脚底锁定、家具接触、实体手机、Safari 和长时间正式场景验收另行安排。保留同一分支和 PR 供视觉审阅，按仓库流程提交审查，不合并。
