import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldSceneProps } from '../../../types/world';
import type { MusicDisc } from '../../../types/interactable';
import { roomAudio } from '../../audioEngine';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox } from '../Primitives';
import { SuppliedAsset } from '../SuppliedAsset';
import { RecordTransport, PLAYER, PLATTER, DISC_LEAN, DISC_RADIUS, discPosition, type Point } from './record-motion';

const IMPORT_DISC: Point = [.3, 1.128, -2.3];
const rackRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(DISC_LEAN, 0, 0));
const flatRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const phaseText = { paused: '唱针已抬起', playing: '播放中', raise: '抬起唱臂', brake: '转盘减速', return: '唱片归架', extract: '正在取放唱片', settle: '唱片就位', spinup: '转盘启动', swing: '唱臂移向外圈', lower: '唱针缓缓落下', starting: '准备播放', fadein: '音乐渐入', park: '唱臂归位' };
function Disc({ colors, radius = 0.17 }: { colors: [string, string]; radius?: number }) {
  return <group rotation={[Math.PI / 2, 0, 0]}>
    <mesh castShadow><cylinderGeometry args={[radius, radius, 0.014, 48]} /><meshStandardMaterial color="#24282b" roughness={0.32} metalness={0.35} /></mesh>
    {[0.76, 0.88].map(r => <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}><ringGeometry args={[radius * r, radius * r + 0.002, 48]} /><meshStandardMaterial color="#606263" /></mesh>)}
    <mesh position={[0, 0.01, 0]}><cylinderGeometry args={[radius * 0.4, radius * 0.4, 0.008, 32]} /><meshStandardMaterial color={colors[0]} /></mesh>
    <mesh position={[0, 0.016, 0]}><cylinderGeometry args={[0.018, 0.018, 0.009, 16]} /><meshStandardMaterial color={colors[1]} metalness={0.5} /></mesh>
  </group>;
}

/** Sibling of the rack and player body under the cabin origin; no world/local reparenting. */
export function RecordPlayer(props: WorldSceneProps) {
  const latest = useRef(props); latest.current = props;
  // Imports are prepended by App. Keep existing slot identities and append new records here.
  const order = useRef(props.discs.map(disc => disc.id));
  const records = order.current.map(id => props.discs.find(disc => disc.id === id)).filter((disc): disc is MusicDisc => !!disc);
  for (const disc of props.discs) if (!order.current.includes(disc.id)) { order.current.push(disc.id); records.push(disc); }
  const [transport] = useState(() => new RecordTransport(props.activeDisc, Math.max(0, order.current.indexOf(props.activeDisc.id)), props.isMusicPlaying));
  const [, redraw] = useState(0);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(records.length / 6));
  const visiblePage = Math.min(page, pages - 1);
  const imported = useRef<MusicDisc | null>(null);
  const known = useRef(new Set(props.discs.map(disc => disc.id)));
  const platter = useRef<THREE.Group>(null), seated = useRef<THREE.Group>(null), flying = useRef<THREE.Group>(null), flyingSpin = useRef<THREE.Group>(null);
  const armYaw = useRef<THREE.Group>(null), armLift = useRef<THREE.Group>(null);
  const angle = useRef(0);
  const startedAt = useRef(0);
  const ownsAudio = props.sceneId === props.transition.toScene;
  const enabled = ownsAudio && !['leaving', 'returning'].includes(props.transition.phase);
  const select = (disc: MusicDisc) => {
    if (!transport.select(disc, order.current.indexOf(disc.id))) return false;
    roomAudio.prepareMusic(disc);
    if (latest.current.focusedObject !== 'music-player') latest.current.onAction({ sceneId: latest.current.sceneId, objectId: 'music-player', kind: 'inspect' });
    redraw(value => value + 1); return true;
  };
  useEffect(() => {
    for (const disc of props.discs) if (!known.current.has(disc.id) && disc.isUserUploaded && ownsAudio) imported.current = disc;
    known.current = new Set(props.discs.map(disc => disc.id));
  }, [props.discs, ownsAudio]);
  useEffect(() => () => {
    if (latest.current.sceneId !== latest.current.transition.toScene) return;
    roomAudio.cancelPreparedMusic();
    // Unmount during a pending start must not resurrect playback after disposal.
    if (transport.busy) roomAudio.pauseMusic();
    roomAudio.setMusicLevel(1);
  }, [transport]);

  useFrame((_, rawDelta) => {
    if (!ownsAudio || document.hidden) return;
    const delta = Math.min(rawDelta, .05);
    const before = transport.phase;
    if (!transport.busy && imported.current) {
      const next = imported.current; imported.current = null; select(next);
    }
    const audio = roomAudio.getSnapshot();
    if (transport.phase === 'starting') {
      startedAt.current += delta;
      if (audio.disc.id === transport.disc.id && audio.isPlaying) transport.playbackResult(true);
      else if (audio.status === 'error' || audio.status === 'paused' || startedAt.current > 8) {
        roomAudio.pauseMusic(); transport.playbackResult(false);
      }
    } else if (transport.phase === 'playing' && !audio.isPlaying) transport.toggle();
    for (const event of transport.tick(delta, props.reducedMotion)) {
      if (event.type === 'pause') roomAudio.pauseMusic();
      if (event.type === 'contact') roomAudio.playSfx('soft');
      if (event.type === 'play') { roomAudio.playSfx('switch'); startedAt.current = 0; roomAudio.setMusicLevel(0); latest.current.onSelectDisc(event.disc); }
    }
    const pose = transport.pose(props.reducedMotion);
    roomAudio.setMusicLevel(pose.volume);
    if (!props.reducedMotion) angle.current = (angle.current + delta * 3.49 * pose.speed) % (Math.PI * 2);
    if (platter.current) platter.current.rotation.y = angle.current;
    if (seated.current) seated.current.position.y = pose.position[1] - PLATTER[1];
    if (flying.current) {
      flying.current.position.set(...pose.position);
      flying.current.quaternion.copy(rackRotation).slerp(flatRotation, pose.tilt);
    }
    if (flyingSpin.current) flyingSpin.current.rotation.z = angle.current * pose.tilt;
    if (armYaw.current) armYaw.current.rotation.y = pose.yaw;
    if (armLift.current) armLift.current.rotation.x = -.15 * pose.lift;
    if (transport.phase !== before) {
      // Show the original shelf when returning, then the incoming shelf during pickup.
      if (transport.phase === 'return' || transport.phase === 'extract') setPage(Math.floor(transport.slot / 6));
      redraw(value => value + 1);
    }
  });

  const action = (request: WorldAction) => {
    if (!enabled) return;
    const id = request.objectId;
    if (id === 'music-mute') { props.onToggleMute(); return; }
    if (transport.busy) return;
    if (id === 'music-rack') setPage((visiblePage + (request.payload?.direction ?? 1) + pages) % pages);
    else if (id.startsWith('music-disc-')) { const disc = records.find(item => item.id === request.payload?.itemId); if (disc) select(disc); }
    else if (id === 'music-player') {
      roomAudio.prepareMusic(transport.disc);
      if (props.focusedObject !== 'music-player') props.onAction({ sceneId: props.sceneId, objectId: 'music-player', kind: 'inspect' });
      transport.toggle(); redraw(value => value + 1);
    }
  };
  const world = { ...props, onAction: action };
  const moving = transport.phase === 'return' || transport.phase === 'extract';
  const pose = transport.pose(props.reducedMotion);
  return <group name="RecordPlayer" userData={{ phase: transport.phase, discId: transport.disc.id }}>
    <group position={PLAYER}>
      <SuppliedAsset name="turntable.parts" part="body" partBounds size={[.88, .158, .50]} fit="contact" position={[0, -.079, 0]} fallback={<>
        <SoftBox dims={[.88, .14, .5]} color="#936c49" />
        <SoftBox dims={[.83, .018, .46]} position={[0, .079, 0]} color="#d9c7a4" />
        {[-.32, .32].flatMap(x => [-.16, .16].map(z => <SoftBox key={`${x}/${z}`} position={[x, -.072, z]} dims={[.09, .018, .07]} color="#464e43" />))}
      </>} />
      <SoftBox dims={[.89, .018, .51]} position={[0, .079, 0]} color="#936c49" radius={.014} />
      <ObjectHandle id="music-player" action="toggle" hint={transport.busy ? phaseText[transport.phase] : props.isMusicPlaying ? '轻触唱盘，暂停音乐' : '放下唱针，继续播放'} world={world} position={[-.13, .095, 0]}>
        <group ref={platter} name="RecordPlatter" rotation={[0, angle.current, 0]}>
          <mesh><cylinderGeometry args={[.205, .205, .025, 48]} /><meshStandardMaterial color="#343d3c" metalness={.4} /></mesh>
          {!moving && <group ref={seated} name="SeatedRecord" position={[0, pose.position[1] - PLATTER[1], 0]} rotation={[-Math.PI / 2, 0, 0]}><Disc colors={transport.disc.discThemeColor} radius={DISC_RADIUS} /></group>}
        </group>
        <mesh position={[0, .031, 0]} name="RecordSpindle"><cylinderGeometry args={[.006, .006, .04, 16]} /><meshStandardMaterial color="#c9c4ac" metalness={.8} roughness={.25} /></mesh>
      </ObjectHandle>
      <ObjectHandle id="music-player" action="toggle" hint="抬起或放下唱臂" world={world} position={[.27, .11, -.13]}>
        <mesh><cylinderGeometry args={[.035, .035, .07, 16]} /><meshStandardMaterial color="#b7ad92" metalness={.65} /></mesh>
        <group ref={armYaw} name="TonearmYaw" rotation={[0, pose.yaw, 0]}><group ref={armLift} name="TonearmLift" rotation={[-.15 * pose.lift, 0, 0]}>
          <SoftBox dims={[.025, .023, .28]} position={[-.03, .04, .12]} rotation={[0, -.3, 0]} color="#c9c4ac" />
          <SoftBox dims={[.05, .03, .065]} position={[-.07, .035, .245]} color="#54675d" />
          <mesh position={[-.07, .016, .245]} name="RecordNeedle"><cylinderGeometry args={[.002, .002, .008, 8]} /><meshStandardMaterial color="#c9c4ac" metalness={.8} /></mesh>
        </group></group>
      </ObjectHandle>
    </group>
    <SoftBox position={[-.2, 1.16, -2.80]} dims={[1.24, .06, .33]} color="#765b43" />
    {records.slice(visiblePage * 6, visiblePage * 6 + 6).map((disc, index) => disc.id === transport.disc.id ? null : <ObjectHandle key={disc.id} id={`music-disc-${disc.id}`} action="insert" hint={`拿取《${disc.title}》${disc.isUserUploaded ? ' · 我的唱片' : ''}`} world={world} payload={{ itemId: disc.id }} position={discPosition(index)}>
      <group rotation={[DISC_LEAN, 0, 0]}><Disc colors={disc.discThemeColor} /></group>
    </ObjectHandle>)}
    {[-1, 1].map(direction => <ObjectHandle key={direction} id="music-rack" action="select" hint={pages > 1 ? '翻动唱片架，查看更多唱片' : '唱片架'} payload={{ direction }} world={world} position={[-.2 + direction * .6, 1.31, -2.81]}><SoftBox dims={[.035, .29, .21]} color="#765b43" /></ObjectHandle>)}
    <ObjectHandle id="music-import" action="insert" hint="空白唱片 · 导入本地音乐" world={world} position={IMPORT_DISC} onClick={event => {
      event.stopPropagation(); if (!enabled || transport.busy || event.delta >= 9) return;
      const request: WorldAction = { sceneId: props.sceneId, objectId: 'music-import', kind: 'insert' };
      const ready = !props.onApproach || props.onApproach(IMPORT_DISC, request, () => {});
      if (ready) props.onImportMusic(); else props.onHover('music-import', '走近后，再点击空白唱片选择音乐');
    }}><group rotation={[-Math.PI / 2, 0, 0]}><Disc colors={['#efe4c7', '#c8a879']} radius={.145} /></group></ObjectHandle>
    <group position={[2.57, 1.4, -2.55]}>
      <SoftBox dims={[.38, .56, .37]} color="#886448" />
      {[.13, -.1].map((y, i) => <mesh key={y} position={[0, y, .19]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[i ? .125 : .065, i ? .125 : .065, .018, 32]} /><meshStandardMaterial color="#35423f" /></mesh>)}
      <ObjectHandle id="music-mute" action="toggle" hint={props.isMuted ? '旋动音箱旋钮，恢复声音' : '旋动音箱旋钮，静音'} world={world} position={[.12, -.21, .21]} drag="x"><mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.03, .03, .035, 16]} /><meshStandardMaterial color={props.isMuted ? '#7a7f73' : '#d7b46e'} /></mesh></ObjectHandle>
    </group>
    {moving && <group ref={flying} name="MovingRecord" position={pose.position} quaternion={rackRotation.clone().slerp(flatRotation, pose.tilt)}><group ref={flyingSpin}><Disc colors={transport.disc.discThemeColor} /></group></group>}
    {enabled && props.focusedObject === 'music-player' && <Html center position={[-.35, 1.95, -2.25]} distanceFactor={4} style={{ pointerEvents: 'none', width: 260, textAlign: 'center', color: '#f3e6c9', font: '12px monospace', textShadow: '0 1px 3px #242723' }}>
      {transport.disc.title} · {phaseText[transport.phase]}<br />拿取唱片换曲 · 空白唱片导入音乐{pages > 1 ? ` · 唱片架 ${visiblePage + 1}/${pages}` : ''}
    </Html>}
  </group>;
}
