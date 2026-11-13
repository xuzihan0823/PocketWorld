import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled=ts.transpileModule(fs.readFileSync(new URL('./audioEngine.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function setup() {
  const nodes=[], intervals=new Set(), audios=[];
  let reject=false;
  const param=()=>({value:1,setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;}});
  const node=kind=>{const n={kind,gain:param(),frequency:param(),connect(to){this.to=to;},disconnect(){this.disconnected=true;},start(){},stop(){this.onended?.();}};nodes.push(n);return n;};
  class Context { state='running';currentTime=0;destination={};createGain(){return node('gain');}createOscillator(){return node('osc');}async resume(){} }
  class Audio { paused=true;volume=1;muted=false;currentTime=0;constructor(src){this.src=src;audios.push(this);}async play(){if(reject)throw Error('blocked');this.paused=false;}pause(){this.paused=true;this.onpause?.();}removeAttribute(){this.src='';}load(){} }
  const context={exports:{},Audio,window:{AudioContext:Context,setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}},require(){return {};}};
  vm.runInNewContext(compiled,context);
  return {engine:context.exports.roomAudio,discs:context.exports.PRESET_MUSIC_DISCS,nodes,intervals,audios,set reject(value){reject=value;}};
}

test('synth transport fade is independent of mute and mechanical effects; pause releases voices/timer', async()=>{
 const {engine,discs,nodes,intervals}=setup();engine.setMusicLevel(0);await engine.startMusic(discs[0]);
 const master=nodes[0],envelope=nodes[1];assert.equal(envelope.gain.value,0);assert.equal(envelope.to,master);
 engine.setMusicLevel(.5);assert.equal(envelope.gain.value,.5);assert.equal(master.gain.value,1);
 engine.playSfx('soft');assert.equal(nodes.at(-1).to,master);
 engine.setMuted(true);assert.equal(master.gain.value,0);engine.setMusicLevel(.8);assert.equal(master.gain.value,0);
 engine.setMuted(false);assert.equal(master.gain.value,1);assert.equal(envelope.gain.value,.8);
 engine.pauseMusic();assert.equal(intervals.size,0);assert.equal(engine.getSnapshot().isPlaying,false);
});

test('imported audio uses the prepared element, starts silent, fades, mutes and retains position on resume',async()=>{
 const {engine,audios}=setup();const local={id:'local',title:'local',audioUrl:'blob:local',discThemeColor:['#fff','#000']};
 engine.prepareMusic(local);await Promise.resolve();engine.setMusicLevel(0);await engine.startMusic(local);
 assert.equal(audios.length,1);const audio=audios[0];assert.equal(audio.volume,0);
 engine.setMusicLevel(.5);assert.equal(audio.volume,.325);engine.setMuted(true);assert.equal(audio.muted,true);
 audio.currentTime=12;engine.pauseMusic();assert.equal(audio.paused,true);await engine.resumeMusic();assert.equal(audio.currentTime,12);
 engine.setMuted(false);assert.equal(audio.muted,false);engine.stopMusic();assert.equal(audio.src,'');
});

test('rejected and cancelled playback never becomes playing; prepared resources are disposed',async()=>{
 const state=setup(),{engine,discs,audios}=state;
 const local={...discs[0],id:'local',audioUrl:'blob:test'};engine.prepareMusic(local);await Promise.resolve();engine.cancelPreparedMusic();assert.equal(audios[0].src,'');
 state.reject=true;assert.equal(await engine.startMusic(local),false);assert.equal(engine.getSnapshot().status,'error');
 state.reject=false;const pending=engine.startMusic(local);engine.pauseMusic();assert.equal(await pending,false);assert.equal(engine.getSnapshot().isPlaying,false);
});
