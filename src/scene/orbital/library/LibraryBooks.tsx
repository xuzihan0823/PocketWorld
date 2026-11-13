import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldModelProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox } from '../Primitives';
import { bookPose, leafProgress } from './bookMotion';
import { type LibraryBook } from './catalog';
function BookEntity({ world, book }: { world: WorldModelProps; book: LibraryBook }) {
  const group = useRef<THREE.Group>(null), cover = useRef<THREE.Group>(null), page = useRef<THREE.Group>(null), leftPages = useRef<THREE.Group>(null);
  const sheet = useMemo(() => new THREE.PlaneGeometry(.235, .215, 18, 1).rotateX(-Math.PI / 2).translate(.1175, 0, 0), []);
  const base = useMemo(() => Float32Array.from(sheet.getAttribute('position').array), [sheet]);
  React.useEffect(() => () => sheet.dispose(), [sheet]);
  useFrame(() => {
    if (!group.current || !world.library) return;
    const s = world.library.flow.current, pose = bookPose(world.sceneId, book, s);
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.quaternion);
    if (cover.current) { cover.current.rotation.z = Math.PI * pose.open; cover.current.position.y = .058 * (1 - pose.open); }
    if (leftPages.current) leftPages.current.scale.x = Math.sin(pose.open * Math.PI / 2) ** 2;
    if (page.current) {
      const turning = pose.phase === 'turn'; page.current.visible = turning;
      const t = s.direction > 0 ? leafProgress(s) : 1 - leafProgress(s);
      page.current.rotation.z = Math.PI * t;
      const attr = sheet.getAttribute('position');
      for (let i = 0; i < attr.count; i++) attr.setY(i, base[i * 3 + 1] + Math.sin(base[i * 3] / .235 * Math.PI) * Math.sin(t * Math.PI) * .025);
      attr.needsUpdate = true; sheet.computeVertexNormals();
    }
  });
  return <ObjectHandle id="book-01" action="read" hint={`取阅《${book.title}》`} world={world} payload={{ itemId: book.id }}>
    <group ref={group} name={`LibraryBook_${book.id}`} userData={{ bookId: book.id, slotId: book.slotId }}>
      <SoftBox dims={[.24, .012, .22]} position={[.12, 0, 0]} color={book.color} radius={.003} />
      <SoftBox dims={[.226, .041, .209]} position={[.12, .027, 0]} color="#eee3c8" radius={.002} />
      <SoftBox dims={[.011, .065, .22]} position={[0, .026, 0]} color={book.color} radius={.003} />
      <SoftBox dims={[.005, .035, .09]} position={[-.006, .026, 0]} color="#c7af7d" radius={.001} />
      <group ref={leftPages} scale={[0, 1, 1]}><SoftBox dims={[.226, .041, .209]} position={[-.12, .027, 0]} color="#eee3c8" radius={.002} /></group>
      <group ref={cover} position={[0, .058, 0]}>
        <SoftBox dims={[.24, .012, .22]} position={[.12, 0, 0]} color={book.color} radius={.003} />
        <SoftBox dims={[.12, .002, .09]} position={[.12, .007, 0]} color="#c7af7d" radius={.001} />
      </group>
      {[-.065, -.035, -.005, .025, .055].map(z => <mesh key={z} position={[.12, .049, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.16, .002]} /><meshStandardMaterial color="#9a957f" /></mesh>)}
      <group ref={page} position={[0, .055, 0]} visible={false}><mesh geometry={sheet} castShadow><meshStandardMaterial color="#fff3d9" side={THREE.DoubleSide} roughness={.9} /></mesh></group>
    </group>
  </ObjectHandle>;
}
export function LibraryBooks({ world }: { world: WorldModelProps }) {
  return <>
    {world.library?.data.books.map(book => <BookEntity key={book.id} book={book} world={world} />)}
  </>;
}
