# Luna 坐姿制作源

`Luna-Sit-ContactFixed.blend` 基于用户提供的接触修正版，调整了落座深度与小腿轨迹，保留 115 骨骼、坐下动作、真实转椅和接触修形修改器。源文件 SHA-256：`a9b60ea23722f85dcf3d9bdb419eca4ed7bbafb8028778442f85e0aaf09af3ab`。角色与 Mixamo 行走素材沿用既有项目输入，未收到独立许可声明；不将其标记为 CC0。

## 运行资源

- `assets/public/models/resident/luna-walk-room.glb`：保留原压缩贴图与 `Walk_Grounded_Loop`，加入 `ChairSit_Contact`（第 1–68 帧，30 fps，时间归零后 67/30 秒）。31,140 个三角形，9,353,064 bytes。
- 同目录 `luna-seat-contact.bin`：68 帧、2,716 个局部顶点的蒙皮前修形，1,108,148 bytes。不能只替换 GLB 而遗漏该文件；普通 glTF 查看器只显示骨骼动作，不会自动应用此缓存。
- 相对原运行模型合计增加 2,182,580 bytes；源 `.blend` 不在 `assets/public/`，不进入网页构建。

## 复建

使用 Blender 5.2.3 与 Python 3。所有中间文件必须输出到仓库外。以下路径为示例，`<外部目录>` 替换为实际绝对路径：

```text
blender --background --python scripts/bake-luna-chair.py -- --output <外部目录>
python scripts/pack-luna-chair.py --output <外部目录>
```

第二步默认从 Git 基线 `6f6df88` 读取原 Walk 与压缩贴图，也可通过 `--original <原始GLB>` 指定输入。确认验收后，仅把输出 `luna-room-contact.glb` 复制为运行目录的 `luna-walk-room.glb`，并复制 `luna-seat-contact.bin`。

制作脚本仅细化裙摆接触区，先限制为四骨骼权重，再从 Blender 评估网格反解蒙皮前位移；保留原平滑法线。转椅按场景尺寸归一化并降低 0.25 m，人物比例 1.43。升降通过人物与座椅共同平移实现，不伸长腿骨。

缓存为小端：20 bytes 头（`PWSC`、uint32 版本 1、uint32 帧数、uint32 顶点数、float32 量化步长），随后为帧优先的 int16 XYZ 位移。GLB 的 `_CONTACT_ID` 对应缓存行，-1 表示不修形；轴采用 glTF 的 X/Y/Z。量化分量误差小于 1.2 微米（世界坐标）。骨骼采样时间与缓存第零帧必须对齐。

## 验证边界

制作脚本检查原生 68 帧的接触面；运行时单测检查时间原点、绑定、独立实例、恢复、骨长与有限坐标。网页动作和导出后网格还需单独验收，不能用原生检查替代浏览器检查。验证结果及截图放在任务 PR，临时模型、报告和录屏不提交。
