# 连续坐卧动作验收

本轮在第二阶段精修版上编排两段连续诊断动作，并制作了独立的 [Blender 工程](luna-tripo-transitions.blend) 和 [GLB](../../../public/models/resident/luna-tripo-transitions.glb)。保留 103 根骨骼的静态矩阵、层级和蒙皮权重，保留 18,659 个三角面、静态顶点、UV、三张贴图和五个既有修正目标。原模型、第一版及[第二阶段工程和记录](../tripo-dynamics/README.md)继续可用。主房间接入另行安排。

## 动作与接触

| 动作 | 编排时长 | 过程 |
| --- | ---: | --- |
| `SitCycle` | 9 秒 | 起步、减速停稳、屈膝坐下、坐稳、起身、站稳 |
| `LieCycle` | 13 秒 | 站立准备、坐下、经坐姿后躺、躺卧停留、回到坐姿、起身 |

两段采用 Blender 骨骼和形状键 NLA，向下和起身时有躯干前倾、肘部过渡与骨盆轨迹。坐下过程中用脚踝高度补偿骨盆降幅，后躺时逐步释放并伸腿。动作末尾停在站立，可单独重播或拖动检查时刻。导出器为骨骼采样保留约一帧的末尾停留。

在坐下和后躺路径上各取五个姿势，按近似身体胶囊计算局部裙发偏移，沿相邻网格平滑并烘焙成十个姿势目标。相邻修正随姿势进度混合，起身使用同一路径回落。后躺末段增加发束与裙摆的托面留量。接触修正只改变该动作中的局部形状。

动态仍使用 120 Hz 固定步长、现有弹簧及八个身体胶囊。连续动作在接近支撑姿势时逐步收紧允许的裙发摆幅，离开时恢复，避免把惯性拖尾甩入身体和地面。最紧时允许摆幅为原头发上限的 4%、裙摆上限的 5%，在动作采样中平滑变化，保留模拟历史。

## Windows 验收

[正面视频](front.mp4) · [侧面视频](side.mp4) · [背面视频](back.mp4)

每段视频为 1152 × 720、24 fps、22 秒、528 帧，依次呈现两条完整动作。左侧为基础动作和 Blender 姿势修正，右侧在同一时间轴上开启裙发动态与身体碰撞。三台固定机位按相同时间采样。逐帧解码通过，并从编码后的视频抽查了接近、坐姿保持、后躺过渡和躺卧保持的取景。

在 Chrome 的同一姿势和碰撞状态下临时去掉十个新修正目标，再与开启修正后的结果比较。表内为活动接触区间每 0.125 秒采样一次、穿入八个近似胶囊超过 0.001 模型单位的平均顶点数。

| 动作与模式 | 头发，修正前 → 后 | 裙摆，修正前 → 后 |
| --- | ---: | ---: |
| 坐下静态 | 67.44 → 8.33 | 0.86 → 0.06 |
| 坐下动态 | 65.39 → 12.72 | 0.86 → 0.06 |
| 躺卧静态 | 28.88 → 2.81 | 0.25 → 0 |
| 躺卧动态 | 28.37 → 4.44 | 0.29 → 0 |

躺卧动态采样中，发束最低点从 −0.0168 到 +0.0199 模型单位，基准为实验室地面。近似胶囊下仍有少量接触重叠。坐垫和床面是定位参考，当前脚踝高度补偿允许脚掌滑动，床边、手部支撑与布料自碰撞需另行处理。

- Windows 11、Blender 5.2.3 LTS。重新载入工程检查六段 NLA，比较骨骼、静态网格、UV、权重和原形状键。见 [Blender 验收](blender-validation.json)。
- Chrome 156。在真实 GLB 上检查两个连续动作的完整帧序列、暂停、重播、切换、时刻范围、动作结束及形状键清零。最大相邻帧头部位移约 0.021 模型单位。见 [连续帧和接触采样](browser-validation.json)。
- Khronos glTF Validator 0 错误、2 项既有警告，涉及切线生成和蒙皮网格节点层级。核对 103 根骨骼、15 个形状目标、六段动作和三张原贴图。见 [GLB 验收](gltf-validation.json)。
- Windows 上 `npm run build`（含 TypeScript 检查）和现有八项回归通过。原独立入口另外检查了动作、开关、加载失败重试和 390 × 844 模拟视口。

GLB 为 14,072,252 bytes（13.42 MiB），比第二阶段增加 3,344,084 bytes，主要是十个过渡形状目标。Blender 工程为 9,871,008 bytes。验收视频放在 art 目录，应用依赖不增加。正式接入前仍需处理模型预算和 4096² 源贴图。

## 复现

在 `?dev=resident` 选择「打开连续坐卧验收」，或访问 `?dev=resident&asset=transitions`。在 Blender 中同时启用骨架和 Shape Keys 的一对同名 NLA 轨道。通过 Blender Python 加载 [制作脚本](../../../scripts/blender/build_tripo_transitions.py)，调用 `build(workspace)`，再加载 [Blender 验收脚本](../../../scripts/blender/validate_tripo_transitions.py) 并调用 `validate(workspace)`。制作脚本校验第二阶段源工程哈希。

启动 Vite 后运行 `node scripts/check-resident-transitions.mjs`。本机须能解析 Playwright、Chrome 和 FFmpeg，可通过 `PLAYWRIGHT_MODULE`、`CHROME_PATH`、`FFMPEG_PATH`、`FFPROBE_PATH` 指定工具。原始帧默认保存到被 Git 忽略的 `art/resident/generated/transition-frames`，也可设置 `TRANSITION_FRAMES`。只检查数值时加 `--audit-only`，另设 `LAB_OUT` 避免覆盖带视频记录的报告。

GLB 校验运行 `node scripts/validate-resident-transition-glb.mjs`，可用 `GLTF_VALIDATOR_MODULE` 指向本机 validator 的模块 file URL。
