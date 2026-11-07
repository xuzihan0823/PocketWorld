# PocketWorld

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

访客在微缩房间里探索物件，通过电脑卡带玩小游戏。此次依据用户提供的滑雪设计方案实现「雪线逃脱」。

## Operating Context

游戏从房间电脑按需加载，也保留既有 PocketOS 卡带入口。开始游戏后选择雪道；局内暂停可继续或返回首页；首页退出返回电脑。

## Capabilities and Constraints

React、TypeScript、Vite，纯静态部署；小游戏采用 800 × 600 Canvas 2D，无新增游戏引擎。兼容 mario 标识、MarioGame 默认导出和 GameCartridgeProps；纪录使用 pocketworld:mario:highscore。人物模型与另一游戏不在本轮范围。

## Brand Commitments

用户指定奶娃为主角、豆包群追赶、牛来双形态伙伴，沿用已有黄色角色素材。奶娃翻转、绊倒和被豆包吞噬播放原版笑声前三秒，骑上牛来播放 niulai 音效。

## Accessibility & Inclusion

键盘与触屏都能完成玩法；支持减少动态效果、静音、失焦与外层停用自动暂停，恢复需主动继续。小屏由电脑集成层提供放大游玩视图。
