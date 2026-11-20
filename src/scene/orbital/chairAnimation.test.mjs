import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';
const modules={};
function local(name){
 if(modules[name])return modules[name];
 const scope={exports:{},require:n=>n==='three'?THREE:local(n)};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 return modules[name]=scope.exports;
}
const {createResidentRig}=local('./residentRig');
const {createChairAnimation,readSeatContactCache}=local('./chairAnimation');
const {CHAIR_FPS,CHAIR_SIT_FRAMES,CHAIR_HOLD_SECONDS,CHAIR_END_SECONDS}=local('./chairMotion');
const data=readFileSync(new URL('../../../assets/public/models/resident/luna-seat-contact.bin',import.meta.url));
const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),cache=readSeatContactCache(buffer);
const {gltf}=await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb',import.meta.url));
const {gltf:captureAsset}=await load(new URL('../../../assets/public/models/resident/luna-chair-cmu113.glb',import.meta.url));
const captured=captureAsset.animations.find(c=>c.name==='Chair_CMU_113_15');
function instance(){
 const asset=clone(gltf.scene),rig=createResidentRig(asset,gltf.animations.find(c=>c.name==='Walk_Grounded_Loop'));
 const chair=createChairAnimation(asset,gltf.animations.find(c=>c.name==='ChairSit_Contact'),captured,cache);
 const root=new THREE.Group();root.add(rig.mesh);root.position.z=.54;
 const sample=(t,w=1)=>{rig.applyPose(0,0);chair.apply(t,w);root.updateMatrixWorld(true);asset.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});};
 return {asset,rig,chair,root,sample,dispose:()=>{chair.dispose();rig.dispose();}};
}
test('the shipped contact cache validates its header, dimensions and vertex mapping',()=>{
 assert.equal(cache.frames,CHAIR_SIT_FRAMES);assert(cache.count<5000);
 const clip=gltf.animations.find(c=>c.name==='ChairSit_Contact');
 assert(Math.abs(clip.duration-(CHAIR_SIT_FRAMES-1)/CHAIR_FPS)<1e-6);
 for(const track of clip.tracks)assert.equal(track.times[0],0,'Blender frame 1 and cache frame 0 must share the same time origin');
 assert.throws(()=>readSeatContactCache(new ArrayBuffer(8)));
 assert.throws(()=>readSeatContactCache(buffer.slice(0,-2)));
 assert(Math.abs(captured.duration-CHAIR_END_SECONDS)<1e-6);
 const x=instance();x.dispose();
});
test('seat deformation is instance-local and releases the original geometry and authored normals',()=>{
 const a=instance(),b=instance();
 const ma=a.asset.getObjectByProperty('isSkinnedMesh',true),mb=b.asset.getObjectByProperty('isSkinnedMesh',true);
 const rest=new Float32Array(ma.geometry.attributes.position.array),normals=new Float32Array(ma.geometry.attributes.normal.array);
 a.sample(CHAIR_HOLD_SECONDS);
 assert.notDeepEqual(ma.geometry.attributes.position.array,rest);
 assert.deepEqual(mb.geometry.attributes.position.array,rest);
 assert.deepEqual(ma.geometry.attributes.normal.array,normals);
 a.sample(0,0);assert.deepEqual(ma.geometry.attributes.position.array,rest);
 a.rig.applyPose(.49,1);a.root.updateMatrixWorld(true);
 assert(a.asset.getObjectByName('mixamorigHips').position.length()<1);
 a.dispose();b.dispose();
});
test('authored sitting preserves limb lengths and finite skinning',()=>{
 const a=instance(),position=o=>o.getWorldPosition(new THREE.Vector3());
 const lengths=[];
 for(const time of [0,.5,1,1.5,(53 - 1) / CHAIR_FPS,2.45,CHAIR_HOLD_SECONDS,3.7,CHAIR_END_SECONDS]) {
  a.sample(time);
  const values=[];
  for(const side of ['Left','Right']) {
   const chain=['UpLeg','Leg','Foot'].map(n=>a.asset.getObjectByName('mixamorig'+side+n));
   values.push(position(chain[0]).distanceTo(position(chain[1])),position(chain[1]).distanceTo(position(chain[2])));
  }
  if(!lengths.length)lengths.push(...values);
  values.forEach((v,i)=>assert(Math.abs(v-lengths[i])<1e-5,`bone ${i}: ${v} vs ${lengths[i]}`));
  const mesh=a.asset.getObjectByProperty('isSkinnedMesh',true),v=new THREE.Vector3();
  for(let i=0;i<mesh.geometry.attributes.position.count;i+=61){mesh.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite));}
 }
 a.dispose();
});

test('CMU 113_15 keeps both feet planted across the recorded sit and rise', () => {
 const actor = instance();
 const point = name => actor.asset.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
 const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
 try {
  actor.sample(0);
  const standing = point('Hips');
  const anchors = feet.map(point);
  for (let frame = 0; frame <= Math.round(CHAIR_END_SECONDS * 60); frame++) {
   actor.sample(frame / 60);
   feet.forEach((name, index) => {
    assert(point(name).distanceTo(anchors[index]) < .002, name + ' drifted at frame ' + frame);
   });
  }
  assert(point('Hips').distanceTo(standing) < .001);
  actor.sample(CHAIR_HOLD_SECONDS);
  const seat = point('Hips');
  assert(standing.z - seat.z > .24 && standing.y - seat.y > .07);
  actor.sample(3.7);
  assert(point('Head').z - point('Hips').z > .15, 'weight moves forward before standing');
 } finally { actor.dispose(); }
});

test('the raised front skirt covers both thighs at the supported edge and on release', () => {
 const a = instance();
 const mesh = a.asset.getObjectByProperty('isSkinnedMesh', true);
 const { skinIndex, skinWeight } = mesh.geometry.attributes;
 const down = new THREE.Vector3(0, -1, 0);
 const ray = new THREE.Raycaster();
 function strongestBone(vertex) {
  let strongest = 0;
  for (let slot = 1; slot < 4; slot++) {
   if (skinWeight.getComponent(vertex, slot) > skinWeight.getComponent(vertex, strongest)) strongest = slot;
  }
  return mesh.skeleton.bones[skinIndex.getComponent(vertex, strongest)].name;
 }
 for (const time of [CHAIR_HOLD_SECONDS - .10, CHAIR_HOLD_SECONDS, CHAIR_HOLD_SECONDS + .1]) {
  a.sample(time);
  mesh.computeBoundingSphere();
  const hips = a.asset.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
  for (const x of [-.09, .09]) for (const depth of [.16, .18]) {
   ray.set(new THREE.Vector3(x, 2, hips.z + depth), down);
   const hits = [];
   // The room disables pointer hits on Luna. Use the deforming mesh's original raycast.
   THREE.SkinnedMesh.prototype.raycast.call(mesh, ray, hits);
   hits.sort((a, b) => a.distance - b.distance);
   const cloth = hits.find(hit => strongestBone(hit.face.a).startsWith('Dress_Front'));
   const thigh = hits.find(hit => strongestBone(hit.face.a).endsWith('UpLeg'));
   assert(cloth && thigh, `skirt and thigh at ${time}s, x ${x}, depth ${depth}`);
   assert(cloth.point.y > thigh.point.y + .005, `exposed thigh at ${time}s, x ${x}, depth ${depth}`);
  }
 }
 a.dispose();
});

test('wrists stay aligned with the captured forearms through sitting and rising', () => {
  const actor = instance();
  const chains = ['Left', 'Right'].map(side => {
    const joint = name => actor.asset.getObjectByName(`mixamorig${side}${name}`);
    const wrist = joint('Hand');
    const mesh = actor.asset.getObjectByProperty('isSkinnedMesh', true);
    const index = mesh.skeleton.bones.indexOf(wrist);
    const parent = mesh.skeleton.bones.indexOf(wrist.parent);
    const bind = mesh.skeleton.boneInverses[parent].clone().multiply(mesh.skeleton.boneInverses[index].clone().invert());
    const bindRotation = new THREE.Quaternion().setFromRotationMatrix(bind.extractRotation(bind));
    const middle = joint('HandMiddle1');
    return { side, wrist, middle,
      bindRotation, palmAxis: middle.position.clone().normalize() };
  });
  const position = bone => bone.getWorldPosition(new THREE.Vector3());
  try {
    for (let frame = 0; frame <= Math.round(CHAIR_END_SECONDS * 60); frame++) {
      actor.sample(frame / 60);
      for (const { side, wrist, middle, bindRotation, palmAxis } of chains) {
        const label = side + ' at sample ' + frame;
        const forearm = position(wrist).sub(position(wrist.parent)).normalize();
        const palm = position(middle).sub(position(wrist)).normalize();
        assert(THREE.MathUtils.radToDeg(forearm.angleTo(palm)) < 58, `bent wrist: ${label}`);
        const relative = bindRotation.clone().invert().multiply(wrist.quaternion).normalize();
        const axial = new THREE.Vector3(relative.x, relative.y, relative.z).dot(palmAxis);
        const twist = 2 * Math.atan2(Math.abs(axial), Math.abs(relative.w));
        assert(THREE.MathUtils.radToDeg(twist) < 12, `twisted wrist: ${label}`);
      }
    }
  } finally {
    actor.dispose();
  }
});
