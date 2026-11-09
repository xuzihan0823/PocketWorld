# Luna 精细骨架与独立兔子

## PR #23 参考图重建兔子

`refined/luna-bunny-refined.blend` 是按照用户提供的五视角设定图重新建模的可编辑源文件。
头、身体、耳朵、手脚、尾巴和配饰分别命名，参考图已打包在隐藏的 Reference 集合中。
运行时资源为 `../../public/models/resident/luna-bunny-refined.glb`。
正面、前侧、侧面、后侧和背面预览见 `refined/bunny-views.jpg`。

新版还原了白色玩偶、粉色耳内与脚掌、棕色四芒星眼罩及完整绑带、六瓣黄色领饰和圆尾。
布料使用粗糙材质与内嵌微表面法线贴图。高约 0.290 米，原点位于脚底，Blender 朝向 -Y，
GLB 朝向 +Z。`Grip_Right`、`Grip_Left` 和 `Support` 是非渲染接触标记，供抱兔动作定位。
当前共 59,672 个三角形，运行时合并为 1 个网格、9 个材质批次，GLB 约 1.86 MiB。

已检查五个视角，并将 GLB 重新导入 Blender 验证。
焊接导出时拆开的 UV 接缝后，开放边、非流形边和退化面均为零，握持点位置一致。
输入参考图哈希、Blender 版本、导出参数与验证结果分别保存在 `refined/bunny-manifest.json`
和 `refined/bunny-validation.json`。新版兔子的游戏挂接与人物手指接触仍待抱兔阶段验证。

重建脚本写入独立生成目录，目标目录非空时拒绝覆盖。
后续直接在 `.blend` 精修，再用导出脚本从该源文件导出。

```sh
blender --background --python scripts/blender/build_bunny.py -- --reference /path/to/reference.png --render
blender --background art/resident/refined/luna-bunny-refined.blend --python scripts/blender/export_bunny.py -- --output /path/to/new-bunny.glb
blender --background art/resident/refined/luna-bunny-refined.blend --python scripts/blender/validate_bunny.py -- --runtime public/models/resident/luna-bunny-refined.glb --report /path/to/validation.json
```

## PR #21 初版资产

原始 `public/models/resident/luna.glb` 保持不变。本次另交付 Blender 源文件、
有蒙皮的人物 GLB 和独立兔子 GLB，未切换应用当前的模型加载路径。

## 文件

- `luna-detailed-rig.blend`：只包含交付场景，人物与兔子分开摆放，可直接编辑骨架；含预览相机和灯光。
- `../../public/models/resident/luna-rigged.glb`：人物、87 根骨骼、蒙皮和 `Rig_Check` 检查动画。
- `../../public/models/resident/luna-bunny.glb`：独立静态兔子，原点位于脚底附近，未绑定人物骨架。
- `luna-bone-map.json`：骨骼名称、父子关系和静置姿势关节坐标，坐标采用 Blender 的 Z 向上。
- `overview.png`：实际 Blender 渲染预览。

## 骨架与操作

87 根骨骼包括 1 根不参与变形的根骨骼、22 根人体骨骼、30 根手指骨骼、
24 根裙骨和 10 根发骨。双手各五条指链，每条三节；拇指链包含掌部基节。
Blender 骨骼集合按 Body、Fingers、Skirt、Hair 分组。

选中 `Luna_Rig`，进入 Pose Mode 即可调整骨骼。模型静置姿势沿用原来的
不对称手臂姿势，并非标准 T Pose。左右以角色自身为准，`.L` 为左侧。
`Rig_Check` 以 24 fps 播放：第 1、49、97 帧为静置，第 25 帧为手指弯曲，
第 73 帧检查肘部和膝盖。这是绑定检查动画，不是正式行走、阅读或坐卧动作。

## 分离与补建范围

源 GLB 没有骨架、权重或动画；焊接 UV 接缝后，人物与兔子属于同一个连通网格。
因此分离涉及表面修补，不能仅拆分对象。

- 兔子的脸、耳朵及围巾保留原始贴图表面。被遮挡的头后部、身体、肢端和尾部是补建形体，不能视为原始资产中完整存在的细节。
- 原左手掌面及部分手指与兔子融合。新左手使用原右手几何镜像、缩放和转向后对齐左腕，并重建腕部连接；手指不再依赖兔子表面。
- 原兔子遮挡、融合的左侧衣服和前侧发卷参考右侧完整表面补建；手臂内侧增加补面。
- 保留原人物比例和主要材质；修补处并非逐顶点还原，近距离可能看见材质及表面过渡。

这是可以继续制作动作的资产初版，不是完整人工重拓扑结果。源模型存在细长三角形、
局部非流形边和衣物/身体融合；大幅握拳、抬臂、坐卧仍需针对动作修正权重、
关节拓扑与穿插。裙骨和发骨已绑定，但没有接入弹簧物理、碰撞或 IK。

## 验证

- 原始 GLB SHA-256 未变：`e34bb73e7935b9520de767e575eb9226a14fa05b15dd56904bf6780de443a4bb`。
- 在 Blender 中检查静置、双手指节弯曲、肘部和膝盖姿势，并查看人物与兔子的多角度结果。
- 导出后在独立场景重新导入人物：87 根骨骼、7 个蒙皮网格、无漏绑顶点、最多 4 个权重，权重和误差小于 `0.000001`。
- 所有 86 根变形骨骼都有实际顶点，每根手指骨骼至少影响 19 个顶点。
- `Rig_Check` 重导入后能产生手指和肢体形变；两份 GLB 均仅含交付场景，纹理内嵌，没有默认 Cube 或其他场景对象。
- `glb-validation.json` 和 `roundtrip-validation.json` 保存结构检查结果。
- 未执行游戏运行时替换、完整动作回归或手机性能测试。

## 重建

使用 Blender 5.2.3 LTS 制作。以下命令均为一次性后台任务：

```sh
blender --background --python scripts/blender/build_luna_rig.py
python3 scripts/blender/validate_luna_assets.py
```

第二条命令需要 NumPy。构建脚本会核对源 GLB 哈希、在新场景处理副本，并写入
`art/resident/generated/base-rig/`，GLB 位于其中的 `runtime/` 子目录。
可通过 `-- --output /path/to/empty-directory` 指定空目录，非空目录会被拒绝。
`luna-separation.json` 保存针对该源文件
检查过的面选择，源文件或焊接拓扑改变后必须重新检查选择。

`render_luna_review.py` 可在交付场景中生成预览，使用完应保留该场景供编辑。
新资产接入应用时，应使用 GLB 自带的 Skeleton 和权重；现有 `rigResident()`
会重新生成简易绑定，不能直接用来消费这套精细骨架。
