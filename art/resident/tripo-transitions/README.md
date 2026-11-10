# 新角色腿型、步态与裙发验收

当前版本在 `941173f` 的步态与肩发修复基础上，局部修正正面膝周和小腿形体、膝部蒙皮与停步弯曲平面。保留 103 根骨骼、18,659 个三角面、UV、三张原贴图、49 个形状目标，以及已有足部滚转和肩发修复。沿用 `feat/tripo-hair-dress-rig` / PR #27。

## 正面腿型诊断

原 `walk-front.mp4` 前 2.4 秒是 SitCycle 接近停步，后 3.6 秒是 Walk；完整视频的 2.20 / 2.60 / 3.20 秒分别对应 SitCycle 2.20、Walk 0.20 / 0.80 秒。本轮用固定正交相机比较，取消原透视和俯视造成的比例变化。

| 检查项 | 证据与结论 | 本轮处理 |
| --- | --- | --- |
| 基础网格 | Rest 与停止态都有膝周内收、小腿肚偏外的轮廓。灰模中同样存在，表面转折明显大于真实骨骼连线转折。 | 在高度 0.10–0.40 的腿部皮肤区域调整 552 个顶点；膝周向外、小腿肚向内，平滑衰减，最大横移 0.005287。同步所有形状目标的基础偏移。 |
| 默认 / 停止姿态 | 原停止姿态与 Rest 的腿部基本相同，没有额外的大腿内旋动画；绑定膝盖相对髋踝正面连线内偏约 0.004226。 | 保存原绑定骨骼，停止及坐起支撑求解改为与步行一致的前向弯曲平面。实际生活舱 idle 采用 SitCycle 末帧，也继承该修正。 |
| 关节位置 | 关节中心按骨骼 head 读取；皮肤膝盖轮廓不作为关节中心。原绑定位置有轻微内偏，但不足以解释屈膝时明显的表面折转。 | 髋、膝、踝的绑定位置和骨段长度保持；不为贴合皮肤轮廓改绑骨架。 |
| 动画旋转 | Walk 0.20 / 0.80 的髋膝踝正面基本共线，摆腿膝弯约 44.86°。120 Hz 全周期最大正面偏离仅 0.0000271。 | Walk 全部骨骼矩阵、膝屈曲角、脚踝轨迹与上一版完全一致；步宽、速度、支撑比和足滚转不变。 |
| IK / 蒙皮 | 使用离线两段骨求解，导出无运行时 IK 约束。Walk 前向 pole 正常；停步原先回到偏内的 rest pole。膝周的原始形体和权重过渡会放大皮肤折转。 | 修正停步 pole，并在膝盖上下 0.045 范围重分配 251 个顶点的同侧大腿/小腿权重，给前侧髌骨小幅大腿偏重，保留其余影响与总权重。 |

[修正前：Rest / 停止 / 双侧屈膝叠骨](front-diagnosis-before.png) · [修正后同机位](front-diagnosis-after.png) · [皮肤前后对比](front-surface-comparison.png) · [无贴图灰模](front-clay-comparison.png)

黄点是实际膝关节中心，青线是髋—膝—踝连线，虚线表示求解后的弯曲方向在画面的投影。Rest 仍显示原绑定骨架，停止态显示前向 pole 求解后的骨架。皮肤与关节允许有合理偏移，未把两者强制重合。

[正面正交视频：左旧右新](front-orthographic.mp4) · [同一视频叠加关节](front-orthographic-joints.mp4)

两段均为 6 秒 / 30 fps / 180 帧，沿用原视频完整时间轴。骨骼和表面在同一真实 GLB 中采样；这两段隔离裙发动力学以观察腿部，带动力学的三视角视频另列如下。

## 验证

- [腿部回读](leg-validation.json)：120 Hz 下 Walk 全骨骼矩阵最大差、脚踝轨迹最大差及膝屈曲角最大差均为 0。停止膝关节正面内偏由 0.0042264 降至 2.01e-8。
- 同一条腿内的小腿中段与膝周表面中线横向差：停止态约 0.009462 → 0.00199；两个屈膝关键帧约 0.00862–0.01020 → 0.00176–0.00263。该几何量用于对照转折趋势，不替代外观判断，也不把表面中线当成骨骼中心。
- [120 Hz 脚底](walk-validation.json)：SitCycle / Walk 支撑脚底最大漂移 0.000174 / 0.000213；最低点 −0.000108 / −0.000191；双脚同时离地采样数均为 0。足滚转约 +15.98° / −11.33°；支撑中期膝弯仍约 4.94°。
- [坐卧及旧动作](footplant-validation.json)：足底支撑通过，ArmsUp / Sit / LieDown 骨骼矩阵样本与 941173f 一致。
- [Blender 回读](blender-validation.json)：25,206 个导出顶点 / 22 个时刻，最大表面误差 7.16e-7；552 个形体修改点和 251 个膝权重点均在限定范围；高度 ≤0.10 的脚部原坐标及权重保留，拓扑、UV、绑定骨骼不变；原 259 个肩背复制权重点仍逐点通过。
- [glTF](gltf-validation.json)：0 errors、2 个既有 warnings（生成切线、蒙皮网格非根节点）。三张原贴图逐字节一致，GLB 11,346,500 bytes，比 941173f 增加 2,040 bytes；导出顶点因属性拆分增加 2 个，原三角面不变。
- [完整浏览器动作](browser-validation.json)：9 / 13 秒坐卧、暂停、重播、形状清零和切回真实 Rest 通过。验收页现在恢复 glTF 局部 TRS，避免 `Skeleton.pose()` 对带坐标转换父节点的根骨造成额外转向。
- [步行动态](walk-browser-validation.json)：静态 / 动态各 180 帧，大腿胶囊穿入数为 0（深度阈值 0.001）；单节裙发最大偏角约 8.9601°。
- [正交录制](leg-render-validation.json)：两段视频完整解码、帧数、时长及页面异常检查通过。关键帧和全周期已检查；灰模用于排除贴图阴影误导。
- `node --test src/scene/orbital/secondary/secondary.test.mjs`：8/8 通过。`npm run build`（含 TypeScript）通过，保留既有 Three.js 大包提示。
- [实际生活舱](room-validation.json)：移动、转向、停步通过，移动距离约 0.525，无页面错误。[场景截图](room-walk.png)。

## 保留的步态与肩发功能

Walk 周期 1.2 秒、速度 0.25 模型单位/秒、支撑比 7/12；左右脚各内收 0.015 的上一轮设置保持。足滚转为抬跟、勾脚尖、落地放平三段，包含 0.0045 插值余量。保留骨盆重心转移、对侧摆臂、收臂与放松手指。

SitCycle 前 2.1 秒的四步摆脚边界仍对齐 30 fps，2.1 秒接入停稳、2.4 秒后坐下。49 个修正目标包含 34 个 Walk / Approach 接触形状，已按本轮表面与支撑求解重烘焙。

原 259 个肩背误分头发点仍按最近身体顶点复制权重，左肩跟随 Shoulder / Arm 混合权重。头发 / 裙摆步行动力学配额仍为 0.32 / 0.12，SecondaryMotion 求解器保持。[肩部近景](shoulder-repair-comparison.png)。

[当前正面](walk-front.mp4) · [当前侧面](walk-side.mp4) · [当前背面](walk-back.mp4) 均已重录，左为基础动作、右为开启裙发动态；这三段沿用上一轮透视取景。`before-after-side.mp4` / `back-repair-comparison.png` 保留为 fe8bf8c → 941173f 的上一轮肩发历史对比。

实际入口 `?resident=tripo` 使用缩放 1.45、速度 0.3625，按实测移动距离推进 Walk。独立验收入口 `?dev=resident&asset=transitions`；默认应用入口仍使用原角色。

## 复现与边界

```powershell
blender -b -t 4 --python-exit-code 1 --python scripts/blender/build_tripo_transitions.py -- --workspace <项目绝对路径>
blender -b -t 4 --python-exit-code 1 --python scripts/blender/validate_tripo_transitions.py -- --workspace <项目绝对路径>
# BASELINE_GLB 指向 941173f 的 luna-tripo-transitions.glb
node scripts/check-resident-legs.mjs
node scripts/check-resident-walk.mjs
node scripts/check-resident-footplant.mjs
node scripts/validate-resident-transition-glb.mjs
node --test src/scene/orbital/secondary/secondary.test.mjs
npm.cmd run build
node scripts/check-resident-transitions.mjs --audit-only
node scripts/record-resident-walk.mjs
node scripts/record-resident-leg-review.mjs
```

浏览器脚本用 `LAB_URL` 指定当前实验室，`REVIEW_ORIGIN` 指定正交录制的本地 Vite origin（默认 8950）；`PLAYWRIGHT_MODULE` / `CHROME_PATH` 指定工具路径，`LEG_FRAMES` / `WALK_FRAMES` 指定中间帧目录，`GLTF_VALIDATOR_MODULE` 指定验证器。未新增应用依赖。

[GLB](../../../public/models/resident/luna-tripo-transitions.glb) · [Blender 工程](luna-tripo-transitions.blend) · [制作记录](authoring.json)

本轮修正限定于腿部正面轮廓与屈伸。原贴图的膝部明暗、网格本身的低多边形细节保留。胶囊检查不代表精确布料自碰撞；坐卧头发仍有约 0.00105 的近似重叠。新骨架家具动作、实时启停及急转融合、GLB / 4096² 贴图预算、实体手机、Safari 和长期性能仍待验收。
