import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.env.FLOOR_ROOT??fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const THREE=await import(pathToFileURL(path.join(root,'node_modules/three/build/three.module.js')));
const {GLTFLoader}=await import(pathToFileURL(path.join(root,'node_modules/three/examples/jsm/loaders/GLTFLoader.js')));
const {load}=await import(pathToFileURL(path.join(root,'src/scene/orbital/load-for-validation.mjs')));
const modules=new Map();
function local(file) {
 file=path.resolve(file);if(modules.has(file))return modules.get(file);
 const scope={exports:{},require:id=>id==='three'?THREE:id.includes('GLTFLoader')?{GLTFLoader}:local(path.resolve(path.dirname(file),id.endsWith('.ts')?id:id+'.ts'))};
 let source=fs.readFileSync(file,'utf8').replaceAll('import.meta.env.BASE_URL',"'/'");
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 modules.set(file,scope.exports);return scope.exports;
}
const {createResidentRig}=local(path.join(root,'src/scene/orbital/residentRig.ts'));
const {createCabinActionPlayer,applyCabinPerformance}=local(path.join(root,'src/scene/orbital/cabinActions.ts'));
const model=path.join(root,'assets/public/models/resident/luna-cardigan.glb');
const candidate=process.env.FLOOR_CANDIDATE??path.join(root,'assets/public/models/resident/luna-cabin-actions-cardigan.glb');
const {gltf}=await load(model),rig=createResidentRig(gltf.scene,gltf.animations.find(a=>a.name==='Walk_Grounded_Loop'),true);
const raw=fs.readFileSync(candidate),size=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+size));
const {animations}=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),'');
const clips=Object.fromEntries(animations.map(a=>[a.name,a])),player=createCabinActionPlayer(rig.mesh,clips);
const bone=name=>rig.mesh.getObjectByName('mixamorig'+name),pos=name=>bone(name).getWorldPosition(new THREE.Vector3());
const sample=(name,time,production=false)=>{
 rig.applyPose(0,0);
 if(production)applyCabinPerformance({kind:'floor',phase:name==='floorSit'?'sit':'rise',time,leaving:false},clips,player);
 else player(name,time);
 rig.mesh.updateMatrixWorld(true);rig.mesh.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});
};
function palm(side){
 const wrist=pos(side+'Hand'),mid=pos(side+'HandIndex1').add(pos(side+'HandRing1')).add(pos(side+'HandPinky1')).multiplyScalar(1/3);
 const normal=mid.clone().sub(wrist).cross(pos(side+'HandIndex1').sub(pos(side+'HandPinky1'))).normalize().multiplyScalar(side==='Left'?1:-1);
 return {wrist,mid,normal,center:wrist.clone().lerp(mid,.6)};
}
const meshes=[];rig.mesh.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)});
// Membership follows the actual four skin weights, never a wrist proxy sphere.
const membership=meshes.map(mesh=>{
 const {skinIndex:joints,skinWeight:weights}=mesh.geometry.attributes;
 const groups={Left:[],Right:[],lower:[],collision:[],side:{Left:[],Right:[]}};
 for(let i=0;i<joints.count;i++) {
  let lower=0,collision=0;const hands={Left:0,Right:0},thigh={Left:0,Right:0};
  for(let c=0;c<4;c++) {
   const n=mesh.skeleton.bones[joints.getComponent(i,c)].name,w=weights.getComponent(i,c);
   if(/Hips|UpLeg|Dress/.test(n))lower+=w;
   if(/Hips|Leg|Foot|ToeBase|Dress/.test(n))collision+=w;
   for(const side of ['Left','Right']){if(n.includes(side+'Hand'))hands[side]+=w;if(n.includes(side+'UpLeg'))thigh[side]+=w;}
  }
  groups.lower.push(lower>.75);
  groups.collision.push(collision>.75);
  for(const side of ['Left','Right']){if(hands[side]>.75)groups[side].push(i);groups.side[side].push(thigh[side]>.15);}
 }
 return groups;
});
function contact(side){
 const p=palm(side),points=[],handPoints=[],triangles=[],collisionTriangles=[],skinNormal=new THREE.Vector3();
 meshes.forEach((mesh,k)=>{
  const group=membership[k],vertices=Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  const palmIds=new Set();
  for(const i of group[side]) {
   handPoints.push(vertices[i]);
   if(vertices[i].distanceTo(p.center)<.025&&vertices[i].clone().sub(p.center).dot(p.normal)>.002){points.push(vertices[i]);palmIds.add(i);}
  }
  const idx=mesh.geometry.index;
  for(let i=0;i<idx.count;i+=3){
   const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)],tri=new THREE.Triangle(...ids.map(n=>vertices[n]));
   if(ids.every(n=>group.lower[n])&&ids.some(n=>group.side[side][n]))triangles.push(tri);
   if(ids.every(n=>group.collision[n]))collisionTriangles.push(tri);
   if(ids.every(n=>palmIds.has(n)))skinNormal.add(tri.getNormal(new THREE.Vector3()).multiplyScalar(tri.getArea()));
  }
 });
 assert(points.length>=8,side+' actual palm samples');assert(triangles.length>100,'same-side thigh triangles');
 const near=new THREE.Vector3(),normal=new THREE.Vector3();let penetration=0;
 const distances=points.map(point=>{
  let distance=Infinity,signed=0;
  for(const tri of triangles){tri.closestPointToPoint(point,near);const d=near.distanceTo(point);if(d<distance){distance=d;signed=point.clone().sub(near).dot(tri.getNormal(normal));}}
  penetration=Math.max(penetration,-signed);return distance;
 }).sort((a,b)=>a-b);
 let handPenetration=0;
 for(const point of handPoints) {
  let distance=Infinity,signed=0;
  // Include the knee and calf for penetration: clipping a thigh at a skin-weight
  // boundary creates an open edge whose signed nearest distance is not inside/outside.
  for(const tri of collisionTriangles){tri.closestPointToPoint(point,near);const d=near.distanceTo(point);if(d<distance){distance=d;signed=point.clone().sub(near).dot(tri.getNormal(normal));}}
  handPenetration=Math.max(handPenetration,-signed);
 }
 return {nearest:distances[0],median:distances[Math.floor(distances.length/2)],samples:points.length,penetration,handPenetration,skinNormalDown:skinNormal.normalize().y*-1,palmDown:p.normal.dot(new THREE.Vector3(0,-1,0)),wristAngle:p.mid.clone().sub(p.wrist).angleTo(p.wrist.clone().sub(pos(side+'ForeArm')))};
}

for(const side of ['Left','Right'])test(`cardigan floor ${side} palm bears on its own real thigh skin with a natural wrist`,()=>{
 const rows=[];
 const times=process.env.FLOOR_DENSE?Array.from({length:36},(_,i)=>Math.min(clips.floorSit.duration,3.8+i/30)):[3.8,4.1,4.4,4.7,clips.floorSit.duration];
 for(const time of times) {
  sample('floorSit',time);
   const row={time,side,...contact(side)};rows.push(row);
   assert(row.nearest<.004,JSON.stringify(row)+' palm floats');
   assert(row.median<.015,JSON.stringify(row)+' palm only touches at an edge');
   assert(row.penetration<.001,JSON.stringify(row)+' palm penetrates thigh');
   assert(row.palmDown>.80,JSON.stringify(row)+' palm turns away from thigh');
   assert(row.skinNormalDown>.70,JSON.stringify(row)+' actual palm triangles face away');
   assert(row.handPenetration<.002,JSON.stringify(row)+' hand or cuff penetrates leg');
   assert(row.wristAngle<.90,JSON.stringify(row)+' folded wrist');
 }
 console.log('FLOOR_CONTACT',JSON.stringify(rows));
});

test('floor sit, cancel and stand are continuous at 30/60/120 Hz including the production handoff',()=>{
 const names=['LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand'];
 for(const side of ['Left','Right'])for(const finger of ['Thumb','Index','Middle','Ring','Pinky'])for(const segment of [1,2,3])names.push(side+'Hand'+finger+segment);
 const maxima={angularStep:0,wristStep:0};
 for(const hz of [30,60,120])for(const name of ['floorSit','floorStand'])for(const reverse of [false,true])for(const production of [false,true]) {
  let previous;
  for(let frame=0;frame<=Math.ceil(clips[name].duration*hz);frame++){
   const t=Math.min(clips[name].duration,frame/hz);sample(name,reverse?clips[name].duration-t:t,production);
   const q=names.map(n=>bone(n).quaternion.clone().normalize()),w=['Left','Right'].map(s=>pos(s+'Hand'));
   if(previous){q.forEach((v,i)=>{const d=v.angleTo(previous.q[i]);maxima.angularStep=Math.max(maxima.angularStep,d);assert(d<.25,`${name} ${hz}Hz ${t} ${names[i]} ${d} rad`)});w.forEach((v,i)=>{const d=v.distanceTo(previous.w[i]);maxima.wristStep=Math.max(maxima.wristStep,d);assert(d<.045,`${name} ${hz}Hz wrist jump ${d}m at ${t}`)});}
   previous={q,w};
  }
 }
 sample('floorSit',clips.floorSit.duration,true);const seated=names.map(n=>bone(n).quaternion.clone().normalize());sample('floorStand',0,true);
 names.forEach((n,i)=>assert(bone(n).quaternion.clone().normalize().angleTo(seated[i])<1e-6,n+' sit/stand handoff'));
 console.log('FLOOR_CONTINUITY',JSON.stringify(maxima));
});

function unchangedDigest(bytes){
 const n=bytes.readUInt32LE(12),d=JSON.parse(bytes.subarray(20,20+n)),start=n+28;
 const bear=d.animations.find(a=>a.name==='bearPickUp');
 if(bear){
  const accessor=Math.min(...bear.samplers.map(s=>s.input)),view=d.accessors[accessor].bufferView;
  d.buffers[0].byteLength=d.bufferViews[view].byteOffset;
  d.accessors.length=accessor;d.bufferViews.length=view;
  d.animations=d.animations.filter(a=>a!==bear);
 }
 const copy=Buffer.from(bytes.subarray(start,start+d.buffers[0].byteLength));
 for(const a of d.animations)if(['floorSit','floorStand'].includes(a.name))for(const c of a.channels){
  const name=d.nodes[c.target.node].name;
  if(c.target.path!=='rotation'||!/^mixamorig(Left|Right)(Shoulder|Arm|ForeArm|Hand)/.test(name))continue;
  const acc=d.accessors[a.samplers[c.sampler].output],view=d.bufferViews[acc.bufferView];copy.fill(0,(view.byteOffset??0)+(acc.byteOffset??0),(view.byteOffset??0)+(acc.byteOffset??0)+acc.count*16);
 }
 return createHash('sha256').update(JSON.stringify(d)).update(copy).digest('hex');
}
test('animation skeleton, pelvis, legs, feet and all unrelated clips retain the original bytes',()=>{
 assert.equal(animations.length,12);assert.equal(raw.length,798224);
 // Normalize the appended bear timing, then exclude only the original floor hand rotations.
 assert.equal(unchangedDigest(raw),'101d0a5a0bc8157b3641a8448fc30a777073a171fee8c639a9d26beeb35173dd');
 if(process.env.FLOOR_BASE)assert.equal(unchangedDigest(raw),unchangedDigest(fs.readFileSync(process.env.FLOOR_BASE)));
});
