# 团子猫模型

原始 Tripo GLB 由项目成员提供，文件内未声明许可或来源链接。原始文件可从项目 Git 历史取得，SHA-256 为 `ccab0f90867ebdfe3293cc4ef2de8a85c8f94c2da95613711c1db7f7193c55ca`。

- [cat.blend](cat.blend) 是可编辑制作源，包含蒙皮和打包贴图。打开后在姿态模式选骨骼，使用 `R` 试摆姿态，使用 `Alt+R` 恢复选中骨骼的静置旋转。`Cat_Root` 控制全身，头、耳、尾及四肢可以分别摆动。四肢使用正向运动学，每条腿有上段、下段和脚掌。
- [cat.glb](../../public/models/cat/cat.glb) 是场景资源，共 23 根骨骼、35,594 个三角形和 3 张内嵌的 2048 × 2048 贴图，大小为 6,803,076 字节。转头和三节尾巴摇动由场景逐帧驱动。
- 在 Blender 导出静置模型时选用 glTF 2.0 Binary（`.glb`），保留蒙皮和贴图，关闭动画导出。场景通过 `Cat_Head`、`Cat_TailBase`、`Cat_TailMid` 和 `Cat_TailTip` 定位关节。
