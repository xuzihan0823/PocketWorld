import type { SoundEvent } from '../audio';
import { ARSENAL, STARTERS, armamentOf, variantsFor } from './arsenal';
import type { VariantId } from './arsenal';
export { ARSENAL } from './arsenal';
import { WEAPONS, weaponOf } from './weapons';
import type { WeaponId } from './weapons';
import { TRAITS, emptyEnchantments, isTrait, traitDescription } from './traits';
import type { Enchantments, TraitId } from './traits';
import { SPECIALS, emptySpecials, isSpec, CLASS_TRAITS, PROFESSIONS, CLASS_LINKS, classLinkActive, clusterDescription } from './professions';
import type { SpecId } from './professions';
import { segmentCircleEntry } from './collision';
export { SPECIALS, PROFESSIONS } from './professions';
export const W = 800, H = 600, WORLD = 2000, DURATION = 600;
export const LIMITS = { enemies: 105, bullets: 100, gems: 180, particles: 160, texts: 24, blasts: 24, arcs: 16, hazards: 12, fields: 12 };
export type Vec = { x: number; y: number };
export type SupportId = 'power' | 'rapid' | 'spread' | 'orbit' | 'magnet' | 'boots' | 'heart' | 'pulse';
export type UpgradeId = SupportId | TraitId | SpecId;
export type Upgrade = { id: UpgradeId; name: string; icon: string; description: string; color: string; tag: string; weapon?: WeaponId };
export const UPGRADES: (Upgrade & { id: SupportId })[] = [
  { id: 'power', name: '月晶共鸣', icon: '✦', description: '全武器伤害 +18%，最多四级。', color: '#f3be51', tag: '全局辅助' },
  { id: 'rapid', name: '加速符纹', icon: '»', description: '全武器攻击间隔缩短 10%，最多四级。', color: '#f58c85', tag: '全局辅助' },
  { id: 'spread', name: '分光符纹', icon: '⋈', description: '额外一弹，但每弹伤害降低；扫把范围 +12，最多两级。', color: '#b09ad5', tag: '全局辅助' },
  { id: 'orbit', name: '护身月轮', icon: '❋', description: '身边多一枚旋转月轮，接触怪物时造成伤害。', color: '#d6ad60', tag: '环绕武器' },
  { id: 'magnet', name: '拾星磁阵', icon: '◎', description: '经验拾取范围 +40%，最多三级。', color: '#7ac2c2', tag: '成长辅助' },
  { id: 'boots', name: '疾行护符', icon: '↗', description: '移动速度 +8%，冲刺冷却缩短，最多三级。', color: '#86b887', tag: '灵巧走位' },
  { id: 'heart', name: '红莓药剂', icon: '♥', description: '生命上限 +15，立即恢复 25 点生命，最多三级。', color: '#e78caa', tag: '生命恢复' },
  { id: 'pulse', name: '月泉震波', icon: '◌', description: '周期性释放月泉震波，伤害并击退周围怪物。', color: '#8eabdc', tag: '范围武器' },
];
export type Enemy = Vec & { id: number; kind: number; hp: number; max: number; radius: number; speed: number; seed: number; flash: number; hit: number; charge: number; burn?: number; burnDps?: number; burnTick?: number; chill?: number; slow?: number; reaction?: number };
export type Bullet = Vec & { vx: number; vy: number; life: number; damage: number; radius: number; kind: WeaponId; hits: number[]; traits?: Enchantments; secondary?: boolean; bounces?: number; procDone?: boolean; reactionDone?: boolean; specs?: Record<SpecId, number>; variant?: VariantId; delay?: number; target?: Vec; duration?: number; explosiveFollowup?: boolean };
export type Blast = Vec & { radius: number; life: number; max: number; color: string; coneAngle?: number };
export type Gem = Vec & { value: number; life: number; heart: boolean };
export type Particle = Vec & { vx: number; vy: number; life: number; max: number; color: string; size: number };
export type Float = Vec & { label: string; life: number; color: string };
export type Run = {
  phase: 'playing' | 'upgrade' | 'victory' | 'defeat'; time: number; player: Vec; facing: number; moving: boolean;
  hp: number; maxHp: number; speed: number; invincible: number; dash: number; dashCd: number; dashDir: Vec;
  level: number; xp: number; need: number; score: number; kills: number; upgrades: Record<SupportId, number>;
  enemies: Enemy[]; bullets: Bullet[]; gems: Gem[]; particles: Particle[]; texts: Float[];
  shot: number; spawn: number; pulseCd: number; pulseRing: number; shake: number; nextId: number; boss: boolean;
  choices: Upgrade[]; sounds: SoundEvent[]; random: () => number;
  variant: VariantId; weaponNotice: number;
  readonly weapon: WeaponId; cooldowns: Record<WeaponId, number>; aim: number; recoil: number; sweep: number; blasts: Blast[];
  enchants: Record<WeaponId, Enchantments>; leechCd: Record<WeaponId, number>; arcs: { from: Vec; to: Vec; life: number }[];
  wave: number; waveCd: number; hazardCd: number; hazards: (Vec & { delay: number; life: number; radius: number })[];
  damageDealt: number;
  readonly profession: WeaponId; specials: Record<SpecId, number>; shotCounts: Record<WeaponId, number>; rerolls: number;
  hitStop: number; hitStopCd: number; damageFlash: number; combo: number; comboTime: number; heat: number; witchCharge: number;
  fields: (Vec & { radius: number; life: number; tick: number; damage: number })[];
};
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const CLUSTER_CONE_HALF_ANGLE = 32 * Math.PI / 180;
const CLUSTER_CONE_REACH = 112;
const CLUSTER_CONE_COS = Math.cos(CLUSTER_CONE_HALF_ANGLE);
const CLUSTER_DAMAGE_PER_RANK = .14;
const MINI_MINE_TRIGGER = 24;
export function createRun(random = Math.random, weapon: WeaponId = 'pistol', variant: VariantId = STARTERS[weapon]): Run {
  return {
    phase: 'playing', time: 0, player: { x: 1000, y: 1000 }, facing: 1, moving: false,
    hp: 100, maxHp: 100, speed: 155, invincible: 0, dash: 0, dashCd: 0, dashDir: { x: 1, y: 0 },
    level: 1, xp: 0, need: 5, score: 0, kills: 0,
    upgrades: { power: 0, rapid: 0, spread: 0, orbit: 0, magnet: 0, boots: 0, heart: 0, pulse: 0 },
    enemies: [], bullets: [], gems: [], particles: [], texts: [], shot: 0.2, spawn: 0.4,
    pulseCd: 5, pulseRing: 0, shake: 0, nextId: 1, boss: false, choices: [], sounds: [], random,
    variant: armamentOf(variant).family === weapon ? variant : STARTERS[weapon], weaponNotice: 2.2,
    weapon, cooldowns: { pistol: 0, machine: 0, rocket: 0, wand: 0, broom: 0 }, aim: 0, recoil: 0, sweep: 0, blasts: [],
    enchants: { pistol: emptyEnchantments(), machine: emptyEnchantments(), rocket: emptyEnchantments(), wand: emptyEnchantments(), broom: emptyEnchantments() },
    leechCd: { pistol: 0, machine: 0, rocket: 0, wand: 0, broom: 0 }, arcs: [], wave: 1, waveCd: 45, hazardCd: 8, hazards: [], damageDealt: 0,
    profession: weapon, specials: emptySpecials(), shotCounts: { pistol: 0, machine: 0, rocket: 0, wand: 0, broom: 0 }, rerolls: 2,
    hitStop: 0, hitStopCd: 0, damageFlash: 0, combo: 0, comboTime: 0, heat: 0, witchCharge: 0, fields: [],
  };
}
export function switchVariant(r: Run, id?: VariantId): boolean {
  if (r.phase !== 'playing') return false;
  const list = variantsFor(r.profession), next = id ?? list[(list.findIndex(a => a.id === r.variant) + 1) % list.length].id;
  if (armamentOf(next).family !== r.profession || r.variant === next || !ARSENAL.some(a => a.id === next)) return false;
  r.variant = next; r.weaponNotice = 2.2; r.shot = Math.max(.18, r.cooldowns[r.weapon]);
  r.recoil = 0; r.sweep = 0; r.heat = 0; sound(r, 'switch'); return true;
}
function addBlast(r: Run, blast: Blast): void {
  if (r.blasts.length >= LIMITS.blasts) r.blasts.shift();
  r.blasts.push(blast);
}

function explode(r: Run, b: Bullet): void {
  const arm = armamentOf(b.variant ?? STARTERS[b.kind]);
  const radiusScale = b.secondary ? (arm.id === 'mine' ? .55 : .58) : 1;
  const radius = ((arm.radius || 82) + r.upgrades.spread * 7) * radiusScale * (r.profession === 'rocket' ? 1.1 : 1);
  const clusterRank = b.secondary ? 0 : (b.specs?.cluster ?? 0);
  const angle = Math.atan2(b.vy, b.vx);
  const coneTargets = clusterRank && arm.id === 'launcher' ? clusterConeTargets(r, b, angle) : [];
  addBlast(r, { x: b.x, y: b.y, radius, life: .5, max: .5, color: '#ff86ab' });
  let killed = false;
  // A primary explosion chain hits each enemy once; independent secondary blasts
  // may overlap, but cannot start another chain or generate cluster children.
  for (const e of r.enemies) if (e.hp > 0 && !b.hits.includes(e.id) && dist(b, e) < radius + e.radius) {
    b.hits.push(e.id);
    const baseDamage = b.damage;
    if (!b.secondary && dist(b, e) < 45) b.damage *= 1 + (b.specs?.warhead ?? 0) * .25;
    applyImpact(r, e, b); b.damage = baseDamage; killed ||= e.hp <= 0; const d = Math.max(1, dist(e, b));
    e.x = clamp(e.x + (e.x - b.x) / d * 24, 40, WORLD - 40); e.y = clamp(e.y + (e.y - b.y) / d * 24, 40, WORLD - 40);
  }
  if (!b.secondary && b.specs?.embers && r.fields.length < LIMITS.fields) {
    const linked = classLinkActive('rocket', b.specs);
    r.fields.push({ x: b.x, y: b.y, radius: radius * .75, life: linked ? 4 : 3, tick: .4, damage: b.specs.embers * 9 });
    if (linked) label(r, b, CLASS_LINKS.rocket.name, '#ffb883');
  }
  if (clusterRank) {
    const damage = b.damage * CLUSTER_DAMAGE_PER_RANK * clusterRank;
    if (arm.id === 'launcher') {
      for (const target of coneTargets) hurt(r, target, damage);
      addBlast(r, {
        x: b.x, y: b.y, radius: CLUSTER_CONE_REACH, life: .32, max: .32, color: '#ffe098', coneAngle: angle,
      });
    } else {
      spawnClusterCharges(r, b, damage, arm.id === 'mine');
    }
  }
  if (killed && !b.secondary && b.specs?.fuse) { ring(r, b, radius * 1.3, '#e5b77b'); for (const e of r.enemies) if (e.hp > 0 && dist(b, e) < radius * 1.3) hurt(r, e, b.damage * .2 * b.specs.fuse); }
  burst(r, b, '#ffbe45', 18); label(r, b, '噗嘭！', '#fff3ba'); r.shake = Math.min(5, r.shake + 2); sound(r, 'blast');
}
function clusterConeTargets(r: Run, origin: Vec, angle: number): Enemy[] {
  const forwardX = Math.cos(angle), forwardY = Math.sin(angle);
  return r.enemies.filter(enemy => {
    if (enemy.hp <= 0) return false;
    const dx = enemy.x - origin.x, dy = enemy.y - origin.y;
    const distance = Math.hypot(dx, dy);
    return distance <= CLUSTER_CONE_REACH && dx * forwardX + dy * forwardY >= distance * CLUSTER_CONE_COS;
  });
}

function spawnClusterCharges(r: Run, origin: Vec, damage: number, mines: boolean): void {
  for (let i = 0; i < 3 && r.bullets.length < LIMITS.bullets; i++) {
    const angle = i * Math.PI * 2 / 3;
    const x = Math.cos(angle), y = Math.sin(angle);
    r.bullets.push(mines ? {
      x: clamp(origin.x + x * 62, 40, WORLD - 40), y: clamp(origin.y + y * 62, 40, WORLD - 40),
      vx: 0, vy: 0, life: 5, delay: .35, damage, radius: 5, kind: 'rocket', variant: 'mine', hits: [], secondary: true,
    } : {
      x: origin.x + x * 15, y: origin.y + y * 15, vx: x * 200, vy: y * 200,
      life: .4, damage, radius: 5, kind: 'rocket', variant: 'launcher', hits: [], secondary: true,
    });
  }
}

function sound(r: Run, s: Run['sounds'][number]): void { if (r.sounds.length < 12) r.sounds.push(s); }
function burst(r: Run, p: Vec, color: string, n = 8): void {
  for (let i = 0; i < n; i++) {
    if (r.particles.length >= LIMITS.particles) r.particles.shift();
    const a = r.random() * Math.PI * 2, v = 25 + r.random() * 85, life = .35 + r.random() * .3;
    r.particles.push({ ...p, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life, max: life, color, size: 2 + r.random() * 4 });
  }
}
function label(r: Run, p: Vec, value: string, color: string): void {
  if (r.texts.length >= LIMITS.texts) r.texts.shift();
  r.texts.push({ ...p, y: p.y - 30, label: value, color, life: .8 });
}
function drop(r: Run, p: Vec, value: number, heart = false): void {
  if (r.gems.length >= LIMITS.gems) {
    // Merge value into an existing pickup instead of leaking objects or losing XP.
    const sameKind = r.gems.find(g => g.heart === heart);
    if (sameKind) { sameKind.value += value; sameKind.life = 90; }
    return;
  }
  r.gems.push({ ...p, value, heart, life: 90 });
}
function hurt(r: Run, e: Enemy, damage: number): void {
  if (e.hp <= 0) return;
  r.damageDealt += Math.min(e.hp, damage);
  e.hp -= damage; e.flash = .12;
  label(r, e, String(Math.round(damage)), '#fffaf0');
  burst(r, e, '#f8df9c', 2); sound(r, 'impact');
  if (e.hp > 0) return;
  r.kills++; r.combo++; r.comboTime = 2; r.score += e.kind === 3 ? 1000 : e.kind === 2 ? 35 : 10;
  if (r.hitStopCd <= 0) { r.hitStop = e.kind === 3 ? .065 : .025; r.hitStopCd = .18; }
  burst(r, e, ['#95ce8a', '#e8afc8', '#b7a6dd', '#fac875'][e.kind], e.kind === 3 ? 28 : 8);
  drop(r, e, e.kind === 3 ? 45 : e.kind === 2 ? 4 : 1);
  if (r.random() < .025) drop(r, { x: e.x + 15, y: e.y }, 12, true);
  if (e.kind === 3) { label(r, e, '首领退散！', '#f6b64b'); r.hp = Math.min(r.maxHp, r.hp + 35); }
  sound(r, 'destroy');
}
function ring(r: Run, p: Vec, radius: number, color: string): void {
  addBlast(r, { x: p.x, y: p.y, radius, color, life: .4, max: .4 });
}
function applyImpact(r: Run, e: Enemy, b: Bullet): void {
  if (e.hp <= 0) return;
  const t = b.traits ?? emptyEnchantments(), chilled = (e.chill ?? 0) > 0;
  const s = b.specs;
  const critChance = (t.crit > 0 ? .1 + t.crit * .08 : 0) + (b.kind === 'pistol' ? (s?.deadeye ?? 0) * .1 : 0);
  const exposed = b.kind === 'pistol' && s && e.hp / e.max < .35 && classLinkActive('pistol', s);
  const chance = critChance + (exposed ? .15 : 0);
  const critical = !b.secondary && chance > 0 && r.random() < chance;
  const fresh = r.profession === 'pistol' && b.kind === 'pistol' && e.hp / e.max > .8 ? 1.12 : 1;
  const execute = b.kind === 'pistol' && e.hp / e.max < .35 ? 1 + (s?.execute ?? 0) * .35 : 1;
  hurt(r, e, b.damage * (critical ? 1.7 : 1) * fresh * execute);
  if (!b.secondary && b.kind === 'pistol') { const a = Math.atan2(b.vy, b.vx); e.x += Math.cos(a) * 4; e.y += Math.sin(a) * 4; }
  if (!b.secondary && b.kind === 'wand' && s?.gravity) for (const other of r.enemies) if (other !== e && other.hp > 0 && dist(other, e) < 100) { const d = Math.max(1, dist(other, e)), push = Math.min(d, 6 * s.gravity); other.x += (e.x - other.x) / d * push; other.y += (e.y - other.y) / d * push; }
  if (b.secondary) return;
  if (critical) { label(r, e, exposed ? CLASS_LINKS.pistol.name : '暴击！', '#ffe675'); sound(r, 'critical'); r.shake = Math.max(r.shake, 2); if (r.hitStopCd <= 0) { r.hitStop = .035; r.hitStopCd = .18; } }
  if (t.burn) {
    const arm = armamentOf(b.variant ?? STARTERS[b.kind]);
    const dps = arm.damage * arm.count / arm.interval * (.1 + t.burn * .05);
    e.burnDps = (e.burn ?? 0) > 0 ? Math.max(e.burnDps ?? 0, dps) : dps; e.burn = 2.4;
  }
  if (t.frost) { e.chill = 1.4; e.slow = .18 + t.frost * .08; }
  if (!b.reactionDone && (e.reaction ?? 0) <= 0 && ((t.burn && t.frost) || (critical && chilled && t.frost))) {
    const shatter = critical && chilled && t.frost;
    b.reactionDone = true; e.reaction = 1.2; const color = shatter ? '#83dbff' : '#ffbd9b';
    ring(r, e, 65, color); label(r, e, shatter ? '碎冰！' : '蒸汽爆破', color);
    for (const other of r.enemies) if (other.hp > 0 && dist(e, other) < 65 + other.radius) hurt(r, other, b.damage * (shatter ? .55 : .38));
  }
  if (b.procDone) return; b.procDone = true;
  if (t.vampire && r.leechCd[b.kind] <= 0) { r.hp = Math.min(r.maxHp, r.hp + .6 + t.vampire * .4); r.leechCd[b.kind] = 1; }
  if (t.chain && r.random() < .2 + t.chain * .1) {
    const magnetic = t.ricochet > 0, radius = magnetic ? 220 : 155;
    const targets = r.enemies.filter(o => o !== e && o.hp > 0 && dist(o, e) < radius).sort((a, b) => dist(a, e) - dist(b, e)).slice(0, 1 + Math.floor(t.chain / 2) + Number(magnetic));
    for (const target of targets) {
      if (r.arcs.length >= LIMITS.arcs) r.arcs.shift();
      r.arcs.push({ from: { x: e.x, y: e.y }, to: { x: target.x, y: target.y }, life: .16 }); hurt(r, target, b.damage * .42);
    }
  }
  if (t.split && r.random() < .2 + t.split * .12) {
    const a = Math.atan2(b.vy, b.vx);
    for (const side of [-1, 1]) if (r.bullets.length < LIMITS.bullets) r.bullets.push({ x: e.x + Math.cos(a + side * .8) * 18, y: e.y + Math.sin(a + side * .8) * 18, vx: Math.cos(a + side * .8) * 320, vy: Math.sin(a + side * .8) * 320, life: 1, damage: b.damage * .3, radius: 5, kind: b.kind, hits: [e.id], secondary: true });
  }
}
function redirect(r: Run, b: Bullet): boolean {
  const rank = b.traits?.ricochet ?? 0;
  if (b.secondary || b.kind === 'wand' || (b.bounces ?? 0) >= Math.min(3, rank) || (b.kind !== 'rocket' && b.hits.length >= 8)) return false;
  const targets = r.enemies.filter(o => o.hp > 0 && !b.hits.includes(o.id) && dist(o, b) < 240).sort((a, c) => dist(a, b) - dist(c, b) || a.id - c.id);
  const target = targets[0]; if (!target) return false;
  const d = Math.max(.01, dist(target, b)), speed = Math.max(300, Math.hypot(b.vx, b.vy));
  b.vx = (target.x - b.x) / d * speed; b.vy = (target.y - b.y) / d * speed;
  b.damage *= .65; b.bounces = (b.bounces ?? 0) + 1; b.life = Math.max(.8, b.life); return true;
}
function detonate(r: Run, b: Bullet): void {
  explode(r, b);
  if (redirect(r, b)) {
    // Reuse this bounded projectile and its snapshots/history. A landed mortar or
    // triggered mine becomes a flying charge, never a second armed/landing event.
    b.explosiveFollowup = true; b.delay = 0; b.target = undefined;
    b.life = .8;
  } else b.life = 0;
}
function spawnEnemy(r: Run, boss = false): void {
  if (r.enemies.length >= LIMITS.enemies) return;
  const a = r.random() * Math.PI * 2, radius = 350 + r.random() * 50;
  const kind = boss ? 3 : r.time > 45 && r.random() < .15 ? 2 : r.time > 18 && r.random() < .3 ? 1 : 0;
  const hp = boss ? 2400 : (kind === 2 ? 78 : kind === 1 ? 24 : 28) * (1 + r.time / 190);
  r.enemies.push({ id: r.nextId++, x: clamp(r.player.x + Math.cos(a) * radius, 60, WORLD - 60), y: clamp(r.player.y + Math.sin(a) * radius, 60, WORLD - 60),
    kind, hp, max: hp, radius: [18, 15, 24, 51][kind], speed: [48, 76, 35, 38][kind] + Math.min(30, r.time / 18), seed: r.random() * 10, flash: 0, hit: 0, charge: 4,
  });
}
export function upgradeRank(r: Run, u: Upgrade): number {
  return isSpec(u.id) ? r.specials[u.id] : isTrait(u.id) ? r.enchants[u.weapon ?? r.weapon][u.id] : r.upgrades[u.id];
}
export function rollChoices(r: Run, avoid: UpgradeId[] = []): Upgrade[] {
  const shuffle = <T>(pool: T[]): T[] => { for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool; };
  const w = r.weapon;
  const link = CLASS_LINKS[w];
  const partner = link.cards.find(id => r.specials[id] === 0 && link.cards.some(other => r.specials[other] > 0));
  const traits: Upgrade[] = shuffle(SPECIALS.filter(s => s.weapon === w && r.specials[s.id] < 3)).sort((a,b) => Number(avoid.includes(a.id)) - Number(avoid.includes(b.id)) || Number(b.id === partner) - Number(a.id === partner)).map(s => ({ ...s, description: s.id === 'cluster' ? clusterDescription(r.variant) : s.description, tag: `${PROFESSIONS[w].name} · 专属秘术` }));
  const elemental: Upgrade[] = TRAITS.filter(t => CLASS_TRAITS[w].includes(t.id) && r.enchants[w][t.id] < 3).map(t => ({ ...t, weapon:w,tag:`${weaponOf(w).short} · 元素秘术`,description:traitDescription(t.id,w) }));
  const supports = shuffle(UPGRADES.filter(u => !isTrait(u.id) && r.upgrades[u.id] < (u.id === 'power' || u.id === 'rapid' ? 4 : u.id === 'spread' ? 2 : 3)));
  const utilities = shuffle([...supports,...elemental]).sort((a,b) => Number(avoid.includes(a.id)) - Number(avoid.includes(b.id)));
  const result = [...traits.slice(0, 2), ...utilities.slice(0, 1)];
  // At caps, fill with other eligible cards; never offer duplicates or unusable ranks.
  for (const u of [...traits.slice(2), ...utilities.slice(1)]) if (result.length < 3) result.push(u);
  return shuffle(result);
}
export function rerollUpgrades(r: Run): boolean {
  if (r.phase !== 'upgrade' || r.rerolls <= 0) return false;
  const before = r.choices.map(c => c.id).sort().join(',');
  const next = rollChoices(r, r.choices.map(c => c.id));
  if (next.map(c => c.id).sort().join(',') === before) return false;
  r.choices = next; r.rerolls--; sound(r, 'switch'); return true;
}
export function chooseUpgrade(r: Run, id: UpgradeId): boolean {
  const card = r.choices.find(c => c.id === id);
  if (r.phase !== 'upgrade' || !card || upgradeRank(r, card) >= (isTrait(id) || isSpec(id) ? 3 : id === 'power' || id === 'rapid' ? 4 : id === 'spread' ? 2 : 3)) return false;
  if (isSpec(id)) { if (card.weapon !== SPECIALS.find(s => s.id === id)?.weapon) return false; r.specials[id]++; }
  else if (isTrait(id)) r.enchants[card.weapon ?? r.weapon][id]++;
  else r.upgrades[id]++;
  if (id === 'heart') { r.maxHp += 15; r.hp = Math.min(r.maxHp, r.hp + 25); }
  r.choices = []; r.phase = 'playing'; sound(r, 'wave'); return true;
}
export function dash(r: Run, input: Vec): boolean {
  if (r.phase !== 'playing' || r.dashCd > 0) return false;
  const d = Math.hypot(input.x, input.y);
  r.dashDir = d > 0 ? { x: input.x / d, y: input.y / d } : { x: r.facing, y: 0 };
  r.dash = .24; r.dashCd = Math.max(1.6, 3.5 - r.upgrades.boots * .2 - (r.profession === 'broom' ? .4 : 0)); r.invincible = Math.max(r.invincible, .35); r.witchCharge = 2;
  burst(r, r.player, '#fff6cb', 12); sound(r, 'dash'); return true;
}
export function orbitPoints(r: Run): Vec[] {
  return Array.from({ length: r.upgrades.orbit }, (_, i) => { const a = r.time * 2.8 + i * Math.PI * 2 / r.upgrades.orbit; return { x: r.player.x + Math.cos(a) * 71, y: r.player.y + Math.sin(a) * 71 }; });
}
export function advance(r: Run, delta: number, input: Vec = { x: 0, y: 0 }): void {
  if (r.phase !== 'playing') return;
  const dt = clamp(delta, 0, .05); if (!dt) return;
  r.hitStopCd = Math.max(0, r.hitStopCd - dt);
  if (r.hitStop > 0) { r.hitStop = Math.max(0, r.hitStop - dt); return; }
  r.damageFlash = Math.max(0, r.damageFlash - dt); r.comboTime = Math.max(0, r.comboTime - dt); if (!r.comboTime) r.combo = 0;
  r.witchCharge = Math.max(0, r.witchCharge - dt);
  r.weaponNotice = Math.max(0,r.weaponNotice-dt);
  r.time += dt; r.invincible = Math.max(0, r.invincible - dt); r.dashCd = Math.max(0, r.dashCd - dt);
  r.dash = Math.max(0, r.dash - dt); r.pulseRing = Math.max(0, r.pulseRing - dt); r.shake = Math.max(0, r.shake - dt * 20);
  r.recoil = Math.max(0, r.recoil - dt); r.sweep = Math.max(0, r.sweep - dt);
  for (const w of WEAPONS) { r.cooldowns[w.id] = Math.max(0, r.cooldowns[w.id] - dt); r.leechCd[w.id] = Math.max(0, r.leechCd[w.id] - dt); }
  for (const arc of r.arcs) arc.life -= dt; r.arcs = r.arcs.filter(a => a.life > 0);
  for (const b of r.blasts) b.life -= dt; r.blasts = r.blasts.filter(b => b.life > 0);
  const len = Math.hypot(input.x, input.y), speed = r.speed * (1 + r.upgrades.boots * .08) * (r.profession === 'broom' ? 1.1 : 1);
  r.moving = len > 0 || r.dash > 0;
  const mx = r.dash > 0 ? r.dashDir.x * 560 : len ? input.x / Math.max(1, len) * speed : 0;
  const my = r.dash > 0 ? r.dashDir.y * 560 : len ? input.y / Math.max(1, len) * speed : 0;
  r.player.x = clamp(r.player.x + mx * dt, 70, WORLD - 70); r.player.y = clamp(r.player.y + my * dt, 70, WORLD - 70);
  if (Math.abs(mx) > .01) r.facing = mx > 0 ? 1 : -1;
  r.heat = r.weapon === 'machine' && r.enemies.length ? Math.min(1, r.heat + dt / 3) : Math.max(0, r.heat - dt * 2);
  for (const f of r.fields) { f.life -= dt; f.tick -= dt; if (f.tick <= 0) { f.tick += .4; for (const e of r.enemies) if (e.hp > 0 && dist(e, f) < f.radius) hurt(r,e,f.damage * .4); } }
  r.fields = r.fields.filter(f => f.life > 0);
  r.spawn -= dt;
  if (r.spawn <= 0) { spawnEnemy(r); r.spawn += Math.max(.2, .86 - r.time / 800); }
  r.waveCd -= dt;
  if (r.waveCd <= 0) {
    r.wave++; r.waveCd += 45;
    for (let i = 0; i < Math.min(20, 7 + r.wave); i++) spawnEnemy(r);
    label(r, r.player, `第 ${r.wave} 波 · 软糖暴走`, '#f286af'); sound(r, 'wave');
  }
  if (r.time >= 90) {
    r.hazardCd -= dt;
    if (r.hazardCd <= 0 && r.hazards.length < LIMITS.hazards) {
      r.hazardCd = Math.max(3.5, 8 - r.time / 130);
      r.hazards.push({ x: r.player.x, y: r.player.y, radius: 65, delay: 1.25, life: 1.6 });
    }
  }
  for (const h of r.hazards) {
    const before = h.delay; h.delay -= dt; h.life -= dt;
    if (before > 0 && h.delay <= 0) { ring(r, h, h.radius, '#e7a6ff'); if (dist(h, r.player) < h.radius && r.invincible <= 0) { r.hp = Math.max(0, r.hp - 16); r.invincible = .7; r.shake = 4; r.damageFlash = .28; sound(r, 'hit'); } }
  }
  r.hazards = r.hazards.filter(h => h.life > 0);
  if (r.time >= 540 && !r.boss) {
    // Reserve space for the one-time encounter even when the normal spawn cap is full.
    if (r.enemies.length >= LIMITS.enemies) r.enemies.pop();
    r.boss = true; spawnEnemy(r, true);
  }
  const alive = r.enemies.filter(e => e.hp > 0);
  r.shot -= dt;
  if (r.shot <= 0 && alive.length) {
    const target = alive.reduce((a, b) => dist(r.player, a) < dist(r.player, b) ? a : b);
    const weapon = armamentOf(r.variant);
    const a = Math.atan2(target.y - r.player.y, target.x - r.player.x), count = weapon.count + r.upgrades.spread;
    r.aim = a; r.facing = Math.cos(a) >= 0 ? 1 : -1;
    const shotNumber = r.shotCounts[r.weapon] + 1;
    const circular = r.specials.whirl > 0 && shotNumber % 3 === 0;
    const range = weapon.reach + r.upgrades.spread * 12 + (circular ? r.specials.whirl * 12 : 0) + (r.specials.witchstep && r.dash > 0 ? 25 : 0);
    if (weapon.mode !== 'melee' || dist(r.player, target) < range + target.radius || r.specials.gale > 0) {
      r.recoil = .14;
      r.shotCounts[r.weapon] = shotNumber;
      const specs = { ...r.specials };
      const linked = classLinkActive(r.weapon, specs);
      let damage = weapon.damage * (1 + r.upgrades.power * .18) / (weapon.mode === 'melee' ? 1 : 1 + r.upgrades.spread * .55);
      if (r.weapon === 'pistol' && shotNumber % 6 === 0 && specs.sixth) { damage *= 1 + specs.sixth * .8; label(r,r.player,'第六发！','#eac383'); }
      if (r.weapon === 'machine') { if (!r.moving) damage *= 1 + specs.stabilizer * .15; if (r.profession === 'machine' && shotNumber % 10 === 0) damage *= 2; }
      if (r.weapon === 'broom' && r.witchCharge > 0 && specs.witchstep) { damage *= 1 + specs.witchstep * .3; r.witchCharge = 0; }
      const traits = { ...r.enchants[r.weapon] };
      if (weapon.id === 'frostfan') traits.frost = Math.max(1, traits.frost);
      if (weapon.mode === 'melee') {
        r.sweep = .28;
        const swing: Bullet = { ...r.player, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, damage, radius: 8, life: 1, kind: 'broom', variant: weapon.id, hits: [], traits, specs };
        let struck = 0;
        for (const e of [...alive].sort((u,v)=>dist(u,r.player)-dist(v,r.player))) {
          if(weapon.id==='lance'&&!circular&&struck>=weapon.pierce)break;
          const d = dist(e, r.player), angle = Math.atan2(e.y - r.player.y, e.x - r.player.x);
          if (d < range + e.radius && (circular || Math.cos(angle - a) > weapon.cone)) {
            struck++;
            applyImpact(r, e, swing);
            const push = e.kind === 3 ? 8 : e.kind === 2 ? 22 : 55;
            e.x = clamp(e.x + Math.cos(angle) * push, 40, WORLD - 40); e.y = clamp(e.y + Math.sin(angle) * push, 40, WORLD - 40);
            burst(r, e, '#ffe67a', 5);
          }
        }
        if (circular) ring(r,r.player,range,'#a8cdb0');
        if (struck >= 2 && specs.reap && r.leechCd.broom <= 0) { r.hp = Math.min(r.maxHp, r.hp + specs.reap); r.leechCd.broom = 1; }
        if (circular && linked) label(r, r.player, CLASS_LINKS.broom.name, '#c3ff9a');
        if (circular && linked) for (const angle of [a + Math.PI / 2, a - Math.PI / 2]) {
          if (r.bullets.length >= LIMITS.bullets) break;
          r.bullets.push({ ...r.player, vx: Math.cos(angle) * 380, vy: Math.sin(angle) * 380, damage: damage * .5, radius: 8, life: 1.2, kind: 'broom', hits: [], secondary: true });
        }
        if (specs.gale) for (let i=0;i<specs.gale && r.bullets.length<LIMITS.bullets;i++) { const angle = a + (i-(specs.gale-1)/2)*.2; r.bullets.push({ ...r.player,vx:Math.cos(angle)*380,vy:Math.sin(angle)*380,damage:damage*.5,radius:8,life:1.2,kind:'broom',hits:[],secondary:true }); }
        if (traits.ricochet && swing.procDone && r.bullets.length < LIMITS.bullets) {
          const blade: Bullet = { ...swing, x: target.x, y: target.y, damage: damage * .4, hits: [target.id], procDone: true };
          if (redirect(r, blade)) r.bullets.push(blade);
        }
        label(r, target, '走你～', '#ffe772');
      } else {
        const twin = r.weapon === 'wand' ? specs.twin : 0;
        const extra = r.weapon === 'machine' && shotNumber % 6 === 0 ? specs.salvo : r.weapon === 'wand' && shotNumber % 3 === 0 ? specs.familiar : 0;
        for (let i = 0; i < count + twin + extra && r.bullets.length < LIMITS.bullets; i++) {
          const bonus = i >= count + twin;
          const other = bonus && r.weapon === 'wand' ? alive.find(e => e.id !== target.id) : undefined;
          const spreadIndex = bonus && r.weapon === 'wand' ? i - count - twin - (extra - 1) / 2 : i - (count + twin - 1) / 2;
          const angle = (other ? Math.atan2(other.y - r.player.y, other.x - r.player.x) : a) + spreadIndex * weapon.spread + (r.weapon === 'machine' ? (r.random() - .5) * (specs.stabilizer && !r.moving ? .025 : .14) : 0);
          const flight = weapon.mode === 'lob' ? { vx:(target.x-r.player.x)/weapon.life,vy:(target.y-r.player.y)/weapon.life,target:{x:target.x,y:target.y} } : {vx:Math.cos(angle)*weapon.speed,vy:Math.sin(angle)*weapon.speed};
          r.bullets.push({ ...r.player, ...flight, variant:weapon.id, duration:weapon.life, delay:weapon.id==='burst'?i*.08:weapon.mode==='mine'?.35:0, life:weapon.life, damage:damage*(bonus?.5:1)/(1+twin*.65/weapon.count), radius:r.weapon==='rocket'?9:r.weapon==='wand'?10:5+r.upgrades.power*.4,kind:r.weapon,hits:[],traits,specs,secondary:bonus });
        }
        if (r.weapon === 'broom') {
          const radial = specs.whirl > 0 && shotNumber % 3 === 0, extra = specs.gale + (radial ? 4 + specs.whirl + (linked ? 2 : 0) : 0);
          for(let i=0;i<extra && r.bullets.length<LIMITS.bullets;i++){ const angle=radial?i*Math.PI*2/extra:a+(i-(extra-1)/2)*.2; r.bullets.push({...r.player,vx:Math.cos(angle)*380,vy:Math.sin(angle)*380,damage:damage*.5,radius:8,life:1.2,kind:'broom',hits:[],secondary:true}); }
          if (radial) {
            ring(r, r.player, 70, '#b7c999');
            if (linked) label(r, r.player, CLASS_LINKS.broom.name, '#c3ff9a');
          }
        }
        if (r.weapon === 'machine' && specs.capacitor) {
          const overcharged = linked && r.heat >= .75;
          if (shotNumber % (overcharged ? 8 : 12) === 0) {
            ring(r, r.player, 180, overcharged ? '#7fffe2' : '#e2cf88');
            for (const e of alive) if (e.hp > 0 && dist(e, r.player) < 180) hurt(r, e, 18 * specs.capacitor);
            if (overcharged) label(r, r.player, CLASS_LINKS.machine.name, '#7fffe2');
          }
        }
      }
      r.shot = weapon.interval * .9 ** r.upgrades.rapid * (r.weapon === 'machine' ? 1 - specs.spinup * .08 * r.heat : 1);
      r.cooldowns[r.weapon] = r.shot; sound(r, 'launch');
    }
  }
  const orbits = orbitPoints(r);
  r.pulseCd -= dt;
  if (r.upgrades.pulse && r.pulseCd <= 0) {
    r.pulseCd = Math.max(2, 7 - r.upgrades.pulse * .5); r.pulseRing = .6;
    for (const e of alive) if (dist(e, r.player) < 150) {
      hurt(r, e, 14 * r.upgrades.pulse); const d = Math.max(1, dist(e, r.player));
      e.x = clamp(e.x + (e.x - r.player.x) / d * 65, 40, WORLD - 40); e.y = clamp(e.y + (e.y - r.player.y) / d * 65, 40, WORLD - 40);
    }
    sound(r, 'wave');
  }
  for (const e of alive) {
    if (e.hp <= 0) continue;
    e.reaction = Math.max(0, (e.reaction ?? 0) - dt); e.chill = Math.max(0, (e.chill ?? 0) - dt);
    if ((e.burn ?? 0) > 0) {
      e.burn = Math.max(0, (e.burn ?? 0) - dt); e.burnTick = (e.burnTick ?? 0) + dt;
      if (e.burnTick >= .35) { hurt(r, e, (e.burnDps ?? 0) * e.burnTick); e.burnTick = 0; }
    }
    if (e.hp <= 0) continue;
    e.flash = Math.max(0, e.flash - dt); e.hit = Math.max(0, e.hit - dt); e.charge -= dt;
    const d = Math.max(.01, dist(e, r.player));
    const chargeSpeed = e.kind === 1 && e.charge < .4 ? 1.9 : 1;
    if (e.charge <= 0) e.charge = 3 + r.random();
    const slow = (e.chill ?? 0) > 0 ? 1 - (e.slow ?? 0) * (e.kind === 3 ? .5 : 1) : 1;
    e.x += (r.player.x - e.x) / d * e.speed * chargeSpeed * slow * dt;
    e.y += (r.player.y - e.y) / d * e.speed * chargeSpeed * slow * dt;
    if (orbits.some(o => dist(o, e) < e.radius + 12) && e.hit <= 0) { hurt(r, e, 16 * (1 + r.upgrades.power * .2)); e.hit = .45; }
    if (e.hp > 0 && d < e.radius + 15 && r.invincible <= 0) {
      r.hp = Math.max(0, r.hp - (e.kind === 3 ? 28 : e.kind === 2 ? 20 : 12)); r.invincible = .7; r.shake = 4; r.damageFlash = .28;
      burst(r, r.player, '#ef9da6', 12); sound(r, 'hit');
      e.x -= (r.player.x - e.x) / d * 25; e.y -= (r.player.y - e.y) / d * 25;
    }
  }
  // Resolve light separation without an unbounded all-pairs pass.
  const cells = new Map<string, Enemy[]>();
  for (const e of alive) {
    const cx = Math.floor(e.x / 60), cy = Math.floor(e.y / 60);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = dist(e, other), min = (e.radius + other.radius) * .88;
        if (d > .01 && d < min) { const push = (min - d) * .3; const nx = (e.x - other.x) / d, ny = (e.y - other.y) / d; e.x += nx * push; e.y += ny * push; other.x -= nx * push; other.y -= ny * push; }
      }
    }
    const key = `${cx},${cy}`; const bucket = cells.get(key) ?? []; bucket.push(e); cells.set(key, bucket);
  }
  for (const b of [...r.bullets]) {
    const arm = armamentOf(b.variant ?? STARTERS[b.kind]);
    const mode = b.explosiveFollowup ? 'projectile' : arm.mode;
    if ((b.delay ?? 0) > 0) { b.delay = Math.max(0,b.delay!-dt); if (arm.mode !== 'mine') { b.x=r.player.x;b.y=r.player.y;continue; } }
    if (mode==='mine') {
      b.life-=dt;
      const triggerRadius = b.secondary ? MINI_MINE_TRIGGER : 42;
      if (b.life > 0 && (b.delay ?? 0) <= 0 && alive.some(enemy => enemy.hp > 0 && dist(enemy, b) < triggerRadius + enemy.radius)) {
        detonate(r, b);
      }
      continue;
    }
    if (arm.homing === 'seek' && !b.secondary) {
      const targets = alive.filter(e => e.hp > 0 && !b.hits.includes(e.id) && dist(e,b)<300);
      if(targets.length){const target=targets.reduce((a,e)=>dist(a,b)<dist(e,b)?a:e),d=Math.max(.01,dist(target,b)),turn=1-Math.exp(-dt*5);b.vx+=((target.x-b.x)/d*arm.speed-b.vx)*turn;b.vy+=((target.y-b.y)/d*arm.speed-b.vy)*turn;}
    }
    if(arm.homing==='return' && !b.secondary && b.life<(b.duration??arm.life)*.55){const d=Math.max(1,dist(b,r.player)),turn=1-Math.exp(-dt*10);b.vx+=((r.player.x-b.x)/d*arm.speed*1.3-b.vx)*turn;b.vy+=((r.player.y-b.y)/d*arm.speed*1.3-b.vy)*turn;}
    const ox = b.x, oy = b.y;
    b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if(mode==='lob'){ if(b.life<=0){if(b.target)Object.assign(b,b.target);detonate(r,b);}continue; }
    const end = { x: b.x, y: b.y }, start = { x: ox, y: oy };
    // Snapshot geometry before any knockback, damage, explosion or direction change.
    const contacts = alive.filter(e => e.hp > 0 && !b.hits.includes(e.id)).map(e => ({ e, t: segmentCircleEntry(start, end, e, b.radius + e.radius) }))
      .filter((contact): contact is { e: Enemy; t: number } => contact.t !== null)
      .sort((a, c) => a.t - c.t || a.e.id - c.e.id);
    let stopped = false;
    for (const { e, t } of contacts) {
      if (e.hp <= 0 || b.hits.includes(e.id)) continue;
      b.x = ox + (end.x - ox) * t; b.y = oy + (end.y - oy) * t;
      if (b.kind === 'rocket') { detonate(r, b); stopped = true; break; }
      b.hits.push(e.id);
      applyImpact(r, e, b);
      if(b.kind==='broom'&&!b.secondary&&b.hits.length>=2&&b.specs?.reap&&r.leechCd.broom<=0){r.hp=Math.min(r.maxHp,r.hp+b.specs.reap);r.leechCd.broom=1;}
      const capacity=b.secondary?1:Math.min(8,arm.pierce+(b.kind==='pistol'?(b.specs?.silver??0):0)+(b.kind==='wand'?(b.traits?.ricochet??0)+Number(r.profession==='wand'):0));
      if (b.kind === 'wand' && !b.secondary && b.specs?.sigil && b.hits.length < capacity) {
        const linked = classLinkActive('wand', b.specs);
        b.damage *= 1 + b.specs.sigil * .12 + (linked ? .08 : 0);
        if (linked && b.hits.length === 1) label(r, e, CLASS_LINKS.wand.name, '#e8afff');
      }
      if(b.hits.length>=capacity){if(!redirect(r,b))b.life=0;stopped=true;break;}
      if(b.kind==='pistol'||arm.id==='prism')b.damage*=.8;
    }
    if (!stopped) {
      Object.assign(b, end);
      if (b.life <= 0 && b.kind === 'rocket') detonate(r, b);
    }
  }
  r.bullets = r.bullets.filter(b => b.life > 0); r.enemies = alive.filter(e => e.hp > 0 && (e.kind === 3 || dist(e, r.player) < 1000));
  const magnet = 70 * (1 + r.upgrades.magnet * .4);
  for (const g of r.gems) {
    g.life -= dt; const d = dist(g, r.player);
    if (d < magnet && d > 12) { const step = Math.min(d, (220 + magnet * 2) * dt); g.x += (r.player.x - g.x) / d * step; g.y += (r.player.y - g.y) / d * step; }
    if (d < 22) { if (g.heart) { r.hp = Math.min(r.maxHp, r.hp + g.value); label(r, r.player, '+生命', '#7aaa78'); } else { r.xp += g.value; r.score += g.value * 2; sound(r,'pickup'); } g.life = 0; }
  }
  r.gems = r.gems.filter(g => g.life > 0);
  for (const p of r.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 65 * dt; p.life -= dt; }
  r.particles = r.particles.filter(p => p.life > 0);
  for (const t of r.texts) { t.y -= dt * 24; t.life -= dt; } r.texts = r.texts.filter(t => t.life > 0);
  if (r.hp <= 0) r.phase = 'defeat';
  else if (r.time >= DURATION) r.phase = 'victory';
  else if (r.xp >= r.need) {
    r.xp -= r.need; r.level++; r.need = Math.round(5 + r.level * 2.7); r.choices = rollChoices(r);
    if (r.choices.length) r.phase = 'upgrade';
    r.hp = Math.min(r.maxHp, r.hp + 2); sound(r, 'wave');
  }
}
