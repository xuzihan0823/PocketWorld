import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createResidentRig, WALK_SPEED } from '../residentRig';
import { chairSeatFit, chairScootFit, CHAIR_STAND_OFFSET, createChairMotion, advanceChairMotion } from '../chairMotion';
import { SEAT_DROP } from '../chairPose';
import { cloneSuppliedModel } from '../supplied-model';

const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);renderer.setClearColor('#b7c4d1');renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true;document.body.prepend(renderer.domElement);
const scene=new T.Scene(), camera=new T.PerspectiveCamera(33,1,.01,100);
scene.add(new T.HemisphereLight(0xffffff,0x687980,2));
const light=new T.DirectionalLight(0xfff5df,3);light.position.set(2,4,3);light.castShadow=true;light.shadow.mapSize.set(2048,2048);scene.add(light);
Object.assign(light.shadow.camera,{left:-2,right:2,top:2,bottom:-2,near:.1,far:10});light.shadow.bias=-.0001;light.shadow.normalBias=.012;
const fill=new T.DirectionalLight(0xc5dfff,1);fill.position.set(-3,2,-2);scene.add(fill);
const floor=new T.Mesh(new T.PlaneGeometry(30,30),new T.MeshStandardMaterial({color:'#b7c4d1',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const loader=new GLTFLoader(),base=import.meta.env.BASE_URL;
const [gltf,clip,toy,...chairs]=await Promise.all([
  loader.loadAsync(base+'models/resident/luna-walk-room.glb'),loader.loadAsync(base+'models/resident/luna-chair-sit.glb'),
  loader.loadAsync(base+'models/resident/luna-bunny-refined.glb'),
  ...['rolling','lounge'].map(k=>loader.loadAsync(base+`models/replaced/${k}-chair.parts.glb`)),
]);
const rig=createResidentRig(clone(gltf.scene),gltf.animations[0],toy.scene,clip.animations[0]);scene.add(rig.mesh);
const seats:T.Group[]=[];
const furniture=chairs.map(({scene:asset},i)=>{
  const group=new T.Group(),b=new T.Box3().setFromObject(asset),extent=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());
  for(const part of ['base','seat']){
    const moving=new T.Group(),fit=new T.Group(),model=cloneSuppliedModel(asset,part);
    fit.scale.set((i?1.04:.9)/extent.x,1.4/extent.y,(i?1:.9)/extent.z);model.position.set(-center.x,-b.min.y,-center.z);
    fit.add(model);moving.add(fit);group.add(moving);if(part==='seat')seats.push(moving);else moving.rotation.y=.2;
  }scene.add(group);return group;
});
const el=(id:string)=>document.getElementById(id)!;
let room='habitat',view='side',playing=false,time=0,previous=performance.now();
function draw(clipTime:number,weight=1,offset=CHAIR_STAND_OFFSET,perch=0,sole=.03,soleLift=.06,walkPhase=0,walkWeight=0){
  const lounge=room==='observatory',fit=chairSeatFit(clipTime,weight,lounge);
  const scoot=chairScootFit(perch);
  furniture.forEach((f,i)=>f.visible=i===(lounge?1:0));seats.forEach(s=>s.position.y=-SEAT_DROP*perch);
  rig.mesh.position.set(0,fit.y-SEAT_DROP*perch+scoot.y,offset+fit.z+scoot.z);
  rig.applyPose(walkPhase,walkWeight,true,{time:clipTime,weight,perch,sole,soleLift});scene.updateMatrixWorld(true);
  const positions:Record<string,number[]>={front:[0,1.02,3.8],side:[3.8,1.02,.2],back:[0,1.02,-3.8],left:[-3.8,1.02,.2],top:[0,4,.1],perspective:[2.6,1.8,3.2]};
  camera.position.fromArray(positions[view]);camera.lookAt(0,.83,.18);renderer.render(scene,camera);
}
function seek(t:number){
  time=t;const motion=createChairMotion(.86,room==='observatory');
  let walkPhase=0,walkWeight=0;
  for(let elapsed=0;elapsed<t;elapsed+=1/120){
    const dt=Math.min(1/120,t-elapsed),step=advanceChairMotion(motion,dt,elapsed>=8,false,.53);
    walkPhase=(walkPhase+step.travel/WALK_SPEED+1)%1;
    walkWeight=['backing','leaving'].includes(motion.phase)?Math.min(1,walkWeight+dt/.14):0;
  }
  draw(motion.time,motion.weight,motion.offset,0,.03,.06,walkPhase,T.MathUtils.smoothstep(walkWeight,0,1));
  (el('time') as HTMLInputElement).value=String(t);el('clock').textContent=`${t.toFixed(2)} s · ${motion.phase}`;
  return motion;
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);seek(time);}addEventListener('resize',resize);resize();
el('play').onclick=()=>{playing=!playing;el('play').textContent=playing?'暂停':'正常速度播放';};el('reset').onclick=()=>{time=0;playing=true;el('play').textContent='暂停';};
el('time').oninput=()=>{playing=false;seek(Number((el('time') as HTMLInputElement).value));};
el('room').onchange=()=>{room=(el('room') as HTMLSelectElement).value;seek(time);};
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view!;seek(time);});
renderer.setAnimationLoop(now=>{const dt=Math.min((now-previous)/1000,.05);previous=now;if(playing)seek(time+dt>13?0:time+dt);});
const review={rig,scene,camera,renderer,seek,render(t=3,v='side',r='habitat',perch=0,sole=.03,soleLift=.06){playing=false;view=v;room=r;draw(t,1,CHAIR_STAND_OFFSET+(r==='observatory'?.065:0),perch,sole,soleLift);el('clock').textContent=`片段 ${t.toFixed(2)} s`;},play(){time=0;playing=true;},pause(){playing=false;},get time(){return time;}};
Object.assign(window,{review});
