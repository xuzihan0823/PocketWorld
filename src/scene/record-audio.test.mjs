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
  const context={exports:{},Audio,window:{AudioContext:Context,setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}},require(name){assert.ok(name.endsWith('.mp3'));return {default:name};}};
  vm.runInNewContext(compiled,context);
  return {engine:context.exports.roomAudio,discs:context.exports.PRESET_MUSIC_DISCS,nodes,intervals,audios,set reject(value){reject=value;}};
}

test('preset collection bundles the three supplied C418 tracks and retains one synth record', () => {
 const {discs,audios}=setup();
 assert.deepEqual(Array.from(discs,disc=>disc.title),['Sweden','Aria Math','Subwoofer Lullaby','微缩梦境 (Diorama Reverie)']);
 assert.equal(new Set(discs.map(disc=>disc.id)).size,4);
 assert.equal(audios.length,0,'loading the catalog must not preload audio');
 for(const disc of discs.slice(0,3)) {
  assert.equal(disc.artist,'C418');assert.equal(disc.synthPreset,undefined);
  assert.ok(disc.audioUrl.startsWith('../../assets/audio/records/'));
  assert.ok(fs.statSync(new URL(disc.audioUrl,import.meta.url)).size>1_000_000);
  assert.ok(disc.duration>200 && disc.duration<=310);
 }
 assert.equal(discs[3].audioUrl,'synth:starlight-dream');
});

test('bundled records reuse prepared audio, loop, release the previous track and survive pause/mute', async()=>{
 const {engine,discs,audios}=setup();
 for(const disc of discs.slice(0,3)) {
  const previous=audios.at(-1);
  engine.prepareMusic(disc);await Promise.resolve();
  engine.setMusicLevel(0);assert.equal(await engine.startMusic(disc),true);
  const audio=audios.at(-1);
  assert.equal(audio.src,disc.audioUrl);assert.equal(audio.loop,true);assert.equal(audio.volume,0);
  if(previous) {assert.equal(previous.src,'');assert.equal(previous.paused,true);}
  engine.setMusicLevel(1);assert.equal(audio.volume,.65);
  const count=audios.length;await engine.startMusic(disc);assert.equal(audios.length,count);
  audio.currentTime=20;engine.pauseMusic();assert.equal(audio.paused,true);
  engine.setMuted(true);await engine.resumeMusic();assert.equal(audio.muted,true);assert.equal(audio.currentTime,20);
  engine.setMuted(false);assert.equal(audio.muted,false);
  assert.equal(engine.getSnapshot().disc.id,disc.id);
 }
 engine.stopMusic();assert.equal(audios.at(-1).src,'');assert.equal(engine.getSnapshot().status,'idle');
});

test('synth transport fade is independent of mute and mechanical effects; pause releases voices/timer', async()=>{
 const {engine,discs,nodes,intervals}=setup();engine.setMusicLevel(0);await engine.startMusic(discs.find(disc=>disc.synthPreset));
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

test('Tuanzi meows once per interaction, reuses the sample, and stops when muted', () => {
  const { engine, audios } = setup();
  const meow = './assets/tuanzi-meow.mp3';
  engine.setMuted(true);
  engine.playCatMeow(meow);
  assert.equal(audios.length, 0);
  engine.setMuted(false);
  engine.playCatMeow(meow);
  const [audio] = audios;
  assert.equal(audio.src, meow);
  assert.equal(audio.paused, false);
  audio.currentTime = .3;
  engine.playCatMeow(meow);
  assert.equal(audios.length, 1);
  assert.equal(audio.currentTime, .3, 'a second request does not restart the sound that is playing');
  engine.setMuted(true);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  engine.setMuted(false);
  assert.equal(audio.paused, true, 'unmuting does not replay an old reply');
  engine.playCatMeow(meow);
  assert.equal(audios.length, 1);
  assert.equal(audio.paused, false);
  engine.stopCatMeow();
  assert.equal(audio.paused, true);
});

test('a blocked cat audio playback can be retried on the next interaction', async () => {
  const state = setup();
  const meow = './assets/tuanzi-meow.mp3';
  state.reject = true;
  state.engine.playCatMeow(meow);
  await Promise.resolve();
  assert.equal(state.audios[0].paused, true);
  state.reject = false;
  state.engine.playCatMeow(meow);
  assert.equal(state.audios.length, 2);
  assert.equal(state.audios[1].paused, false);
});

function setupFullWebAudio() {
  const nodes = [];
  let now = 1;
  const param = () => ({
    value: 1,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
  });
  const makeNode = kind => {
    const n = {
      kind,
      gain: param(),
      frequency: param(),
      Q: param(),
      playbackRate: param(),
      connect(to) { this.to = to; },
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop() { this.stopped = true; this.onended?.(); },
    };
    nodes.push(n);
    return n;
  };
  class Context {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    get currentTime() { return now; }
    createGain() { return makeNode('gain'); }
    createOscillator() { return makeNode('osc'); }
    createBiquadFilter() { return makeNode('filter'); }
    createBuffer(_ch, len, rate) {
      const data = new Float32Array(len);
      return { duration: len / rate, getChannelData: () => data };
    }
    createBufferSource() {
      const src = makeNode('buffer');
      src.start = () => { src.started = true; src.onended?.(); };
      return src;
    }
    async resume() {}
  }
  const context = {
    exports: {},
    window: { AudioContext: Context, setInterval() {}, clearInterval() {} },
    require(name) { return { default: name }; },
  };
  vm.runInNewContext(compiled, context);
  return {
    engine: context.exports.roomAudio,
    nodes,
    advance(dt) { now += dt; },
  };
}

test('lamp, book, and paper physical SFX route through master mute gain, clean up nodes, and throttle bursts', () => {
  const env = setupFullWebAudio();
  const types = [
    'lamp-on', 'lamp-off',
    'book-open', 'book-close', 'book-extract', 'book-insert', 'book-shelf-add',
    'paper', 'paper-tear', 'paper-crumple', 'paper-land', 'paper-pickup', 'paper-check',
  ];

  env.engine.setMuted(true);
  for (const type of types) env.engine.playSfx(type);
  assert.equal(env.nodes.length, 0, 'muted engine must not allocate SFX nodes');

  env.engine.setMuted(false);
  let master = null;
  for (const type of types) {
    const before = env.nodes.length;
    env.engine.playSfx(type);
    if (!master) master = env.nodes[0];
    const created = env.nodes.slice(before);
    const activeNodes = created.filter(n => n !== master && n !== env.nodes[1]);
    assert.ok(activeNodes.length > 0, `${type} should create audio nodes`);
    assert.ok(activeNodes.some(n => n.to === master), `${type} should route into master mute gain`);
    for (const n of activeNodes) {
      assert.equal(n.disconnected, true, `${type} node (${n.kind}) must disconnect on end`);
    }
    env.advance(0.1);
  }

  // Verify rapid duplicate throttle prevents immediate double-trigger
  const beforeBurst = env.nodes.length;
  env.engine.playSfx('lamp-on');
  const afterFirst = env.nodes.length;
  assert.ok(afterFirst > beforeBurst);
  env.engine.playSfx('lamp-on');
  assert.equal(env.nodes.length, afterFirst, 'immediate duplicate SFX should be throttled');
});

test('physical SFX degrade gracefully when AudioContext lacks buffer/filter APIs', () => {
  const { engine, nodes } = setup();
  for (const type of ['lamp-on', 'paper', 'paper-tear', 'paper-crumple', 'paper-pickup', 'book-open', 'book-close', 'book-insert']) {
    assert.doesNotThrow(() => engine.playSfx(type));
  }
  assert.ok(nodes.length > 2);
});
