# 连续坐卧动作与脚底接触精修

当前版本在两段连续坐卧动作中加入烘焙的双腿脚底固定，调整骨盆后移轨迹，并修复 GLB 骨骼动画与形状键相差一帧的问题。浅屈膝阶段重新分配接触修正采样，减少刚坐下时长发穿入身体。

继续使用 `feat/tripo-hair-dress-rig` 和 PR #27，供审阅、不合并。主房间接入另行安排。保留原模型、第一版和[第二阶段工程](../tripo-dynamics/README.md)。上一轮连续动作及视频保存在提交 [186c526](https://github.com/xuzihan0823/PocketWorld/tree/186c526/art/resident/tripo-transitions)。

## 资产与动作

- [Blender 工程](luna-tripo-transitions.blend)：103 根骨骼，六段骨骼与形状键 NLA，贴图打包。
- [GLB](../../../public/models/resident/luna-tripo-transitions.glb)：一个 Skin、一个网格、18,659 个三角面、15 个形状目标、三张原贴图。
- 103 根骨骼的静态矩阵和层级、静态顶点、三角面、UV、蒙皮权重与五个原修正目标保持一致。没有增加骨骼、缩小裙摆、删除发束或减面。

| 动作 | 时长 | 过程与脚底约束 |
| --- | ---: | --- |
| `SitCycle` | 9 秒 | 起步、停稳、坐下、坐稳、起身。2.1–9 秒固定脚踝及脚掌方向 |
| `LieCycle` | 13 秒 | 站立、坐下、后躺、停留、返回坐姿、站起。0–2.9 秒、9.9–13 秒固定脚底；后躺时平滑释放 |

双腿使用解析两段骨骼求解，结果逐帧烘焙为现有腿骨的旋转，不增加运行时 IK、辅助骨骼或约束。骨盆在坐下时逐步向后移动 0.14 模型单位，配合原降落轨迹。脚掌保持世界方向，膝盖向前弯曲；起身沿同一路径回落。坐垫参考位置随新的骨盆落点调整。

本机 Blender 导出器将骨骼第 1 帧写在 glTF 的 1/30 秒，而 Key 曲线的第 1 帧写在 0 秒。制作脚本为两段连续动作建立独立时间访问器，将骨骼与形状键对齐到 0 秒，时长为准确的 9 / 13 秒。四段既有诊断动作保留。

## 裙发接触

仍使用十个连续动作接触目标。坐姿参数的采样点为 0.08 / 0.22 / 0.45 / 0.70 / 1.00，后躺为 0.20 / 0.40 / 0.60 / 0.80 / 1.00，相邻目标连续混合。局部胶囊留量为 0.005–0.006 模型单位；后躺末段保留托面留量。接触修正只改变动作中的局部形状，零权重恢复原静态外形。

运行时沿用 120 Hz 固定步长、弹簧与八个身体胶囊。动作进入浅屈膝时开始收紧摆幅，接触参数从 0 增至 0.12 时平滑收紧到头发上限的 4%、裙摆的 5%，离开时恢复；保留模拟历史和独立开关。

## Windows 验收

[正面视频](front.mp4) · [侧面视频](side.mp4) · [背面视频](back.mp4)

每段为 1152 × 720、24 fps、22 秒、528 帧。左侧基础动作与 Blender 修正，右侧开启裙发动态与碰撞；固定机位呈现完整两段动作。编码后完整解码，并抽查屈膝、坐姿、后躺中段与躺卧停留的正侧背关键帧。

### 脚底固定

[脚底回归记录](footplant-validation.json) 使用真实 GLB，在 60 fps 下覆盖烘焙关键帧之间的插值。脚底表面取站立时距离地面小于 0.005 的 152 个顶点；脚踝和脚趾取四个骨骼锚点。数值为模型单位，角色约高 0.98。

| 接触区间的最大位移 | 186c526 | 当前 |
| --- | ---: | ---: |
| 坐起：脚踝／脚趾锚点 | 0.168630 | 0.0000601 |
| 坐起：脚底表面 | 0.168688 | 0.0001118 |
| 躺卧流程的站坐支撑：脚踝／脚趾锚点 | 0.168630 | 0.0000602 |
| 躺卧流程的站坐支撑：脚底表面 | 0.168688 | 0.0001119 |

当前脚底最低高度范围约 −0.000049 至 +0.0000002，为插值与浮点残差。该约束不覆盖前 2.1 秒诊断步行，也不把后躺伸腿锁在地面。踝部上方仍有原蒙皮的局部形变。

### 接触与完整性

[本轮连续帧与接触记录](browser-validation.json)、[与上一轮对比](polish-comparison.json)。相同活动区间每 0.125 秒采样一次，统计实际变形网格穿入八个近似胶囊超过 0.001 的平均顶点数：

| 动作与模式 | 头发，上一轮 → 当前 | 裙摆，上一轮 → 当前 |
| --- | ---: | ---: |
| 坐下静态 | 8.33 → 4.00 | 0.06 → 0 |
| 坐下动态 | 12.72 → 4.19 | 0.06 → 0 |
| 躺卧静态 | 2.81 → 1.62 | 0 → 0 |
| 躺卧动态 | 4.44 → 1.57 | 0 → 0 |

当前动态采样头发最大胶囊穿入深度为坐姿约 0.00599、躺卧约 0.00318；仍存在少量局部重叠。躺卧发束最低点约 +0.0199。此诊断不是精确身体表面、自碰撞或家具接触检测，不能据此宣称全模型无穿模。`browser-validation.json` 内的 before/after 专指同一新姿势移除／启用十个接触目标；跨版本比较以 `polish-comparison.json` 为准。

- Windows 11、Node 24.14.0、npm 11.12.0、Blender 5.2.3 LTS、Chrome 156。
- [Blender 验收](blender-validation.json)：保存工程重载，六段 NLA、原静态网格／UV／权重／骨架保持；实际 GLB 导入后 25,207 个导出顶点在 13 个动作时刻与工程对照，最大表面误差约 `6.56e-7`。
- [glTF 验收](gltf-validation.json)：0 errors、2 项既有 warnings（切线生成、蒙皮网格非根节点）；三张贴图逐字节不变。
- 新增脚底回归检查时间原点、9/13 秒准确时长、脚底插值、起落连续性，并对照原四段动作的骨骼姿势采样。
- 本机 `npm run build`（含 TypeScript）、原八项动态回归、`git diff --check` 通过。
- Chrome 完整序列、结束停留、重播、暂停、切换、时刻范围、形状键清零通过；原入口另检查独立开关、加载失败重试、减少动态偏好和 390 × 844 模拟视口，见 [原入口记录](lab-validation.json)。

GLB 为 14,135,024 bytes（13.48 MiB），比上一轮增加 62,772 bytes（0.45%）；Blender 为 10,379,172 bytes。应用依赖不增加，形状目标数量不增加。原 4096² 贴图和超 10 MB 的模型预算仍待正式接入前处理。

## 复现

在 `?dev=resident` 选择「打开连续坐卧验收」，或访问 `?dev=resident&asset=transitions`。Blender 中同时启用骨架与 Shape Keys 的一对同名 NLA 轨道。

通过 Blender Python 加载 [制作脚本](../../../scripts/blender/build_tripo_transitions.py)，调用 `build(workspace)`；再加载 [验收脚本](../../../scripts/blender/validate_tripo_transitions.py)，调用 `validate(workspace)`。源工程哈希校验继续指向保留的第二阶段工程。

```powershell
node scripts/check-resident-footplant.mjs
node scripts/validate-resident-transition-glb.mjs
node --test src/scene/orbital/secondary/secondary.test.mjs
npm.cmd run build
# 启动独立 Vite 预览后
node scripts/check-resident-transitions.mjs
```

脚底脚本的 `BASELINE_GLB` 可指向从 `186c526:public/models/resident/luna-tripo-transitions.glb` 提取的二进制文件以生成跨版本对比；不设置时仍校验当前版。`FOOTPLANT_OUT` 可指定报告路径。

浏览器录制工具可由 `PLAYWRIGHT_MODULE`、`CHROME_PATH`、`FFMPEG_PATH`、`FFPROBE_PATH` 指定；`LAB_URL` 指定独立端口，`LAB_OUT` 和 `TRANSITION_FRAMES` 指定输出。原始帧默认在 Git 忽略的 `art/resident/generated/transition-frames`；只做数值检查可加 `--audit-only` 并另设 `LAB_OUT`。`GLTF_VALIDATOR_MODULE` 可指定现有 validator 模块，不必修改应用依赖。

## 边界与后续

本轮完成停稳后坐起脚底固定、早期裙发接触及连续动作时间轴对齐。肩腋近景原低面数折角与烘焙色斑、诊断步行的完整步态、手掌支撑、家具边缘和布料自碰撞仍待处理。坐垫与床面仍为定位参考。实体手机、Safari、正式房间性能、主场景接入另行验收。
