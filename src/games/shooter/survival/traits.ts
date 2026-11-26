import type { WeaponId } from './weapons';
export type TraitId = 'burn' | 'frost' | 'chain' | 'ricochet' | 'split' | 'crit' | 'vampire';
export type Enchantments = Record<TraitId, number>;
export const emptyEnchantments = (): Enchantments => ({ burn: 0, frost: 0, chain: 0, ricochet: 0, split: 0, crit: 0, vampire: 0 });
export const TRAITS: { id: TraitId; name: string; icon: string; color: string; description: string }[] = [
  { id: 'burn', name: '赤焰刻印', icon: '♨', color: '#f38c58', description: '命中附加持续灼烧，重复命中刷新时间，不叠加火层。' },
  { id: 'frost', name: '霜月刻印', icon: '❄', color: '#65c9e2', description: '命中减速。与灼烧组合触发蒸汽爆破；与暴击组合触发碎冰。' },
  { id: 'chain', name: '雷纹刻印', icon: 'ϟ', color: '#c2a138', description: '命中有概率电击附近目标。与弹射组合扩大连锁范围、增加目标。' },
  { id: 'ricochet', name: '回响刻印', icon: '↝', color: '#e68db7', description: '命中后弹向新目标，伤害逐次衰减。火箭再爆一次，扫把发出反弹风刃。' },
  { id: 'split', name: '分影刻印', icon: '⋈', color: '#b78cdb', description: '主攻击命中有概率分裂两枚小弹，继承外形和部分伤害，分裂弹不再触发特性。' },
  { id: 'crit', name: '金运刻印', icon: '✧', color: '#e7ae44', description: '提升暴击率，暴击造成 1.7 倍伤害。暴击冰冷目标触发碎冰。' },
  { id: 'vampire', name: '汲生刻印', icon: '♥', color: '#e983a4', description: '主攻击命中回血，每把武器独立限流，每秒最多触发一次。' },
];
export const isTrait = (id: string): id is TraitId => TRAITS.some(t => t.id === id);
export function traitDescription(id: TraitId, weapon: WeaponId): string {
  if (id === 'ricochet') return weapon === 'broom' ? '扫击命中后发出寻找其他目标的风刃；后续弹射伤害衰减。' : weapon === 'rocket' ? '火箭、迫击炮、地雷爆炸后射出追击弹，每级多弹射一次，每次保留 65% 伤害；同一爆炸链不重复命中。' : weapon === 'wand' ? '法球的穿透次数增加，并在命中后追向新的目标。' : '子弹命中后自动寻找新目标弹射，伤害逐次衰减。';
  if (id === 'split' && weapon === 'broom') return '扫击有概率甩出两道迷你风刃，补足远处伤害。风刃不会再触发特性。';
  if (id === 'split' && weapon === 'rocket') return '爆炸命中有概率分裂两枚炼金飞弹，造成小范围爆炸，无法再分裂。';
  return TRAITS.find(t => t.id === id)?.description ?? '';
}
export function synergies(e: Enchantments): string[] {
  const result: string[] = [];
  if (e.burn && e.frost) result.push('蒸汽爆破');
  if (e.frost && e.crit) result.push('碎冰暴击');
  if (e.chain && e.ricochet) result.push('磁暴连锁');
  return result;
}
