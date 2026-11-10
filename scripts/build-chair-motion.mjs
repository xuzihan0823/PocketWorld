/** Bake chair-specific animation tracks against the accepted GLB, without exporting its skin.
 * The small sidecar GLB contains animation targets, not a replacement resident or chair.
 * Rebuild: node scripts/build-chair-motion.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as THREE from 'three';
import { load } from './resident-glb-loader.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'public/models/resident/luna-tripo-transitions.glb');
const original = fs.readFileSync(source);
const sourceHash = crypto.createHash('sha256').update(original).digest('hex');
if (sourceHash !== '5e1da819d580426618934abf4fc29acc9b92264fff2d9bacf20565a255272ec6') throw Error('Resident baseline changed: review before rebuilding');
function module(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: n => n === 'three' ? THREE : dependencies[n] }); return exports;
}
const dir = 'src/scene/orbital/';
const mode = module(dir + 'secondary/residentMode.ts');
const poses = module(dir + 'chairPose.ts', { './secondary/residentMode': mode });
const seatingModule = module(dir + 'chair/ChairSeating.ts', { '../chairPose': poses, '../secondary/residentMode': mode });
const { plantLeg } = module(dir + 'chair/TurnFootPlant.ts');
const { ImportedPose } = module(dir + 'chair/ImportedPose.ts');
const { ChairContact } = module(dir + 'chair/ChairContact.ts', { '../chairPose': poses, './ChairSeating': seatingModule, './TurnFootPlant': { plantLeg } });
const m = await load(source), sample = m.select('SitCycle');
// select() resets local TRS, so room scale MUST be applied after selecting the clip.
const actor = new THREE.Group(), room = new THREE.Group(); room.add(actor); actor.add(m.gltf.scene);
m.gltf.scene.scale.setScalar(1.45); actor.position.z = .29;
Object.assign(poses.CHAIR_POSES.habitat, { x: 0, z: 0, yaw: .2 - Math.PI });
const v = (...a) => new THREE.Vector3(...a), q = () => new THREE.Quaternion();
const X = v(1, 0, 0), Y = v(0, 1, 0), Z = v(0, 0, 1), rad = Math.PI / 180;
const update = () => { room.updateMatrixWorld(true); m.mesh.skeleton.update(); };
sample(2.4); update();
const base = m.mesh.skeleton.bones.map(b => ({ bone: b, position: b.position.clone(), rotation: b.quaternion.clone(), scale: b.scale.clone() }));
const position = b => actor.worldToLocal(b.getWorldPosition(v()));
const initialHip = position(m.bone('Hips'));
const feet = ['Left', 'Right'].map(side => ({ side, thigh: m.bone(side + 'UpLeg'), shin: m.bone(side + 'Leg'), foot: m.bone(side + 'Foot'),
  target: m.bone(side + 'Foot').getWorldPosition(v()), orientation: m.bone(side + 'Foot').getWorldQuaternion(q()) }));
const contact = new ChairContact(m.mesh, actor);
const imported = new ImportedPose(m.gltf.scene);
const clothIds = Array.from(contact.regions, (r,i) => r===1 ? i : -1).filter(i=>i>=0);
const contactState = { sitting: true, phase: 'SIT_DOWN', clipTime: 2.4 };
const smooth = t => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const blend = (t, a, b) => smooth((t - a) / (b - a));
// Monotone cubic Hermite: continuous velocities through motion phases, flat at extrema.
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys.at(-1)[0]) return keys.at(-1)[1];
  const slope = i => {
    if (i === 0 || i === keys.length - 1) return 0;
    const a = (keys[i][1] - keys[i - 1][1]) / (keys[i][0] - keys[i - 1][0]);
    const b = (keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]);
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  };
  let i = 0; while (keys[i + 1][0] < t) i++;
  const h = keys[i + 1][0] - keys[i][0], u = (t - keys[i][0]) / h;
  return (2*u**3-3*u*u+1)*keys[i][1] + (u**3-2*u*u+u)*h*slope(i) + (-2*u**3+3*u*u)*keys[i+1][1] + (u**3-u*u)*h*slope(i+1);
}
function rotate(b, axis, degrees) {
  const world = b.getWorldQuaternion(q());
  b.quaternion.copy(b.parent.getWorldQuaternion(q()).invert()).multiply(q().setFromAxisAngle(axis, degrees * rad)).multiply(world).normalize();
  b.updateWorldMatrix(false, true);
}
function setHip(target) {
  m.bone('Hips').position.copy(m.bone('Hips').parent.worldToLocal(actor.localToWorld(target)));
  m.bone('Hips').updateWorldMatrix(false, true);
}
function lean(degrees) {
  const h = position(m.bone('Hips')), n = position(m.bone('Neck'));
  const current = Math.atan2(n.z - h.z, n.y - h.y) / rad;
  const change = degrees - current;
  rotate(m.bone('Spine'), X, change * .55);
  rotate(m.bone('Spine1'), X, change * .32);
  rotate(m.bone('Spine2'), X, change * .24);
  const n2 = position(m.bone('Neck'));
  rotate(m.bone('Spine'), X, degrees - Math.atan2(n2.z-h.z,n2.y-h.y)/rad);
}
function palm(hand, side, weight) {
  const current = hand.getWorldPosition(v()), currentQ = hand.getWorldQuaternion(q());
  const direction = m.bone(side + 'HandMiddle1').getWorldPosition(v()).sub(current).normalize();
  const swing = q().setFromUnitVectors(direction, Z);
  const across = m.bone(side + 'HandIndex1').getWorldPosition(v()).sub(m.bone(side + 'HandPinky1').getWorldPosition(v())).applyQuaternion(swing);
  across.addScaledVector(Z, -across.dot(Z)).normalize();
  const desired = v(side === 'Left' ? -1 : 1, 0, 0);
  const twist = Math.atan2(Z.dot(across.clone().cross(desired)), across.dot(desired));
  return currentQ.clone().slerp(q().setFromAxisAngle(Z, twist).multiply(swing).multiply(currentQ), weight);
}
const hipY = [[0,initialHip.y],[.18,initialHip.y],[.46,.758],[.7,.650],[.9,.540],[1,.502],[1.08,.490],[1.17,.493],[1.3,.492],[1.8,.492]];
const hipZ = [[0,0],[.18,-.006],[.46,-.065],[.76,-.190],[1,-.288],[1.12,-.296],[1.24,-.296],[1.5,-.292],[1.8,-.292]];
const torso = [[0,-6.438],[.18,4],[.46,11],[.70,12],[.92,7],[1.08,3],[1.18,4],[1.45,1],[1.8,1]];
const pelvisPitch = [[0,0],[.18,1],[.46,4],[.9,5],[1.08,3],[1.24,2],[1.8,2]];
const inverseSmooth = value => { let a=0,b=1; for(let i=0;i<24;i++){const c=(a+b)/2;if(smooth(c)<value)a=c;else b=c;} return (a+b)/2; };
function author(time, kind) {
  let t = time, breathing = 0, rise = kind === 'ChairStandUp';
  if (kind === 'ChairSeatedIdle') { t = 1.8; breathing = .23 * (1 - Math.cos(time * Math.PI / 2)); }
  if (rise) t = curve([[0,1.8],[.3,1.8],[.55,.90],[1,.55],[1.45,.18],[1.7,0]],time);
  const descend = THREE.MathUtils.clamp((initialHip.y - curve(hipY,t)) / (initialHip.y - .492),0,1);
  // Use existing authored clearance morphs/dress as a starting point; body channels below are independent.
  imported.sample(() => sample(2.4 + 1.7 * inverseSmooth(descend)));
  for (const item of base) if (!item.bone.name.startsWith('Dress_')) {
    item.bone.position.copy(item.position); item.bone.quaternion.copy(item.rotation); item.bone.scale.copy(item.scale);
  }
  update();
  const hip = initialHip.clone(); hip.y = curve(hipY,t); hip.z += curve(hipZ,t);
  setHip(hip); rotate(m.bone('Hips'), X, curve(pelvisPitch,t));
  const tilt = rise ? curve([[0,1],[.25,12],[.6,12],[1.05,7],[1.5,-3],[1.7,-6.438]],time) : curve(torso,t) + breathing;
  lean(tilt);
  rotate(m.bone('Neck'),X,-Math.max(0,tilt)*.14);
  rotate(m.bone('Head'),X,-Math.max(0,tilt)*.16 + (rise?0:curve([[0,0],[1,0],[1.12,1.3],[1.28,-.3],[1.65,0],[1.8,0]],t)));
  for (const leg of feet) plantLeg(leg.thigh,leg.shin,leg.foot,leg.target.clone(),leg.orientation.clone(),Z);
  contactState.clipTime=2.4+1.7*descend;
  contact.poseDress(contactState);
  update();
  const cloth = descend > .5 ? clothIds.map(i=>actor.worldToLocal(m.mesh.getVertexPosition(i,v()).applyMatrix4(m.mesh.matrixWorld))) : [];
  for (const [side,sign,delay] of [['Left',1,0],['Right',-1,.045]]) {
    const shoulder = m.bone(side+'Shoulder'), arm=m.bone(side+'Arm'), forearm=m.bone(side+'ForeArm'), hand=m.bone(side+'Hand');
    const relax = blend(t,.24,1.28);
    rotate(shoulder,Z,-sign*2.4*relax); rotate(shoulder,Y,-sign*1.8*relax);
    const settle = rise ? 1-blend(time,0,.30) : blend(t,1.28+delay,1.8);
    const hanging = position(hand), clear = blend(t,.36,.97);
    const target = hanging.lerp(v(sign*.232,hip.y+.035,hip.z+.09),clear);
    // Lap follows this pose's thigh instead of a constant actor-space coordinate.
    const thigh=position(m.bone(side+'UpLeg')), knee=position(m.bone(side+'Leg'));
    const lap=thigh.lerp(knee,.57);lap.x=sign*.145;lap.y+=.075;lap.z-=.035;
    // Skin-based upper envelope under palm/fingers; keeps the hand above the raised skirt folds.
    for(const p of cloth) if(Math.abs(p.x-lap.x)<.042 && p.z>lap.z-.025 && p.z<lap.z+.075 && p.y<hip.y+.19)
      lap.y=Math.max(lap.y,p.y+.022);
    target.lerp(lap,settle);
    const weight=blend(t,.16,.55);
    const rotations=[arm.quaternion.clone(),forearm.quaternion.clone(),hand.quaternion.clone()];
    plantLeg(arm,forearm,hand,actor.localToWorld(target),palm(hand,side,settle),v(sign*.65,-.25,-.8).normalize());
    [arm,forearm,hand].forEach((bone,i)=>bone.quaternion.copy(rotations[i].slerp(bone.quaternion,weight)));
    arm.updateWorldMatrix(false,true);
  }
  update();
}

const doc = JSON.parse(original.subarray(20,20+original.readUInt32LE(12)));
const output = { asset:{version:'2.0',generator:'PocketWorld chair motion baker'},scene:0,scenes:doc.scenes,nodes:doc.nodes.map(n=>{const c=structuredClone(n);delete c.skin;delete c.camera;return c;}),
  buffers:[{byteLength:0}],bufferViews:[],accessors:[],animations:[],extras:{sourceSha256:sourceHash,description:'Animation targets only; apply clips to the accepted resident scene. Never render this placeholder mesh.'} };
const chunks=[];let byteLength=0;
function accessor(values,type,count,{bounds=false}={}){
  const floats=new Float32Array(values), buffer=Buffer.from(floats.buffer);const view=output.bufferViews.length;
  output.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:buffer.length});chunks.push(buffer);byteLength+=buffer.length;
  const result={bufferView:view,componentType:5126,count,type};
  if(bounds){const n=values.length/count;result.min=Array.from({length:n},(_,c)=>Math.min(...values.filter((_,i)=>i%n===c)));result.max=Array.from({length:n},(_,c)=>Math.max(...values.filter((_,i)=>i%n===c)));}
  output.accessors.push(result);return output.accessors.length-1;
}
// glTF weights channels need a named mesh with morph slots. A zero-area placeholder is never mounted.
const zero=accessor(Array(9).fill(0),'VEC3',3,{bounds:true});
output.meshes=[{name:doc.meshes[0].name,weights:Array(49).fill(0),extras:doc.meshes[0].extras,primitives:[{attributes:{POSITION:zero},targets:Array.from({length:49},()=>({POSITION:zero}))}]}];
const meshNode=doc.nodes.findIndex(n=>n.mesh===0),names=new Map(doc.nodes.map((n,i)=>[n.name,i]));
const samples=[];
for(const [name,duration]of [['ChairSitDown',1.8],['ChairSeatedIdle',4],['ChairStandUp',1.7]]){
  const frames=Math.round(duration*60)+1,times=Array.from({length:frames},(_,i)=>i/60),tracks=new Map(),hipPositions=[],weights=[];
  for(const item of base)tracks.set(item.bone.name,[]);
  for(const time of times){
    author(time,name);
    for(const item of base)tracks.get(item.bone.name).push(...item.bone.quaternion.toArray());
    hipPositions.push(...m.bone('Hips').position.toArray());weights.push(...m.mesh.morphTargetInfluences);
    if(name==='ChairSitDown'&&Math.round(time*60)%6===0)samples.push({t:time,hips:position(m.bone('Hips')).toArray(),neck:position(m.bone('Neck')).toArray(),leftKnee:position(m.bone('LeftLeg')).toArray(),leftFoot:position(m.bone('LeftFoot')).toArray(),leftHand:position(m.bone('LeftHand')).toArray()});
  }
  const animation={name,samplers:[],channels:[]},input=accessor(times,'SCALAR',frames,{bounds:true});
  const channel=(node,path,values,type,count)=>{const index=animation.samplers.length;animation.samplers.push({input,output:accessor(values,type,count),interpolation:'LINEAR'});animation.channels.push({sampler:index,target:{node,path}});};
  for(const item of base){const node=names.get(item.bone.name.replace(/^mixamorig/,'mixamorig:'));if(node===undefined)throw Error(item.bone.name);channel(node,'rotation',tracks.get(item.bone.name),'VEC4',frames);}
  channel(names.get('mixamorig:Hips'),'translation',hipPositions,'VEC3',frames);
  channel(meshNode,'weights',weights,'SCALAR',frames*49);
  output.animations.push(animation);
}
output.buffers[0].byteLength=byteLength;
const jsonRaw=Buffer.from(JSON.stringify(output)),json=Buffer.alloc(Math.ceil(jsonRaw.length/4)*4,32);jsonRaw.copy(json);
const binary=Buffer.concat(chunks),result=Buffer.alloc(28+json.length+binary.length);
result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(binary.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);binary.copy(result,28+json.length);
fs.writeFileSync(path.join(root,'public/models/resident/luna-chair-motion.glb'),result);
const reportDir=path.join(root,'art/resident/chair-motion');fs.mkdirSync(reportDir,{recursive:true});
fs.writeFileSync(path.join(reportDir,'authoring.json'),JSON.stringify({sourceHash,scale:1.45,durations:{ChairSitDown:1.8,ChairSeatedIdle:4,ChairStandUp:1.7},hipY,hipZ,torso,pelvisPitch,samples,bytes:result.length},null,2));
contact.dispose();
console.log(JSON.stringify({sourceHash,bytes:result.length,clips:output.animations.map(a=>a.name)}));
