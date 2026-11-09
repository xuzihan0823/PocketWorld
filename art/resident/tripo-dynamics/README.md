# Tripo 第二阶段：变形修复与裙发动态

本阶段继续使用 `feat/tripo-hair-dress-rig` 和第一版 Blender 工程，交付修复后的独立模型、弹簧控制器和 `?dev=resident` 测试场景。原始模型、第一版 GLB/Blender 和主房间的旧角色保留。此版本可供动态系统审查，但抬臂时的腋下表面尚未达到最终美术质量。

## 文件与接入范围

| 文件 | 用途 |
| --- | --- |
| [luna-tripo-dynamics.blend](luna-tripo-dynamics.blend) | 修复后的可编辑工程，贴图已打包，四段动作保存在 NLA 轨道 |
| [luna-tripo-dynamics.glb](../../../public/models/resident/luna-tripo-dynamics.glb) | 103 根骨骼、一个 Skin、一个网格、四段测试动画 |
| [SecondaryMotion.ts](../../../src/scene/orbital/secondary/SecondaryMotion.ts) | 独立弹簧、角度限制与身体胶囊碰撞 |
| [ResidentLab.tsx](../../../src/scene/orbital/secondary/ResidentLab.tsx)、[resident-lab.css](../../../src/scene/orbital/secondary/resident-lab.css) | 独立预览、动作选择、暂停/检查时刻、各项开关、碰撞体显示 |
| [main.tsx](../../../src/main.tsx) | 仅增加 `?dev=resident` 的按需加载入口 |
| [secondary.test.mjs](../../../src/scene/orbital/secondary/secondary.test.mjs) | 使用实际 GLB 的七项运行时回归测试 |
| [refine_tripo_dynamics.py](../../../scripts/blender/refine_tripo_dynamics.py) | 从第一版工程修复区域、权重并生成测试动作，不新增骨骼 |
| [validate_tripo_dynamics.py](../../../scripts/blender/validate_tripo_dynamics.py) | Blender 姿势、权重、外观保持及导出回读检查 |
| [check-resident-lab.mjs](../../../scripts/check-resident-lab.mjs) | Chrome 端截图、开关、加载恢复、减少动态偏好及性能检查 |
| [模型索引](../../../public/models/resident/README.md) | 登记第二阶段模型与使用范围 |
| 本目录的 JSON、PNG、WebM | 实测记录、四种动作及侧面预览、动态短片 |

没有修改 `ResidentModel.tsx`、`OrbitalResidents.tsx` 或现有房间动作。它们仍为旧模型在加载时生成骨架，不能直接替换文件路径使用新模型。测试入口绕过旧绑骨逻辑，使用 GLTFLoader 导出的原生 SkinnedMesh 和 AnimationMixer。

## 蒙皮修复

103 根骨骼的名称、静态矩阵和父子关系全部保留，其中 26 根头发骨骼、24 根裙摆骨骼。检查确认主要根因是区域误选、串权重和表面粘连，无需再创建或移动骨骼。

按第一版区域、纹理颜色及裙底内部位置重新识别表面。拆开头发/身体、裙摆/身体边界的 518 个共用顶点，保留所有 18,525 个三角面、顶点静态位置、轮廓、UV 和法线。没有缩小裙摆、删发束或减面。恢复误选的手臂皮肤和裙底中央身体表面的原始蒙皮，同时移除腿部误带的手指权重。

头发只保留头骨和发链权重；裙摆只保留裙链、髋及腰部脊柱过渡权重。每顶点最多四个影响，归一化且无漏绑。先裁去低于导出器有效阈值的微小权重，确保 Blender 与 GLB 回读一致。

Blender 有 24,877 个顶点；GLB 因顶点属性拆分为 24,998 个顶点。GLB 为 9,346,684 bytes（8.91 MiB），工程为 8,973,204 bytes。三张嵌入贴图与第一版逐字节一致。GLB 不依赖外部解码器；保留的 4096² 颜色贴图仍是移动端内存优化的后续事项。

## 动态与动画的关系

控制器在世界空间模拟每根辅助骨骼的尾点，使用 1/120 秒固定步长、弹簧回复力和指数阻尼。角色移动产生惯性，停止后回到当前动画的目标姿势。每一步固定采用以下顺序：

1. 恢复上一时刻保存的基础动画局部旋转。
2. 在回调中更新 AnimationMixer 和角色根节点的位置。
3. 保存本步基础旋转，计算弹簧与碰撞，最后写入辅助骨骼旋转。

模拟不改骨骼平移、缩放、父子关系或运行时蒙皮权重。头发根部/后续关节的叠加旋转上限为 18°/28°，裙摆为 10°/16°。坐姿裙摆抬起来自 Blender 测试动画，弹簧只在该姿势上作小幅叠加。

```ts
const motion = new SecondaryMotion(character);
motion.advance(frameDelta, fixedDelta => {
  mixer.update(fixedDelta);
  updateCharacterPosition(fixedDelta);
});
motion.configure({ hair: false, dress: true, collisions: true });
```

不要在这个回调之外再次更新同一个 Mixer。切换动作或跳到检查时刻时，先 `motion.reset()`，再采样基础动作，然后 `motion.captureBasePose()`。卸载调用 `dispose()`。每个角色实例使用自己的控制器；从缓存复制蒙皮模型时使用 SkeletonUtils.clone。

超过 100 ms 的帧间隔丢弃补算并复位，避免回到后台页面时追赶大量模拟；瞬移超过约 0.3 模型单位也会复位。所有开关都清理历史速度。关闭头发和裙摆动态后，碰撞仍可独立修正姿势；“静态对比”会同时关闭三者，得到未叠加的基础动画。

碰撞使用八个跟随人体骨骼的胶囊体：头部、双肩、上下躯干、骨盆、双大腿。每节辅助骨骼在中点和末端做四轮投影，并重复约束长度和旋转角度。身体往返移动与暂停动作可组合，用于观察停止后的收敛。

## 实际验证

本机 Blender 5.2.3 LTS、项目 Three.js r169、Chrome WebGL；记录见 [Blender](blender-validation.json)、[glTF Validator](gltf-validation.json)、[浏览器](browser-validation.json) 和 [表面修复计数](repair.json)。

第一版与修复版使用完全相同的测试姿势。下表“显著拉伸边”定义为长度超过静态的两倍，且增加超过 0.015 模型单位；它是诊断阈值，不是所有顶点均无形变的保证。

| 动作 | 第一版显著拉伸边 | 修复后 | 最大单边长度比，第一版 → 修复后 |
| --- | ---: | ---: | ---: |
| Walk | 61 | 0 | 3.26 → 2.12 |
| 双臂上举 | 178 | 5 | 27.21 → 3.97 |
| 坐下 | 125 | 0 | 4.32 → 2.73 |
| 躺下 | 0 | 0 | 1.61 → 1.56 |

抬臂时头发的直接位移约 `1.19e-7`，肩臂权重牵扯已消除。原静态表面位置和 UV 误差为零；GLB 回读静态误差 `4.77e-7`，四种姿势最大误差 `7.15e-7`。Khronos Validator 为 0 errors、2 warnings，均延续第一版：运行时生成切线、蒙皮网格不是根节点。

七项运行时测试通过：实际四段动画有非恒定旋转；30/60/144 fps 及不均匀帧间隔的模拟结果误差小于 `1e-9`；停止五秒后稳定；各关节限制成立；静态模式与原 Mixer 旋转逐分量一致；反复开关无累积；头发/裙摆独立控制；后台恢复、瞬移与实例隔离正常。

四段动作在第 2 秒的碰撞采样，关闭约束时最大穿透依次约为 0.00667、0.00103、0.00239、0.00103 模型单位，开启后均小于 `1e-8`。这只证明骨链的中点/端点约束有效，不能据此宣称整个网格无穿模。

浏览器中五种状态（含站立）均正常渲染，顶点坐标有限；开关、暂停、动作切换、模型加载失败后重试、390×844 模拟视口及减少动态偏好检查通过。无页面异常或模型请求失败；原应用缺失 favicon 的 404 单独记录。动画和模拟 CPU 更新在 180 帧样本中平均约 1.23 ms，最大 6.5 ms，不含 GPU 渲染时间；不是实体手机性能结论。

`npm run build`（含 TypeScript）通过。新增实验室 JS 块约 15.35 kB（gzip 6.46 kB），按需加载；没有新增应用依赖。构建仍提示既有 Three.js vendor 块较大。

## 复现与预览

在此分支工作区启动独立端口：

```sh
nohup npm run dev -- --host 127.0.0.1 --port 8941 --strictPort > /tmp/pw-resident-lab.log 2>&1 &
resident_lab_pid=$!
# 浏览器打开 http://127.0.0.1:8941/?dev=resident
# 完成后停止该进程：kill "$resident_lab_pid"
node --test src/scene/orbital/secondary/secondary.test.mjs
npm run build
```

选择 Walk/双臂上举/坐下/躺下；检查时刻滑块可停在关键姿势。逐个切换头发、裙摆、碰撞；开启身体移动，再停止移动和动作，观察裙发稳定。碰撞体显示用于核对覆盖范围。页面遵循系统减少动态偏好；启用该偏好时首次默认站立，不自动播放或移动。

动作预览：[Walk](three-walk.png)、[上举](three-armsup.png)、[上举侧面与遗留问题](three-armsup-side.png)、[坐下](three-sit.png)、[坐姿侧面](three-sit-side.png)、[躺下](three-liedown.png)、[躺姿侧面](three-liedown-side.png)、[碰撞体](three-colliders.png)、[手机布局](three-mobile.png)、[移动与停止短片](motion-preview.webm)。

浏览器自动检查运行 `node scripts/check-resident-lab.mjs`，需要当前环境可解析 `playwright`；也可用 `PLAYWRIGHT_MODULE` 指向已安装模块，`CHROME_PATH` 指向 Chrome。`LAB_URL` 可指定预览地址。`RECORD_PREVIEW=1` 可附加录像，需要先安装 Playwright 的 ffmpeg；这些只用于检查，不是应用依赖。

Blender 中打开本目录工程，选择骨架，在 NLA Editor 只启用一个同名轨道。Walk 为 30 fps、1–37 帧循环；ArmsUp、Sit、LieDown 为 1–121 帧，约 0.8 秒过渡、保持后回到起始姿势。这些是本轮制作的诊断片段，不是现成动作资源、动作捕捉或正式步态/上床流程。

需要重新生成时，在 Blender 的 Python 环境用 importlib 加载 `scripts/blender/refine_tripo_dynamics.py`，调用 `build(workspace, source)`；`workspace` 为本工作区，`source` 为原始 Tripo GLB。脚本校验原始 SHA-256，只读取第一版工程，写入第二阶段路径。再加载 `validate_tripo_dynamics.py`，调用 `validate(workspace)`。在本机通过 Blender MCP 执行成功；本机后台 Blender 启动曾发生进程崩溃，因此本次不把命令行后台路径列为已验证方式。

## 未解决与边界

- 上举时腋下附近仍有局部折叠、缺面/开口，保留了五条符合上述阈值的拉伸边。需要局部补面与人体肩部蒙皮精修，不能把此次修复描述为完整美术验收。
- 裙摆在坐姿仍有褶皱压缩和局部长度变化；头发和裙摆的宽度没有完整体积碰撞，骨链之间的网格仍可能穿入身体。没有自碰撞、手臂全段/手掌、地面或家具碰撞，显示的坐垫和床面只作位置参考。
- 模型以动画姿势为弹簧目标，不包含真实重力下任意姿势的布料垂落。正式阅读、翻书、上床流程、脚底锁定和 IK 未包含在这四段测试动作中。
- 实体手机、Safari、长时间游戏场景及非均匀/运行中变化的角色缩放未验收。当前碰撞尺寸针对这一个模型，在初始化时按角色比例计算。

保留分支、工作区与原 PR 供审查，不合并。第一版说明和资源仍位于 [tripo-secondary](../tripo-secondary/README.md)。
