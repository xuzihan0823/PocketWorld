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
const data=readFileSync(new URL('../../../assets/public/models/resident/luna-seat-contact.bin',import.meta.url));
const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),cache=readSeatContactCache(buffer);
const {gltf}=await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb',import.meta.url));
function instance(){
 const asset=clone(gltf.scene),rig=createResidentRig(asset,gltf.animations.find(c=>c.name==='Walk_Grounded_Loop'));
 const chair=createChairAnimation(asset,gltf.animations.find(c=>c.name==='ChairSit_Contact'),cache);
 const root=new THREE.Group();root.add(rig.mesh);root.position.z=.54;
 const sample=(t,w=1,ahead=0,lift=0)=>{rig.applyPose(0,0);chair.apply(t,w,ahead,lift);root.updateMatrixWorld(true);asset.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});};
 return {asset,rig,chair,root,sample,dispose:()=>{chair.dispose();rig.dispose();}};
}
test('the shipped contact cache validates its header, dimensions and vertex mapping',()=>{
 assert.equal(cache.frames,68);assert(cache.count<5000);
 const clip=gltf.animations.find(c=>c.name==='ChairSit_Contact');
 assert(Math.abs(clip.duration-67/30)<1e-6);
 for(const track of clip.tracks)assert.equal(track.times[0],0,'Blender frame 1 and cache frame 0 must share the same time origin');
 assert.throws(()=>readSeatContactCache(new ArrayBuffer(8)));
 assert.throws(()=>readSeatContactCache(buffer.slice(0,-2)));
 const x=instance();x.dispose();
});
test('seat deformation is instance-local and releases the original geometry and authored normals',()=>{
 const a=instance(),b=instance();
 const ma=a.asset.getObjectByProperty('isSkinnedMesh',true),mb=b.asset.getObjectByProperty('isSkinnedMesh',true);
 const rest=new Float32Array(ma.geometry.attributes.position.array),normals=new Float32Array(ma.geometry.attributes.normal.array);
 a.sample(2.2333333333333334);
 assert.notDeepEqual(ma.geometry.attributes.position.array,rest);
 assert.deepEqual(mb.geometry.attributes.position.array,rest);
 assert.deepEqual(ma.geometry.attributes.normal.array,normals);
 a.sample(0,0);assert.deepEqual(ma.geometry.attributes.position.array,rest);
 a.rig.applyPose(.49,1);a.root.updateMatrixWorld(true);
 assert(a.asset.getObjectByName('mixamorigHips').position.length()<1);
 a.dispose();b.dispose();
});
test('authored sitting and grounded scoot corrections preserve limb lengths and finite skinning',()=>{
 const a=instance(),position=o=>o.getWorldPosition(new THREE.Vector3());
 const lengths=[];
 for(const time of [0,.5,1,1.5,2.2333333333333334])for(const ahead of [0,.03,.06,.1]) {
  a.sample(time,1,time>2?ahead:0,time>2?.02:0);
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
