# 新角色步行、停步与连续坐卧验收

当前模型修复 SitCycle 前 2.1 秒与 Walk 的支撑脚滑动、大腿穿裙、背部悬浮布片和步态僵硬。保留 103 根骨骼、18,659 个三角面、静态位置、UV 与三张原贴图；将 259 个误分到头发的布料顶点归还躯干。沿用 feat/tripo-hair-dress-rig / PR #27。

## 动作修复

- 接近阶段以世界坐标落点烘焙双腿解析求解。四次摆脚区间为左 0.08–0.50、右 0.58–0.99、左 1.07–1.48、右 1.56–1.98 秒，其余时间该脚固定。最后一脚在 1.98 秒落稳，2.1 秒连续衔接原坐姿流程。
- Walk 是 1.2 秒原地循环，匹配前进速度为 0.20 模型单位/秒。每脚 2/3 周期支撑、1/3 摆动，交接包含双脚支撑。接触边界对齐 30 fps 烘焙帧。宿主须按实际移动距离驱动动画。
- 骨盆小幅上下起伏、约 ±2° 水平旋转，脊柱微量反转；脚踝起落俯仰；上臂内收约 16.6°，前臂自然微屈。
- 大腿求解后的前摆角驱动 Dress_Front / Dress_Front_L / Dress_Front_R，另烘焙 34 个局部步行接触目标。只修正松散裙摆，接近动作两端形变归零。步行时运行时裙摆额外动态上限为原来的 12%，保留基础动作。
- 几何接缝连接后识别出独立布料小片：259 个领口／背部／衣袖边缘顶点移出 Secondary_Hair_Region，权重回到 Spine2 / Spine1，清掉原先的头发接触形变。主要长发、头顶与刘海连通块保留。close_local_surfaces 补洞面使用身体顶点，未发现 Hair 权重，未删除或重绑这些面。

## 视频与回读

[正面](walk-front.mp4) · [侧面](walk-side.mp4) · [背面](walk-back.mp4) · [侧面前后对比](before-after-side.mp4)

前三段各 6 秒、30 fps、180 帧：前 2.4 秒接近停步，后 3.6 秒带匹配根位移的 Walk；左基础动作、右开启动态。前后对比左为 4edd62b 旧版、右为本轮。已完整解码并抽查 0.30、0.93、1.47 秒和 Walk 关键帧。现有 front.mp4 / side.mp4 / back.mp4 仍是上一轮完整 22 秒视频，本轮视频使用 walk- 前缀。

[120 Hz 步行回读](walk-validation.json) 检查导出 GLB 的实际插值、骨骼与 152 个脚底顶点。Walk 叠加匹配的前进位移，检测每次支撑区间的世界空间漂移。单位为模型单位，站立高度约 0.98。

| 项目 | SitCycle 0–2.1 s | Walk 两个循环 |
| --- | ---: | ---: |
| 采样数 | 253 | 289 |
| 支撑脚踝最大漂移 | 0.000360 | 0.0000304 |
| 支撑脚底表面最大漂移 | 0.000410 | 0.000143 |
| 双脚同时离地超过 0.001 的采样数 | 0 | 0 |
| 脚底最低点 | −0.000352 | −0.0000291 |

Walk 循环首尾骨骼矩阵差最大 4.11e-8，形状权重差 4.77e-7。原坐起／躺卧支撑区间精度保持，见 [脚底回归](footplant-validation.json)；ArmsUp、Sit、LieDown 骨骼姿势样本与上一版一致。

[浏览器步行接触](walk-browser-validation.json)：每帧检查实际裙摆顶点与左右大腿胶囊，基础／动态模式各覆盖 72 帧接近和 108 帧 Walk，穿入为 0。此结论限于两个近似大腿胶囊，不代表精确身体表面、所有衣物和自碰撞均无重叠。上衣与躯干近似胶囊仍有既存重叠。

[Blender 验证](blender-validation.json)：原骨架层级／静态矩阵、网格与 UV 保留，只有记录的 259 个顶点修改权重及关联旧头发修正。六段 NLA、49 个形状目标齐全。实际 GLB 回读 25,204 个导出顶点，在 22 个时刻与工程逐点比较，最大误差 6.56e-7，包含 0.92 / 1.46 秒。

[glTF Validator](gltf-validation.json)：0 errors、2 项既有 warnings（切线生成、蒙皮网格非根节点），三张贴图逐字节一致。清理小于 1e-6 的形状法线舍入噪声后，GLB 为 11,177,284 bytes，比上一版 14,135,024 bytes 小约 20.9%，位置形变不做近似。模型仍略高于建议 10 MB，源 4096² 贴图预算待处理。

Windows TypeScript、生产构建、八项原动态回归、步行与坐卧脚底回归通过。Chrome 完整 9 / 13 秒流程、暂停、重播、切换及形状清零通过，见 [完整流程回归](browser-validation.json)。完整坐卧动态采样裙摆重叠为 0；头发仍有少量胶囊重叠，最大约 0.00105。

## 实际房间测试

用户已授权接入场景测试。启动应用后访问 `?resident=tripo`，在真实生活舱／观景舱测试新模型。沿用 WASD、点地寻路、转向与障碍处理，模型缩放 1.45，匹配速度 0.29 场景单位/秒；动画按障碍处理后的实际位移推进。[房间记录](room-validation.json) 与 [场景截图](room-walk.png) 验证了加载、移动和转向，页面无运行错误。

此入口用于站立／步行测试；桌椅坐姿、床铺、搬书及抽屉手部动作尚未适配新骨架。默认入口继续使用原运行角色。实时启停与急转弯的平滑过渡还需和正式移动控制器联调；本轮锁脚指标针对交付 GLB 的 SitCycle 接近及匹配位移的 Walk。

## 复现

[GLB](../../../public/models/resident/luna-tripo-transitions.glb) · [Blender 工程](luna-tripo-transitions.blend) · [制作记录](authoring.json)

保留的第二阶段输入由脚本校验哈希；上一版可从提交 4edd62b 取出。通过 Blender Python 执行 scripts/blender/build_tripo_transitions.py，传入 `-- --workspace <项目绝对路径>`。共用步态在 tripo_walk.py，误绑修复在 refine_tripo_dynamics.py。

```powershell
node scripts/check-resident-walk.mjs
node scripts/check-resident-footplant.mjs
node scripts/validate-resident-transition-glb.mjs
node --test src/scene/orbital/secondary/secondary.test.mjs
npm.cmd run build
# 启动独立预览、配置 LAB_URL 后
node scripts/check-resident-transitions.mjs --audit-only
```

BASELINE_GLB 可指定上一版生成对比；GLTF_VALIDATOR_MODULE、PLAYWRIGHT_MODULE、CHROME_PATH 可复用本机工具。未增加应用依赖。实体手机、Safari、正式房间性能、精确布料自碰撞和家具接触未验收。
