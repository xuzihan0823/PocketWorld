import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RecordTransport, recordPath, discPosition, RECORD_CENTER, PLATTER, PLAYER, DISC_LEAN, DISC_RADIUS, ARM_PLAY } from './record-motion.ts';
const disc = index => ({ id: `disc-${index}`, title: `${index}`, audioUrl: `synth:${index}`, discThemeColor: ['#fff', '#000'] });
const advance = (machine, target, options = {}) => {
  const events = [];
  for (let i = 0; machine.phase !== target && i < 4000; i++) events.push(...machine.tick(options.delta ?? 1/60, options.reduced ?? false));
  assert.equal(machine.phase, target); return events;
};

test('each shelf slot returns to its exact anchor and lands above the platter without changing radius', () => {
  for (let slot = 0; slot < 18; slot++) {
    assert.deepEqual(recordPath(slot, 0), { position: discPosition(slot), tilt: 0 });
    assert.deepEqual(recordPath(slot, 1), { position: RECORD_CENTER, tilt: 1 });
    assert.equal(DISC_RADIUS, .17);
    assert.ok(Math.abs(RECORD_CENTER[1] - .007 - (PLATTER[1] + .0125)) < 1e-12);
    for (let step = 0; step <= 1000; step++) {
      const pose = recordPath(slot, step/1000);
      assert.ok(pose.position.every(Number.isFinite));
      assert.ok(pose.tilt >= 0 && pose.tilt <= 1);
      if (step >= 850) {
        assert.equal(pose.position[0], RECORD_CENTER[0]);
        assert.equal(pose.position[2], RECORD_CENTER[2]);
      }
    }
  }
});

test('all records clear neighbouring complete vinyl, label and hub envelopes throughout pickup and return', () => {
  // Dense sampled solid surfaces, in the exact Disc geometry orientation. Check both directions
  // because a moving small label can otherwise pass into the stationary vinyl unnoticed.
  const pieces = [ { radius: .17, min: -.007, max: .007 }, { radius: .068, min: .006, max: .014 }, { radius: .018, min: .0115, max: .0205 } ];
  const rack = new THREE.Quaternion().setFromEuler(new THREE.Euler(DISC_LEAN,0,0));
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
  const cylinder = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0));
  const samples = [];
  for (const piece of pieces) for (const y of [piece.min, (piece.min+piece.max)/2, piece.max]) for (const radius of [0, piece.radius*.5, piece.radius]) for (let a = 0; a < 64; a++) samples.push(new THREE.Vector3(radius*Math.cos(a*Math.PI/32), y, radius*Math.sin(a*Math.PI/32)));
  const inside = point => pieces.some(p => point.y > p.min + 1e-5 && point.y < p.max - 1e-5 && Math.hypot(point.x, point.z) < p.radius - 1e-5);
  const fixedQ = rack.clone().multiply(cylinder);
  const scratch = new THREE.Vector3();
  for (let slot = 0; slot < 6; slot++) for (let step = 0; step <= 200; step++) {
    const { position, tilt } = recordPath(slot, step/200);
    const movingQ = rack.clone().slerp(flat,tilt).multiply(cylinder);
    const pos = new THREE.Vector3(...position);
    for (let other = 0; other < 6; other++) {
      if (slot === other) continue;
      const origin = new THREE.Vector3(...discPosition(other));
      if (pos.distanceTo(origin) > .36) continue;
      for (const [from, fromQ, to, toQ] of [[pos,movingQ,origin,fixedQ],[origin,fixedQ,pos,movingQ]]) {
        const inverse = toQ.clone().invert();
        for (const sample of samples) {
          scratch.copy(sample).applyQuaternion(fromQ).add(from).sub(to).applyQuaternion(inverse);
          assert.equal(inside(scratch), false, `slot ${slot} crossed ${other}, path ${step/200}`);
        }
      }
    }
  }
});

test('needle is over the outer groove at playing yaw and touches the vinyl surface', () => {
  const tip = new THREE.Vector3(-.07,.012,.245).applyAxisAngle(new THREE.Vector3(0,1,0),ARM_PLAY).add(new THREE.Vector3(.27,.11,-.13)).add(new THREE.Vector3(...PLAYER));
  const radius = Math.hypot(tip.x-RECORD_CENTER[0],tip.z-RECORD_CENTER[2]);
  assert.ok(radius > .14 && radius < DISC_RADIUS, `needle radius ${radius}`);
  assert.ok(Math.abs(tip.y - (RECORD_CENTER[1]+.007)) < .001);
});

test('swap serializes arm lift, braking, old return, new pickup and needle contact before music', () => {
  const machine = new RecordTransport(disc(0),0,true);
  assert.equal(machine.select(disc(1),1),true);
  for (let i=0;i<20;i++) { assert.equal(machine.select(disc(2),2),false); assert.equal(machine.toggle(),false); }
  assert.deepEqual(advance(machine,'brake'),[{type:'pause'}]);
  advance(machine,'return'); assert.equal(machine.disc.id,disc(0).id); assert.equal(machine.pose().speed,0);
  advance(machine,'extract'); assert.equal(machine.disc.id,disc(1).id);
  const events = advance(machine,'starting');
  assert.deepEqual(events.map(e=>e.type),['contact','play']);
  assert.equal(machine.pose().lift,0); assert.equal(machine.pose().volume,0);
  assert.equal(machine.select(disc(2),2),false);
  machine.playbackResult(true); advance(machine,'playing');
  assert.equal(machine.pose().volume,1);
});

test('pause keeps the record seated, parks the arm, and resume never fetches a duplicate record', () => {
  const machine = new RecordTransport(disc(0),0,true);
  machine.toggle();
  const phases = new Set();
  while (machine.phase !== 'paused') { phases.add(machine.phase); assert.equal(machine.pose().seated,true); machine.tick(1/60); }
  assert.equal(phases.has('return'),false); assert.equal(machine.pose().speed,0);
  machine.toggle(); const events = advance(machine,'starting');
  assert.deepEqual(events.map(e=>e.type),['play']);
  machine.playbackResult(false); advance(machine,'paused'); assert.equal(machine.busy,false);
});

test('30/60/144 Hz, reduced motion and a suspended-tab delta reach identical stable states', () => {
  for (const delta of [1/30,1/60,1/144,10]) for (const reduced of [false,true]) {
    const machine = new RecordTransport(disc(0),0,true); machine.select(disc(5),5);
    const events = advance(machine,'starting',{delta,reduced});
    assert.deepEqual(events.map(e=>e.type),['pause','contact','play']);
    machine.playbackResult(true); advance(machine,'playing',{delta,reduced});
    assert.equal(machine.disc.id,disc(5).id); assert.deepEqual(machine.pose().position,RECORD_CENTER);
    assert.equal(machine.tick(100).length,0);
  }
});

test('path position and orientation are continuous at every segment boundary', () => {
  for (let slot=0;slot<6;slot++) for (const t of [.1,.24,.4,.58,.85]) {
    const a=recordPath(slot,t-1e-7), b=recordPath(slot,t+1e-7);
    assert.ok(new THREE.Vector3(...a.position).distanceTo(new THREE.Vector3(...b.position))<1e-5);
    assert.ok(Math.abs(a.tilt-b.tilt)<1e-5);
  }
});

test('arm, motor and volume do not jump when transport stages hand off', () => {
  for (const playing of [false,true]) {
    const machine = new RecordTransport(disc(0),0,playing);machine.select(disc(1),1);
    let previous=machine.pose();
    for(let i=0;i<15000 && machine.phase!=='playing';i++) {
      const phase=machine.phase;
      if(phase==='starting') machine.playbackResult(true); else machine.tick(.001);
      const next=machine.pose();
      if(machine.phase!==phase) for(const key of ['yaw','lift','speed','volume']) assert.ok(Math.abs(previous[key]-next[key])<.001,`${phase} -> ${machine.phase}: ${key} jumped`);
      previous=next;
    }
    assert.equal(machine.phase,'playing');
    machine.toggle();advance(machine,'paused');assert.equal(machine.pose().lift,0,'arm rests after parking');
  }
});
