# PWCS 布料预研

在任务工作区运行 `npm ci` 和 `npm run dev -- --port 5194 --strictPort`，打开 [布料实验台](http://localhost:5194/src/scene/cloth/index.html)。生产构建使用原应用入口。实验台在 Vite 开发服务中单独启动。

| 实验 | 入口 | 操作 |
|---|---|---|
| 同一块悬挂布 | [XPBD](http://localhost:5194/src/scene/cloth/index.html?scene=sheet&solver=xpbd) · [Rapier](http://localhost:5194/src/scene/cloth/index.html?scene=sheet&solver=rapier) | 观察锚边收拢、折叠、横向换向及与球体的接触。切换自碰撞后重置。 |
| 骨骼驱动 | [前臂挂布](http://localhost:5194/src/scene/cloth/index.html?scene=arm) | 同一排运动学锚点跟随左前臂，切换抬臂、阅读与行走。 |
| 真实服装 | [左袖](http://localhost:5194/src/scene/cloth/index.html?scene=sleeve) · [第 2,702 步旧版](http://localhost:5194/src/scene/cloth/index.html?scene=sleeve&legacy=1&atStep=2702) · [同一步新版](http://localhost:5194/src/scene/cloth/index.html?scene=sleeve&atStep=2702) | 「同帧四层对照」冻结并聚焦左袖，可拖动和缩放。「测量当前形变」显示各层对衣身、内衬的相交对数。`atStep` 在对应物理子步自动打开对照。 |
| 扩容 | [双袖](http://localhost:5194/src/scene/cloth/index.html?scene=both) · [日常装裙摆](http://localhost:5194/src/scene/cloth/index.html?scene=skirt) · [双角色三区域](http://localhost:5194/src/scene/cloth/index.html?scene=multi) | 蝴蝶结外套配短裤。三区域同时绘制外套与日常裙装两个角色，另有单角色无布料基线。 |
| 生活舱 | [基线](http://localhost:5194/src/scene/cloth/room.html?solver=off) · [XPBD 单袖](http://localhost:5194/src/scene/cloth/room.html?solver=xpbd) · [Rapier 单袖](http://localhost:5194/src/scene/cloth/room.html?solver=rapier) | 真实生活舱和原有交互，用同一机位比较。可追加 `&hz=30`。 |

独立实验支持 30/60 Hz、每步 1/2/4 个子步、暂停、恢复及重新初始化。角色动作轮播一周 34.25 秒，含 220 ms 混合。抬臂来自 `reachHigh`，阅读姿势用现有持书 IK 求解后采成姿态，坐下与起身使用各装扮的地毯动作。躺下使用开衫的 9.25 秒上床片段，对共有骨骼转移绑定姿态相对旋转，并保留髋部轨迹。此项用于测试重力方向和大幅姿态变化，外套在正式场景中没有专用上床片段与床垫接触数据。

## 求解与数据流

| 接口 / 文件 | 输入 | 输出和所有权 |
|---|---|---|
| Character Animation，`actor.ts` | 已绑定的 GLB、动作与持书 IK | 先完成动作混合、修形和世界矩阵更新。生活舱直接使用现有住民控制器的最终姿态。 |
| Cloth Controller，`Region.sample()` | 最终骨骼矩阵、绑定姿势 | 世界坐标锚点和随骨骼移动的球链。肩肘腕近似手臂，脊柱球链近似衣身体积。 |
| Cloth Profile，`physics.ts`、`garmentRegion()` | 服装、侧别、模拟区域 | 单袖实验从世界尺度下的绑定格点建立约束，独立用当前蒙皮坐标和零初速启动。其他实验沿用前轮基线。 |
| Cloth Solver，`step(dt, targets, balls)` | 米、秒、Y 向上；固定子步 | 拥有世界坐标粒子位置与内部速度状态，只读动画输入。`dispose()` 释放后端资源。 |
| Pose Correction，`Region.bind()` | 模拟与蒙皮代理之间的位移、当前碰撞体 | 单袖调试保留未混合、未限幅位移。最终袖面保留接缝渐隐与世界空间 18 mm 位移预算。 |
| Geometry Binding，`binding.ts` | 校正后的代理位移 | 四点周期双线性插值，经权重遮罩渐隐，转到网格局部坐标，在 GPU 蒙皮之后叠加动态顶点属性。正式模型、蒙皮权重、UV、骨骼和动作文件由角色层持有。 |

XPBD 在每个子步清零约束乘子，迭代内累积乘子，柔度除以子步时长的平方。横纵边控制拉伸，双对角边控制剪切，跨两点的距离约束近似抗弯。空间哈希只检查邻近桶，跳过直接约束邻点。该自碰撞只检测粒子，顶点穿面和边穿边仍可能漏检。[XPBD 原论文](https://doi.org/10.1145/2994258.2994272)

Rapier 0.21.0 使用原生 `SoftBodyDesc`，写入与 XPBD 共用的边表和三角面，设置粒子固定、运动学目标、自接触、可变形表面碰撞和线性阻尼。每子步读取 WASM 的粒子位置。两者保持相同拓扑、轨迹、重力与外部时钟，各后台保留自己的材料模型和内部迭代机制。实验参数适用于本次试样。Dimforge 维护的 compat 发布包采用 Apache-2.0，下载包 4,990,881 字节，解包 15,038,573 字节，内含 JS、WASM、类型声明与映射文件。锁为开发依赖。[官方软体 API](https://rapier.rs/docs/user_guides/javascript/soft_bodies/)

每渲染帧最多追赶四个固定步，多余整步记为丢弃。独立实验按子步采样动画并在渲染前绑定一次结果。完整生活舱的观察器在住民更新之后执行，在同一渲染帧的子步复用该帧最终姿势。切换模型时释放实验实例并还原共享几何和材质。

## 新服装的制作与接入规范（候选）

1. 保留服装的蒙皮、修形与材质。制作副本中分别标记模拟区域、固定环、沿缝辅助锚点和软过渡边界，明确左右侧，排除皮肤、头发、手指及内侧的其他衣片。
2. 在统一绑定姿势制作低模代理。记录模型版本、primitive、轴向、单位、骨骼名、有效缩放和碰撞分组。保持代理顶点顺序稳定，检查零长边、折叠面、反向绕序及环形接缝。POC 按骨骼权重与臂轴截取袖带，左袖 12×5，裙摆 20×6。正式资产应提供经人工检查的区域遮罩。
3. 每个渲染顶点保存代理三角形与重心权重，或规则套筒的四个控制点及归一化权重。分别检查双侧 UV 缝、内衬和衣身交界。网格版本变更后重新生成映射、固定环和碰撞体。当前袖区覆盖主表面，不含腋下独立内衬。
4. 手臂碰撞体与衣身外壳分开标定，在肩部、肘窝及贴臂姿势保留衣料厚度。坐卧接触另行提供座面、床面和针对特定姿态的修形。材料记录质量、厚度、约束参数、阻尼、固定频率、子步及对不同后端的标定值。
5. 控制器在动画混合、IK、接触形态键及世界矩阵完成后读取输入。每个角色实例独占可写顶点属性和求解状态，销毁、切场景与换装时释放。正式接入前还需处理大位移重置、按渲染时刻插值、变形法线与阴影通道的一致性。
6. 用同一动作回放检查锚点误差、代理边长、衣身间隙、可见表面与人体的穿透，以及多层自交。逐区域记录性能，并单独测量完整生活舱。通过目标机器的真实动作和接触验收后，再推广到其他装扮。

## 复测口径

- 在 Chrome 以 1280×720、DPR 1 打开实验台，得到 980×720 的画布。基准运行关闭代理显示。选同一动作和频率，等待模型、WASM 以及首帧完成，预热后执行 `pwcs.reset()`，读取 `pwcs.report()`。该接口保留最近最多 600 个有效渲染间隔，返回实测 FPS、P95、求解（包含碰撞）、碰撞和 CPU 映射耗时。页面隐藏或用户暂停期间跳过采样。
- 单袖形变在 120 Hz 固定回放中逐步检查。弯肘、躺姿和动作切换附近的衣身相交在同一步号比较。`shell` 给出抽样袖顶点相对碰撞球的深度，`intersections` 给出实际三角面对数。后端质量配对采集后，在正常渲染页单独计步和计时。`pwcs.report().cumulative` 包含累计物理子步、耗时、丢弃毫秒、超过 50 ms 的渲染帧数及最长帧。顶层 `p95` 对应最近最多 600 帧。
- 生活舱以 980×720 打开，等待角色、完整家具和 GPU 着色器就绪。依次测关闭、XPBD、Rapier，再逆序测一次。对 `window.pwcsRoom` 的累计时间取差并除以帧数。用独立的 `requestAnimationFrame` 记录帧间隔。Chrome DevTools Protocol 的 `Performance.getMetrics` 可取主线程 TaskDuration 与 Timestamp 的增量比和 JSHeapUsedSize，`Runtime.getHeapUsage` 提供 backingStorageSize。两项内存分别列示；均不等于整个浏览器的常驻内存。
- 数值和绑定回归运行 `node --test src/scene/cloth/cloth.test.mjs`；仓库完整验证运行 `npm test`。

单袖开发页的控制台可独立复现同一轮播。`legacy=true` 重建旧代理和旧映射，同时采集未限幅对照。第四个参数可追加需要逐步采样的模拟时刻（秒）。

```js
const { replaySleeve, isolateElbow } = await import('/src/scene/cloth/sleeveReplay.ts')
const { createSleeveAudit } = await import('/src/scene/cloth/sleeveSurface.ts')
const focus = [0.04, 6.33, 7.1, 21.4, 26.45]
const before = await replaySleeve('xpbd', true, createSleeveAudit, focus)
const xpbd = await replaySleeve('xpbd', false, createSleeveAudit, focus)
const rapier = await replaySleeve('rapier', false, createSleeveAudit, focus)
const slowBend = await isolateElbow(false, createSleeveAudit)
const releaseGuide = await isolateElbow(true, undefined, true)
```

`peaks` 依次给出自由—自由、固定—自由、固定—固定各自峰值最大的四条边，长度单位为米。`observations` 按步号保留同姿势的接触结果。`isolateElbow(true)` 可复测旧版。它固定住其余骨骼，静置 1 秒，在 3 秒内缓慢屈肘，再保持 2 秒，全程关闭重力、自碰撞与外部碰撞。

[桌面性能与接触验收](./布料验收.md)
