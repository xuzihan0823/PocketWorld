# 新角色步态形态、肩部权重与后发验收

当前 `luna-tripo-transitions.glb` 已完成步态精修，保留 103 根骨骼、18,659 个三角面、静态网格、UV、三张原贴图和 49 个形状目标。沿用 `feat/tripo-hair-dress-rig` / PR #27；对比基线为 `fe8bf8c`。

## 当前动作

- Walk：1.2 秒周期，速度 0.25 模型单位/秒；支撑占 7/12（21/36 帧），双支撑占 16.7%。左右脚各向内收 0.015。所有支撑边界对齐 30 fps。
- SitCycle 前 2.1 秒：摆脚区间为左 3/30–15/30、右 17/30–29/30、左 31/30–44/30、右 46/30–59/30 秒；初始位移 0.28，最后一脚在 59/30 秒落稳。脚宽保留原值，2.1 秒连续接入坐姿。
- 骨盆起伏由脚相对髋部的伸展量决定，单腿承重中期升高；加入 0.009 横向重心转移、骨盆转动及胸椎反向补偿。同侧手脚前后位移相关系数约 −0.946，保持对侧摆臂。
- 足滚转分抬跟、勾脚尖、落地放平三段；约 +16° / −11.3°，摆动到 88% 时提前到达落点。原模型脚尖距踝约 0.089，因此抬脚补偿由任务单的示例 0.058 调整为 0.092，并加入最高 0.0045 的插值余量；中段抬脚峰值仍为 0.032。
- 双肩和上臂内收、前臂相位滞后；手腕和五指镜像微屈。接近动作末端平滑归零，ArmsUp / Sit / LieDown 原骨骼矩阵样本保持。
- 重烘焙 34 个 Walk / Approach 接触修正。步行头发旋转配额为 0.32，裙摆为 0.12；没有修改 SecondaryMotion 求解器或第二阶段 GLB。

## 肩背修复

259 个原误分头发的顶点重新匹配最近的非头发、非裙摆身体顶点，距离小于 0.015 时复制权重并归一化。该资产的 259 点均找到身体邻点；左肩 4712 等点改为跟随 Shoulder/Arm 混合权重。

实际身体邻点还包含 Spine 和 Hips 的小权重，所以验证在躯干及肩臂白名单之外，逐点核对原始身体邻点权重，防止把同样合法但错误的 Spine2 绑定当作修复通过。保留网格和贴图；近景仍可能看见原贴图色斑，未将其重绘。

[肩部近景（左旧右新）](shoulder-repair-comparison.png) · [背发侧面对比](back-repair-comparison.png)

## 数值验收

[120 Hz 实际 GLB 回读](walk-validation.json)，模型高约 0.98，单位为模型单位：

| 指标 | SitCycle 前 2.1 秒 | Walk 两周期 |
| --- | ---: | ---: |
| 样本数 | 253 | 289 |
| 支撑脚踝最大漂移 | 0.000108 | 0.000192 |
| 支撑脚底最大漂移 | 0.000174 | 0.000213 |
| 脚底最低点 | −0.000108 | −0.000191 |
| 双脚同时离地超过 0.001 | 0 | 0 |

单腿支撑中期左右膝角均约 4.94°（要求小于 12°）；Walk 首尾骨骼矩阵误差 1.39e-7 以内，形状权重误差 4.77e-7。

- [坐卧脚底及旧动作回归](footplant-validation.json)：通过，与 fe8bf8c 的 ArmsUp / Sit / LieDown 骨骼矩阵样本相同。
- [浏览器逐帧步行检查](walk-browser-validation.json)：基础与动态各 72 帧接近、108 帧 Walk；深度超过 0.001 的大腿胶囊穿入计数为 0。基础接近最大重叠 0.000708，动态接近 0.0000372，Walk 为 0。
- 步行时单节辅助骨骼最大动态偏角从约 28° 降为 8.9601°；这是关节局部偏角，不等于整条发束在世界空间中的角度。
- [Blender 验证](blender-validation.json)：25,204 个导出顶点、22 个时刻回读，最大表面误差 7.16e-7；259 个复制权重点逐点验证。
- [glTF 验证](gltf-validation.json)：0 errors、2 个既有 warnings（生成切线、蒙皮网格非根节点）；三张贴图逐字节一致。GLB 为 11,344,460 bytes，比 fe8bf8c 增加 167,176 bytes（约 1.50%）。
- 原动态 8 项单测、TypeScript 和生产构建全部通过。构建仍有既有 Three.js 大包提示。
- [完整流程](browser-validation.json)：9 / 13 秒坐卧、暂停、重播、切换及形状清零通过。坐卧头发仍有少量近似胶囊重叠，最大约 0.00105。

## 视频与场景

[侧面前后对比](before-after-side.mp4) · [正面](walk-front.mp4) · [侧面](walk-side.mp4) · [背面](walk-back.mp4)

四段视频均为 6 秒、30 fps、180 帧。前 2.4 秒为接近停步，后 3.6 秒为匹配实际根位移的 Walk。三视角左为关闭裙发及碰撞的基础动作、右为开启动态；前后对比左为 fe8bf8c、右为当前版，均开启动态。Walk 镜头跟随角色，旧版只作相同的取景改动。全部视频完整解码通过并抽查关键帧。根目录旧 front.mp4 / side.mp4 / back.mp4 是历史 22 秒坐卧视频。

实际入口 `?resident=tripo` 已验证移动、停步及转向，无页面异常；缩放 1.45，匹配速度为 0.3625 场景单位/秒。[截图](room-walk.png) · [场景结果](room-validation.json)。默认入口继续使用原角色；家具交互、新骨架动作融合与急转弯接触尚待适配。

## 复现与边界

```powershell
blender -b -t 4 --python-exit-code 1 --python scripts/blender/build_tripo_transitions.py -- --workspace <项目绝对路径>
blender -b -t 4 --python-exit-code 1 --python scripts/blender/validate_tripo_transitions.py -- --workspace <项目绝对路径>
node scripts/check-resident-walk.mjs
node scripts/check-resident-footplant.mjs
node scripts/validate-resident-transition-glb.mjs
node --test src/scene/orbital/secondary/secondary.test.mjs
npm.cmd run build
node scripts/check-resident-transitions.mjs --audit-only
node scripts/record-resident-walk.mjs
```

浏览器脚本用 `LAB_URL` 指定当前预览，`BASELINE_URL` 指定 fe8bf8c 预览，`PLAYWRIGHT_MODULE` / `CHROME_PATH` 指定本机工具；`WALK_FRAMES` 可指定中间帧目录。旧版取景 API 需和当前版一样按 mover.position.z 平移 Walk 镜头。`BASELINE_GLB` 可供坐卧回归比较旧动作矩阵，`GLTF_VALIDATOR_MODULE` 可指定验证器。没有新增应用依赖。

[GLB](../../../public/models/resident/luna-tripo-transitions.glb) · [Blender 工程](luna-tripo-transitions.blend) · [制作记录](authoring.json)

接触检查使用近似身体胶囊，不代表精确布料自碰撞或任意姿势均不穿模。文件仍超建议 10 MB，原 4096² 贴图预算、实体手机、Safari 和正式场景长期性能尚未验收。
