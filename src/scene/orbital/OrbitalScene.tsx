import { CLOCK_POSITION, LAMP_POSITION } from './cabinLayout';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldObjectState, type WorldSceneId, type WorldSceneProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { CAMERA_FOV, HOME_DIRECTION, HOME_TARGET, HOME_ZOOM, homeDistanceForAspect } from './cabinView';
import { Cosmos, createSunState, type SunState } from './Cosmos';
import { HabitatShell } from './HabitatShell';
import { SpacecraftHull } from './SpacecraftHull';
import {
  BOOST_FOV_KICK,
  ENTER_CABIN_DURATION,
  LEAVE_CABIN_DURATION,
  REDUCED_TRANSITION_DURATION,
  SHIP_TARGET,
  approachStartPosition,
  createFlightState,
  easeInOutCubic,
  easeOutQuart,
  hullOpacityForTransition,
  orbitDistanceForAspect,
  orbitHomePosition,
  stepFlightState,
  type SpacecraftFlightState,
  type SpacecraftViewMode,
} from './spacecraftFlight';
import { HabitatFurniture } from './HabitatFurniture';
import { MediaObjects } from './media/MediaObjects';
import { FeatureSurfaces } from './FeatureSurfaces';
import { AlarmClock3D, AlarmClockSurface } from './clock/AlarmClock';
import { ScheduleProvider } from './schedule/ScheduleContext';
import { ScheduleSurfaces } from './schedule/ScheduleSurfaces';
import { BOOK_POSITION } from './schedule/SchedulePaper';
import { SCHEDULE_BOOK_POSITION } from './schedule/bookLayout';
import { OrbitalResidents } from './OrbitalResidents';
import { shelfPoint, shelfVector } from './library/catalog';
import { sideLibraryCamera } from './library/sideCamera';
import { JOURNAL_PAGE_POSITION } from './journalLayout';
import type { BedRestPhase, WakeStretch } from './useWorldController';

const FOCUS: Record<string, { target: [number, number, number]; offset: [number, number, number] }> = {
  computer: { target: [1.77, 1.68, -2.30], offset: [0, 0.30, 3.5] },
  'music-player': { target: [-0.45, 1.2, -2.0], offset: [.4, 2.5, 3.1] },
  journal: { target: JOURNAL_PAGE_POSITION, offset: [0, 0.97, 0.45] },
  schedule: { target: [SCHEDULE_BOOK_POSITION[0] + 0.02, SCHEDULE_BOOK_POSITION[1] + 0.079, SCHEDULE_BOOK_POSITION[2]], offset: [0, 0.88, 0.48] },
  'schedule-glass': { target: [0.69, 2.53, -3.13], offset: [0, 0.02, 1.75] },
  'book-01': { target: [-.07, 1.03, .9], offset: [1.35, 1.12, 2.5] },
  cabinet: { target: [0, 0.48, .32], offset: [0.9, 0.71, 2.35] },
  clock: { target: [-2.06, 1.01, -2.615], offset: [0.10, 0.24, 1.15] },
};
interface OrbitalSceneProps extends WorldSceneProps {
  sceneObjects: Record<WorldSceneId, Record<string, WorldObjectState>>;
  gestureActive: boolean;
  bedRest: BedRestPhase;
  wakeStretch: React.RefObject<WakeStretch | null>;
  orbitalRestTime: React.RefObject<number>;
  viewMode: SpacecraftViewMode;
  boosting: boolean;
  onViewModeChange: (mode: SpacecraftViewMode) => void;
  onEnterCabin: () => void;
}
function CameraRig(props: OrbitalSceneProps & { flight: SpacecraftFlightState }) {
  const { camera, size } = useThree();
  const controls = useRef<Controls>(null);
  const fromPosition = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const destination = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const fromLens = useRef(new THREE.Vector2());
  const toLens = useRef(new THREE.Vector2());
  const moving = useRef(false), cameraProgress = useRef(0), localFlight = useRef(false);
  const viewFlight = useRef<{ active: boolean; elapsed: number; duration: number; mode: 'entering-cabin' | 'leaving-cabin' }>({ active: false, elapsed: 0, duration: ENTER_CABIN_DURATION, mode: 'entering-cabin' });
  const currentView = useRef('habitat/');
  const prevSize = useRef({ width: 0, height: 0 });
  const initialized = useRef(false);
  const initialTarget = useMemo(() => (props.viewMode === 'cabin' ? HOME_TARGET.toArray() : SHIP_TARGET.toArray()) as [number, number, number], []);
  const narrow = size.width < 720;
  const aspect = size.width / Math.max(1, size.height);
  const homeDistance = useMemo(() => homeDistanceForAspect(aspect), [aspect]);
  const orbitDistance = useMemo(() => orbitDistanceForAspect(aspect), [aspect]);
  const zoomFlight = useRef([HOME_ZOOM, HOME_ZOOM]);
  const cameraView = props.library?.cameraView;
  const sideView = props.focusedObject === 'book-01' && cameraView === 'side';
  const sideSlot = sideView ? props.library?.view.book?.slotId : undefined;
  const sideReading = !!sideSlot && ['open', 'reading', 'turn', 'close'].includes(props.library!.view.phase);
  const setLensOffset = (x: number, y: number) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (x || y) camera.setViewOffset(size.width, size.height, x, y, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
  };
  useEffect(() => {
    if (!controls.current) return;
    const resized = prevSize.current.width !== size.width || prevSize.current.height !== size.height;
    prevSize.current = { width: size.width, height: size.height };
    if (initialized.current && !resized) return;
    initialized.current = true;
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]);
    if (props.viewMode === 'approach') {
      const look = origin.clone().add(SHIP_TARGET);
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = 1; camera.fov = CAMERA_FOV; camera.updateProjectionMatrix(); }
      camera.position.copy(approachStartPosition(aspect)).add(origin);
      controls.current.target.copy(look);
      controls.current.update();
    } else if (props.viewMode === 'orbit') {
      const look = origin.clone().add(SHIP_TARGET);
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = 1; camera.fov = CAMERA_FOV; camera.updateProjectionMatrix(); }
      camera.position.copy(orbitHomePosition(aspect)).add(origin);
      controls.current.target.copy(look);
      controls.current.update();
    } else if (props.viewMode === 'cabin' && !props.focusedObject) {
      const look = origin.add(HOME_TARGET);
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = HOME_ZOOM; camera.fov = CAMERA_FOV; camera.updateProjectionMatrix(); }
      camera.position.copy(look).addScaledVector(HOME_DIRECTION, homeDistance);
      controls.current.target.copy(look);
      controls.current.update();
    }
  }, [camera, size.width, size.height, aspect, homeDistance, orbitDistance]);
  useEffect(() => {
    props.flight.mode = props.viewMode;
    if (props.viewMode === 'orbit' || props.viewMode === 'approach') {
      props.flight.hullOpacity = 1;
      viewFlight.current.active = false;
      return;
    }
    if (props.viewMode === 'cabin') {
      props.flight.hullOpacity = 0;
      viewFlight.current.active = false;
      return;
    }
    if (!controls.current) return;
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]);
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.current.target);
    const lens = camera instanceof THREE.PerspectiveCamera ? camera.view : null;
    fromLens.current.set(lens?.enabled ? lens.offsetX : 0, lens?.enabled ? lens.offsetY : 0);
    toLens.current.set(0, 0);
    if (props.viewMode === 'entering-cabin') {
      target.current.copy(origin).add(HOME_TARGET);
      destination.current.copy(target.current).addScaledVector(HOME_DIRECTION, homeDistance);
      if (camera instanceof THREE.PerspectiveCamera) zoomFlight.current = [camera.zoom, HOME_ZOOM];
      viewFlight.current = { active: true, elapsed: 0, duration: props.reducedMotion ? REDUCED_TRANSITION_DURATION : ENTER_CABIN_DURATION, mode: 'entering-cabin' };
    } else {
      target.current.copy(origin).add(SHIP_TARGET);
      destination.current.copy(orbitHomePosition(aspect)).add(origin);
      if (camera instanceof THREE.PerspectiveCamera) zoomFlight.current = [camera.zoom, 1];
      viewFlight.current = { active: true, elapsed: 0, duration: props.reducedMotion ? REDUCED_TRANSITION_DURATION : LEAVE_CABIN_DURATION, mode: 'leaving-cabin' };
    }
    moving.current = false;
  }, [props.viewMode]);
  useEffect(() => {
    if (!controls.current || props.transition.phase === 'idle' || props.viewMode !== 'cabin') return;
    const view = `${props.transition.toScene}/${props.focusedObject ?? ''}/${size.width}/${size.height}/${cameraView ?? ''}/${sideSlot ?? ''}/${sideReading}`;
    if (view === currentView.current && props.transition.phase !== 'returning' && props.transition.phase !== 'error') return;
    currentView.current = view;
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.current.target);
    const lens = camera instanceof THREE.PerspectiveCamera ? camera.view : null;
    if (camera instanceof THREE.PerspectiveCamera) zoomFlight.current = [camera.zoom, props.focusedObject ? 1 : HOME_ZOOM];
    fromLens.current.set(lens?.enabled ? lens.offsetX : 0, lens?.enabled ? lens.offsetY : 0);
    toLens.current.set(0, 0);
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.transition.toScene]);
    const pose = props.focusedObject ? FOCUS[props.focusedObject] : null;
    if (sideView && camera instanceof THREE.PerspectiveCamera && size.width > 0 && size.height > 0) {
      const side = sideLibraryCamera(props.transition.toScene, sideSlot, sideReading, size.width, size.height, camera.fov);
      target.current.fromArray(side.target).add(origin);
      destination.current.fromArray(side.offset).add(target.current);
      toLens.current.set(...side.lensOffset);
    } else if (pose) {
      target.current.copy(origin).add(new THREE.Vector3(...pose.target));
      const offset = new THREE.Vector3(...pose.offset);
      if (props.focusedObject === 'journal') offset.multiplyScalar(Math.max(1, 0.9 / (size.width / size.height)));
      if (props.focusedObject === 'book-01') {
        if (cameraView === 'close') { offset.set(1.75, .65, .30); target.current.y = 1.08; }
      }
      if (props.focusedObject?.startsWith('schedule')) {
        offset.multiplyScalar(Math.max(1, (narrow && props.focusedObject === 'schedule' ? 0.5 : 0.62) / (size.width / size.height)));
        if (narrow && props.focusedObject === 'schedule') target.current.x = origin.x + BOOK_POSITION[0];
      }
      if (props.focusedObject === 'clock' && narrow) {
        target.current.x = origin.x + CLOCK_POSITION[0];
        target.current.y = origin.y + CLOCK_POSITION[1] - 0.10;
        offset.multiplyScalar(Math.max(1, 0.68 / (size.width / size.height)));
      }
      if (props.focusedObject === 'book-01' && narrow) { const close = cameraView === 'close'; offset.multiplyScalar(close ? 1.9 : 1.6); target.current.y -= close ? .40 : .55; }
      if (props.focusedObject === 'book-01' && !narrow) target.current.x += .45;
      if (props.focusedObject === 'cabinet' || props.focusedObject === 'book-01') {
        target.current.sub(origin);
        target.current.fromArray(shelfPoint(props.transition.toScene, target.current.x, target.current.y, target.current.z)).add(origin);
        offset.fromArray(shelfVector(props.transition.toScene, offset.x, offset.y, offset.z));
      }
      destination.current.copy(target.current).add(offset);
      // Frame the shelf and slot together, including on portrait touchscreens.
      if (props.focusedObject === 'computer') destination.current.z = target.current.z + Math.max(pose.offset[2], 2.25 / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * (size.width / size.height)) + 0.25);
    } else {
      target.current.copy(origin).add(HOME_TARGET);
      destination.current.copy(target.current).addScaledVector(HOME_DIRECTION, homeDistance);
    }
    if (props.transition.phase === 'error') {
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = zoomFlight.current[1]; camera.updateProjectionMatrix(); }
      camera.position.copy(destination.current);
      controls.current.target.copy(target.current);
      controls.current.update();
      setLensOffset(toLens.current.x, toLens.current.y);
      moving.current = false;
    } else { moving.current = true; cameraProgress.current = 0; localFlight.current = props.focusedObject === 'book-01'; }
  }, [props.transition.id, props.focusedObject, props.transition.phase === 'error', props.viewMode, size.width, size.height, cameraView, sideSlot, sideReading]);
  useFrame((_, delta) => {
    const flight = props.flight;
    flight.boosting = props.boosting && (flight.mode === 'orbit' || flight.mode === 'approach');
    const finishedApproach = stepFlightState(flight, delta, props.reducedMotion);
    roomAudio.setThrusterBoost(flight.boost);
    if (finishedApproach) props.onViewModeChange('orbit');

    // Subtle cinematic FOV widening while boosting in orbit
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = CAMERA_FOV + (!props.reducedMotion && (flight.mode === 'orbit' || flight.mode === 'approach') ? flight.boost * BOOST_FOV_KICK : 0);
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, delta);
        camera.updateProjectionMatrix();
      }
    }

    if (!controls.current) return;

    // Opening deep-space approach glide toward the cruising spacecraft
    if (flight.mode === 'approach') {
      const origin = new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]);
      const start = approachStartPosition(aspect).add(origin);
      const end = orbitHomePosition(aspect).add(origin);
      const eased = easeOutQuart(flight.approachProgress);
      camera.position.lerpVectors(start, end, eased);
      // Slight sweeping elevation curve during approach
      camera.position.y += Math.sin(eased * Math.PI) * 1.4;
      controls.current.target.copy(origin).add(SHIP_TARGET);
      camera.lookAt(controls.current.target);
      return;
    }

    // Single-shot cutaway transition between orbital spacecraft view and cabin interior
    if (viewFlight.current.active) {
      const vf = viewFlight.current;
      vf.elapsed = Math.min(vf.duration, vf.elapsed + Math.min(delta, 0.1));
      const raw = vf.duration > 0 ? vf.elapsed / vf.duration : 1;
      const eased = easeInOutCubic(raw);
      flight.hullOpacity = hullOpacityForTransition(vf.mode, eased);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.zoom = THREE.MathUtils.lerp(zoomFlight.current[0], zoomFlight.current[1], eased);
        camera.updateProjectionMatrix();
      }
      camera.position.lerpVectors(fromPosition.current, destination.current, eased);
      controls.current.target.lerpVectors(fromTarget.current, target.current, eased);
      camera.lookAt(controls.current.target);
      setLensOffset(THREE.MathUtils.lerp(fromLens.current.x, toLens.current.x, eased), THREE.MathUtils.lerp(fromLens.current.y, toLens.current.y, eased));
      if (raw >= 1) {
        vf.active = false;
        const settled: SpacecraftViewMode = vf.mode === 'entering-cabin' ? 'cabin' : 'orbit';
        flight.mode = settled;
        flight.hullOpacity = settled === 'cabin' ? 0 : 1;
        controls.current.update();
        props.onViewModeChange(settled);
      }
      return;
    }

    if (!moving.current) return;
    const travel = props.transition.action?.kind === 'travel';
    if (localFlight.current) cameraProgress.current = Math.min(1, cameraProgress.current + Math.min(delta, .04) / (props.reducedMotion ? .25 : .8));
    const progress = localFlight.current ? cameraProgress.current : props.motion.current[travel ? 'sceneProgress' : 'progress'];
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.zoom = THREE.MathUtils.lerp(zoomFlight.current[0], zoomFlight.current[1], progress);
      camera.updateProjectionMatrix();
    }
    camera.position.lerpVectors(fromPosition.current, destination.current, progress);
    if (travel && !props.reducedMotion) camera.position.y += Math.sin(progress * Math.PI) * 3;
    controls.current.target.lerpVectors(fromTarget.current, target.current, progress);
    camera.lookAt(controls.current.target);
    setLensOffset(THREE.MathUtils.lerp(fromLens.current.x, toLens.current.x, progress), THREE.MathUtils.lerp(fromLens.current.y, toLens.current.y, progress));
    if (progress >= 1) moving.current = false;
  });
  const inTransition = props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin';
  const locked = inTransition || !!props.bedRest || props.gestureActive || !!props.focusedObject || !['idle', 'active', 'error'].includes(props.transition.phase);
  const inCabin = props.viewMode === 'cabin';
  return <OrbitControls ref={controls} enabled={!locked} enablePan={false} enableDamping dampingFactor={0.08}
    minDistance={inCabin ? 5 : 14} maxDistance={inCabin ? homeDistance * 1.5 : orbitDistance * 2.4}
    minPolarAngle={0} maxPolarAngle={Math.PI}
    onStart={() => {
      if (props.flight.mode === 'approach') {
        props.flight.mode = 'orbit';
        props.flight.approachProgress = 1;
        props.onViewModeChange('orbit');
      }
    }}
    target={initialTarget} />;
}
const SUN_DAY_COLOR = new THREE.Color('#ffd9b8');
const SUN_LIMB_COLOR = new THREE.Color('#ff8b42');
const SKY_DAY_COLOR = new THREE.Color('#f7e2c8');
const SKY_DUSK_COLOR = new THREE.Color('#eda878');
const SKY_SHADOW_COLOR = new THREE.Color('#8e9bc4');
const GROUND_DAY_COLOR = new THREE.Color('#b58c73');
const GROUND_DUSK_COLOR = new THREE.Color('#593f34');
const GROUND_SHADOW_COLOR = new THREE.Color('#352f3d');
const EARTHSHINE_DAY_COLOR = new THREE.Color('#b8c8e8');
const EARTHSHINE_DUSK_COLOR = new THREE.Color('#f2a270');
const EARTHSHINE_NIGHT_COLOR = new THREE.Color('#7c94c8');
const SUN_INTENSITY = 1.62;

function OrbitalLighting({ objects, sun }: Pick<WorldSceneProps, 'objects'> & { sun: SunState }) {
  const lamp = useRef<THREE.PointLight>(null);
  const roomWarm = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const earthshine = useRef<THREE.DirectionalLight>(null);
  const scene = useThree(state => state.scene);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => () => { scene.environmentIntensity = 1; }, [scene]);
  useFrame((_, delta) => {
    const daylight = sun.daylight.value;
    const warmth = sun.warmth;
    if (lamp.current) lamp.current.intensity = THREE.MathUtils.damp(lamp.current.intensity, objects.lamp?.active === false ? 0 : 5.2, 5, delta);
    if (roomWarm.current) roomWarm.current.intensity = THREE.MathUtils.damp(roomWarm.current.intensity, 2.8 + 0.6 * (1 - daylight), 3, delta);
    if (ambient.current) {
      ambient.current.intensity = THREE.MathUtils.damp(ambient.current.intensity, 0.36 + 0.40 * daylight + 0.06 * warmth, 3, delta);
      ambient.current.color.lerpColors(SKY_SHADOW_COLOR, SKY_DAY_COLOR, daylight).lerp(SKY_DUSK_COLOR, warmth * 0.42);
      ambient.current.groundColor.lerpColors(GROUND_SHADOW_COLOR, GROUND_DAY_COLOR, daylight).lerp(GROUND_DUSK_COLOR, warmth * 0.35);
    }
    if (key.current) {
      key.current.position.copy(sun.light).multiplyScalar(18);
      key.current.intensity = SUN_INTENSITY * daylight;
      key.current.color.lerpColors(SUN_DAY_COLOR, SUN_LIMB_COLOR, warmth * 0.88);
    }
    if (earthshine.current) {
      earthshine.current.intensity = 0.20 + 0.20 * (1 - daylight) + 0.14 * warmth;
      earthshine.current.color.lerpColors(EARTHSHINE_NIGHT_COLOR, EARTHSHINE_DAY_COLOR, daylight).lerp(EARTHSHINE_DUSK_COLOR, warmth * 0.55);
    }
    scene.environmentIntensity = 0.36 + 0.44 * daylight;
  });
  return <>
    <primitive object={sunTarget} />
    <hemisphereLight ref={ambient} args={['#f7e2c8', '#b58c73', 0.46]} />
    <directionalLight ref={key} target={sunTarget} color="#ffd9b8" intensity={SUN_INTENSITY} position={sun.light.toArray().map(n => n * 18) as [number, number, number]} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}
      shadow-camera-near={0.1} shadow-camera-far={60} shadow-normalBias={0.012} shadow-bias={-0.0001} />
    <directionalLight ref={earthshine} target={sunTarget} color="#b8c8e8" intensity={0.22} position={[-11, 4.5, -10]} />
    <pointLight ref={lamp} position={[LAMP_POSITION[0] + .08, 1.74, LAMP_POSITION[2] + .07]} color="#ffc17a" intensity={5.2} distance={10} decay={1.85} />
    <pointLight ref={roomWarm} position={[2.1, 2.2, 0.2]} color="#ffdcb5" intensity={2.8} distance={9} decay={1.9} />
  </>;
}
function WorldContent(props: OrbitalSceneProps) {
  const [walkTarget, setWalkTarget] = useState<[number, number, number] | null>(null);
  const [hullReady, setHullReady] = useState(false);
  const sofaTime = useRef<number | null>(null);
  const interaction = useRef<NonNullable<WorldSceneProps['onApproach']> | null>(null);
  const sun = useMemo(createSunState, []);
  const flight = useMemo(() => createFlightState(props.viewMode), []);
  const initialCameraPos = useMemo(() => {
    const aspect = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 10;
    if (props.viewMode === 'approach') return approachStartPosition(aspect).toArray() as [number, number, number];
    if (props.viewMode === 'orbit') return orbitHomePosition(aspect).toArray() as [number, number, number];
    return HOME_TARGET.clone().addScaledVector(HOME_DIRECTION, homeDistanceForAspect(aspect)).toArray() as [number, number, number];
  }, []);
  const inCabin = props.viewMode === 'cabin';
  const showInterior = inCabin || props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin' || hullReady;
  useEffect(() => { setWalkTarget(null); }, [props.sceneId, inCabin]);
  return <ScheduleProvider adapters={props.adapters}>
    <color attach="background" args={['#080714']} />
    <PerspectiveCamera makeDefault fov={CAMERA_FOV} position={initialCameraPos} near={0.08} far={2000} />
    <CameraRig {...props} flight={flight} />
    <Cosmos reducedMotion={props.reducedMotion} sun={sun} flight={flight} orbitalRestTime={props.orbitalRestTime} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.55} color="#ffe9cc" position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 8, 1]} />
      <Lightformer intensity={0.55} color="#d7c8e0" position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 4, 1]} />
    </Environment>
    {(['habitat', 'observatory'] as WorldSceneId[]).map(id => {
      const focusedObject = inCabin && id === props.sceneId ? props.focusedObject : null;
      const world = { ...props, sceneId: id, objects: props.sceneObjects[id], focusedObject,
        onHover: (objectId: string | null, hint?: string) => {
          if (inCabin && focusedObject) props.onHover(objectId, hint);
        },
        onAction: (action: Parameters<typeof props.onAction>[0]) => {
          if (!inCabin || props.bedRest || id !== props.sceneId) return;
          props.onAction(action);
        },
        // A panorama click is a request to walk over; once focused, the props are already in reach.
        onApproach: (point: [number, number, number], action: WorldAction, perform: () => void) => {
          if (!inCabin || props.bedRest || id !== props.sceneId) return false;
          if (focusedObject) { perform(); return true; }
          return interaction.current?.(point, action, perform) ?? false;
        },
      };
      return <group key={id} position={SCENE_ORIGINS[id]} visible={id === props.sceneId || (props.transition.action?.kind === 'travel' && props.transition.phase !== 'active' && props.transition.phase !== 'error')}>
        {id === props.sceneId && <OrbitalLighting objects={world.objects} sun={sun} />}
        {id === 'habitat' && <SpacecraftHull flight={flight} sun={sun} reducedMotion={props.reducedMotion} onEnterCabin={props.onEnterCabin} onReady={() => setHullReady(true)} />}
        <group visible={showInterior}>
          <HabitatShell variant={id} onFloorClick={point => { if (inCabin && !props.bedRest && !props.focusedObject && props.sceneId === id && !props.gestureActive && (!props.library || props.library.flow.current.phase === 'idle')) { void roomAudio.unlock(); setWalkTarget(point); } }} />
          {id === 'habitat' && <ScheduleSurfaces {...world} visible={inCabin && props.sceneId === 'habitat'} />}
          {id === 'habitat' && <AlarmClock3D {...world} />}
          <Suspense fallback={null}><HabitatFurniture {...world} sofaTime={sofaTime} /><MediaObjects {...world} /></Suspense>
          <FeatureSurfaces {...world} />
          {id === props.sceneId && <>
            <OrbitalResidents {...world} sofaTime={sofaTime} onHover={(objectId, hint) => { if (inCabin) props.onHover(objectId, hint); }} interaction={interaction}
              approachEnabled={inCabin && !props.bedRest && !props.focusedObject && ['idle', 'active', 'error'].includes(props.transition.phase)} walkTarget={walkTarget} onArrive={() => setWalkTarget(null)} enabled={inCabin && !props.bedRest && !props.focusedObject && (!props.library || props.library.view.phase === 'idle') && !props.gestureActive && ['idle', 'active', 'error'].includes(props.transition.phase)} />
          </>}
        </group>
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
    <Canvas shadows dpr={[1, 1.6]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
      <WorldContent {...props} />
    </Canvas>
    <AlarmClockSurface
      focused={props.viewMode === 'cabin' && props.sceneId === 'habitat' && props.focusedObject === 'clock' && ['active', 'error'].includes(props.transition.phase)}
      isMuted={props.isMuted}
      onReturn={props.onReturn}
      onFocusClock={() => props.onAction({ sceneId: 'habitat', objectId: 'clock', kind: 'inspect' })}
    />
  </div>;
}
