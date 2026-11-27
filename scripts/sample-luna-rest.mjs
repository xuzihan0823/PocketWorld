import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2]), out = process.argv[3];
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const THREE = await import(pathToFileURL(path.join(root,'node_modules/three/build/three.module.js')));
const {GLTFLoader} = await import(pathToFileURL(path.join(root,'node_modules/three/examples/jsm/loaders/GLTFLoader.js')));
const {load} = await import(pathToFileURL(path.join(root,'src/scene/orbital/load-for-validation.mjs')));
const cache = new Map();
function local(file) {
 file=path.resolve(file); if(cache.has(file))return cache.get(file);
 const scope={exports:{},require:id=>id==='three'?THREE:id.includes('GLTFLoader')?{GLTFLoader}:local(path.resolve(path.dirname(file),id.endsWith('.ts')?id:id+'.ts'))};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 cache.set(file,scope.exports);return scope.exports;
}
const {createResidentRig, RESIDENT_SCALE}=local(path.join(root,'src/scene/orbital/residentRig.ts'));
const {sofaPlayer}=local(path.join(root,'src/scene/orbital/sofaMotion.ts'));
const dir=path.join(root,'assets/public/models/resident');
const raw=fs.readFileSync(path.join(dir,'luna-sofa-low-sit.glb'));
const sofa=(await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length),'')).animations[0];
const data={scale:RESIDENT_SCALE,outfits:{}};
for(const [outfit,file] of Object.entries({everyday:'luna-walk-room.glb',ribbon:'luna-ribbon.glb',cardigan:'luna-cardigan.glb'})) {
 const {gltf}=await load(path.join(dir,file));
 const bones=[];gltf.scene.traverse(o=>{if(o.isBone)bones.push(o)});
 let skin;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)skin=o});
 const bind=Object.fromEntries(skin.skeleton.bones.map((b,i)=>[b.name,skin.skeleton.boneInverses[i].clone().invert().toArray()]));
 const rig=createResidentRig(gltf.scene,gltf.animations.find(a=>a.name==='Walk_Grounded_Loop'),outfit==='cardigan');
 const snap=()=>{rig.mesh.updateMatrixWorld(true);const inv=gltf.scene.matrixWorld.clone().invert();return Object.fromEntries(bones.map(b=>[b.name,{world:b.matrixWorld.clone().premultiply(inv).toArray(),local:b.matrix.toArray(),parent:b.parent.isBone?b.parent.name:null}]))};
 rig.applyPose(0,0);const standing=snap();
 const clip=gltf.animations.find(a=>a.name==='Luna_CMU_75_20')??sofa;
 sofaPlayer(rig.mesh,clip)(clip.duration);const seated=snap();
 data.outfits[outfit]={file,bind,standing,seated};
 console.log(outfit, Object.fromEntries(['LeftArm','LeftForeArm','LeftHand','LeftUpLeg','LeftLeg'].map(n=>[n, new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(seated['mixamorig'+n].world)).multiplyScalar(RESIDENT_SCALE).toArray()])));
 rig.dispose();
}
fs.writeFileSync(out,JSON.stringify(data));
