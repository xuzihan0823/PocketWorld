import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { load } from './resident-glb-loader.mjs';

const steps = [['Left', 3/30, 15/30], ['Right', 17/30, 29/30], ['Left', 31/30, 44/30], ['Right', 46/30, 59/30]];
function support(clip, side, t) {
  if (clip === 'SitCycle') return !steps.some(([s,a,b]) => s === side && t > a + 1e-6 && t < b - 1e-6);
  return ((t / 1.2 + (side === 'Left' ? 0 : .5)) % 1) <= 7/12 + 1e-7;
}
async function audit(file) {
  const model = await load(file), mesh = model.mesh, p = new THREE.Vector3();
  model.select('SitCycle')(2.1);
  const soles = { Left: [], Right: [] };
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i,p); mesh.localToWorld(p);
    if (p.y < .005) soles[p.x > 0 ? 'Left' : 'Right'].push(i);
  }
  assert.ok(soles.Left.length>30 && soles.Right.length>30,JSON.stringify(soles));
  const result = {};
  for (const clip of ['SitCycle','Walk']) {
    const pose = model.select(clip), seconds = clip === 'Walk' ? 2.4 : 2.1;
    const anchors = {}, previous = {};
    let maxAnchorDrift = 0, maxSoleDrift = 0, minFloor = Infinity, maxSupportHeight = -Infinity;
    let maxAnchorStep = 0, airborneFrames = 0, supportFrames = 0;
    const maxAt = {};
    for (let i=0; i<=Math.round(seconds*120); i++) {
      const time=i/120;
      pose(clip === 'Walk' ? time % 1.2 : time);
      const translation = clip === 'Walk' ? new THREE.Vector3(0,0,.25*time) : new THREE.Vector3();
      let nearest=Infinity;
      for (const side of ['Left','Right']) {
        const ankle = model.bone(side+'Foot').getWorldPosition(new THREE.Vector3()).add(translation);
        const points=soles[side].map(index=>{mesh.getVertexPosition(index,p);mesh.localToWorld(p);return p.clone().add(translation)});
        const floor=Math.min(...points.map(v=>v.y));
        if(floor<minFloor){minFloor=floor;maxAt.floorTime=time;maxAt.floorSide=side;}
        nearest=Math.min(nearest,floor);
        if (previous[side]) maxAnchorStep=Math.max(maxAnchorStep,ankle.distanceTo(previous[side]));
        previous[side]=ankle;
        if (support(clip,side,time)) {
          supportFrames++;
          maxSupportHeight=Math.max(maxSupportHeight,floor);
          if (!anchors[side]) anchors[side]={ankle,points};
          const drift=ankle.distanceTo(anchors[side].ankle);
          if(drift>maxAnchorDrift){maxAnchorDrift=drift; maxAt.time=time;maxAt.side=side}
          maxSoleDrift=Math.max(maxSoleDrift,...points.map((v,j)=>v.distanceTo(anchors[side].points[j])));
        } else anchors[side]=null;
      }
      if(nearest>.001)airborneFrames++;
    }
    result[clip]={samples:Math.round(seconds*120)+1,supportFrames,maxAnchorDrift,maxSoleDrift,minFloor,maxSupportHeight,airborneFrames,maxAnchorStep,maxAt};
  }
  // In-place looping must match at both boundaries, for every animated channel.
  const pose=model.select('Walk'); pose(0);
  const start=mesh.skeleton.bones.map(b=>b.matrixWorld.clone());
  const morphs=[...mesh.morphTargetInfluences];pose(1.2);
  result.loop={boneMatrixError:Math.max(...mesh.skeleton.bones.flatMap((b,i)=>b.matrixWorld.elements.map((v,j)=>Math.abs(v-start[i].elements[j])))),
    morphError:Math.max(...morphs.map((v,i)=>Math.abs(v-mesh.morphTargetInfluences[i])))};
  const midStance = [];
  for (const [side,time] of [['Left',.35],['Right',.95]]) {
    pose(time);
    const [hip,knee,ankle] = ['UpLeg','Leg','Foot'].map(name=>model.bone(side+name).getWorldPosition(new THREE.Vector3()));
    midStance.push({side,time,kneeDegrees:THREE.MathUtils.radToDeg(knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)))});
  }
  pose(0);
  const footRest=model.bone('LeftFoot').getWorldQuaternion(new THREE.Quaternion()).invert();
  let minPitch=Infinity,maxPitch=-Infinity;
  const legs=[],arms=[];
  for(let i=0;i<144;i++) {
    pose(i/120);
    const rotation=model.bone('LeftFoot').getWorldQuaternion(new THREE.Quaternion()).multiply(footRest);
    const pitch=new THREE.Euler().setFromQuaternion(rotation).x;
    minPitch=Math.min(minPitch,pitch);maxPitch=Math.max(maxPitch,pitch);
    const world=name=>model.bone(name).getWorldPosition(new THREE.Vector3());
    legs.push(world('LeftFoot').z-world('LeftUpLeg').z);
    arms.push(world('LeftHand').z-world('LeftArm').z);
  }
  const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
  const meanLeg=mean(legs),meanArm=mean(arms);
  const covariance=legs.reduce((s,x,i)=>s+(x-meanLeg)*(arms[i]-meanArm),0);
  const correlation=covariance/Math.sqrt(legs.reduce((s,x)=>s+(x-meanLeg)**2,0)*arms.reduce((s,x)=>s+(x-meanArm)**2,0));
  result.gaitShape={midStance,footPitchDegrees:[minPitch,maxPitch].map(THREE.MathUtils.radToDeg),sameSideArmLegCorrelation:correlation};
  return {sha256:model.sha256,clips:result};
}
const after=await audit('public/models/resident/luna-tripo-transitions.glb');
const before=process.env.BASELINE_GLB ? await audit(process.env.BASELINE_GLB) : undefined;
const report={fps:120,units:'model units; height approximately 0.98',walkRootSpeed:.25,stanceRatio:7/12,before,after};
console.log(JSON.stringify(report,null,2));
await fs.writeFile('art/resident/tripo-transitions/walk-validation.json',JSON.stringify(report,null,2)+'\n');
if(!process.argv.includes('--report-only')) {
 for(const clip of ['Walk','SitCycle']) {
  const r=after.clips[clip];
  assert.ok(r.maxAnchorDrift<.0006,JSON.stringify(r));
  assert.ok(r.maxSoleDrift<.001,JSON.stringify(r));
  assert.equal(r.airborneFrames,0);
  assert.ok(r.minFloor>-.0005 && r.maxSupportHeight<.0005,JSON.stringify(r));
  assert.ok(r.maxAnchorStep<.02,JSON.stringify(r));
 }
 assert.ok(after.clips.loop.boneMatrixError<1e-5 && after.clips.loop.morphError<1e-5);
 assert.ok(after.clips.gaitShape.midStance.every(sample=>sample.kneeDegrees<12),JSON.stringify(after.clips.gaitShape));
 assert.ok(after.clips.gaitShape.footPitchDegrees[0]<-10 && after.clips.gaitShape.footPitchDegrees[1]>15);
 assert.ok(after.clips.gaitShape.sameSideArmLegCorrelation<-.5,JSON.stringify(after.clips.gaitShape));
}
