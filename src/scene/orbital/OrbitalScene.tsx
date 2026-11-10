import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldObjectState, type WorldSceneId, type WorldSceneProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { Cosmos, SUN_DIRECTION } from './Cosmos';
import { HabitatShell } from './HabitatShell';
import { HabitatFurniture } from './HabitatFurniture';
import { MediaObjects } from './media/MediaObjects';
import { FeatureSurfaces } from './FeatureSurfaces';
import { ScheduleProvider } from './schedule/ScheduleContext';
import { ScheduleSurfaces } from './schedule/ScheduleSurfaces';
import { OrbitalResidents } from './OrbitalResidents';
import type { DrawerInteraction } from './drawerInteraction';

const FOCUS: Record<string, { target: [number, number, number]; offset: [number, number, number] }> = {
  computer: { target: [1.45, 1.58, -2.30], offset: [0, 0.30, 3.5] },
  'music-player': { target: [-0.45, 1.2, -2.0], offset: [1.4, 2.5, 3.1] },
  journal: { target: [-0.48, 1.20, -1.94], offset: [0, 1.05, 0.78] },
  schedule: { target: [0.57, 1.20, -1.96], offset: [0, 0.88, 0.48] },
  'schedule-glass': { target: [0.69, 2.30, -3.39], offset: [0, 0.02, 1.75] },
  'book-01': { target: [-3.35, 1.03, -1.14], offset: [1.35, 1.12, 2.5] },
  bed: { target: [-2.5, 0.7, 1.0], offset: [3.2, 3.2, 4.0] },
};
interface OrbitalSceneProps extends WorldSceneProps {
  sceneObjects: Record<WorldSceneId, Record<string, WorldObjectState>>;
  gestureActive: boolean;
  shortcut: WorldAction | null;
  onShortcutHandled: () => void;
}
function CameraRig(props: OrbitalSceneProps) {
  const { camera, size } = useThree();
  const controls = useRef<Controls>(null);
  const fromPosition = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const destination = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const moving = useRef(false), cameraProgress = useRef(0), localFlight = useRef(false);
  const currentView = useRef('habitat/');
  const narrow = size.width < 720;
  const homeDirection = useMemo(() => new THREE.Vector3(narrow ? 13 : 11, 9, narrow ? 12 : 14).normalize(), [narrow]);
  const homeDistance = Math.max(19.8, 12 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * (size.width / size.height) * 0.87));
  useEffect(() => {
    if (!controls.current) return;
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]);
    if (!props.focusedObject) {
      const look = origin.add(new THREE.Vector3(0, 1.05, 0));
      camera.position.copy(look).addScaledVector(homeDirection, homeDistance);
      controls.current.target.copy(look);
      controls.current.update();
    }
  }, [camera, size.width, size.height, homeDistance, homeDirection]);
  useEffect(() => {
    if (!controls.current || props.transition.phase === 'idle') return;
    const view = `${props.transition.toScene}/${props.focusedObject ?? ''}/${size.width}/${size.height}/${props.library?.cameraView ?? ''}`;
    if (view === currentView.current && props.transition.phase !== 'returning' && props.transition.phase !== 'error') return;
    currentView.current = view;
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.current.target);
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.transition.toScene]);
    const pose = props.focusedObject ? FOCUS[props.focusedObject] : null;
    if (pose) {
      target.current.copy(origin).add(new THREE.Vector3(...pose.target));
      if (props.focusedObject === 'book-01' && props.transition.toScene === 'observatory') target.current.z += 1.25;
      const offset = new THREE.Vector3(...pose.offset);
      if (props.focusedObject === 'book-01') {
        if (props.library?.cameraView === 'close') { offset.set(1.75, .65, .30); target.current.y = 1.08; }
        if (props.library?.cameraView === 'side') offset.set(2.5, 1.1, -.35);
      }
      if (props.focusedObject?.startsWith('schedule')) {
        offset.multiplyScalar(Math.max(1, 0.62 / (size.width / size.height)));
        if (narrow && props.focusedObject === 'schedule') target.current.x = origin.x + 0.69;
      }
      if (props.focusedObject === 'book-01' && narrow) { const close = props.library?.cameraView === 'close'; offset.multiplyScalar(close ? 1.9 : 1.6); target.current.y -= close ? .40 : .55; }
      if (props.focusedObject === 'book-01' && !narrow) target.current.x += .45;
      destination.current.copy(target.current).add(offset);
      // Frame the shelf and slot together, including on portrait touchscreens.
      if (props.focusedObject === 'computer') destination.current.z = target.current.z + Math.max(pose.offset[2], 2.25 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * (size.width / size.height)) + 0.25);
    } else {
      target.current.copy(origin).add(new THREE.Vector3(0, 1.05, 0));
      destination.current.copy(target.current).addScaledVector(homeDirection, homeDistance);
    }
    if (props.transition.phase === 'error') {
      camera.position.copy(destination.current);
      controls.current.target.copy(target.current);
      controls.current.update();
      moving.current = false;
    } else { moving.current = true; cameraProgress.current = 0; localFlight.current = props.focusedObject === 'book-01'; }
  }, [props.transition.id, props.focusedObject, props.transition.phase === 'error', size.width, size.height, props.library?.cameraView]);
  useFrame((_, delta) => {
    if (!controls.current || !moving.current) return;
    const travel = props.transition.action?.kind === 'travel';
    if (localFlight.current) cameraProgress.current = Math.min(1, cameraProgress.current + Math.min(delta, .04) / (props.reducedMotion ? .25 : .8));
    const progress = localFlight.current ? cameraProgress.current : props.motion.current[travel ? 'sceneProgress' : 'progress'];
    camera.position.lerpVectors(fromPosition.current, destination.current, progress);
    if (travel && !props.reducedMotion) camera.position.y += Math.sin(progress * Math.PI) * 3;
    controls.current.target.lerpVectors(fromTarget.current, target.current, progress);
    camera.lookAt(controls.current.target);
    if (progress >= 1) moving.current = false;
  });
  const locked = props.gestureActive || !!props.focusedObject || !['idle', 'active', 'error'].includes(props.transition.phase);
  return <OrbitControls ref={controls} enabled={!locked} enablePan={false} enableDamping dampingFactor={0.08} minDistance={5} maxDistance={homeDistance * 1.5}
    minPolarAngle={0.45} maxPolarAngle={1.30} minAzimuthAngle={-0.15} maxAzimuthAngle={1.4}
    target={[0, 1.05, 0]} />;
}
function OrbitalLighting({ objects }: Pick<WorldSceneProps, 'objects'>) {
  const lamp = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, delta) => {
    const sleeping = objects.bed?.active;
    if (lamp.current) lamp.current.intensity = THREE.MathUtils.damp(lamp.current.intensity, objects.lamp?.active === false ? 0 : sleeping ? 1 : 4, 5, delta);
    if (ambient.current) ambient.current.intensity = THREE.MathUtils.damp(ambient.current.intensity, sleeping ? 0.18 : 0.48, 3, delta);
  });
  return <>
    <primitive object={sunTarget} />
    <hemisphereLight ref={ambient} args={['#f1e7d9', '#3b4145', 0.48]} />
    <directionalLight target={sunTarget} color="#fff2d9" intensity={2.3} position={SUN_DIRECTION.map(n => n * 18) as [number, number, number]} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}
      shadow-camera-near={0.1} shadow-camera-far={60} shadow-normalBias={0.035} shadow-bias={-0.0001} />
    <pointLight ref={lamp} position={[-1, 2.5, -1]} color="#ffca8b" intensity={4} distance={8} decay={2} />
    <pointLight position={[2.3, 2.0, 0.5]} color="#c7dded" intensity={2.2} distance={7} decay={2} />
  </>;
}
function WorldContent(props: OrbitalSceneProps) {
  const [walkTarget, setWalkTarget] = useState<[number, number, number] | null>(null);
  const drawerInteraction = useRef<DrawerInteraction | null>(null);
  const interaction = useRef<NonNullable<WorldSceneProps['onApproach']> | null>(null);
  useEffect(() => { setWalkTarget(null); }, [props.sceneId]);
  useEffect(() => {
    const action = props.shortcut;
    if (!action) return;
    const points: Record<string, [number, number, number]> = {
      computer: [1.55, 1.2, -1.96], 'music-player': [-0.45, 1.2, -1.96],
      journal: [-0.48, 1.2, -1.94], schedule: [0.57, 1.2, -1.96],
      'book-01': [-3.35, 0.9, props.sceneId === 'habitat' ? -1.75 : -0.5], bed: [-2.6, 0.7, 1],
    };
    const point = points[action.objectId];
    if (point) interaction.current?.(point, action, () => props.onAction(action));
    props.onShortcutHandled();
  }, [props.shortcut]);
  return <ScheduleProvider adapters={props.adapters}>
    <PerspectiveCamera makeDefault fov={34} position={[11, 10.05, 14]} near={0.08} far={2000} />
    <CameraRig {...props} />
    <Cosmos reducedMotion={props.reducedMotion} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={2} color="#f5e8d3" position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 8, 1]} />
      <Lightformer intensity={0.7} color="#a8bed1" position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 4, 1]} />
    </Environment>
    {(['habitat', 'observatory'] as WorldSceneId[]).map(id => {
      const world = { ...props, sceneId: id, objects: props.sceneObjects[id], focusedObject: id === props.sceneId ? props.focusedObject : null,
        onApproach: (point: [number, number, number], action: Parameters<typeof props.onAction>[0], perform: () => void) => {
          if (id !== props.sceneId || drawerInteraction.current?.busy) return false;
          let target = point;
          if (action.objectId.startsWith('schedule')) target = [0.57, 1.2, -1.96];
          if (action.objectId.startsWith('music-')) target = [-0.45, 1.2, -1.96];
          if (action.objectId === 'computer' || action.objectId === 'music-mute' || action.objectId === 'computer-exit' || action.objectId.startsWith('game-')) target = [1.55, 1.2, -1.96];
          return interaction.current?.(target, action, perform) ?? false;
        },
        onAction: (action: Parameters<typeof props.onAction>[0]) => {
          if (id !== props.sceneId || drawerInteraction.current?.busy) return;
          if (action.objectId === 'desk-drawer') drawerInteraction.current?.request(action);
          else props.onAction(action);
        },
      };
      return <group key={id} position={SCENE_ORIGINS[id]} visible={id === props.sceneId || (props.transition.action?.kind === 'travel' && props.transition.phase !== 'active' && props.transition.phase !== 'error')}>
        {id === props.sceneId && <OrbitalLighting objects={world.objects} />}
        <HabitatShell variant={id} onFloorClick={point => { if ((!props.focusedObject || props.focusedObject === 'bed') && props.sceneId === id && !props.gestureActive && !drawerInteraction.current?.busy && (!props.library || props.library.flow.current.phase === 'idle')) { void roomAudio.unlock(); setWalkTarget(point); } }} />
        {id === 'habitat' && <ScheduleSurfaces {...world} visible={props.sceneId === 'habitat'} />}
        <Suspense fallback={null}><HabitatFurniture {...world} /><MediaObjects {...world} /></Suspense>
        {id === props.sceneId && <>
          <FeatureSurfaces {...world} />
          <OrbitalResidents {...world} drawerInteraction={drawerInteraction} interaction={interaction}
            drawerEnabled={!props.focusedObject && ['idle', 'active', 'error'].includes(props.transition.phase)} onDrawerAction={props.onAction} walkTarget={walkTarget} onArrive={() => setWalkTarget(null)} enabled={(!props.focusedObject || props.focusedObject === 'bed') && (!props.library || props.library.view.phase === 'idle') && !props.gestureActive && ['idle', 'active', 'error'].includes(props.transition.phase)} />
        </>}
      </group>;
    })}
  </ScheduleProvider>;
}
export function OrbitalScene(props: OrbitalSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const gesture = { time: 0, multi: false, moved: false, points: new Map<number, { x: number; y: number }>() };
    const start = (event: TouchEvent) => {
      if (event.touches.length === event.changedTouches.length) { gesture.time = performance.now(); gesture.multi = false; gesture.moved = false; gesture.points.clear(); }
      for (const touch of Array.from(event.changedTouches)) gesture.points.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      if (event.touches.length > 1) gesture.multi = true;
    };
    const move = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) {
        const origin = gesture.points.get(touch.identifier);
        if (origin && Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > 12) gesture.moved = true;
      }
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length) return;
      if (gesture.multi && !gesture.moved && current.current.focusedObject && !current.current.activeGame && performance.now() - gesture.time < 650) {
        if (event.cancelable) event.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        current.current.onReturn();
      }
      gesture.points.clear();
      gesture.multi = false;
    };
    const cancel = () => { gesture.points.clear(); gesture.multi = false; current.current.onGesture(false); };
    element.addEventListener('touchstart', start, { capture: true, passive: true });
    element.addEventListener('touchmove', move, { capture: true, passive: true });
    element.addEventListener('touchend', end, { capture: true, passive: false });
    element.addEventListener('touchcancel', cancel, true);
    return () => {
      element.removeEventListener('touchstart', start, true);
      element.removeEventListener('touchmove', move, true);
      element.removeEventListener('touchend', end, true);
      element.removeEventListener('touchcancel', cancel, true);
    };
  }, []);
  return <div ref={container} className="orbital-canvas" style={{ touchAction: props.focusedObject === 'computer' && props.activeGame ? 'auto' : 'none' }} onContextMenu={e => e.preventDefault()}
    onPointerDown={() => { void roomAudio.unlock(); }}
    onPointerCancel={() => props.onGesture(false)}
    onWheel={e => { if (props.focusedObject && !props.activeGame && e.deltaY > 45) props.onReturn(); }}
    onDoubleClick={e => { if ((e.target as HTMLElement).tagName === 'CANVAS' && props.focusedObject && !props.activeGame) props.onReturn(); }}>
    <Canvas shadows dpr={[1, 1.6]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
      <WorldContent {...props} />
    </Canvas>
  </div>;
}
