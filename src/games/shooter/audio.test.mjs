import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./audio.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function setup() {
  const contexts = [];
  class AudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    starts = 0;
    stops = 0;
    notes = [];
    constructor() { contexts.push(this); }
    createGain() {
      return { gain: { value: 0, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createOscillator() {
      let pitch;
      const node = { frequency: { setValueAtTime(value) { pitch = value; }, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {}, stop: time => { if (time === undefined) this.stops++; },
        start: time => { this.starts++; this.notes.push([node.type, pitch, time]); },
      };
      return node;
    }
    resume() { return Promise.resolve().then(() => { this.state = 'running'; }); }
    suspend() { return Promise.resolve().then(() => { this.state = 'suspended'; }); }
    close() { return Promise.resolve().then(() => { this.state = 'closed'; }); }
  }
  const context = { exports: {}, window: { AudioContext } };
  vm.runInNewContext(compiled, context);
  return { audio: new context.exports.ShooterAudio(), contexts };
}

test('unmuting an unlocked game restores sound without another gameplay gesture', async () => {
  const { audio, contexts } = setup();
  audio.configure(true, false);
  assert.equal(contexts.length, 0);
  audio.unlock(); await Promise.resolve();
  const context = contexts[0];
  audio.play('launch'); assert.equal(context.starts, 2);
  audio.configure(true, true); await Promise.resolve();
  assert.equal(context.state, 'suspended');
  audio.play('launch'); assert.equal(context.starts, 2);
  audio.configure(true, false); await Promise.resolve();
  assert.equal(context.state, 'running');
  audio.play('launch'); assert.equal(context.starts, 4);
  assert.equal(contexts.length, 1);
  audio.dispose(); await Promise.resolve();
  assert.equal(context.state, 'closed');
});

test('reactivation stays silent while muted and resumes only when unmuted', async () => {
  const { audio, contexts } = setup();
  audio.configure(true, false); audio.unlock(); await Promise.resolve();
  const context = contexts[0];
  audio.configure(false, false); await Promise.resolve();
  assert.equal(context.state, 'suspended');
  audio.configure(true, true); await Promise.resolve();
  assert.equal(context.state, 'suspended');
  audio.configure(true, false); await Promise.resolve();
  assert.equal(context.state, 'running');
  audio.dispose();
});

test('rapid audio configuration changes leave the context in the latest requested state', async () => {
  const { audio, contexts } = setup();
  audio.configure(true, false); audio.unlock(); await Promise.resolve();
  const context = contexts[0];
  audio.configure(true, true); audio.configure(true, false);
  await Promise.resolve(); assert.equal(context.state, 'running');
  audio.configure(true, true); await Promise.resolve();
  audio.configure(true, false); audio.configure(false, false);
  await Promise.resolve(); assert.equal(context.state, 'suspended');
  audio.dispose();
});

test('music plays only during an audible run and resumes the sequence after silence', async () => {
  const { audio, contexts } = setup();
  audio.configure(true, false); audio.startTrack(); audio.unlock(); await Promise.resolve();
  const context = contexts[0];
  audio.tick();
  const opening = context.notes.map(note => note[1]);
  assert.equal(opening.length, 4);
  audio.tick(); assert.equal(context.starts, 4);
  audio.configure(false, false); await Promise.resolve();
  assert.equal(context.stops, 4);
  context.currentTime = 10;
  audio.tick(); assert.equal(context.starts, 4);
  audio.configure(true, false); await Promise.resolve();
  audio.tick(); assert.equal(context.starts, 4); // The next eighth note is a rest.
  context.currentTime += .3;
  audio.tick(); assert.ok(context.notes.at(-2)[1] > opening[0]);
  audio.startTrack(); audio.tick();
  assert.deepEqual(context.notes.slice(-4).map(note => note[1]), opening);
  audio.dispose();
});

test('burst schedules three separate attacks and mute cancels the pending notes', async () => {
  const { audio, contexts } = setup();
  audio.configure(true, false); audio.unlock(); await Promise.resolve();
  const context = contexts[0];
  audio.play('launch', 'burst');
  assert.deepEqual(context.notes.map(note => note[2]), [0, .08, .16]);
  audio.configure(true, true); await Promise.resolve();
  assert.equal(context.stops, 3);
  audio.configure(true, false); await Promise.resolve();
  audio.play('launch', 'prism');
  assert.notEqual(context.notes[3][0], context.notes[0][0]);
  audio.dispose();
});
