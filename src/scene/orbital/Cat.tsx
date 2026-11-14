import React, { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetBoundary } from './ReusableAsset';

const MODEL = `${import.meta.env.BASE_URL}models/cat/cat.glb`;
const CUSHION_TOP = 0.08;
const PET_DURATION = 2.2;

interface CatProps {
  resident: RefObject<THREE.Group>;
  value: number;
  reducedMotion: boolean;
}

type PetMotion = { time: number; remaining: number; value: number };

function joint(scene: THREE.Object3D, name: string) {
  const node = scene.getObjectByName(name);
  if (!(node instanceof THREE.Bone) || !node.parent) throw new Error(`Missing cat model joint: ${name}`);
  const parentSpace = node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  return {
    node,
    rest: node.quaternion.clone(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(parentSpace),
    forward: new THREE.Vector3(0, 0, 1).applyQuaternion(parentSpace),
  };
}

function CatModel({ resident, motion, reducedMotion }: Omit<CatProps, 'value'> & { motion: PetMotion }) {
  const { scene } = useGLTF(MODEL);
  const pivot = useRef<THREE.Group>(null);
  const yaw = useRef(0);
  const model = useMemo(() => {
    const object = clone(scene);
    object.name = 'CatModel';
    object.updateMatrixWorld(true);
    const head = joint(object, 'Cat_Head');
    const tail = [
      joint(object, 'Cat_TailBase'),
      joint(object, 'Cat_TailMid'),
      joint(object, 'Cat_TailTip'),
    ];
    const bounds = new THREE.Box3().setFromObject(object, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.62 / Math.max(size.x, size.z);
    object.scale.setScalar(scale);
    object.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    const skeletons = new Set<THREE.Skeleton>();
    object.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) {
        child.castShadow = child.receiveShadow = true;
        skeletons.add(child.skeleton);
      }
    });
    return { object, head, tail, skeletons, rotation: new THREE.Quaternion(), target: new THREE.Vector3() };
  }, [scene]);
  useEffect(() => () => model.skeletons.forEach(skeleton => skeleton.dispose()), [model]);

  useFrame((_, delta) => {
    const group = pivot.current;
    if (!group) return;
    const { head, tail, rotation, target } = model;
    const { time, remaining } = motion;
    const strength = reducedMotion ? 0 : Math.min(remaining * 4, 1);
    group.position.y = CUSHION_TOP + Math.sin((PET_DURATION - remaining) * 9) ** 2 * 0.08 * strength;
    if (resident.current && !reducedMotion) {
      group.worldToLocal(resident.current.getWorldPosition(target));
      const direction = THREE.MathUtils.clamp(Math.atan2(target.x, target.z), -0.27, 0.27);
      yaw.current = THREE.MathUtils.damp(yaw.current, direction, 5, delta);
    } else yaw.current = 0;
    head.node.quaternion.copy(head.rest)
      .premultiply(rotation.setFromAxisAngle(head.up, yaw.current))
      .premultiply(rotation.setFromAxisAngle(head.forward, Math.sin(time * 9) * 0.10 * strength));
    tail.forEach(({ node, rest, up }, index) => {
      const phase = index * 0.55;
      const amplitude = 1 - index * 0.25;
      const wag = (Math.sin(time * 2.2 - phase) * 0.14 +
        Math.sin(time * 10 - phase) * 0.20 * strength) * amplitude;
      node.quaternion.copy(rest).premultiply(rotation.setFromAxisAngle(up, reducedMotion ? 0 : wag));
    });
  });

  return <group ref={pivot} position-y={CUSHION_TOP}><primitive object={model.object} /></group>;
}

export function Cat({ resident, value, reducedMotion }: CatProps) {
  const motion = useRef<PetMotion>({ time: 0, remaining: 0, value }).current;
  const sparks = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    motion.time += dt;
    if (value > motion.value) motion.remaining = PET_DURATION;
    motion.value = value;
    motion.remaining = Math.max(0, motion.remaining - dt);
    if (!sparks.current) return;
    sparks.current.visible = motion.remaining > 0;
    if (!sparks.current.visible) return;
    sparks.current.children.forEach((child, i) => {
      const rise = reducedMotion ? 0.1 : ((PET_DURATION - motion.remaining + i * 0.25) % 1.1) * 0.45;
      child.position.set(Math.sin(i * 2.1) * 0.22, 0.7 + rise, Math.cos(i * 2.1) * 0.15);
      child.scale.setScalar(Math.min(1, motion.remaining * 3) * 0.7);
    });
  });

  return <>
    <mesh position={[0, 0.04, 0]} castShadow receiveShadow><cylinderGeometry args={[0.37, 0.41, 0.08, 28]} /><meshStandardMaterial color="#d5c3aa" roughness={0.9} /></mesh>
    <mesh position={[0, CUSHION_TOP, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.34, 0.045, 12, 28]} /><meshStandardMaterial color="#c4ad90" /></mesh>
    <AssetBoundary><Suspense fallback={null}><CatModel resident={resident} motion={motion} reducedMotion={reducedMotion} /></Suspense></AssetBoundary>
    <group ref={sparks} name="CatPetSparks" visible={false}>
      {[0, 1, 2].map(i => <mesh key={i}><octahedronGeometry args={[0.045, 1]} /><meshBasicMaterial color="#e5ac9e" /></mesh>)}
    </group>
  </>;
}
