// Sample the current cardigan rig with a compatible, animation-only cabin GLB.
// Usage: node scripts/sample-luna-floor-hands.mjs <root> <base.glb> <output.json>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [rootArg, baseArg, output] = process.argv.slice(2);
const root=path.resolve(rootArg), base=path.resolve(baseArg), require=createRequire(path.join(root,'package.json'));
const ts=require('typescript');
const THREE=await import(pathToFileURL(path.join(root,'node_modules/three/build/three.module.js')));
const {GLTFLoader}=await import(pathToFileURL(path.join(root,'node_modules/three/examples/jsm/loaders/GLTFLoader.js')));
const {load}=await import(pathToFileURL(path.join(root,'src/scene/orbital/load-for-validation.mjs')));
const cache=new Map();
function local(file) {
 file=path.resolve(file); if(cache.has(file))return cache.get(file);
 const scope={exports:{},require:id=>id==='three'?THREE:id.includes('GLTFLoader')?{GLTFLoader}:local(path.resolve(path.dirname(file),id.endsWith('.ts')?id:id+'.ts'))};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 cache.set(file,scope.exports);return scope.exports;
}
const {createResidentRig,RESIDENT_SCALE}=local(path.join(root,'src/scene/orbital/residentRig.ts'));
const model=path.join(root,'assets/public/models/resident/luna-cardigan.glb');
const raw=fs.readFileSync(base), doc=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)));
const {animations,scene:baseScene}=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),'');
const {gltf,mesh}=await load(model);
const rig=createResidentRig(gltf.scene,gltf.animations.find(a=>a.name==='Walk_Grounded_Loop'),true);
const bones=[];gltf.scene.traverse(o=>{if(o.isBone)bones.push(o)});
const bind=Object.fromEntries(mesh.skeleton.bones.map((b,i)=>[b.name,mesh.skeleton.boneInverses[i].clone().invert().toArray()]));
const snap=()=>{rig.mesh.updateMatrixWorld(true);const inv=gltf.scene.matrixWorld.clone().invert();return Object.fromEntries(bones.map(b=>[b.name,{world:b.matrixWorld.clone().premultiply(inv).toArray(),local:b.matrix.toArray(),parent:b.parent.isBone?b.parent.name:null}]))};
rig.applyPose(0,0);const standing=snap();
// Cabin bundles deliberately contain only named animation targets, no bind pose.
// Validate target binding; compare the source character's inverse binds when available.
for (const node of doc.nodes) if (!gltf.scene.getObjectByName(node.name)) throw Error('Missing rig node '+node.name);
const sourceModel=path.join(path.dirname(base),'luna-cardigan.glb');
let bindCompatibility='target names and sampled current rig';
if (fs.existsSync(sourceModel) && path.resolve(sourceModel)!==path.resolve(model)) {
 const source=(await load(sourceModel)).mesh;
 if(source.skeleton.bones.length!==mesh.skeleton.bones.length)throw Error('Skeleton count changed');
 let delta=0;
 source.skeleton.bones.forEach((b,i)=>{
  const j=mesh.skeleton.bones.findIndex(n=>n.name===b.name);if(j<0)throw Error('Missing bind '+b.name);
  source.skeleton.boneInverses[i].elements.forEach((v,k)=>{delta=Math.max(delta,Math.abs(v-mesh.skeleton.boneInverses[j].elements[k]));});
 });
 if(delta>1e-6)throw Error('Incompatible inverse binds '+delta);
 bindCompatibility={sourceBoneCount:source.skeleton.bones.length,maxInverseBindDelta:delta};
}
const data={scale:RESIDENT_SCALE,baseSha256:createHash('sha256').update(raw).digest('hex'),file:'luna-cardigan.glb',bind,standing,compatibility:bindCompatibility,clips:{}};
for(const name of ['floorSit','floorStand']) {
 const clip=animations.find(a=>a.name===name);if(!clip)throw Error('Missing '+name);
 const tracks=clip.tracks.map(t=>{const {nodeName,propertyName}=THREE.PropertyBinding.parseTrackName(t.name);const bone=gltf.scene.getObjectByName(nodeName);if(!bone)throw Error('Unbound '+t.name);return {bone,propertyName,sample:t.createInterpolant()}});
 const times=Array.from(clip.tracks[0].times),frames=[];
 for(const time of times) {
  rig.applyPose(0,0);
  for(const {bone,propertyName,sample} of tracks)bone[propertyName].fromArray(sample.evaluate(time));
  frames.push(snap());
 }
 data.clips[name]={duration:clip.duration,times,frames};
 console.log(name,clip.duration,times.length,Object.fromEntries(['LeftHand','RightHand','LeftUpLeg','LeftLeg','RightUpLeg','RightLeg'].map(n=>[n,new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(frames[name==='floorSit'?frames.length-1:0]['mixamorig'+n].world)).multiplyScalar(RESIDENT_SCALE).toArray()])));
}
fs.writeFileSync(output,JSON.stringify(data));console.log('Compatibility',JSON.stringify(data.compatibility),'base SHA256',data.baseSha256);rig.dispose();
