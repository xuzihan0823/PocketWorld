import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { createRun, advance, dash, rollChoices, LIMITS } = createRequire(import.meta.url)('./dist/engine.cjs');
const enemy = (id, x, y = 1000, radius = 10) => ({ id, x, y, radius, kind: 0, hp: 10000, max: 10000, speed: 0, seed: 0, flash: 0, hit: 0, charge: 4 });
function arena(family = 'machine', variant = 'prism') {
  const r = createRun(() => .5, family, variant);
  r.shot = r.spawn = r.waveCd = r.hazardCd = 10000; r.invincible = 10000;
  return r;
}
function bullet(variant = 'prism', options = {}) {
  return { x: 1000, y: 1000, vx: 1800, vy: 0, life: 1, damage: 36, radius: 5, kind: 'machine', variant, hits: [], ...options };
}
test('living boss survives kiting beyond ordinary cleanup range, then rewards exactly once', () => {
  const r = arena(); r.time = 539.99; r.player.x = 300;
  advance(r, .02);
  const boss = r.enemies.find(e => e.kind === 3), id = boss.id;
  for (let i = 0; i < 210; i++) advance(r, .05, { x: 1, y: 0 });
  assert.ok(Math.hypot(boss.x - r.player.x, boss.y - r.player.y) > 1000);
  assert.equal(r.enemies.find(e => e.id === id), boss);
  assert.equal(boss.hp, 2400); assert.equal(r.kills, 0);
  r.enemies.push(enemy(9999, 50, 50)); advance(r, .01);
  assert.ok(!r.enemies.some(e => e.id === 9999));
  r.bullets = [bullet('prism', { x: boss.x, y: boss.y, vx: 0, damage: 3000 })];
  advance(r, .01); const score = r.score, gems = r.gems.length;
  assert.equal(r.kills, 1); assert.ok(!r.enemies.includes(boss));
  for (let i = 0; i < 10; i++) advance(r, .05);
  assert.equal(r.kills, 1); assert.equal(r.score, score); assert.equal(r.gems.length, gems);
  r.time = 599.99; advance(r, .02); assert.equal(r.phase, 'victory');
});
for (const dt of [1 / 60, 1 / 30, .05]) for (const variant of ['prism', 'rail']) {
  test(`${variant} resolves path order for reversed enemy arrays at ${dt}s`, () => {
    const results = [];
    for (const reverse of [false, true]) {
      const family = variant === 'rail' ? 'pistol' : 'machine', r = arena(family, variant);
      const near = enemy(1, 1030), far = enemy(2, 1070);
      r.enemies = reverse ? [far, near] : [near, far];
      const b = bullet(variant, { vx: 90 / dt, kind: family, damage: variant === 'rail' ? 55 : 36 }); r.bullets = [b];
      advance(r, dt);
      assert.deepEqual(b.hits, [1, 2]);
      results.push([10000 - near.hp, 10000 - far.hp]);
    }
    assert.deepEqual(results[0], results[1]); assert.ok(results[0][0] > results[0][1]);
  });
}
test('ordinary projectiles stop at the first blocker and rockets explode at entry, not frame end', () => {
  const r = arena('rocket', 'launcher');
  r.enemies = [enemy(2, 940, 1000, 5), enemy(1, 1040)];
  r.bullets = [bullet('launcher', { kind: 'rocket', radius: 9, damage: 40 })];
  advance(r, .05);
  assert.equal(r.blasts.length, 1); assert.equal(r.blasts[0].x, 1021);
  assert.equal(r.enemies[0].hp, 9960); assert.equal(r.bullets.length, 0);
  const p = arena('pistol', 'hex'), b = bullet('hex', { kind: 'pistol' });
  p.enemies = [enemy(2, 1070), enemy(1, 1030)]; p.bullets = [b]; advance(p, .05);
  assert.deepEqual(b.hits, [1]); assert.equal(p.enemies[0].hp, 10000);
});
test('ricochet changes direction at impact and cannot consume stale straight-line candidates', () => {
  const r = arena('pistol', 'hex'), b = bullet('hex', { kind: 'pistol', traits: { ricochet: 3 } });
  r.enemies = [enemy(1, 1030), enemy(2, 1015, 1050), enemy(3, 1070)]; r.bullets = [b];
  advance(r, .05); assert.deepEqual(b.hits, [1]); assert.equal(b.x, 1015); assert.ok(b.vy > 0);
  advance(r, .05); assert.ok(b.hits.includes(2)); assert.ok(!b.hits.includes(3));
});
for (const variant of ['launcher', 'mortar', 'mine']) for (const rank of [0, 1, 2, 3]) {
  test(`${variant} explosive ricochet rank ${rank} keeps one diminishing chain`, () => {
    const r = arena('rocket', variant);
    // One fresh target per hop, each outside the preceding blast but within ricochet reach.
    r.enemies = [0, 1, 2, 3, 4].map(i => enemy(i + 1, 1040 + i * 190));
    const b = bullet(variant, { kind: 'rocket', vx: variant === 'launcher' ? 200 : 0, damage: 100, radius: 9,
      life: variant === 'mortar' ? .01 : 8, x: variant === 'mine' ? 1040 : 1000,
      target: { x: 1040, y: 1000 }, traits: { ricochet: rank } });
    r.bullets = [b];
    let maxBlasts = 0;
    for (let i = 0; i < 120; i++) { advance(r, .05); maxBlasts = Math.max(maxBlasts, r.blasts.length); }
    for (let i = 0; i < 5; i++) {
      const expected = i <= rank ? 100 * .65 ** i : 0;
      assert.ok(Math.abs((10000 - r.enemies[i].hp) - expected) < 1e-6, `target ${i + 1}: ${10000 - r.enemies[i].hp} vs ${expected}`);
    }
    assert.equal(b.bounces ?? 0, rank); assert.equal(r.bullets.length, 0); assert.ok(maxBlasts <= rank + 1);
  });
}
test('explosive chain ends with no fresh targets, including when projectile budget is full', () => {
  for (const variant of ['launcher', 'mortar', 'mine']) {
    const r = arena('rocket', variant), target = enemy(1, 1040);
    r.enemies = [target, { ...enemy(2, 1230), hp: 0 }];
    const b = bullet(variant, { x: 1040, vx: 0, kind: 'rocket', life: variant === 'mine' ? 8 : .01, damage: 10, traits: { ricochet: 3 } });
    r.bullets = [b, ...Array.from({ length: LIMITS.bullets - 1 }, () => bullet('mine', { kind: 'rocket', x: 400, y: 400, vx: 0, life: 10, secondary: true }))];
    advance(r, .02); assert.equal(target.hp, 9990); assert.ok(b.life <= 0); assert.ok(r.bullets.length <= LIMITS.bullets);
    for (let i = 0; i < 10; i++) advance(r, .05);
    assert.equal(target.hp, 9990); assert.equal(r.enemies.length, 1);
  }
});
test('overlapping primary explosions cannot damage a prior target twice', () => {
  const r = arena('rocket', 'mortar');
  const a = enemy(1, 1040), b = enemy(2, 1180);
  r.enemies = [a, b]; r.bullets = [bullet('mortar', { kind: 'rocket', vx: 0, damage: 100, life: .01, target: { x: 1040, y: 1000 }, traits: { ricochet: 3 } })];
  for (let i = 0; i < 60; i++) advance(r, .05);
  assert.equal(a.hp, 9900); assert.equal(b.hp, 9935); assert.equal(r.bullets.length, 0);
});
test('a full bullet pool still lets the original mine chain continue without allocating a new charge', () => {
  const r = arena('rocket', 'mine'), a = enemy(1, 1040), b = enemy(2, 1230);
  r.enemies = [a,b];
  const charge = bullet('mine', { x: 1040, vx: 0, kind: 'rocket', damage: 100, life: 8, traits: { ricochet: 1 } });
  r.bullets = [charge, ...Array.from({length: LIMITS.bullets - 1},()=>bullet('mine',{x:400,y:400,vx:0,kind:'rocket',life:10,secondary:true}))];
  advance(r,.05); assert.ok(r.bullets.includes(charge)); assert.equal(r.bullets.length,LIMITS.bullets);
  for(let i=0;i<60;i++)advance(r,.05);
  assert.equal(a.hp,9900);assert.equal(b.hp,9935);assert.ok(r.bullets.length<LIMITS.bullets);
});
test('diagonal hits and overlapping starting contacts use a stable ID tie break', () => {
  for (const reverse of [false,true]) {
    const r=arena(), a=enemy(10,1030,1030), b=enemy(20,1070,1070);
    r.enemies=reverse?[b,a]:[a,b]; const shot=bullet('prism',{vy:1800});r.bullets=[shot];advance(r,.05);
    assert.deepEqual(shot.hits,[10,20]);
    const z=arena(), first=enemy(1,1000,990), second=enemy(2,1000,1010);
    z.enemies=reverse?[second,first]:[first,second]; const stationary=bullet('prism',{vx:0});z.bullets=[stationary];advance(z,.05);
    assert.deepEqual(stationary.hits,[1,2]);
  }
});
test('a contact killed by an earlier chain proc is skipped before piercing resolution', () => {
  const r=arena();r.random=()=>.1;
  r.enemies=[{...enemy(1,1030),hp:10},{...enemy(2,1070),hp:10}];
  const b=bullet('prism',{traits:{chain:3}});r.bullets=[b];advance(r,.05);
  assert.equal(r.kills,2);assert.deepEqual(b.hits,[1]);
});
for (const rank of [1, 3]) {
  test(`rank ${rank} whirl starts a third melee attack inside its extended reach`, () => {
    const r = arena('broom', 'lance'); r.shot = 0; r.specials.whirl = rank; r.shotCounts.broom = 2;
    const target = enemy(1, 1000 + 185 + rank * 12 - 1); r.enemies = [target];
    advance(r, .001);
    assert.equal(r.shotCounts.broom, 3); assert.ok(target.hp < target.max);
    const plain = arena('broom', 'lance'); plain.shot = 0; plain.enemies = [enemy(1, 1000 + 185 + rank * 12 - 1)];
    advance(plain, .001); assert.equal(plain.shotCounts.broom, 0);
  });
}

test('witchstep starts a melee attack in its dash-only extended reach', () => {
  const r = arena('broom', 'lance'); r.shot = 0; r.specials.witchstep = 1;
  const target = enemy(1, 1205); r.enemies = [target];
  assert.ok(dash(r, { x: 0, y: 1 })); advance(r, .001);
  assert.equal(r.shotCounts.broom, 1); assert.ok(target.hp < target.max); assert.equal(r.witchCharge, 0);
});

for (const [variant, twin, rank] of [['star', 0, 1], ['star', 2, 1], ['frostfan', 2, 3], ['moon', 1, 2]]) {
  test(`${variant} familiar rank ${rank} aims its bonus group at the other target with twin ${twin}`, () => {
    const r = arena('wand', variant); r.shot = 0; r.shotCounts.wand = 2;
    r.specials.familiar = rank; r.specials.twin = twin;
    const other = enemy(2, 1000, 1400, 18); r.enemies = [enemy(1, 1100), other];
    advance(r, .001); r.shot = 10000;
    const bonus = r.bullets.filter(b => b.secondary); assert.equal(bonus.length, rank);
    const vx = bonus.reduce((sum, b) => sum + b.vx, 0), vy = bonus.reduce((sum, b) => sum + b.vy, 0);
    assert.ok(Math.abs(Math.atan2(vy, vx) - Math.PI / 2) < 1e-9);
    if (variant === 'star') {
      r.bullets = bonus;
      for (let i = 0; i < 100; i++) advance(r, .02);
      assert.ok(other.hp < other.max, 'the non-homing familiar must actually hit its intended target');
    }
  });
}

test('launcher cluster hits every enemy in a short cone along the incoming rocket', () => {
  const r = arena('rocket', 'mine');
  const near = enemy(1, 1000, 958), far = enemy(2, 1000, 890);
  const rear = enemy(3, 1000, 1040), side = enemy(4, 1050, 970);
  const outside = enemy(5, 1000, 875);
  r.enemies = [near, far, rear, side, outside];
  r.bullets = [bullet('launcher', { kind: 'rocket', vx: 0, vy: -100, life: .01, damage: 100, specs: { cluster: 2 } })];

  advance(r, .02);

  assert.equal(near.hp, 9872);
  assert.equal(far.hp, 9972);
  assert.equal(rear.hp, 9900);
  assert.equal(side.hp, 9900);
  assert.equal(outside.hp, 10000);
  assert.equal(r.bullets.length, 0);
  assert.equal(r.blasts.find(blast => blast.coneAngle !== undefined)?.coneAngle, -Math.PI / 2);
});

test('mortar cluster still launches three short-lived rockets with the original damage and speed', () => {
  const r = arena('rocket', 'mortar');
  r.bullets = [bullet('mortar', { kind: 'rocket', vx: 0, life: .01, damage: 100, target: { x: 1040, y: 1000 }, specs: { cluster: 2 } })];

  advance(r, .02);

  assert.equal(r.blasts[0].radius, 118 * 1.1);
  assert.equal(r.bullets.length, 3);
  for (const child of r.bullets) {
    assert.ok(child.secondary);
    assert.equal(child.variant, 'launcher');
    assert.equal(child.life, .4);
    assert.ok(Math.abs(child.damage - 28) < 1e-9);
    assert.ok(Math.abs(Math.hypot(child.vx, child.vy) - 200) < 1e-9);
  }
  for (let i = 0; i < 10; i++) advance(r, .05);
  assert.equal(r.bullets.length, 0);
  assert.equal(r.blasts.filter(blast => blast.radius === 82 * .58 * 1.1).length, 3);
});

test('mine cluster places three smaller mines that arm and explode independently', () => {
  const r = arena('rocket', 'mine');
  r.enemies = [enemy(1, 1040)];
  r.bullets = [bullet('mine', { x: 1040, kind: 'rocket', vx: 0, damage: 100, life: 8, specs: { cluster: 2 } })];

  advance(r, .02);

  const children = [...r.bullets];
  assert.equal(children.length, 3);
  for (const [i, child] of children.entries()) {
    assert.ok(child.secondary);
    assert.equal(child.variant, 'mine');
    assert.equal(child.delay, .35);
    assert.equal(child.life, 5);
    assert.equal(Math.hypot(child.vx, child.vy), 0);
    assert.ok(Math.abs(Math.hypot(child.x - 1040, child.y - 1000) - 62) < 1e-9);
    const other = children[(i + 1) % children.length];
    assert.ok(Math.abs(Math.hypot(child.x - other.x, child.y - other.y) - 62 * Math.sqrt(3)) < 1e-9);
  }

  const [child, second, third] = children;
  const close = enemy(2, child.x, child.y);
  const outside = enemy(3, child.x + 75, child.y);
  const outsideTrigger = enemy(4, second.x - 40, second.y);
  r.enemies = [close, outside, outsideTrigger];
  for (let i = 0; i < 6; i++) advance(r, .05);
  assert.equal(close.hp, 10000);
  for (let i = 0; i < 3; i++) advance(r, .05);
  assert.equal(close.hp, 9972);
  assert.equal(outside.hp, 10000);
  assert.equal(outsideTrigger.hp, 10000);
  assert.deepEqual(r.bullets, [second, third]);
  assert.ok(r.blasts.some(blast => blast.radius === 95 * .55 * 1.1));
});

test('an armed mine cannot trigger on a tick after its remaining lifetime runs out', () => {
  for (const secondary of [false, true]) {
    const r = arena('rocket', 'mine');
    const target = enemy(1, 1040);
    r.enemies = [target];
    r.bullets = [bullet('mine', { x: 1040, kind: 'rocket', vx: 0, life: .01, secondary })];
    advance(r, .05);
    assert.equal(target.hp, target.max);
    assert.equal(r.bullets.length, 0);
    assert.equal(r.blasts.length, 0);
  }
});

test('cluster card describes the currently equipped alchemist weapon', () => {
  for (const [variant, description] of [['launcher', /短锥爆风/], ['mortar', /小火箭/], ['mine', /小地雷/]]) {
    const r = arena('rocket', variant);
    r.specials.embers = 1;
    assert.match(rollChoices(r).find(choice => choice.id === 'cluster')?.description ?? '', description);
  }
});

test('a follow-up whose target dies expires without resurrecting a mine or looping explosions', () => {
  for(const variant of ['launcher','mortar','mine']) {
    const r=arena('rocket',variant), a=enemy(1,1040), target=enemy(2,1230);
    r.enemies=[a,target];const b=bullet(variant,{x:1040,vx:0,kind:'rocket',life:variant==='mine'?8:.01,target:{x:1040,y:1000},traits:{ricochet:3}});r.bullets=[b];
    advance(r,.02);assert.equal(b.bounces,1);target.hp=0;
    for(let i=0;i<60;i++)advance(r,.05);
    assert.equal(b.bounces,1);assert.equal(r.bullets.length,0);assert.equal(a.hp,9964);
  }
});
