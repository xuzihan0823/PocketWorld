export type Vec3 = [number, number, number];
export const BOOK_SIZE = { thickness: 0.105, height: 0.22, depth: 0.24 };
export const BOOK_SLOTS = [0.6675, 0.9575, 1.2475].flatMap((floor, row) =>
  Array.from({ length: 6 }, (_, column) => ({ id: `s${row}-${column}`, row, column, position: [-0.405 + column * 0.162, floor + BOOK_SIZE.height / 2, 0.08] as Vec3 })));
export const CAPACITY = BOOK_SLOTS.length;
export const INPUT_LIMIT = 128 * 1024;
export const TOTAL_LIMIT = 512 * 1024;
export const LIBRARY_KEY = 'pocketworld:library:collection:v1';
export interface LibraryBook { id: string; source: 'builtin' | 'user'; title: string; author: string; text: string; color: string; slotId: string; anchor: number }
export interface LibraryData { version: 1; revision: number; books: LibraryBook[] }
const colors = ['#617e79', '#aa7c48', '#815e70', '#697c9d', '#a45f48', '#78834f'];
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export const normalizeText = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
const stories = [
  ['轨道上的日常', [
    '第一章 · 晨光\n\n晨光越过窗沿，落在没有合上的书页上。地球在窗外缓缓转动，海面把一小片光反射进生活舱。我把杯子挪开，让那片光停在桌面。\n\n这里的清晨不由太阳决定。闹钟响起时，我先检查植物的水，再打开通风口。叶尖比昨天多了一点绿色，这便是今天最先收到的消息。',
    '第二章 · 水珠\n\n浇水要很慢。水沿着细管进入盆土，藏进那些看不见的缝隙。舱里有重力，却没有一场真正的雨。我偶尔播放雨声，植物是否听见，我不知道。\n\n午后，玻璃上映出一张小小的脸。我靠近去看，才发现那是自己。身后有一盆刚抽新叶的薄荷，像从地球带来的一枚书签。',
    '第三章 · 唱片\n\n唱针落下前有轻轻的一响，随后，熟悉的旋律铺满房间。录下这首歌的人也许从未想过，有一天它会在一座轨道小屋里播放。\n\n我擦了擦唱片封套，把卷起的边角压平。音乐结束后没有立刻翻面，让最后一个音留在安静里。窗外的云正好越过大陆的边缘。',
    '第四章 · 一餐饭\n\n晚餐是一碗热汤。胡萝卜切得有些大，煮了很久仍保留着脆意。我坐在桌边，把今天看到的海岸线画在纸上，汤的蒸汽一会儿就模糊了视线。\n\n远行以前，总觉得生活该有许多惊人的事情。现在，一顿按时吃完的饭、一盏没有忘记关掉的灯，都足够让我安心。',
    '第五章 · 留言\n\n来自地面的留言晚到了几分钟。朋友说，街角的面包店换了招牌，梧桐叶落得很快。我把这两件小事记在日记里，比起新闻，它们更像家。\n\n回信的时候，我没有描述辽阔的宇宙，只写了薄荷长高了，汤有点咸，今天读完一章书。这样平常的句子，也能跨过很远的距离。',
    '第六章 · 夜灯\n\n睡前，我把书放回原来的位置。空出的书位重新被填上，整个房间像完成了一次缓慢的呼吸。玩偶靠在枕边，窗帘留着一条缝。\n\n地球的夜面亮起细小的灯。那里有无数人正在回家，也有人同我一样准备睡去。我关掉阅读灯，想起今天没有什么大事发生，便微笑起来。',
  ]],
  ['窗外的地球', [
    '第一章 · 蓝色\n\n第一次认真观察海洋时，我才知道蓝色有这么多层次。近岸的浅绿像被水泡软的玻璃，远处则深得几乎没有边界。地图上的国界在这里看不见。\n\n我拿出旧笔记本，想找一个准确的颜色名称。写了又划去，最后只留下：今天的海很好看。',
    '第二章 · 云的影子\n\n云不是贴在地表的一层白漆。太阳斜过来时，云团在海面投下清楚的影子，一边明亮，一边安静地暗着。风把它们推向不同的方向。\n\n我跟着一片长云看了好久，直到它出了窗框。生活舱没有停，云也没有停，我们只在这一小段时间里同行。',
    '第三章 · 海岸\n\n海岸不像纸上的线那样利落。河口把泥沙送入海中，颜色缓缓散开，像一封字迹洇开的信。岛屿围着浅滩排列，灯光尚未亮起。\n\n小时候去过的海边也在下面，只是太小，认不出来。我记得那里石阶的温度，记得鞋子里进了沙。这些细节，远比坐标可靠。',
    '第四章 · 山脉\n\n雪线沿山峰蜿蜒，像有人用白线补好了一块旧布。背光的山谷很深，太阳一点点把它们照亮。一个白昼，在不同地方有不同的开始。\n\n我把额头靠近舷窗，玻璃微凉。那些山保持了很久的沉默，人类为它们取名字、画地图，它们仍只依自己的速度变化。',
    '第五章 · 夜面\n\n城市的灯先在海岸出现，然后沿道路伸入内陆。不是每一片土地都明亮，黑暗也不等于无人居住。有人刚关灯，有人正守着炉火。\n\n我不再试着数那些光点。它们让我想起一张饭桌，碗筷摆好，窗户开着，有人听见门响便抬起头。',
    '第六章 · 再看一次\n\n看得越久，越难用一张照片概括地球。它有天气，有季节，有不断移动的阴影。今天看过的风景，下一次经过时已经改变。\n\n我合上笔记本，决定明天再看一次。熟悉一个地方，也许不是终于知道它的全部，而是愿意一次又一次，认真地望向它。',
  ]],
  ['微光旅行札记', [
    '第一章 · 出发\n\n出发那天，林把一张空白明信片放进包里。她说，要等见到最想分享的风景再写。车站很拥挤，广播念着陌生的地名，她却只记得母亲替她拉好围巾。\n\n后来列车离开地面，城市缩成一片光。林没有拍照，只把明信片从包里取出来，看了看背面那条细细的横线。',
    '第二章 · 同行者\n\n邻座是一位修理钟表的老人。他去远方给孙女送一只小钟，钟面上画着一艘船。老人说，旅途太长，总要有些东西提醒人按时吃饭。\n\n林问钟走得准不准。老人笑着摇头，说它每天慢一分钟。正因为如此，收礼物的人每天都会想起调整它，也就会想起送礼物的人。',
    '第三章 · 中途站\n\n中途站只有一扇很大的窗。旅客在窗前站成安静的一排，看远处的尘埃带被星光照亮。没有人催促，也没有人找到一句特别合适的话。\n\n林终于拿出笔，却发现墨水凝在笔尖。她在掌心里暖了一会儿，先写下日期。日期旁边画了一个小点，表示自己曾站在这里。',
    '第四章 · 微光\n\n航行的第三夜，窗外出现一颗很暗的星。它不在导航屏最显眼的位置，却一直伴着他们。林想到老人的小钟，想到地面有人每天等一封信。\n\n她写道：这里没有想象中那么亮，但黑暗里能看见许多微小的光。写完这句，她忽然知道明信片要寄给谁了。',
    '第五章 · 回程票\n\n目的地的工作比预想中顺利。林修好观测站的信号线，把工具一件件放回箱子。准备订下一段旅程时，她停了一下，买了一张回程票。\n\n离开不一定是为了走得更远。她想起窗前那一排沉默的人，想起围巾上熟悉的洗衣皂气味。箱子仍很轻，心里却装了很多东西。',
    '第六章 · 门口\n\n门打开的时候，屋里的灯正好亮起。母亲问路上累不累，林说不累，然后在椅子上坐了很久。包里的明信片已经寄出，会比她晚几天到家。\n\n她没有急着讲那些壮丽的风景，只先帮忙摆好碗筷。窗外有一颗星，暗得几乎看不见。林知道它在那里，便觉得这一趟旅行已经有了完整的结尾。',
  ]],
] as const;
export const BUILTIN_BOOKS: LibraryBook[] = stories.map(([title, chapters], i) => ({ id: `book-0${i + 1}`, source: 'builtin', title, author: 'PocketWorld · 原创', text: chapters.join('\f'), color: colors[i], slotId: BOOK_SLOTS[6 + 1 + i].id, anchor: 0 }));
export const freshLibrary = (): LibraryData => ({ version: 1, revision: 0, books: BUILTIN_BOOKS.map(book => ({ ...book })) });
// Bookcase origin: x keeps its left side clear of the window sill (inner edge x=-3.905);
// in the habitat its back sits against the rear sill (front edge z=-3.08).
export const shelfOrigin = (scene: string): Vec3 => [-3.28, 0, scene === 'observatory' ? -0.65 : -2.79];
export const readingStand = (scene: string): Vec3 => { const [x, y, z] = shelfOrigin(scene); return [x, y, z + 0.87]; };
export const slotFor = (book: LibraryBook) => BOOK_SLOTS.find(slot => slot.id === book.slotId)!;

// Reconcile existing v1 collections in memory; normal locked writes persist the layout.
// Keep visitor books in place unless a new builtin slot displaces them.
function arrangeBuiltinBooks(data: LibraryData): LibraryData {
  if (BUILTIN_BOOKS.every(preset => data.books.some(book => book.id === preset.id && book.slotId === preset.slotId))) return data;
  const reserved = new Map(BUILTIN_BOOKS.map(book => [book.id, book.slotId]));
  const occupied = new Set(reserved.values());
  for (const book of data.books) if (book.source === 'user' && !occupied.has(book.slotId)) occupied.add(book.slotId);
  const books = data.books.map(book => {
    const builtinSlot = reserved.get(book.id);
    if (builtinSlot) return { ...book, slotId: builtinSlot };
    if (!BUILTIN_BOOKS.some(preset => preset.slotId === book.slotId)) return book;
    const slot = BOOK_SLOTS.find(slot => !occupied.has(slot.id))!;
    occupied.add(slot.id);
    return { ...book, slotId: slot.id };
  });
  return { ...data, books };
}

export function readLibrary(storage: Pick<Storage, 'getItem'>): LibraryData {
  const value = storage.getItem(LIBRARY_KEY);
  if (!value) {
    const data = freshLibrary();
    const legacy = JSON.parse(storage.getItem('pocketworld:library:books') ?? '[]');
    if (!Array.isArray(legacy) || legacy.length > CAPACITY - 3) throw new Error('旧藏书需要整理，原记录已保留。请先导出旧藏书再重试。');
    for (const old of legacy) {
      if (!old || typeof old.id !== 'string' || !old.id.startsWith('visitor-') || data.books.some(b => b.id === old.id) || (old.author !== undefined && typeof old.author !== 'string') || typeof old.title !== 'string' || !Array.isArray(old.pages) || !old.pages.every((p: unknown) => typeof p === 'string')) throw new Error('旧藏书记录损坏，原记录已保留。');
      data.books.push(makeUserBook(data, old.title, old.author ?? '', old.pages.join('\n\n'), String(old.id)));
    }
    return data;
  }
  let data: LibraryData;
  try { data = JSON.parse(value); } catch { throw new Error('藏书记录无法解析，原记录已保留，请导出站点数据后修复。'); }
  const ids = new Set<string>(), slots = new Set<string>();
  if (data?.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.books) || data.books.length > CAPACITY) throw new Error('藏书版本或容量异常，未覆盖原记录。');
  for (const book of data.books) {
    if (!book || typeof book.id !== 'string' || ids.has(book.id) || !BOOK_SLOTS.some(slot => slot.id === book.slotId) || slots.has(book.slotId)
      || !['builtin', 'user'].includes(book.source) || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 80
      || typeof book.author !== 'string' || book.author.length > 60 || typeof book.text !== 'string' || !book.text.trim()
      || (book.source === 'user' && byteLength(book.text) > INPUT_LIMIT) || !/^#[\da-f]{6}$/i.test(book.color)
      || !Number.isSafeInteger(book.anchor) || book.anchor < 0 || book.anchor > book.text.length) throw new Error('部分藏书记录损坏，未覆盖原记录。');
    ids.add(book.id); slots.add(book.slotId);
  }
  if (data.books.filter(b => b.source === 'user').reduce((n, b) => n + byteLength(b.text), 0) > TOTAL_LIMIT
    || BUILTIN_BOOKS.some(b => !data.books.some(saved => saved.id === b.id && saved.source === 'builtin'))
    || data.books.some(b => b.source === 'builtin' && !BUILTIN_BOOKS.some(preset => preset.id === b.id))) throw new Error('藏书配置异常，未覆盖原记录。');
  return arrangeBuiltinBooks(data);
}
export function makeUserBook(data: LibraryData, title: string, author: string, input: string, id = `visitor-${crypto.randomUUID()}`): LibraryBook {
  const text = normalizeText(input);
  if (!title.trim() || !text) throw new Error('请填写书名和非空正文。');
  if (title.trim().length > 80 || author.trim().length > 60) throw new Error('书名最多 80 字，作者最多 60 字。');
  if (byteLength(text) > INPUT_LIMIT) throw new Error('单本正文不能超过 128 KiB，请缩短后重试。');
  if (data.books.some(book => normalizeText(book.text) === text)) throw new Error('这份正文已在书柜中，请直接阅读已有书籍。');
  if (data.books.filter(b => b.source === 'user').reduce((n, b) => n + byteLength(b.text), 0) + byteLength(text) > TOTAL_LIMIT) throw new Error('自添正文合计不能超过 512 KiB，请先移除一本。');
  const slot = BOOK_SLOTS.find(slot => !data.books.some(book => book.slotId === slot.id));
  if (!slot) throw new Error('书柜已满，请先移除一本自添书籍。');
  return { id, source: 'user', title: title.trim(), author: author.trim() || '访客', text, slotId: slot.id, color: colors[slot.column % colors.length], anchor: 0 };
}
export async function mutateLibrary(change: (data: LibraryData) => LibraryData, allowed: () => boolean = () => true): Promise<LibraryData> {
  if (!navigator.locks) throw new Error('此浏览器不支持安全保存藏书，请使用新版 Chromium 或 Safari。');
  return navigator.locks.request('pocketworld:library:write', async () => {
    if (!allowed()) throw new Error('请在书柜选书状态操作。');
    const previous = readLibrary(localStorage);
    const next = change(previous);
    next.revision = previous.revision + 1;
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); } catch { throw new Error('浏览器存储不可用或空间不足，原藏书未改动。请释放空间后重试。'); }
    return next;
  });
}
export interface TextPage { start: number; end: number; text: string }
export function paginate(text: string, width: number, lines: number, measure: (character: string) => number): TextPage[] {
  const pages: TextPage[] = [];
  let start = 0, line = 1, used = 0, cursor = 0;
  const finish = (end: number) => { if (end > start) pages.push({ start, end, text: text.slice(start, end).replace(/\f/g, '') }); start = end; line = 1; used = 0; };
  for (const character of text) {
    if (character === '\f') { finish(cursor + 1); cursor += character.length; continue; }
    const advance = character === '\n' ? 0 : measure(character === '\t' ? '　　' : character);
    if (character !== '\n' && used > 0 && used + advance > width) { line++; used = 0; }
    if (line > lines) finish(cursor);
    used += advance;
    cursor += character.length;
    if (character === '\n') { line++; used = 0; }
  }
  finish(text.length);
  return pages.length ? pages : [{ start: 0, end: 0, text: '' }];
}
