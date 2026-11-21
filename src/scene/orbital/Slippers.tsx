import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { DECK_WALK_BOUNDS, deckFromAuthoredX } from './cabinLayout';
import { CabinUpperDeck } from './CabinUpperDeck';
import { createSlipperPair, slipperFloorY, slipperSupportHeight, stepSlippers, type SlipperRect } from './slipperMotion';
import { extractSlipperModel, SLIPPER_MODEL_URL } from './slipperModel';

interface SlipperPairProps {
  resident: React.RefObject<THREE.Group>;
  room: { boxes: SlipperRect[] };
  reducedMotion: boolean;
}

function isValidBody(body: ReturnType<typeof createSlipperPair>[number] | undefined) {
  return !!body
    && Number.isFinite(body.x)
    && Number.isFinite(body.y)
    && Number.isFinite(body.z)
    && Number.isFinite(body.vx)
    && Number.isFinite(body.vy)
    && Number.isFinite(body.vz)
    && Number.isFinite(body.yaw)
    && Number.isFinite(body.spin)
    && Number.isFinite(body.roll)
    && Number.isFinite(body.rollVel)
    && Number.isFinite(body.pitch)
    && Number.isFinite(body.pitchVel)
    && Number.isFinite(body.cooldown);
}

export function SlipperPair({ resident, room, reducedMotion }: SlipperPairProps) {
  const { scene } = useGLTF(SLIPPER_MODEL_URL);
  const model = useMemo(() => extractSlipperModel(scene), [scene]);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const bodies = useRef(createSlipperPair([[0, 0], [0, 0]]));
  const readyModel = useRef<typeof model>(null);
  const last = useRef<{ x: number; z: number } | null>(null);

  useFrame((_, rawDelta) => {
    const groups = [left.current, right.current];
    const root = resident.current;
    if (!model || !groups[0] || !groups[1] || !root) return;
    if (readyModel.current !== model || bodies.current.length !== 2 || !bodies.current.every(isValidBody)) {
      readyModel.current = model;
      bodies.current = createSlipperPair([model.left.center, model.right.center], [model.left.radius, model.right.radius]);
    }
    const dt = Math.min(Math.max(rawDelta, 0), 0.04);
    const previous = last.current;
    last.current = { x: root.position.x, z: root.position.z };
    const posture = root.userData.posture ?? 'standing';
    stepSlippers(bodies.current, dt, {
      x: root.position.x,
      z: root.position.z,
      vx: previous && dt > 0 ? (root.position.x - previous.x) / dt : 0,
      vz: previous && dt > 0 ? (root.position.z - previous.z) / dt : 0,
      active: !root.userData.onStairs && deckFromAuthoredX(root.position.x) === 'upper'
        && (posture === 'standing' || posture === 'standing-up'),
    }, room.boxes, DECK_WALK_BOUNDS.upper, reducedMotion);
    const sides = [model.left, model.right];
    bodies.current.forEach((body, index) => {
      const group = groups[index]!;
      const side = sides[index]!;
      const baseY = Number.isFinite(side.baseY) ? side.baseY : 0.0134;
      const halfH = Number.isFinite(side.halfHeight) ? side.halfHeight : 0.056;
      const halfW = Number.isFinite(side.halfWidth) ? side.halfWidth : 0.08;
      const halfL = Number.isFinite(side.halfLength) ? side.halfLength : 0.168;
      const floor = slipperFloorY(body.x, body.z, baseY);
      const support = slipperSupportHeight(body.roll, body.pitch, halfH, halfW, halfL);
      group.position.set(body.x, floor + support + body.y, body.z);
      group.rotation.order = 'YXZ';
      group.rotation.set(body.pitch, body.yaw, body.roll);
    });
  });

  if (!model) return null;
  return <CabinUpperDeck>
    {[model.left, model.right].map((side, index) => <group key={index} ref={index ? right : left}
      name={index ? 'Slipper_Right' : 'Slipper_Left'} position={[side.center[0], (Number.isFinite(side.baseY) ? side.baseY : 0.0134) + (Number.isFinite(side.halfHeight) ? side.halfHeight : 0.056), side.center[1]]}>
      {side.parts.map((part, partIndex) => <mesh key={partIndex} geometry={part.geometry} material={part.material} castShadow receiveShadow />)}
    </group>)}
  </CabinUpperDeck>;
}
