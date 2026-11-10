import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from '../../../../scripts/resident-glb-loader.mjs';

const original='public/models/resident/luna-tripo-transitions.glb';
const bytes=await fs.readFile('public/models/resident/luna-chair-motion.glb');
const motion=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const vec=()=>new THREE.Vector3();
async function rig(clip='ChairSitDown') {
 const m=await load(original);m.select('SitCycle')(2.4);
 const actor=new THREE.Group();actor.add(m.gltf.scene);m.gltf.scene.scale.setScalar(1.45);
 const mixer=new THREE.AnimationMixer(m.gltf.scene);
 const selected=clip.startsWith('Chair')?motion.animations.find(a=>a.name===clip):m.gltf.animations.find(a=>a.name===clip);
 const action=mixer.clipAction(selected);action.play();action.paused=true;
 const sample=t=>{action.time=t;mixer.update(0);actor.updateMatrixWorld(true);m.mesh.skeleton.update();};
 const point=n=>m.bone(n).getWorldPosition(vec());sample(0);
 return {...m,actor,sample,point};
}
const lean=r=>{const d=r.point('Neck').sub(r.point('Hips'));return Math.atan2(d.z,d.y)*180/Math.PI;};

test('chair sidecar preserves the accepted resident and fixed five-wheel chair',async()=>{
 assert.equal(crypto.createHash('sha256').update(await fs.readFile(original)).digest('hex'),'5e1da819d580426618934abf4fc29acc9b92264fff2d9bacf20565a255272ec6');
 assert.equal(crypto.createHash('sha256').update((await fs.readFile('src/scene/orbital/chair/OfficeChair.tsx','utf8')).replace(/\r\n/g,'\n')).digest('hex'),'51bf5fc5796920b53bb539956846ffb18607938540a2d0bfe3c5d96db97ee977');
 const r=await rig();assert.equal(r.mesh.skeleton.bones.length,103);assert.equal(r.mesh.morphTargetInfluences.length,49);
 assert.deepEqual(motion.animations.map(a=>a.name),['ChairSitDown','ChairSeatedIdle','ChairStandUp']);
 assert.ok(bytes.length<1100000);
 const originalTargets=new Set(r.gltf.animations.flatMap(a=>a.tracks.map(t=>t.name)));
 for(const a of motion.animations) for(const t of a.tracks) assert.ok(originalTargets.has(t.name),`Unbound target: ${t.name}`);
});

test('preparation precedes descent, and lap gathering happens after body support',async()=>{
 const r=await rig();r.sample(0);const h0=r.point('Hips');
 r.sample(.18);assert.ok(Math.abs(r.point('Hips').y-h0.y)<.003);assert.ok(lean(r)>2);
 r.sample(.46);assert.ok(h0.z-r.point('Hips').z>.05);assert.ok(h0.y-r.point('Hips').y<.03);
 r.sample(.72);assert.ok(lean(r)>9);
 r.sample(1.24);const supported=r.point('Hips'),handBefore=r.point('LeftHand');
 r.sample(1.8);assert.ok(r.point('Hips').distanceTo(supported)<.008);assert.ok(r.point('LeftHand').distanceTo(handBefore)>.07);
 assert.ok(Math.abs(lean(r)-1)<1);
});

test('sit, idle loop and rise join without skeleton or cloth pose jumps',async()=>{
 const down=await rig(),idle=await rig('ChairSeatedIdle'),up=await rig('ChairStandUp'),rest=await rig('SitCycle');
 const compare=(a,b,label)=>{
  for(const bone of a.mesh.skeleton.bones){const other=b.mesh.skeleton.bones.find(x=>x.name===bone.name);
   assert.ok(bone.getWorldPosition(vec()).distanceTo(other.getWorldPosition(vec()))<.0003,`${label}: ${bone.name} position`);
   const qa=bone.quaternion.clone().normalize(),qb=other.quaternion.clone().normalize();
   assert.ok(qa.angleTo(qb)<.003,`${label}: ${bone.name} rotation`);
  }
 };
 rest.sample(9);down.sample(0);compare(down,rest,'stand → prepare');
 down.sample(1.8);idle.sample(0);compare(down,idle,'settle → idle');
 idle.sample(4);compare(down,idle,'idle loop');
 up.sample(0);compare(idle,up,'idle → rise');
 up.sample(1.7);compare(up,rest,'rise → stand');
});

test('baked sit/rise keep soles and each leg bend plane stable at native room scale',async()=>{
 for(const [clip,duration]of [['ChairSitDown',1.8],['ChairStandUp',1.7]]){
  const r=await rig(clip),a=r.mesh.geometry.attributes,ids=[];
  for(let i=0;i<a.position.count;i++){
   let foot=0;for(let c=0;c<4;c++)if(/Foot|Toe/.test(r.mesh.skeleton.bones[a.skinIndex.getComponent(i,c)].name))foot+=a.skinWeight.getComponent(i,c);
   if(foot>.5&&a.position.getY(i)<.009)ids.push(i);
  }
  assert.ok(ids.length>10);
  const anchors=['Left','Right'].map(side=>r.point(side+'Foot'));
  const lengths=['Left','Right'].map(side=>[r.point(side+'UpLeg').distanceTo(r.point(side+'Leg')),r.point(side+'Leg').distanceTo(r.point(side+'Foot'))]);
  let soleMin=Infinity,soleMax=-Infinity,drift=0;
  for(let i=0;i<=duration*120;i++){
   r.sample(i/120);let minimum=Infinity;
   for(const id of ids)minimum=Math.min(minimum,r.mesh.getVertexPosition(id,vec()).applyMatrix4(r.mesh.matrixWorld).y);
   soleMin=Math.min(soleMin,minimum);soleMax=Math.max(soleMax,minimum);
   for(const [j,side]of ['Left','Right'].entries()){
    const h=r.point(side+'UpLeg'),k=r.point(side+'Leg'),f=r.point(side+'Foot');drift=Math.max(drift,f.distanceTo(anchors[j]));
    assert.ok(Math.abs(h.distanceTo(k)-lengths[j][0])<.00001);assert.ok(Math.abs(k.distanceTo(f)-lengths[j][1])<.00001);
    const axis=f.clone().sub(h).normalize(),pole=vec().set(0,0,1).addScaledVector(axis,-axis.z).normalize(),normal=axis.clone().cross(pole);
    assert.ok(Math.abs(k.clone().sub(h).dot(normal))<.0005,`${clip} medial knee deviation`);
   }
  }
  assert.ok(soleMin>-.001&&soleMax<.001,`${clip} sole range ${soleMin}..${soleMax}`);assert.ok(drift<.0005,`${clip} ankle drift ${drift}`);
  console.log(JSON.stringify({clip,soleMin,soleMax,drift,scale:r.gltf.scene.scale.x}));
 }
});
