# 团团魔法录海报与角色立绘

- 文件：`standby-poster.jpg`，1024 × 768，274,089 字节，JPEG 品质 88。
- 用途：进入 `shooter` 卡带后的角色选择背景。标题与按钮由 DOM 绘制。
- 来源：使用内置图像生成工具，按现有五职业、魔法遗迹、史莱姆和蘑菇怪设定新生成；非第三方素材库下载。原始 PNG 保留在本机生成目录，仓库只保存压缩后的运行时资源。
- 处理：保持 4:3 比例缩小并压缩为 JPEG，无新增运行时依赖。通过 Vite 相对资源导入；随 `shooter` 卡带加载，供选角使用。

## 角色立绘

- 文件：`role-portraits.jpg`，1500 × 600，432,506 字节，JPEG 品质 88。
- 来源与用途：以内置图像生成工具、以上述海报作为角色与画风参考生成。五幅等宽竖画从左到右依次为游侠、机巧师、炼金师、术士、魔女；CSS 分别显示对应区域，名称与选中状态由 DOM 绘制。原始 PNG 留在本机生成目录。
- 处理：缩小并压缩为单张图集，仅随 shooter 卡带选角界面加载，不增加第三方运行时依赖。两张运行时图片共 706,595 字节。

### 立绘生成提示词

Use case: stylized-concept. Asset type: five-panel character selection illustration sheet for the game 团团魔法录, matching the supplied game poster. Use the reference ONLY as style and character identity reference. Create ONE wide landscape sheet, exactly FIVE equally wide vertical panels edge to edge, each panel a separate waist-up dynamic portrait, centered face and torso, all hats fully visible, no subject crossing panel boundaries. Overall aspect ratio 5:2. SAME detailed crisp pixel-art/anime illustration style as reference, vivid jewel colors, golden rim lights, expressive confident cute chibi heroines. Left to right: 1 silver-haired gunslinger girl in wide brown witch hat with gold goggles and brown cape, holding gold rune pistol; 2 turquoise twin-tail mechanic girl wearing brass goggles and teal outfit, holding compact cyan-glowing rune machine; 3 auburn red-haired alchemist girl with brown cap/goggles, red-orange cloak and glowing orange flask; 4 lilac-haired star mage girl in large purple star hat with orbiting violet/gold magic; 5 lime-green-haired wind witch girl in green flower-trimmed hat, green cape and broom, curling mint wind. Backgrounds of each panel are matching moonlit teal/violet forest ruins with magical sparks, slightly different accent for each character, strongly separated silhouettes, lively action. Faces stay within upper-middle 55% of each panel so lower edge may be covered with live UI text. No text, no letters, no UI, no borders, no watermarks. Five characters exactly, one per panel.

## 生成提示词

Use case: stylized-concept. Create ONE finished original illustrated key-art poster asset for the Chinese browser game 团团魔法录, not a screenshot, not a mockup. Landscape 4:3 composition intended to fill an in-world retro computer screen. High-quality hand-painted pixel art with deliberate crisp pixel clusters and a restrained 16-bit fantasy palette, dramatic game-cover energy. Scene: moonlit teal forest ruins and violet magic, five tiny heroic adventurers fighting a surrounding wave of cute menacing slimes and mushroom monsters. The five existing game professions are a tan-cloaked hat-wearing magical gunslinger firing golden rune bullets, a turquoise rune mechanic with enchanted machinery, a rust-colored alchemist launching a fiery magical projectile, a lilac star mage surrounded by orbital spell rings, and a green wind witch swooping on a broom. Arrange these heroes as a tight, readable group concentrated in the RIGHT TWO THIRDS, a strong diagonal forward charge with foreshortened weapons, swirling spell trails and bright warm gold impact sparks. A large ominous shadowy creature in the distant ruined arch gives scale and tension, no gore. Dynamic three-quarter low view, powerful silhouettes, dramatic violet rim light and turquoise shadows, expressive small faces, lively combat motion frozen at the decisive moment. The LEFT THIRD must remain dark, low-detail atmospheric forest space, especially left-center and bottom-left, so the game title and a gold preparation button can be overlaid there later. Keep the most important faces and weapons away from the outer 8 percent edges. The art should feel cute but brave, adventurous and tense, consistent with an original pixel magic survival roguelite. No text of any kind, no letters, no typography, no logos, no UI elements, no buttons, no monitor frame, no border, no watermark. Full bleed poster artwork only.

## 秘术像素图标

- 文件：upgrade-icons.png。透明 PNG，224 × 160 像素，5,847 字节。
- 来源与用途：按「团团魔法录」的秘术名称和效果逐像素绘制的原创道具图。用于「月下觉醒」的卡面插画。
- 图集规格：7 列 × 5 行，每格 32 × 32 像素。卡片与格子的对应顺序由 UpgradeIcon.tsx 维护。
