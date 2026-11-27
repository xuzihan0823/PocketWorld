import { CLUSTER_CONE_HALF_ANGLE, orbitPoints } from './engine';
import type { Blast, Run, Vec, Enemy } from './engine';
import { armamentOf, STARTERS } from './arsenal';
import { INK, heroSprite, SLIME, MUSHROOM, variantSprite } from './pixel-art';
import type { Sprite } from './pixel-art';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const RASTER_SCALE = 2;
const buffers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const hash = (x:number,y:number):number => { const a=Math.sin(x*127.1+y*311.7)*43758.5453;return a-Math.floor(a); };
function box(c:Ctx,x:number,y:number,w:number,h:number,color:string):void{c.fillStyle=color;c.fillRect(Math.round(x*2)/2,Math.round(y*2)/2,Math.max(.5,Math.round(w*2)/2),Math.max(.5,Math.round(h*2)/2));}
function disk(c:Ctx,x:number,y:number,r:number,color:string,squash=1):void{
  for(let row=-Math.ceil(r);row<=Math.ceil(r);row++){const span=Math.floor(Math.sqrt(Math.max(0,r*r-row*row)));if(span)box(c,x-span,y+row*squash,span*2+1,Math.max(1,squash),color);}
}
function sprite(c:Ctx,s:Sprite,x:number,y:number,scale=1,flip=false,white=false):void{
  c.save();c.translate(Math.round(x*2)/2,Math.round(y*2)/2);
  for (let iy = 0; iy < s.rows.length; iy++) {
    const row = s.rows[iy];
    for (let ix = 0; ix < row.length; ix++) {
      const color = s.colors[row[flip ? row.length - 1 - ix : ix]];
      if (color) box(c, ix * scale, iy * scale, scale, scale, white ? '#ffffff' : color);
    }
  }
  c.restore();
}
function spark(c:Ctx,x:number,y:number,s:number,color:string):void{box(c,x-s,y,s*2+1,1,color);box(c,x,y-s,1,s*2+1,color);box(c,x-1,y-1,3,3,color);}
function stroke(c:Ctx,points:number[][],color:string,width=1):void{c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(Math.round(x),Math.round(y)):c.moveTo(Math.round(x),Math.round(y)));c.stroke();}
function paintBlast(c: Ctx, blast: Blast, position: Vec): void {
  const remaining = blast.life / blast.max;
  const radius = blast.radius * (1 - remaining * .65);
  const y = position.y - 6;
  c.strokeStyle = blast.color;
  c.lineWidth = 2;
  c.beginPath();
  if (blast.coneAngle !== undefined) {
    c.moveTo(position.x, y);
    for (let i = 0; i <= 8; i++) {
      const angle = blast.coneAngle + CLUSTER_CONE_HALF_ANGLE * (i / 4 - 1);
      c.lineTo(position.x + Math.cos(angle) * radius * .4, y + Math.sin(angle) * radius * .29);
    }
    c.closePath();
    c.fillStyle = blast.color;
    c.globalAlpha = remaining * .26;
    c.fill();
    c.globalAlpha = remaining * .85;
    c.stroke();
  } else {
    c.globalAlpha = remaining;
    c.ellipse(position.x, y, radius * .4, radius * .288, 0, 0, TAU);
    c.stroke();
    for (let i = 0; i < 8; i++) {
      const angle = i * TAU / 8;
      spark(c, position.x + Math.cos(angle) * radius * .4, y + Math.sin(angle) * radius * .288, 2, blast.color);
    }
  }
  c.globalAlpha = 1;
}
function tree(c:Ctx,x:number,y:number,variant:number):void{
  disk(c,x+3,y+2,13,'#152b36',.35);box(c,x-2,y-25,5,26,'#382c43');box(c,x,y-22,2,20,'#6c5261');
  const colors=variant>.5?['#30255b','#5d438c','#a37bc9']:['#123c4e','#196c6c','#49b49c'];
  const layers=[{r:17,y:-25},{r:14,y:-36},{r:10,y:-45}];
  for(const l of layers){disk(c,x,y+l.y,l.r+1,INK,.65);disk(c,x,y+l.y-1,l.r,colors[0],.65);disk(c,x-3,y+l.y-3,l.r-3,colors[1],.55);}
  for(let i=0;i<10;i++){const xx=x-12+hash(i,variant)*23,yy=y-49+hash(i,4)*26;box(c,xx,yy,2,1,colors[2]);}
}
function hero(c:Ctx,r:Run,x:number,y:number,time:number,home:boolean):void{
  const scale = home ? 2.5 : 1.25;
  const art = heroSprite(r.profession);
  const bob = r.moving ? Math.abs(Math.sin(time * 10)) * 2 : Math.round(Math.sin(time * 2));
  const left = !home && r.facing < 0;
  disk(c,x,y+1,11*scale,'#172b37',.28);
  if(r.dash>0){for(let i=1;i<4;i++){c.globalAlpha=.13*(4-i);sprite(c,art,x-10*scale-r.dashDir.x*i*6,y-24*scale-r.dashDir.y*i*4,scale,left);}c.globalAlpha=1;}
  c.save();if(r.invincible>0&&!home)c.globalAlpha=r.damageFlash>.16?1:.65+Math.sin(time*32)*.25;
  sprite(c,art,x-10*scale,y-24*scale-bob,scale,left,!home&&r.damageFlash>.16);
  const armX = x + (left ? -5 : 5) * scale;
  const armY = y - 10 * scale - bob;
  c.save();c.translate(armX,armY);c.rotate(Math.round(Math.atan2(Math.sin(home?-.15:r.aim)*.72,Math.cos(home?-.15:r.aim))*8/Math.PI)*Math.PI/8);
  const w=variantSprite(r.weapon,r.variant);sprite(c,w,-4-r.recoil*14,-4,home?1.4:.8,false);
  if(r.recoil>.04&&!home)spark(c,17,0,3,'#ffe4a0');c.restore();c.restore();
  if(!home&&r.damageFlash>0){c.globalAlpha=Math.min(1,r.damageFlash*4);c.strokeStyle='#ff88b5';c.lineWidth=1.5;c.beginPath();c.ellipse(x,y-8,13+(1-r.damageFlash/.28)*12,18,0,0,TAU);c.stroke();spark(c,x-13,y-24,3,'#fff4ed');c.globalAlpha=1;}
  if(!home&&r.specials.witchstep&&r.witchCharge>0){box(c,x-12,y+3,24,1,'#c4d590');spark(c,x+12,y-8,2,'#e2e6b2');}
}
function enemy(c:Ctx,e:Enemy,p:Vec,time:number):void{
  const s=e.kind===3?3:e.kind===2?1.5:1,bob=Math.round(Math.sin(time*5+e.seed)*1.5);
  disk(c,p.x+1,p.y+2,8*s,'#182933',.3);
  const palettes=[['#d5a0ff','#8642c0'],['#97f8ef','#339eaf'],['#ffafdd','#d94c9e'],['#ffe27b','#d85e53']];
  const [light,fill]=palettes[e.kind];
  const base=e.kind===2?MUSHROOM:SLIME;
  const art={rows:base.rows,colors:{...base.colors,H:light,G:fill}};
  sprite(c,art,p.x-8*s,p.y-10*s+bob,s,false,e.flash>0);
  if(e.flash>0){spark(c,p.x+9*s,p.y-12*s,3,'#ffffff');stroke(c,[[p.x-11*s,p.y-6*s],[p.x-15*s,p.y-10*s]],'#fff5b7',1);}
  if(e.kind===1){box(c,p.x-5,p.y-15+bob,3,7,e.flash>0?'#ffffff':INK);box(c,p.x+3,p.y-15+bob,3,7,INK);box(c,p.x-4,p.y-14+bob,1,5,e.flash>0?'#ffffff':light);box(c,p.x+4,p.y-14+bob,1,5,light);}
  if(e.kind===2||e.kind===3){const yy=p.y-10*s+bob;stroke(c,[[p.x-6*s,yy],[p.x-7*s,yy-6*s],[p.x,yy-2*s],[p.x+6*s,yy-6*s],[p.x+5*s,yy]],e.flash>0?'#ffffff':'#ffd977',2);}
  if(e.hp<e.max){box(c,p.x-9*s,p.y+5,18*s,2,'#251f36');box(c,p.x-9*s,p.y+5,18*s*e.hp/e.max,1,'#bcaa82');}
  if((e.chill??0)>0)spark(c,p.x-7*s,p.y-12*s,2,'#99d8e8');
  if((e.burn??0)>0){box(c,p.x+7*s,p.y-11*s-Math.sin(time*10)*2,2,4,'#ec9f6a');box(c,p.x+7*s,p.y-13*s,1,3,'#f5d395');}
}
/** Logical field stays 320 × 240; HD paints actual 640 × 480 pixels with half-cell detail. */
export function render(output:Ctx,r:Run,home=false,clock=r.time,surface?:HTMLCanvasElement):void{
  let buffer=surface??buffers.get(output.canvas);
  if(!buffer){buffer=document.createElement('canvas');buffers.set(output.canvas,buffer);}
  if(buffer.width!==320*RASTER_SCALE||buffer.height!==240*RASTER_SCALE){buffer.width=320*RASTER_SCALE;buffer.height=240*RASTER_SCALE;}
  const c=buffer.getContext('2d');if(!c)return;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,buffer.width,buffer.height);c.imageSmoothingEnabled=false;c.save();c.scale(RASTER_SCALE,RASTER_SCALE);
  const camera=home?{x:1000,y:1000}:r.player,cx=home?226:160,cy=home?165:135;
  const project=(p:Vec):Vec=>({x:Math.round((cx+(p.x-camera.x)*.4)*RASTER_SCALE)/RASTER_SCALE,y:Math.round((cy+(p.y-camera.y)*.29)*RASTER_SCALE)/RASTER_SCALE});
  if(!home&&r.shake)c.translate(Math.round(Math.sin(clock*49)*r.shake*.5),Math.round(Math.cos(clock*61)*r.shake*.35));
  box(c,0,0,320,240,'#163d49');
  const tx=Math.floor((camera.x-cx/.4)/80)-1,ty=Math.floor((camera.y-cy/.29)/80)-1;
  for(let j=ty;j<ty+14;j++)for(let i=tx;i<tx+13;i++){
    const p=project({x:i*80,y:j*80}),n=hash(i,j);
    box(c,p.x,p.y,33,24,n>.5?'#194950':'#18474f');
    for(let k=0;k<4;k++){const xx=p.x+Math.floor(hash(i+k,j)*29),yy=p.y+Math.floor(hash(i,j+k)*20);box(c,xx,yy,2,1,n>.5?'#247964':'#245869');if(k%2===0){box(c,xx+1,yy-2,1,2,'#369579');box(c,xx-1,yy-1,1,1,'#52b89b');}}
    if(n>.86){box(c,p.x+14,p.y+10,1,4,'#48bb91');box(c,p.x+12,p.y+8,4,2,n>.95?'#ff85d1':'#a28bff');box(c,p.x+14,p.y+8,1,1,'#ffe5a0');if(n>.95){box(c,p.x+17,p.y+12,2,1,'#ac78ee');box(c,p.x+11,p.y+13,2,1,'#ff89c5');}}
  }
  for(let i=0;i<100;i++){const xx=hash(i,21)*320,yy=hash(i,33)*240;box(c,xx,yy,.5,.5,hash(i,6)>.5?'#618175':'#4b6672');}
  const shrine=project({x:1000,y:710});
  if(shrine.x>-90&&shrine.x<410&&shrine.y>-80&&shrine.y<300){
    const x=shrine.x,y=shrine.y;
    const glow=c.createRadialGradient(x,y-24,4,x,y-24,70);glow.addColorStop(0,'#a848ed55');glow.addColorStop(1,'#8338cc00');c.fillStyle=glow;c.fillRect(x-70,y-94,140,140);
    c.strokeStyle='#52d7d0';c.lineWidth=1;c.beginPath();c.ellipse(x,y+6,40,12,0,0,TAU);c.stroke();
    for(const side of [-1,1]){box(c,x+side*27-5,y-54,10,56,INK);box(c,x+side*27-3,y-54,7,52,'#63568d');box(c,x+side*27-3,y-54,2,51,'#b49dd6');spark(c,x+side*27,y-22,3,'#64ffe4');}
    for(let i=0;i<9;i++){const a=Math.PI+i*Math.PI/8;box(c,x+Math.cos(a)*28-4,y-51+Math.sin(a)*26,9,9,'#74609e');box(c,x+Math.cos(a)*28-3,y-52+Math.sin(a)*26,6,2,'#b79ddd');}
    c.strokeStyle='#d689ff';c.lineWidth=1;c.beginPath();c.ellipse(x,y-23,17,24,0,0,TAU);c.stroke();
    for(let i=0;i<6;i++)spark(c,x+Math.sin(clock*.6+i*2)*19,y-7-(clock*10+i*8)%49,1,'#e8b5ff');
  }
  for(let i=0;i<18;i++){const p=project({x:hash(i,49)*1900+50,y:hash(i,71)*1900+50});if(p.x<0||p.x>320||p.y<0||p.y>240)continue;c.globalAlpha=.45+Math.sin(clock*1.5+i)*.25;spark(c,p.x+Math.sin(clock*.4+i)*3,p.y-8,1,i%2?'#7affdc':'#e7a2ff');c.globalAlpha=1;}
  // Weathered violet stones, with broken edges and hand-placed highlights.
  for(let i=0;i<27;i++){
    const worldX=480+i*42,worldY=900+Math.sin(i*.26)*90;
    const p=project({x:worldX,y:worldY});if(p.x<-30||p.x>350)continue;
    box(c,p.x-1,p.y,19,11,'#222d3c');box(c,p.x,p.y-1,17,10,'#695a96');box(c,p.x+2,p.y,12,1,'#ae94cc');box(c,p.x+14,p.y+2,2,5,'#443d72');
  }
  const aa=project({x:50,y:50}),bb=project({x:1950,y:1950});c.strokeStyle='#675675';c.lineWidth=3;c.strokeRect(aa.x,aa.y,bb.x-aa.x,bb.y-aa.y);
  const moonlight=c.createLinearGradient(0,0,320,240);moonlight.addColorStop(0,'#1b1a5730');moonlight.addColorStop(.55,'#56e5d809');moonlight.addColorStop(1,'#6c24752b');c.fillStyle=moonlight;c.fillRect(0,0,320,240);
  for(const f of home?[]:r.fields){const p=project(f);c.globalAlpha=.28;disk(c,p.x,p.y,f.radius*.4,'#c27a5a',.72);c.globalAlpha=1;for(let i=0;i<5;i++)spark(c,p.x+Math.sin(clock+i)*f.radius*.25,p.y+Math.cos(clock*2+i)*f.radius*.18,1,'#e7b576');}
  for(const h of home?[]:r.hazards){const p=project(h);c.globalAlpha=h.delay>0?.6:1;c.strokeStyle='#a87db8';c.lineWidth=1;c.setLineDash([2,2]);c.beginPath();c.ellipse(p.x,p.y,h.radius*.4,h.radius*.29,0,0,TAU);c.stroke();c.setLineDash([]);spark(c,p.x,p.y,3,h.delay>0?'#b191bf':'#f6dab9');if(h.delay<=0)stroke(c,[[p.x,p.y-45],[p.x-5,p.y-24],[p.x+3,p.y-24],[p.x,p.y]],'#eee1ff',3);c.globalAlpha=1;}
  const objects:{y:number;paint:()=>void}[]=[];
  for(let i=0;i<46;i++){
    const angle=i*2.39996,radius=i<14?290+hash(i,7)*100:540+hash(i,9)*350;
    const p=project({x:1000+Math.cos(angle)*radius,y:1000+Math.sin(angle)*radius});
    if(p.x<-40||p.x>360||p.y<-20||p.y>285)continue;
    objects.push({y:p.y,paint:()=>{
      if(i%3===0)tree(c,p.x,p.y,hash(i,6));
      else if(i%3===1){box(c,p.x-5,p.y-13,11,14,INK);box(c,p.x-4,p.y-14,8,12,'#67538f');box(c,p.x-3,p.y-13,6,1,'#c09fe8');spark(c,p.x,p.y-7,2,'#72ffe0');box(c,p.x+4,p.y-9,3,9,'#4b485e');}
      else{box(c,p.x-1,p.y-5,3,6,'#c8baae');box(c,p.x-5,p.y-8,11,4,INK);box(c,p.x-4,p.y-9,8,3,'#d94ca2');box(c,p.x-2,p.y-9,2,1,'#ffd1e7');}
    }});
  }
  if(home){
    const p={x:240,y:101};box(c,p.x-26,p.y-42,52,5,INK);box(c,p.x-26,p.y-41,6,43,'#6e637f');box(c,p.x+20,p.y-41,6,43,'#6e637f');box(c,p.x-20,p.y-42,40,6,'#81748d');box(c,p.x-19,p.y-35,38,35,'#28243c');
    for(let i=0;i<5;i++){const xx=p.x+Math.round(Math.sin(clock*.5+i)*15),yy=p.y-8-Math.round((clock*9+i*7)%25);spark(c,xx,yy,1,'#c4aecf');}
    for(let i=0;i<7;i++)spark(c,172+hash(i,5)*130,25+hash(i,9)*80,Math.sin(clock+i)>0?1:0,'#b5b490');
    objects.push({y:167,paint:()=>hero(c,r,226,165,clock,true)});
  }
  for(const g of home?[]:r.gems){const p=project(g);if(g.heart){box(c,p.x-2,p.y-3,5,3,'#cc94a6');box(c,p.x-1,p.y,3,1,'#cc94a6');}else{const yy=p.y-2+Math.round(Math.sin(clock*4+g.x));box(c,p.x-1,yy-2,3,5,'#efab43');box(c,p.x-2,yy-1,5,3,'#ffd66e');box(c,p.x,yy-2,1,2,'#fff0bb');}}
  const enemies=home?[{id:1,x:1200,y:1100,kind:0,hp:20,max:20,radius:18,speed:0,seed:1,flash:0,hit:0,charge:4},{id:2,x:850,y:1160,kind:1,hp:20,max:20,radius:18,speed:0,seed:3,flash:0,hit:0,charge:4}]:r.enemies;
  for(const e of enemies){const p=project(e);if(p.x>-35&&p.x<355&&p.y>-30&&p.y<285)objects.push({y:p.y,paint:()=>enemy(c,e,p,clock)});}
  const player=project(r.player);if(!home)objects.push({y:player.y,paint:()=>hero(c,r,player.x,player.y,clock,false)});
  objects.sort((a,b)=>a.y-b.y).forEach(o=>o.paint());
  if(!home){
    for(const b of r.bullets){
      const w=armamentOf(b.variant??STARTERS[b.kind]);if((b.delay??0)>0&&w.mode!=='mine')continue;
      const p=project(b),q=project({x:b.x-b.vx*.035,y:b.y-b.vy*.035}),tint=b.traits?.frost?'#96d0e1':b.traits?.burn?'#e7a476':w.color;
      if(w.mode==='mine'&&!b.explosiveFollowup){
        const size = b.secondary ? .64 : 1;
        const status = (b.delay ?? 0) > 0 ? '#6d7580' : '#faf2b7';
        c.strokeStyle=(b.delay??0)>0?'#6d7580':'#bacd8d';c.lineWidth=.5;c.beginPath();c.ellipse(p.x,p.y,9*size,5*size,0,0,TAU);c.stroke();
        box(c,p.x-5*size,p.y-5*size,10*size,5*size,INK);
        box(c,p.x-4*size,p.y-4*size,8*size,3*size,tint);
        spark(c,p.x,p.y-4*size,1,status);continue;
      }
      let lift=8;
      if(w.mode==='lob'&&b.target){const land=project(b.target);c.strokeStyle='#e4bc85';c.lineWidth=.5;c.setLineDash([2,2]);c.beginPath();c.ellipse(land.x,land.y,w.radius*.4,w.radius*.29,0,0,TAU);c.stroke();c.setLineDash([]);spark(c,land.x,land.y,4,'#d7b175');lift+=Math.sin(Math.PI*(1-b.life/(b.duration??w.life)))*45;}
      stroke(c,[[q.x,q.y-lift],[p.x,p.y-lift]],tint,w.id==='prism'?2.5:w.id==='rail'?1.5:1);
      if(w.id==='prism'||w.id==='rail'){stroke(c,[[q.x,q.y-lift],[p.x,p.y-lift]],'#fff3d9',.5);spark(c,p.x,p.y-lift,2,tint);}
      else if(b.kind==='rocket'){box(c,p.x-4,p.y-lift-2,8,4,tint);box(c,p.x-3,p.y-lift-2,2,4,'#e6bd8f');spark(c,q.x,q.y-lift,b.secondary?1:2,'#dca86a');}
      else if(w.id==='moon'){disk(c,p.x,p.y-lift,4,'#eee1a9');disk(c,p.x+2,p.y-lift-1,3,'#163d49');}
      else if(w.id==='frostfan'){stroke(c,[[p.x,p.y-lift-4],[p.x+2,p.y-lift],[p.x,p.y-lift+4],[p.x-2,p.y-lift],[p.x,p.y-lift-4]],tint,.5);}
      else if(b.kind==='broom'){c.save();c.translate(p.x,p.y-lift);c.rotate(clock*15);stroke(c,[[-4,-4],[4,0],[-4,4]],'#d7dcaa',2);c.restore();}
      else spark(c,p.x,p.y-lift,b.kind==='wand'?3:1,tint);
    }
    for (const blast of r.blasts) paintBlast(c, blast, project(blast));
    if(r.sweep>0){const arm=armamentOf(r.variant),radius=(arm.reach+r.upgrades.spread*12)*.4,span=arm.id==='lance'?.4:1.5;for(let i=0;i<13;i++){const a=r.aim-span+i*span/6;box(c,player.x+Math.cos(a)*radius,player.y-7+Math.sin(a)*radius*.72,3,2,'#e4dfb1');}}
    if(r.pulseRing>0){const rr=(1-r.pulseRing/.6)*60;c.strokeStyle='#b8ccdc';c.beginPath();c.ellipse(player.x,player.y-6,rr,rr*.72,0,0,TAU);c.stroke();}
    for(const o of orbitPoints(r)){const p=project(o);spark(c,p.x,p.y-8,3,'#d8c493');}
    for(const a of r.arcs){const p=project(a.from),q=project(a.to);stroke(c,[[p.x,p.y-7],[(p.x+q.x)/2+3,(p.y+q.y)/2-11],[(p.x+q.x)/2-2,(p.y+q.y)/2-4],[q.x,q.y-7]],'#ead59c',2);}
    for(const p of r.particles){const point=project(p);c.globalAlpha=p.life/p.max;box(c,point.x,point.y-6,Math.max(1,p.size*.5),Math.max(1,p.size*.5),p.color);}c.globalAlpha=1;
    c.textAlign='center';c.font='bold 6px monospace';
    for(const t of r.texts){const p=project(t);c.globalAlpha=Math.min(1,t.life*3);c.fillStyle=INK;c.fillText(t.label,p.x+1,p.y-8);c.fillStyle=t.color;c.fillText(t.label,p.x,p.y-9);}c.globalAlpha=1;
    if(r.combo>=3&&r.comboTime>0){c.textAlign='right';c.font='bold 10px monospace';c.fillStyle='#ebcf95';c.fillText(`${r.combo} CHAIN`,302,59);}
    if(r.damageFlash>0){const impact=c.createRadialGradient(160,135,65,160,120,180);impact.addColorStop(0,'#ff467900');impact.addColorStop(1,'#ff4679');c.globalAlpha=Math.min(.65,r.damageFlash*2.5);c.fillStyle=impact;c.fillRect(0,0,320,240);c.globalAlpha=1;}
  }
  c.restore();output.save();output.setTransform(1,0,0,1,0,0);output.imageSmoothingEnabled=false;output.clearRect(0,0,output.canvas.width,output.canvas.height);output.drawImage(buffer,0,0,output.canvas.width,output.canvas.height);output.restore();
}
