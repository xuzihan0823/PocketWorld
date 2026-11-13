# 滑雪游戏素材索引

游戏素材统一放在 `assets/games/ski/` 目录下（音频在同级 `audio/`）。

| 用途 | 素材位置 | 入口 |
| --- | --- | --- |
| 黄色奶娃主角 | naiwa/ | [原始说明](naiwa/README.md) |
| 冬日分层雪景 | winter/ | [四层说明](winter/README.md)、[无界面全景](winter/panorama.svg) |
| 低多边形造型参考 | naiwa/ | [白底三视图](naiwa/winter-three-views.svg)、[源网格](naiwa/winter-character.obj) |
| 豆包追赶群 | doubao/ | [来源与帧说明](doubao/README.md)、[原始动作图](doubao/spritesheet.webp) |
| 牛来滑行与冲撞伙伴 | niulai/ | [播放说明](niulai/README.md)、[滑行动画](niulai/niulai-slide.svg)、[冲撞动画](niulai/niulai-charge.svg) |
| 原版笑声与牛来音效 | audio/ | [音效说明](audio/README.md)、[原版笑声](audio/原版笑声.wav)、[牛来音效](audio/niulai.wav) |

## 素材结构

- naiwa/ 保存奶娃相关原始文件，包括说明、控制器示例、12组分层动作、6组描摹动作和81帧矢量图及索引。另有游戏运行用低多边形 ski-volume-rig.svg 分层素材，以及不进入运行包的三视图和OBJ/MTL源网格。
- winter/ 保存天空、远山、树林与近景装饰四个1600×900循环图层，以及无界面全景和说明。
- doubao/ 保存 Petdex doubao-4 原始素材包的全部解压内容，包括 pet.json 与 spritesheet.webp，来源见该目录说明。
- niulai/ 保存依据用户参考重画的两种伙伴动画、Canvas 序列图、播放配置与许可声明。
- audio/ 保存原版笑声、牛来 WAV 与来源许可说明，音效通过 PR #8 交付。

奶娃素材库连同新造型参考约10.72MiB，豆包动作图约922KiB，牛来四份SVG约57KiB，音效合计约764KiB，四层雪景源图约8.4kB。网页只按需加载运行素材，角色网格和美术参考不随运行包发布；动画、暂停、静音与资源清理由游戏统一管理。

主角、追赶群、伙伴能力与碰撞逻辑已接入游戏，当前实现与验证边界见模块进度文档。
