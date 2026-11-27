import type { WeaponId } from './weapons';
import type { VariantId } from './arsenal';
export const PROFESSIONS: Record<WeaponId, { name: string; shortName: string; title: string; passive: string; color: string }> = {
  pistol: { name: '魔弹游侠', shortName: '游侠', title: '一枪，刻下一道咒印。', passive: '职业天赋：手枪对生命高于 80% 的目标伤害 +12%。', color: '#daa76b' },
  machine: { name: '符文机巧师', shortName: '机巧师', title: '齿轮转动，符文轰鸣。', passive: '职业天赋：机关枪每第 10 次攻击伤害翻倍。', color: '#75c7bc' },
  rocket: { name: '爆破炼金师', shortName: '炼金师', title: '用爆炸，回答黑夜。', passive: '职业天赋：火箭爆炸范围 +10%。', color: '#dc8a73' },
  wand: { name: '星辉术士', shortName: '术士', title: '星辰记得所有咒语。', passive: '职业天赋：法球额外穿透一个目标。', color: '#b89cdd' },
  broom: { name: '疾风魔女', shortName: '魔女', title: '扫过荒野，留下风暴。', passive: '职业天赋：移速 +10%，冲刺冷却减少 0.4 秒。', color: '#a9bf77' },
};
export type SpecId = 'deadeye' | 'silver' | 'sixth' | 'execute' | 'spinup' | 'capacitor' | 'stabilizer' | 'salvo' | 'warhead' | 'embers' | 'cluster' | 'fuse' | 'twin' | 'sigil' | 'gravity' | 'familiar' | 'gale' | 'reap' | 'whirl' | 'witchstep';
export type Specialization = { id: SpecId; weapon: WeaponId; name: string; icon: string; description: string; color: string };
export const SPECIALS: Specialization[] = [
  { id:'deadeye',weapon:'pistol',name:'金瞳刻印',icon:'⊙',description:'手枪暴击率每级 +10%，不依赖射速堆触发。',color:'#e3b873' },
  { id:'silver',weapon:'pistol',name:'银纹穿甲',icon:'↠',description:'手枪每级额外穿透一个目标，后续伤害递减。',color:'#d3d6df' },
  { id:'sixth',weapon:'pistol',name:'暮星第六响',icon:'Ⅵ',description:'手枪每第六次攻击，伤害额外增加每级 80%。',color:'#e49c83' },
  { id:'execute',weapon:'pistol',name:'暮星终幕',icon:'✧',description:'手枪对生命低于 35% 的目标每级增伤 35%。',color:'#bb98d8' },
  { id:'spinup',weapon:'machine',name:'符文升频',icon:'⚙',description:'连续开火逐渐预热，满热时每级缩短 8% 攻击间隔。切枪会冷却。',color:'#87bfb8' },
  { id:'capacitor',weapon:'machine',name:'过载线圈',icon:'ϟ',description:'每十二次机关枪攻击，释放每级 18 点范围电击。',color:'#e0c477' },
  { id:'stabilizer',weapon:'machine',name:'刻印脚架',icon:'⌖',description:'站定射击时散布减小，机关枪每级增伤 15%。',color:'#adc5cd' },
  { id:'salvo',weapon:'machine',name:'符文回声弹链',icon:'»',description:'每六次机关枪攻击额外喷出每级一枚低伤符文弹。',color:'#df9f90' },
  { id:'warhead',weapon:'rocket',name:'日冕爆心',icon:'✹',description:'爆心 45 单位内的目标，每级额外承受 25% 伤害。',color:'#e3a277' },
  { id:'embers',weapon:'rocket',name:'熔火余烬',icon:'♨',description:'主火箭留下三秒余烬，每秒造成每级 9 点伤害。',color:'#d98966' },
  { id:'cluster',weapon:'rocket',name:'星火集束',icon:'⋈',description:'爆炸后追加集束攻击，效果随当前兵装变化。',color:'#cab080' },
  { id:'fuse',weapon:'rocket',name:'熔火追爆',icon:'※',description:'主火箭击杀目标后，产生一次额外冲击，每级继承 20% 伤害。',color:'#df8f97' },
  { id:'twin',weapon:'wand',name:'双星咒环',icon:'✦',description:'每次多发一颗法球，每颗伤害降低；总伤害逐级增加。',color:'#c4a7e7' },
  { id:'sigil',weapon:'wand',name:'星轨刻蚀',icon:'◇',description:'法球每次穿透后，伤害额外增加每级 12%。',color:'#93c8db' },
  { id:'gravity',weapon:'wand',name:'月蚀引力',icon:'◎',description:'法球命中时将附近怪物向命中点拉拢，便于穿透和连锁。',color:'#ac9fd3' },
  { id:'familiar',weapon:'wand',name:'巡月星灵',icon:'✶',description:'每三次施法，向另一个目标放出每级一颗半伤星灵弹。',color:'#d9c18d' },
  { id:'gale',weapon:'broom',name:'翡翠飞叶',icon:'彡',description:'每次攻击追加每级一枚半伤风刃，三种魔女兵装均可生效。',color:'#b8c98b' },
  { id:'reap',weapon:'broom',name:'迎风花露',icon:'♥',description:'同次扫击、突刺或主飞帚命中至少两个目标，每级回血 1 点，每秒最多一次。',color:'#d89cba' },
  { id:'whirl',weapon:'broom',name:'翠羽风暴',icon:'↻',description:'每第三次近战变为环击，范围每级 +12；飞帚改为向周围环射低伤风刃。',color:'#9fcac0' },
  { id:'witchstep',weapon:'broom',name:'踏风回旋',icon:'↗',description:'冲刺后首次攻击每级增伤 30%；冲刺中近战攻击还可延长距离。',color:'#c5bd82' },
];
export function clusterDescription(variant: VariantId): string {
  if (variant === 'launcher') return '爆炸后打出前方短锥爆风，贯穿锥内敌人，每级追加 14% 伤害。';
  if (variant === 'mine') return '爆炸后向四周布置 3 枚小地雷，爆炸范围缩小，每枚每级继承 14% 伤害。';
  return '爆炸后散出三枚小火箭，每枚每级继承 14% 伤害。';
}

export const isSpec = (id: string): id is SpecId => SPECIALS.some(s => s.id === id);
export const emptySpecials = (): Record<SpecId, number> => Object.fromEntries(SPECIALS.map(s => [s.id, 0])) as Record<SpecId, number>;
export const CLASS_TRAITS: Record<WeaponId, readonly string[]> = { pistol:['crit','ricochet'],machine:['burn','frost'],rocket:['burn','ricochet'],wand:['frost','chain'],broom:['vampire','split'] };

export const CLASS_LINKS: Record<WeaponId, { cards: [SpecId, SpecId]; name: string; effect: string }> = {
  pistol: { cards: ['deadeye', 'execute'], name: '金瞳终幕', effect: '对生命低于 35% 的怪物额外获得 15 个百分点暴击率。' },
  machine: { cards: ['spinup', 'capacitor'], name: '翡翠过载', effect: '热量达到 75% 时，线圈放电由每 12 击缩短至每 8 击。' },
  rocket: { cards: ['embers', 'cluster'], name: '余烬星雨', effect: '主爆炸留下的余烬持续时间从 3 秒延长到 4 秒。' },
  wand: { cards: ['gravity', 'sigil'], name: '月蚀星轨', effect: '每次穿透后额外增加 8% 伤害。' },
  broom: { cards: ['gale', 'whirl'], name: '翠羽叶潮', effect: '每次触发风暴时额外向四周发出 2 枚风刃。' },
};

export function classLinkActive(weapon: WeaponId, ranks: Record<SpecId, number>): boolean {
  return CLASS_LINKS[weapon].cards.every(id => ranks[id] > 0);
}
