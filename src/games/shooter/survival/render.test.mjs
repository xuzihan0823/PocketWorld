import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const engine = require('./dist/engine.cjs');
const cache = new Map();
function load(name) {
  if (name === './engine') return engine;
  if (cache.has(name)) return cache.get(name);
  const exports = {}; cache.set(name, exports);
  const source = fs.readFileSync(new URL(`${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: load }); return exports;
}
const { render } = load('./render');
const { SLIME } = load('./pixel-art');
function context() {
  const calls = [], fills = [], stack = []; let x=0,y=0,sx=1,sy=1,path=[];
  return { calls, fills, canvas: { width:800,height:600 }, globalAlpha:1,
    save(){stack.push([x,y,sx,sy,this.globalAlpha]);}, restore(){[x,y,sx,sy,this.globalAlpha]=stack.pop();},
    translate(a,b){x+=a*sx;y+=b*sy;}, scale(a,b){sx*=a;sy*=b;}, setTransform(){x=y=0;sx=sy=1;},
    fillRect(a,b,w,h){calls.push({x:x+a*sx,y:y+b*sy,w:w*sx,h:h*sy,color:this.fillStyle,alpha:this.globalAlpha});},
    createRadialGradient(){return {addColorStop(){}};}, createLinearGradient(){return {addColorStop(){}};},
    beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},
    fill(){fills.push({path,color:this.fillStyle,alpha:this.globalAlpha});},
    clearRect(){},rotate(){},ellipse(){},stroke(){},strokeRect(){},setLineDash(){},fillText(){},drawImage(){},
  };
}
function paint(r) {
  const c = context();
  const surface = { width: 0, height: 0, getContext: () => c };
  render(context(), r, false, 0, surface);
  assert.deepEqual([surface.width, surface.height], [640, 480]);
  return c.calls.map(({ x, y, w, h, ...rest }) => ({
    ...rest, x: x / 2, y: y / 2, w: w / 2, h: h / 2,
  }));
}
test('cluster blast paints a translucent sector facing the direction of travel', () => {
  const r = engine.createRun(() => .5, 'rocket');
  r.blasts = [{ x: 1050, y: 1000, radius: 112, life: .16, max: .32, color: '#ffe098', coneAngle: Math.PI }];
  const c = context();
  render(context(), r, false, 0, { width: 0, height: 0, getContext: () => c });
  const sector = c.fills.find(fill => fill.color === '#ffe098');
  assert.ok(sector && sector.alpha > 0 && sector.alpha < 1);
  const [[originX, originY], ...arc] = sector.path;
  assert.ok(arc.length > 2 && arc.every(([x]) => x < originX));
  assert.ok(arc.some(([, y]) => y > originY) && arc.some(([, y]) => y < originY));
});
test('monster impact paints every occupied body pixel pure white, then restores its palette',()=>{
  const r=engine.createRun(()=>.5);r.enemies=[{id:1,x:1150,y:1000,kind:0,hp:100,max:100,radius:18,speed:0,seed:0,flash:.12,hit:0,charge:4}];
  const white=paint(r);
  for(const [iy,row] of SLIME.rows.entries())for(const [ix,key] of [...row].entries())if(SLIME.colors[key]){
    const cell=white.findLast(p=>p.x===212+ix&&p.y===125+iy&&p.w===1&&p.h===1);
    assert.equal(cell?.color,'#ffffff',`body ${ix},${iy}`);
  }
  r.enemies[0].flash=0;
  assert.ok(paint(r).some(p=>p.x===218&&p.y===125&&p.color!=='#ffffff'));
});
test('player damage adds a white silhouette and fading edge feedback without changing the run',()=>{
  const r=engine.createRun(()=>.5); const normal=paint(r);r.damageFlash=.28;r.invincible=.7;
  const before=JSON.stringify(r),hit=paint(r);assert.equal(JSON.stringify(r),before);
  assert.ok(hit.filter(p=>p.color==='#ffffff').length>normal.filter(p=>p.color==='#ffffff').length+80);
  assert.ok(hit.some(p=>p.w===320&&p.h===240&&typeof p.color==='object'&&p.alpha>0&&p.alpha<1));
  r.damageFlash=0; assert.ok(!paint(r).some(p=>p.w===320&&p.h===240&&typeof p.color==='object'&&p.alpha<1));
});
