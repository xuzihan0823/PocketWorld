# 滑雪游戏素材索引

游戏素材统一按用途放在本模块目录下。角色资源在 assets/，音效在同级 audio/。

| 用途 | 素材位置 | 入口 |
| --- | --- | --- |
| 黄色奶娃主角 | naiwa/ | [原始说明](naiwa/README.md)、[全动作预览](naiwa/preview.html) |
| 豆包追赶群 | doubao/ | [来源与帧说明](doubao/README.md)、[原始动作图](doubao/spritesheet.webp) |
| 牛来滑行与冲撞伙伴 | niulai/ | [播放说明](niulai/README.md)、[滑行动画](niulai/niulai-slide.svg)、[冲撞动画](niulai/niulai-charge.svg) |
| 原版笑声与牛来音效 | ../audio/ | [音效说明](../audio/README.md)、[原版笑声](../audio/原版笑声.wav)、[牛来音效](../audio/niulai.wav) |

## 素材结构

- naiwa/ 保留用户提供的完整主角素材库，共 105 个文件，包括原始 README、预览页、控制器示例、12 组分层动作、6 组描摹滑雪动作和 81 帧原素材矢量图及索引。
- doubao/ 保存 Petdex doubao-4 原始素材包的全部解压内容，包括 pet.json 与 spritesheet.webp，来源见该目录说明。
- niulai/ 保存依据用户参考重画的两种伙伴动画、Canvas 序列图、播放配置与许可声明。
- ../audio/ 保存原版笑声、牛来 WAV 与来源许可说明，音效通过 PR #8 交付。

奶娃素材库约 9.96 MiB，豆包动作图约 922 KiB，牛来四份 SVG 约 57 KiB，音效合计约 764 KiB。正式接入时选择需要的动作并按需加载，由游戏统一管理动画时钟、暂停、静音与资源清理。

当前阶段为素材归档。主角、追赶群、伙伴能力与碰撞逻辑待游戏实现时接入。
