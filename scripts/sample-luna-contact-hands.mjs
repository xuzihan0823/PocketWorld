import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]), output=process.argv[3];
const imp=p=>import(pathToFileURL(path.join(root,p)));
const THREE=await imp('node_modules/three/build/three.module.js');
const {load}=await imp('src/scene/orbital/load-for-validation.mjs');
const {createResidentRig,RESIDENT_SCALE}=await imp('src/scene/orbital/residentRig.ts');
const {sampleStairGait,stairTreadSurface}=await imp('src/scene/orbital/stairGait.ts');
const {CABIN_STAIRS,STAIR_RISE,STAIR_TREAD_RUN}=await imp('src/scene/orbital/cabinStairs.ts');
const file='luna-cardigan.glb';
const {gltf}=await load(path.join(root,'assets/public/models/resident',file));
const bones=[];let skin;gltf.scene.traverse(o=>{if(o.isBone)bones.push(o);if(o.isSkinnedMesh)skin=o;});
const bind=Object.fromEntries(skin.skeleton.bones.map((b,i)=>[b.name,skin.skeleton.boneInverses[i].clone().invert().toArray()]));
const rig=createResidentRig(gltf.scene,gltf.animations.find(a=>a.name==='Walk_Grounded_Loop'),true);
const snap=()=>{rig.mesh.updateMatrixWorld(true);const inv=gltf.scene.matrixWorld.clone().invert();return Object.fromEntries(bones.map(b=>[b.name,{world:b.matrixWorld.clone().premultiply(inv).toArray(),parent:b.parent.isBone?b.parent.name:null}]))};
rig.applyPose(0,0);const standing=snap();
const record={file,bind,standing,up:[],down:[]};
for(const ascending of [true,false])for(let i=0;i<=64;i++){
 const cycle=6+2*i/64;
 const progress=ascending?cycle-.78:18-(cycle+.18)/(1+.4/18);
 const gait=sampleStairGait(progress,ascending);
 rig.mesh.rotation.y=gait.yaw;
 rig.mesh.position.set(CABIN_STAIRS.x,progress*STAIR_RISE,CABIN_STAIRS.lowerZ-progress*STAIR_TREAD_RUN);
 rig.applyPose(gait.phase,0);rig.applyStairPose(gait,CABIN_STAIRS.x,stairTreadSurface);
 record[ascending?'up':'down'].push(snap());
}
fs.writeFileSync(output,JSON.stringify({scale:RESIDENT_SCALE,record}));
rig.dispose();console.log('captured 130 stair poses and standing');
