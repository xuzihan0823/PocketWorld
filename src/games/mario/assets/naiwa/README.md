# 黄色奶娃 (Yellow Naiwa) 矢量图 & 《滑雪大冒险》角色资产库

本目录提取了原始素材（`codex-pet-naiwa`、`milk-frog-work-pet`、`naiwa-desktop`）中的**黄色奶娃/奶蛙**形象，并提供**两套完整的纯路径矢量图（SVG）方案**，专门适配《滑雪大冒险》(Ski Safari) 游戏开发。

---

## 目录结构

```text
yellow-naiwa-vector/
├── preview.html                           # 交互式动作预览台（直接用浏览器打开即可查看全部动画与切换模式）
├── README.md                              # 使用说明与接入文档
├── ski-safari-rig/                        # 【方案 A】分层骨骼可动矢量角色 + 滑雪大冒险专属动作
│   ├── naiwa-master-rig.svg               # 完整分层骨骼总装 SVG（支持单独控制每个身体部件与表情层）
│   ├── naiwa-ski-character.js             # 《滑雪大冒险》HTML5 Canvas / DOM 角色控制器模块
│   ├── actions/                           # 12 组独立可动骨骼矢量 SVG（含 SMIL/SVG 原生流畅骨骼动画）
│   │   ├── 01-ski-glide.svg               # 滑雪大冒险：基础滑行（踩双板、围巾飘动、捧肚呼吸、雪花粒子）
│   │   ├── 02-ski-boost.svg               # 滑雪大冒险：俯冲加速（压低重心、护目镜护眼、尾部喷射加速火焰）
│   │   ├── 03-ski-jump-laugh.svg          # 滑雪大冒险：腾空大笑（标志性仰头闭眼、张嘴露白牙、双手捧肚起跳）
│   │   ├── 04-ski-backflip.svg            # 滑雪大冒险：空中后空翻特技（360° 空中旋转特技 + 气流轨迹）
│   │   ├── 05-ski-belly-slide.svg         # 滑雪大冒险：笑倒躺滑（还原“笑倒后停留”四脚朝天仰面大笑滑行）
│   │   ├── 06-ski-crash.svg               # 滑雪大冒险：摔倒撞雪（栽入雪堆、眩晕圈圈眼、雪板飞出、头顶转金星）
│   │   ├── 07-ski-ride-penguin.svg        # 滑雪大冒险：骑乘企鹅滑行（踩在贴地滑行的企鹅背上欢呼招手）
│   │   ├── 08-orig-idle.svg               # 原版经典动作：侧面双手捧肚待机（呼吸 + 眨眼）
│   │   ├── 09-orig-run.svg                # 原版经典动作：欢快迈步奔跑
│   │   ├── 10-orig-wave.svg               # 原版经典动作：热情挥手
│   │   ├── 11-orig-belly-laugh.svg        # 原版经典动作：原地仰头闭眼露齿捧腹爆笑
│   │   └── 12-orig-sad-slump.svg          # 原版经典动作：失败阻塞 / 垂头丧气蹲下
│   └── traced-ski-actions/                # 6 组原图 3D 矢量化轮廓 + 滑雪装备组合 SVG
│       ├── traced-01-ski-glide.svg
│       ├── traced-02-ski-boost.svg
│       ├── traced-03-ski-jump-laugh.svg
│       ├── traced-04-ski-backflip.svg
│       ├── traced-05-ski-belly-slide.svg
│       └── traced-06-ski-crash.svg
└── extracted-traced-svg/                  # 【方案 B】从原素材切分并逐帧拟合的 81 帧纯 <path> 贝塞尔矢量图
    ├── spritesheet-vector-all.svg         # 全 81 帧纯矢量精灵总表 SVG
    ├── metadata.json                      # 全部动作帧索引与路径元数据
    ├── classic-side-belly/                # 经典 45° 侧面双手捧肚待机与眨眼（6 帧 SVG）
    ├── idle/                              # 正面微侧待机与眨眼（7 帧 SVG）
    ├── running-right/                     # 向右奔跑（8 帧 SVG）
    ├── running-left/                      # 向左奔跑（8 帧 SVG）
    ├── waving/                            # 热情招手（4 帧 SVG）
    ├── belly-laugh/                       # 标志性捧腹大笑（5 帧 SVG，已自动清理原图脚底残留白影）
    ├── laugh-fall-down/                   # 笑倒后停留躺平（1 帧 SVG，提取自新增互动预览）
    ├── sad-failed/                        # 失败阻塞 / 垂头丧气蹲下（8 帧 SVG）
    ├── working/                           # 执行任务 / 思考搓手（6 帧 SVG）
    ├── waiting/                           # 等待输入 / 托腮（6 帧 SVG）
    ├── review/                            # 完成待查看 / 抱胸叉腰（6 帧 SVG）
    └── look-directions/                   # 16 方向注视旋转（16 帧 SVG）
```

---

## 在《滑雪大冒险》游戏中快速接入

可以直接引入 `ski-safari-rig/naiwa-ski-character.js`：

```javascript
import { NaiwaSkiCharacter } from './ski-safari-rig/naiwa-ski-character.js';

// 初始化角色（mode 可选 'skeletal' 分层骨骼版 或 'traced' 原图3D矢量化版）
const player = new NaiwaSkiCharacter({
  basePath: './ski-safari-rig',
  mode: 'skeletal',
  initialAction: 'ski-glide'
});

await player.preloadAll();

// 在游戏状态机中切换动作：
// 'ski-glide' | 'ski-boost' | 'ski-jump-laugh' | 'ski-backflip' | 'ski-belly-slide' | 'ski-crash' | 'ski-ride-penguin'
player.setAction('ski-jump-laugh');

// 在 Canvas 2D 游戏循环中绘制：
player.drawToCanvas(ctx, playerX, playerY, 0.65, slopeAngleRadians);
```

---

## 分层骨骼部件 ID (`naiwa-master-rig.svg`)

如果需要对单个 SVG 内的骨骼节点做自定义关节旋转，可直接通过 DOM ID 控制：
- `#ski-board-front` / `#ski-board-back`：前后滑雪双板
- `#scarf`：迎风飘动的红色滑雪围巾
- `#goggles-forehead`：额头滑雪护目镜
- `#torso-head`：梨形圆润黄身体与头部
- `#belly`：奶油色大肚皮（支持独立缩放做 Q 弹呼吸动画）
- `#face-normal` / `#expr-laugh` / `#expr-boost` / `#expr-dizzy` / `#expr-sad`：可切换表情层
- `#arm-front` / `#arm-back-fingers`：双手捧肚的渐变棕色三指手
- `#leg-front` / `#leg-back`：前后腿与棕色三趾蛙脚
- `#tail`：背部小短尾巴
- `#fx-snow` / `#fx-boost`：雪花飞溅与加速尾焰特效层
