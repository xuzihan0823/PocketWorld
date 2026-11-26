import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { createRun, advance, dash, chooseUpgrade, rollChoices, upgradeRank, UPGRADES, LIMITS, SPECIALS, PROFESSIONS, rerollUpgrades, ARSENAL, switchVariant } = require('./dist/engine.cjs');
let seed = 91827;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const enemy = (r, options = {}) => ({ id: 1, x: r.player.x + 50, y: r.player.y, kind: 0, hp: 15, max: 15, radius: 18, speed: 0, seed: 0, flash: 0, hit: 0, charge: 4, ...options });
test('movement is normalized and clamped; dash has invincibility and a cooldown', () => {
  const a = createRun(random), b = createRun(random);
  advance(a,.05,{x:1,y:0}); advance(b,.05,{x:1,y:1});
  assert.ok(Math.abs(Math.hypot(b.player.x-1000,b.player.y-1000)-(a.player.x-1000)) < 1e-6);
  assert.ok(dash(a,{x:1,y:0})); assert.ok(a.invincible > 0); assert.equal(dash(a,{x:1,y:0}),false);
  a.player.x=1930; advance(a,.05,{x:1,y:0}); assert.equal(a.player.x,1930);
});
test('nearest-target star fire kills an enemy and creates collectible experience', () => {
  const r=createRun(random); r.enemies=[enemy(r)]; r.shot=0; r.spawn=100;
  for(let i=0;i<10;i++) advance(r,.05);
  assert.equal(r.kills,1); assert.ok(r.score>0); assert.equal(r.xp,1);
});
test('level-up freezes every object and only offered upgrades can resume play', () => {
  const r=createRun(random); r.xp=r.need; advance(r,.016);
  assert.equal(r.phase,'upgrade'); assert.equal(r.choices.length,3); assert.equal(new Set(r.choices.map(u=>u.id)).size,3);
  const before=JSON.stringify(r); advance(r,.05,{x:1,y:1}); assert.equal(JSON.stringify(r),before);
  assert.equal(chooseUpgrade(r,'invalid'),false); assert.ok(chooseUpgrade(r,r.choices[0].id)); assert.equal(r.phase,'playing');
});
test('all eight upgrades apply; orbit and pulse deal damage; healing increases max HP', () => {
  for(const u of UPGRADES){ const r=createRun(random); r.phase='upgrade';r.choices=[u];r.hp=50;
    assert.ok(chooseUpgrade(r,u.id));assert.equal(r.upgrades[u.id],1);
    if(u.id==='heart'){assert.equal(r.maxHp,115);assert.equal(r.hp,75);}
  }
  for(const id of ['orbit','pulse']){ const r=createRun(random);r.upgrades[id]=1;r.shot=100;r.spawn=100;r.pulseCd=0;
    r.enemies=[enemy(r,{x:r.player.x+(id==='orbit'?71:45),hp:10})];advance(r,.01);assert.equal(r.kills,1);
  }
});
test('boss can spawn at cap; defeat and victory are terminal', () => {
  const r=createRun(random); r.time=540;r.spawn=100;
  r.enemies=Array.from({length:LIMITS.enemies},(_,i)=>enemy(r,{id:i+1,x:1400+i}));advance(r,.01);
  assert.ok(r.enemies.some(e=>e.kind===3));assert.ok(r.enemies.length<=LIMITS.enemies);
  r.time=599.99;r.invincible=10;advance(r,.02);assert.equal(r.phase,'victory');
  const before=JSON.stringify(r);advance(r,.05);assert.equal(JSON.stringify(r),before);
  const d=createRun(random);d.hp=0;advance(d,.01);assert.equal(d.phase,'defeat');
});
test('ten-minute stress simulation keeps counts bounded and coordinates finite', () => {
  const r=createRun(random);let choices=0,maxEnemies=0;
  for(let i=0;i<48010 && r.phase!=='victory';i++){
    if(r.phase==='upgrade'){chooseUpgrade(r,r.choices[0].id);choices++;}
    r.invincible=1; // Stress-test the whole run independently of player skill.
    const gem=r.gems.find(g=>!g.heart);const t=r.time;
    const input=gem?{x:gem.x-r.player.x,y:gem.y-r.player.y}:{x:Math.cos(t*.1),y:Math.sin(t*.1)};
    if(i%83===0)switchVariant(r);
    advance(r,1/60,input);r.sounds.length=0;maxEnemies=Math.max(maxEnemies,r.enemies.length);
    for(const [key,limit] of Object.entries(LIMITS))assert.ok(r[key].length<=limit,`${key} cap`);
    for(const p of [r.player,...r.enemies,...r.bullets,...r.gems])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  }
  assert.equal(r.phase,'victory');assert.ok(choices>0);console.log({choices,kills:r.kills,maxEnemies});
});
test('machine gun fires substantially faster than pistol; switching preserves reload', () => {
  const shots={};
  for(const id of ['pistol','machine']){
    const r=createRun(random,id);r.enemies=[enemy(r,{x:1350,hp:100000,max:100000})];r.shot=0;r.spawn=100;
    let count=0;for(let i=0;i<60;i++){advance(r,1/60);count+=r.sounds.filter(s=>s==='launch').length;r.sounds.length=0;}shots[id]=count;
  }
  assert.ok(shots.machine>=shots.pistol*3);
  const r=createRun(random,'rocket');r.enemies=[enemy(r,{x:1350,hp:10000})];r.shot=0;r.spawn=100;advance(r,.01);
  assert.equal(r.bullets.length,1);switchVariant(r,'mortar');switchVariant(r,'launcher');advance(r,.01);
  assert.equal(r.bullets.length,1);assert.ok(r.shot>1);assert.equal(r.bullets[0].kind,'rocket');
});
test('rocket explodes exactly once and hits a group; expired rockets also explode', () => {
  const r=createRun(random,'rocket');r.shot=0;r.spawn=100;
  r.enemies=[enemy(r,{x:1080,y:1000}),enemy(r,{id:2,x:1100,y:1045}),enemy(r,{id:3,x:1110,y:980})];
  for(let i=0;i<12;i++)advance(r,.02);
  assert.equal(r.kills,3);assert.equal(r.blasts.length,1);
  const e=createRun(random,'rocket');e.shot=100;e.spawn=100;e.bullets=[{x:1000,y:1000,vx:0,vy:0,life:.01,damage:64,radius:9,kind:'rocket',hits:[]}];advance(e,.02);assert.equal(e.blasts.length,1);assert.equal(e.bullets.length,0);
});
test('wand pierces four distinct enemies without repeat damage, and curves toward a target', () => {
  const r=createRun(random,'wand');r.spawn=100;r.shot=100;
  r.enemies=Array.from({length:4},(_,i)=>enemy(r,{id:i+1,x:1050+i*48,hp:100,max:100}));
  r.bullets=[{x:1000,y:1000,vx:265,vy:0,life:2.6,damage:24,radius:10,kind:'wand',hits:[]}];
  for(let i=0;i<70;i++)advance(r,.016);
  assert.deepEqual(r.enemies.map(e=>e.hp),[76,76,76,76]);assert.equal(r.bullets[0].hits.length,4);
  const h=createRun(random,'wand');h.spawn=100;h.shot=100;h.enemies=[enemy(h,{x:1100,y:1080,hp:100})];h.bullets=[{x:1000,y:1000,vx:265,vy:0,life:2,damage:24,radius:10,kind:'wand',hits:[]}];advance(h,.05);assert.ok(h.bullets[0].vy>0);
});
test('broom sweeps and knocks back only enemies in its forward cone', () => {
  const r=createRun(random,'broom');r.spawn=100;r.shot=0;
  r.enemies=[enemy(r,{x:1060,hp:100,max:100}),enemy(r,{id:2,x:1080,y:1050,hp:100,max:100}),enemy(r,{id:3,x:910,hp:100,max:100})];
  advance(r,.01);assert.equal(r.enemies[0].hp,70);assert.equal(r.enemies[1].hp,70);assert.equal(r.enemies[2].hp,100);assert.ok(r.enemies[0].x>1100);assert.equal(r.bullets.length,0);assert.ok(r.sweep>0);
});
const training = () => { const r=createRun(random);r.spawn=1000;r.shot=1000;r.enemies=[enemy(r,{x:1050,hp:10000,max:10000})];return r; };
const impact = (r, traits, kind='pistol') => { r.bullets.push({x:1030,y:1000,vx:200,vy:0,life:1,damage:30,radius:6,kind,hits:[],traits:{burn:0,frost:0,chain:0,ricochet:0,split:0,crit:0,vampire:0,...traits}});advance(r,.02); };
test('draft offers two bound weapon traits and one support; ranks and weapon ownership persist', () => {
  const r=createRun(random,'rocket');r.phase='upgrade';r.choices=rollChoices(r);
  assert.equal(r.choices.filter(c=>SPECIALS.some(s=>s.id===c.id&&s.weapon==='rocket')).length,2);
  const card=r.choices.find(c=>SPECIALS.some(s=>s.id===c.id));assert.equal(switchVariant(r,'mortar'),false);
  assert.ok(chooseUpgrade(r,card.id));assert.equal(upgradeRank(r,card),1);assert.equal(r.specials[card.id],1);
  switchVariant(r,'mortar');switchVariant(r,'launcher');assert.equal(r.specials[card.id],1);
  Object.keys(r.enchants.rocket).forEach(id=>r.enchants.rocket[id]=3);SPECIALS.filter(s=>s.weapon==='rocket').forEach(s=>r.specials[s.id]=3);assert.ok(rollChoices(r).every(c=>!c.weapon));
});
test('burn continues after the shot, frost slows enemies, and combined hits make one steam reaction', () => {
  const r=training();impact(r,{burn:1,frost:1});assert.ok(r.enemies[0].burn>0);assert.ok(r.enemies[0].chill>0);assert.equal(r.blasts.length,1);
  const before=r.enemies[0].hp;for(let i=0;i<30;i++)advance(r,.02);assert.ok(r.enemies[0].hp<before);
  const cold=training(),plain=training();cold.enemies[0].speed=plain.enemies[0].speed=30;impact(cold,{frost:1});impact(plain,{});
  for(let i=0;i<15;i++){advance(cold,.02);advance(plain,.02);}assert.ok(cold.enemies[0].x>plain.enemies[0].x);
  const area=training();area.random=()=>0;area.enemies=Array.from({length:6},(_,i)=>enemy(area,{id:i+1,x:1050+i*8,hp:10000,max:10000}));impact(area,{burn:1,frost:1},'rocket');assert.equal(area.blasts.length,2,'one rocket ring plus one reaction, not six nested reactions');
});
test('chain + ricochet reaches more enemies; split children cannot recursively proc', () => {
  const r=training();r.random=()=>0;r.enemies.push(enemy(r,{id:2,x:1120,hp:10000}),enemy(r,{id:3,x:1190,hp:10000}));
  impact(r,{chain:1,ricochet:1});assert.equal(r.arcs.length,2);assert.ok(r.enemies[2].hp<10000);
  const s=training();s.random=()=>0;impact(s,{split:3});assert.equal(s.bullets.length,2);assert.ok(s.bullets.every(b=>b.secondary));
  for(let i=0;i<60;i++)advance(s,.02);assert.ok(s.bullets.length<=2);
});
test('crit against frost shatters; healing is rate-limited separately per weapon', () => {
  const r=training();r.random=()=>0;r.enemies[0].chill=1;impact(r,{crit:1,frost:1});assert.ok(r.damageDealt>51);assert.ok(r.texts.some(t=>t.label==='碎冰！'));
  const h=training();h.hp=50;impact(h,{vampire:3},'machine');const first=h.hp;impact(h,{vampire:3},'machine');assert.equal(h.hp,first);
  impact(h,{vampire:3},'pistol');assert.ok(h.hp>first);assert.ok(h.hp<54);
});
test('bouncing bullets hit a new target with diminishing damage and retain source enchantments', () => {
  const r=training();r.enemies.push(enemy(r,{id:2,x:1140,hp:10000,max:10000}));impact(r,{ricochet:1,burn:1});
  assert.equal(r.bullets.length,1);assert.ok(r.bullets[0].damage<30);switchVariant(r,'scatter');r.enchants.pistol.burn=0;
  for(let i=0;i<30;i++)advance(r,.02);assert.ok(r.enemies[1].hp<10000);assert.ok(r.enemies[1].burn>0);assert.equal(r.enchants.pistol.burn,0);
});
test('wave pressure increases and ground hazards warn before damaging a stationary player', () => {
  const r=createRun(random);r.spawn=1000;r.time=44.99;r.waveCd=.01;advance(r,.02);assert.equal(r.wave,2);assert.ok(r.enemies.length>=8);
  const h=createRun(random);h.spawn=1000;h.waveCd=1000;h.time=90;h.hazardCd=0;advance(h,.02);assert.equal(h.hazards.length,1);assert.equal(h.hp,100);
  for(let i=0;i<23;i++)advance(h,.05);assert.equal(h.hp,100);
  for(let i=0;i<4;i++)advance(h,.05);assert.equal(h.hp,84);
});
test('each locked profession remains bounded through ten minutes with max-rank skills and rotating variants', () => {
  for(const family of Object.keys(PROFESSIONS)){
  const r=createRun(random,family);Object.values(r.enchants).forEach(e=>Object.keys(e).forEach(id=>e[id]=3));Object.keys(r.specials).forEach(id=>r.specials[id]=3);
  Object.assign(r.upgrades,{power:4,rapid:4,spread:2,orbit:3,magnet:3,boots:3,heart:3,pulse:3});r.need=1e9;
  for(let i=0;i<48010&&r.phase!=='victory';i++){
    r.invincible=1;if(i%83===0)switchVariant(r);
    advance(r,1/60,{x:Math.cos(r.time*.14),y:Math.sin(r.time*.14)});r.sounds.length=0;
    for(const [key,limit]of Object.entries(LIMITS))assert.ok(r[key].length<=limit,key);
    for(const b of r.bullets){assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y)&&Number.isFinite(b.damage));assert.ok(b.hits.length<=(b.kind==='rocket'?LIMITS.enemies*4:8));assert.equal(new Set(b.hits).size,b.hits.length);}
    assert.ok(Number.isFinite(r.damageDealt));
  }
  assert.equal(r.phase,'victory');assert.ok(r.kills>100,family);assert.equal(r.weapon,family);assert.equal(r.profession,family);
  }
});
const ready = (weapon) => { const r=createRun(random,weapon);r.spawn=1000;r.waveCd=1000;r.shot=0;r.enemies=[enemy(r,{hp:10000,max:10000})];return r; };
test('five professions persist across swaps and own four distinct specialization cards each',()=>{
  assert.equal(new Set(Object.values(PROFESSIONS).map(p=>p.name)).size,5);
  for(const w of ['pistol','machine','rocket','wand','broom']){
    const r=ready(w);switchVariant(r);assert.equal(r.profession,w);assert.equal(r.weapon,w);
    for(const arm of ARSENAL.filter(a=>a.family!==w))assert.equal(switchVariant(r,arm.id),false);
    assert.equal(SPECIALS.filter(s=>s.weapon===w).length,4);
    const choices=rollChoices(r);const cards=choices.filter(c=>SPECIALS.some(s=>s.id===c.id));assert.equal(cards.length,2);assert.ok(cards.every(c=>c.weapon===w));
  }
});
test('ranger sixth-round and silver penetration change pistol attacks',()=>{
  const r=ready('pistol');r.specials.sixth=1;r.shotCounts.pistol=5;advance(r,.01);assert.equal(r.bullets[0].damage,54);
  const p=ready('pistol');p.specials.silver=1;p.enemies.push(enemy(p,{id:2,x:1120,hp:10000,max:10000}));advance(p,.01);p.shot=100;
  for(let i=0;i<30;i++)advance(p,.01);assert.ok(p.enemies[1].hp<10000);assert.ok(p.enemies[0].hp<p.enemies[1].hp);
  const e=ready('pistol');e.specials.deadeye=3;e.random=()=>0;advance(e,.01);e.shot=100;for(let i=0;i<15;i++)advance(e,.01);assert.ok(e.texts.some(t=>t.label==='暴击！'));
});
test('engineer supports spin-up, anchored damage, bonus salvo and periodic discharge',()=>{
  const r=ready('machine');r.heat=1;r.specials.spinup=3;r.specials.stabilizer=2;r.specials.salvo=2;r.shotCounts.machine=5;advance(r,.01);
  assert.ok(r.shot<.12);assert.equal(r.bullets.length,3);assert.ok(r.bullets[0].damage>7);
  const c=ready('machine');c.specials.capacitor=2;c.shotCounts.machine=11;advance(c,.01);assert.equal(c.enemies[0].hp,9964);assert.ok(c.blasts.length>0);
});
test('alchemist launcher cone leaves linked damaging embers and a fuse burst',()=>{
  const r=ready('rocket');r.specials.cluster=2;r.specials.embers=1;r.specials.fuse=1;r.enemies[0].hp=1;r.enemies.push(enemy(r,{id:2,x:1085,hp:10000,max:10000}));
  advance(r,.05);advance(r,.05);assert.equal(r.bullets.length,0);assert.equal(r.fields.length,1);assert.ok(r.fields[0].life>3.9);assert.equal(r.blasts.length,3);assert.ok(r.blasts.some(b=>b.coneAngle!==undefined));
  const survivor=r.enemies.find(e=>e.id===2), hp=survivor.hp;
  survivor.x=r.fields[0].x;survivor.y=r.fields[0].y;r.shot=100;
  for(let i=0;i<15;i++)advance(r,.05);
  assert.ok(Math.abs(hp-survivor.hp-3.6)<1e-9);assert.equal(r.bullets.length,0);
});
test('arcanist twins, familiar and sigils change spell count and penetration damage',()=>{
  const r=ready('wand');r.specials.twin=2;r.specials.familiar=1;r.shotCounts.wand=2;advance(r,.01);assert.equal(r.bullets.length,4);assert.ok(r.bullets.some(b=>b.secondary));
  const s=ready('wand');s.specials.sigil=2;s.enemies.push(enemy(s,{id:2,x:1100,hp:10000,max:10000}));advance(s,.01);s.shot=100;for(let i=0;i<40;i++)advance(s,.01);assert.ok(10000-s.enemies[1].hp>10000-s.enemies[0].hp);
});
test('witch can launch ranged wind blades, whirl behind her and enhance attacks after dashing',()=>{
  const g=ready('broom');g.enemies[0].x=1300;g.specials.gale=2;advance(g,.01);assert.equal(g.bullets.length,2);
  const w=ready('broom');w.specials.whirl=1;w.specials.reap=2;w.hp=50;w.shotCounts.broom=2;w.enemies.push(enemy(w,{id:2,x:910,hp:10000,max:10000}));advance(w,.01);assert.ok(w.enemies[1].hp<10000);assert.equal(w.hp,52);
  const d=ready('broom');d.specials.witchstep=2;dash(d,{x:1,y:0});advance(d,.01);assert.ok(d.enemies[0].hp<=9952);assert.equal(d.witchCharge,0);
});
test('card refresh costs a limited charge and heavy hits produce a bounded simulation stop',()=>{
  const r=ready('rocket');r.phase='upgrade';r.choices=rollChoices(r);const old=r.choices.map(c=>c.id).sort().join(',');assert.ok(rerollUpgrades(r));assert.notEqual(r.choices.map(c=>c.id).sort().join(','),old);assert.equal(r.rerolls,1);
  assert.ok(rerollUpgrades(r));assert.equal(r.rerolls,0);assert.equal(rerollUpgrades(r),false);
  const h=ready('pistol');h.enemies[0].hp=1;for(let i=0;i<12&&h.kills===0;i++)advance(h,.01);assert.ok(h.hitStop>0);const before=h.time;advance(h,.01);assert.equal(h.time,before);
});


test('all five classes own exactly three unique, playable armaments',()=>{
  assert.equal(ARSENAL.length,15);assert.equal(new Set(ARSENAL.map(a=>a.id)).size,15);
  for(const family of Object.keys(PROFESSIONS)){
    const list=ARSENAL.filter(a=>a.family===family);assert.equal(list.length,3);
    for(const a of list){const r=createRun(random,family,a.id);r.spawn=1000;r.shot=0;r.enemies=[enemy(r,{x:1100,hp:1e5,max:1e5})];advance(r,.01);assert.equal(r.variant,a.id);assert.ok(r.shot>0);assert.ok(r.sweep>0||r.bullets.length>0,a.id);}
  }
});
test('variant swaps share reload, reject other professions and preserve skills',()=>{
  const r=ready('rocket');r.specials.cluster=2;advance(r,.01);const reload=r.shot;
  assert.ok(switchVariant(r,'mortar'));assert.equal(r.shot,reload);assert.equal(r.bullets.length,1);
  assert.equal(switchVariant(r,'rail'),false);assert.equal(switchVariant(r,'star'),false);
  assert.equal(r.variant,'mortar');assert.equal(r.profession,'rocket');assert.equal(r.specials.cluster,2);
  r.phase='upgrade';assert.equal(switchVariant(r),false);
  assert.equal(createRun(random,'wand','mine').variant,'star');
});
const variantReady=(family,id)=>{const r=createRun(()=>.5,family,id);r.spawn=1000;r.waveCd=1000;r.shot=0;r.enemies=[enemy(r,{x:1160,hp:1e5,max:1e5})];return r;};
test('shotgun fans five pellets; burst gun releases three sequential rounds',()=>{
  const s=variantReady('pistol','scatter');advance(s,.01);assert.equal(s.bullets.length,5);assert.equal(new Set(s.bullets.map(b=>b.vy)).size,5);
  const r=variantReady('machine','burst');advance(r,.01);r.shot=100;assert.equal(r.bullets.length,3);assert.equal(r.bullets.filter(b=>(b.delay??0)>0).length,2);
  const pending=r.bullets[1];advance(r,.04);assert.equal(pending.x,r.player.x);advance(r,.05);advance(r,.01);assert.ok(pending.x>r.player.x);
});
test('long rifle and prism beam penetrate with decreasing damage',()=>{
  for(const [family,id,n]of [['pistol','rail',3],['machine','prism',4]]){
    const r=variantReady(family,id);r.enemies=Array.from({length:n},(_,i)=>enemy(r,{id:i+1,x:1080+i*55,hp:1e5,max:1e5}));advance(r,.01);r.shot=100;
    for(let i=0;i<60;i++)advance(r,.01);
    assert.ok(r.enemies.every(e=>e.hp<1e5),id);assert.ok(r.enemies[0].hp<r.enemies[n-1].hp,id);
  }
});
test('mortar ignores early collisions and detonates only at its marked landing point',()=>{
  const r=variantReady('rocket','mortar');advance(r,.01);r.shot=100;const b=r.bullets[0];const target={...b.target};
  for(let i=0;i<14;i++)advance(r,.05);assert.equal(r.damageDealt,0);assert.equal(r.blasts.length,0);
  for(let i=0;i<4;i++)advance(r,.05);assert.ok(r.damageDealt>0);assert.equal(r.blasts.length,1);assert.equal(r.blasts[0].x,target.x);assert.equal(r.bullets.length,0);
});
test('mines arm before triggering and idle mines expire without an explosion',()=>{
  const r=variantReady('rocket','mine');r.enemies[0].x=1040;advance(r,.01);r.shot=100;
  for(let i=0;i<5;i++)advance(r,.05);assert.equal(r.damageDealt,0);assert.equal(r.bullets.length,1);
  for(let i=0;i<3;i++)advance(r,.05);assert.ok(r.damageDealt>0);assert.equal(r.bullets.length,0);assert.equal(r.blasts.length,1);
  const idle=variantReady('rocket','mine');advance(idle,.01);idle.shot=100;for(let i=0;i<170;i++)advance(idle,.05);assert.equal(idle.bullets.length,0);assert.equal(idle.damageDealt,0);assert.equal(idle.blasts.length,0);
});
test('frost fan has innate slow and twin upgrades still improve multi-pellet total damage',()=>{
  const r=variantReady('wand','frostfan');advance(r,.01);r.shot=100;assert.equal(r.bullets.length,5);
  for(let i=0;i<50;i++)advance(r,.01);assert.ok(r.enemies[0].chill>0);
  const a=variantReady('wand','frostfan'),b=variantReady('wand','frostfan');b.specials.twin=1;advance(a,.001);advance(b,.001);
  assert.ok(b.bullets.reduce((s,p)=>s+p.damage,0)>a.bullets.reduce((s,p)=>s+p.damage,0));
});
test('moon and flying broom return, and a lance has long narrow reach',()=>{
  for(const [family,id]of [['wand','moon'],['broom','flying']]){
    const r=variantReady(family,id);r.enemies[0].x=1500;advance(r,.01);r.shot=100;const b=r.bullets[0];let furthest=b.x;
    for(let i=0;i<130&&r.bullets.includes(b);i++){advance(r,.01);furthest=Math.max(furthest,b.x);}
    assert.ok(furthest>1100,id);assert.ok(b.x<furthest-50,id);
  }
  const r=variantReady('broom','lance');r.enemies.push(enemy(r,{id:2,x:1110,y:1120,hp:1e5,max:1e5}));advance(r,.01);
  assert.ok(r.enemies[0].hp<1e5);assert.equal(r.enemies[1].hp,1e5);
  const cap=variantReady('broom','lance');cap.enemies=Array.from({length:5},(_,i)=>enemy(cap,{id:i+1,x:1050+i*28,hp:1e5,max:1e5}));advance(cap,.001);assert.equal(cap.enemies.filter(e=>e.hp<1e5).length,3);
});
test('thrown broom inherits reap and third-attack radial specialization',()=>{
  const r=variantReady('broom','flying');r.hp=50;r.specials.reap=2;r.enemies=[enemy(r,{x:1080,hp:1e5,max:1e5}),enemy(r,{id:2,x:1130,hp:1e5,max:1e5})];advance(r,.01);r.shot=100;
  for(let i=0;i<70;i++)advance(r,.01);assert.equal(r.hp,52);
  const w=variantReady('broom','flying');w.specials.whirl=1;w.shotCounts.broom=2;advance(w,.01);assert.equal(w.bullets.filter(b=>b.secondary).length,5);
});

test('hit feedback decays and contact invincibility prevents repeated damage', () => {
  const r=createRun(()=>.5);r.shot=100;r.spawn=100;
  r.enemies=[enemy(r,{x:r.player.x,hp:500,max:500})];
  advance(r,.01);const hp=r.hp;
  assert.ok(hp<r.maxHp);assert.ok(r.damageFlash>0);assert.ok(r.invincible>0);
  for(let i=0;i<6;i++)advance(r,.05);
  assert.equal(r.hp,hp);assert.equal(r.damageFlash,0);
  r.enemies=[enemy(r,{hp:500,max:500})];r.shot=0;
  for(let i=0;i<30&&!r.enemies[0].flash;i++)advance(r,.01);
  assert.ok(r.enemies[0].flash>0);r.bullets=[];r.shot=100;
  for(let i=0;i<4;i++)advance(r,.05);
  assert.equal(r.enemies[0].flash,0);
});

test('the engineer is offered the missing link card and can discharge early once both cards are learned', () => {
  for (const heat of [.4, .8]) {
    const r = ready('machine');
    r.heat = heat; r.specials.spinup = 1; r.shotCounts.machine = 7;
    r.phase = 'upgrade'; r.choices = rollChoices(r);
    assert.ok(r.choices.some(card => card.id === 'capacitor'));
    assert.ok(chooseUpgrade(r, 'capacitor'));
    advance(r, .01);
    assert.equal(r.enemies[0].hp, heat > .75 ? 9982 : 10000);
    assert.equal(r.texts.some(effect => effect.label === '翡翠过载'), heat > .75);
  }
});

test('wind link adds two blades only on a storm attack, for melee and flying broom', () => {
  for (const variant of ['sweep', 'flying']) {
    const build = (linked, shotCount) => {
      const r = variantReady('broom', variant);
      r.enemies[0].x = 1070;
      r.specials.gale = 1; r.specials.whirl = Number(linked);
      r.shotCounts.broom = shotCount;
      advance(r, .01);
      return r.bullets.length;
    };
    assert.equal(build(true, 1), build(false, 1));
    assert.equal(build(true, 2) - build(false, 2), variant === 'sweep' ? 2 : 7);
  }
});
