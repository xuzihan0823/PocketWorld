# PocketWorld

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

PocketWorld 是浏览器里的一间 3D 轨道居住舱，给访客一个可以独处、慢慢摆弄的小空间。访客环绕观察房间、控制住民走动，直接操作物品：写日记和日程、从书柜取书阅读、播放唱片或把本地音乐做成唱片，把实体卡带插入电脑游玩小游戏。

## Operating Context

访客直接打开网页进入生活舱，没有账号和引导流程，可以随时离开，下次回来时本机保存的日记、日程和藏书仍在。桌面用鼠标与键盘，手机用触屏。两款小游戏（奶娃滑雪大冒险、团团魔法录）从房间电脑的卡带按需加载，也可以通过地址参数单独打开。

## Capabilities and Constraints

React、TypeScript、Vite 与 Three.js（React Three Fiber），纯静态部署，没有后端；数据只保存在访客浏览器的 `localStorage`。小游戏使用 800 × 600 的 Canvas 2D，通过统一的卡带接口接入，不引入游戏引擎。行为约定、存储键和入口参数见 [SPEC.md](SPEC.md)，协作与目录边界见 [AGENTS.md](AGENTS.md)。

## Brand Commitments

- 字标为小写 `pocketworld.`，副题「A LITTLE SPACE TO BE YOURSELF」，首屏文案「宇宙很大。这里，刚刚好。」
- 房间是暖木、米白舱壁与灰绿织物的安静色调，窗外是程序生成的宇宙与地球；标题文案用宋体，界面文字用无衬线体。
- 交互优先落在实体物品上：拿唱片、拖卡带、翻书页、拉灯绳。只有需要输入或选择时才出现界面控件，不做常驻的按钮面板。
- 文案平静、简短，用访客的日常语言描述物品和动作。
- 小游戏有各自的视觉与角色约定，由模块维护：滑雪见 [DESIGN.md](src/games/mario/DESIGN.md)，团团魔法录见其 [README](src/games/shooter/README.md)。

## Accessibility & Inclusion

键盘与触屏都能完成主要操作，常用物品有快捷键并提供给屏幕阅读器的说明。跟随系统的「减少动态效果」设置，缩短转场并关闭装饰性动画。支持全局静音；游戏在失焦、页面隐藏或离开电脑时自动暂停。小屏设备上游戏自动放大到可用视口。完整的屏幕阅读器流程、实体手机与 Safari 尚未验收，状态见 [场景进度](src/scene/orbital/进度文档.md)。
