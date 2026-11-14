import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./chairMotion.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,module);
const {createChairMotion,stepChairMotion,CHAIR_SIT_SECONDS,CHAIR_REST_LIFT,CHAIR_LIFT_SECONDS}=module.exports;
function advance(s, seconds, {exiting=false,moving=false,reduced=false,fps=60}={}) {
  let result;
  for(let i=0;i<Math.ceil(seconds*fps);i++)result=stepChairMotion(s,1/fps,exiting,moving,reduced);
  return result;
}
test('chair finishes the authored sit before a 1.5 second rise at multiple frame rates',()=>{
 for(const fps of [30,60,120,144]) {
  const s=createChairMotion(); let began=-1,ended=-1;
  for(let i=0;i<fps*6;i++) {
   stepChairMotion(s,1/fps,false,false,false);
   if(s.height>0) { assert.equal(s.time,CHAIR_SIT_SECONDS); if(began<0)began=i/fps; }
   if(s.height===CHAIR_REST_LIFT&&ended<0)ended=i/fps;
  }
  assert(Math.abs(ended-began-CHAIR_LIFT_SECONDS)<=2/fps);
  assert.equal(s.phase,'seated');
 }
});
test('movement and stand requests cannot move or reverse the sit until the lift is down',()=>{
 const s=createChairMotion();advance(s,6);
 const first=stepChairMotion(s,.02,false,true,false);
 assert.equal(first.canMove,false);assert(s.height>0&&s.height<CHAIR_REST_LIFT);
 advance(s,1,{moving:true});assert(s.height>0);assert.equal(s.time,CHAIR_SIT_SECONDS);
 const low=advance(s,.6,{moving:true});assert.equal(s.height,0);assert.equal(low.canMove,true);
 advance(s,3);assert.equal(s.height,CHAIR_REST_LIFT);
 advance(s,1,{exiting:true});assert.equal(s.time,CHAIR_SIT_SECONDS);assert(s.height>0);
 assert(advance(s,4,{exiting:true}).done);assert.equal(s.height,0);assert.equal(s.align,0);
});
test('reversing a rise or cancelling during entry preserves position and always releases the chair',()=>{
 for(const seconds of [.2,.9,2,3.2,4]) {
  const s=createChairMotion();advance(s,seconds);const before=s.height;
  stepChairMotion(s,.001,true,false,false);
  assert(Math.abs(before-s.height)<.001);
  assert(advance(s,6,{exiting:true}).done);
 }
 const s=createChairMotion();advance(s,3.2);const before=s.height;
 stepChairMotion(s,.001,false,true,false);assert(Math.abs(before-s.height)<.001);
 advance(s,.2,{moving:true});advance(s,6);assert.equal(s.height,CHAIR_REST_LIFT);
});
test('reduced motion and large resume deltas keep ordering and finite state',()=>{
 const s=createChairMotion();
 advance(s,2,{reduced:true});assert.equal(s.height,CHAIR_REST_LIFT);
 stepChairMotion(s,60,true,true,false);assert(s.height>0);assert.equal(s.time,CHAIR_SIT_SECONDS);
 assert(advance(s,3,{exiting:true,reduced:true}).done);
 for(const value of Object.values(s))if(typeof value==='number')assert(Number.isFinite(value));
});
