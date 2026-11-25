import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldModelProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox } from '../Primitives';
import { BOOK_PAGE_WIDTH, bookCoverPose, bookPose, bookWingPose, turningPageCurve, turningPagePoint } from './bookMotion';
import { applyLibraryBookMotion, libraryCoverFlow, libraryMotionSample } from './libraryMotion';
import { type LibraryBook } from './catalog';

const lineDepths = [-.065, -.035, -.005, .025, .055];

function BookEntity({ world, book }: { world: WorldModelProps; book: LibraryBook }) {
  const group = useRef<THREE.Group>(null), cover = useRef<THREE.Group>(null), page = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const rightWing = useRef<THREE.Group>(null), leftWing = useRef<THREE.Group>(null);
  const rightBlock = useRef<THREE.Group>(null), leftBlock = useRef<THREE.Group>(null);
  const rightLines = useRef<THREE.Group>(null), leftLines = useRef<THREE.Group>(null);
  const sheet = useMemo(() => new THREE.PlaneGeometry(BOOK_PAGE_WIDTH, .215, 18, 1).rotateX(-Math.PI / 2).translate(BOOK_PAGE_WIDTH / 2, 0, 0), []);
  const base = useMemo(() => Float32Array.from(sheet.getAttribute('position').array), [sheet]);
  React.useEffect(() => () => sheet.dispose(), [sheet]);
  useFrame(() => {
    if (!group.current || !world.library) return;
    const s = world.library.flow.current;
    const motion = s.book?.id === book.id ? world.library.motion.current : null;
    const sample = motion ? libraryMotionSample(s) : null;
    const pose = bookPose(world.sceneId, book, libraryCoverFlow(s, sample), !!motion);
    if (motion && sample) applyLibraryBookMotion(motion, world.sceneId, book, sample, pose.position, pose.quaternion);
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.quaternion);
    if (spine.current) spine.current.scale.y = (.012 + bookWingPose(1, pose.open).thickness) / .053;
    if (cover.current) {
      const frame = bookCoverPose(pose.open);
      cover.current.position.copy(frame.position); cover.current.quaternion.copy(frame.quaternion);
    }
    for (const [side, wing, block, lines] of [[0, leftWing, leftBlock, leftLines], [1, rightWing, rightBlock, rightLines]] as const) {
      const frame = bookWingPose(side, pose.open);
      if (wing.current) {
        wing.current.position.copy(frame.position); wing.current.quaternion.copy(frame.quaternion);
        wing.current.scale.x = frame.widthScale;
      }
      if (block.current) {
        block.current.position.y = .0065 + frame.thickness / 2;
        block.current.scale.y = frame.thickness / .041;
      }
      if (lines.current) lines.current.position.y = frame.surfaceY;
    }
    if (page.current) {
      const turning = pose.phase === 'turn';
      page.current.visible = turning;
      if (turning) {
        const curve = turningPageCurve(s.progress, s.direction);
        const attr = sheet.getAttribute('position');
        for (let i = 0; i < attr.count; i++) {
          const vertex = turningPagePoint(curve.leafRatio, curve.bendAmp, base[i * 3], base[i * 3 + 2]).position;
          attr.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        attr.needsUpdate = true; sheet.computeVertexNormals(); sheet.computeBoundingSphere();
      }
    }
  // Sample the same flow as the resident, which advances the clock at priority -1.
  }, -2);
  return <ObjectHandle id="book-01" action="read" panorama hint={`取阅《${book.title}》`} world={world} payload={{ itemId: book.id }}>
    <group ref={group} name={`LibraryBook_${book.id}`} userData={{ bookId: book.id, slotId: book.slotId }}>
      <group ref={rightWing}>
        <SoftBox dims={[.24, .012, .22]} position={[.12, 0, 0]} color={book.color} radius={.003} />
        <group ref={rightBlock} position={[0, .027, 0]}><SoftBox dims={[.226, .041, .209]} position={[.12, 0, 0]} color="#eee3c8" radius={.002} /></group>
        <group ref={rightLines} position={[0, .049, 0]}>{lineDepths.map(z => <mesh key={z} position={[.12, 0, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.16, .002]} /><meshStandardMaterial color="#9a957f" /></mesh>)}</group>
      </group>
      <group ref={spine}>
        <SoftBox dims={[.011, .065, .22]} position={[0, .026, 0]} color={book.color} radius={.003} />
        <SoftBox dims={[.005, .035, .09]} position={[-.006, .026, 0]} color="#c7af7d" radius={.001} />
      </group>
      <group ref={leftWing} scale={[0, 1, 1]}>
        <group ref={leftBlock} position={[0, .027, 0]}><SoftBox dims={[.226, .041, .209]} position={[-.12, 0, 0]} color="#eee3c8" radius={.002} /></group>
        <group ref={leftLines}>{lineDepths.map(z => <mesh key={z} position={[-.12, 0, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.16, .002]} /><meshStandardMaterial color="#9a957f" /></mesh>)}</group>
      </group>
      <group ref={cover} position={[0, .058, 0]}>
        <SoftBox dims={[.24, .012, .22]} position={[.12, 0, 0]} color={book.color} radius={.003} />
        <SoftBox dims={[.12, .002, .09]} position={[.12, .007, 0]} color="#c7af7d" radius={.001} />
      </group>
      <group ref={page} visible={false}><mesh geometry={sheet} castShadow><meshStandardMaterial color="#fff3d9" side={THREE.DoubleSide} roughness={.9} /></mesh></group>
    </group>
  </ObjectHandle>;
}

export function LibraryBooks({ world }: { world: WorldModelProps }) {
  return <>
    {world.library?.data.books.map(book => <BookEntity key={book.id} book={book} world={world} />)}
  </>;
}
