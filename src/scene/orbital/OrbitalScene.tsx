import { previewOutfit, readOutfit } from './wardrobe/outfit';
import { CLOCK_POSITION, LAMP_POSITION, UPPER_DECK_OFFSET } from './cabinLayout';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, events, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldObjectState, type WorldSceneId, type WorldSceneProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { CAMERA_FOV, HOME_TARGET, HOME_ZOOM, OUTFIT_TARGET, outfitCameraPosition, cabinCameraFrame, type CabinView } from './cabinView';
import { CabinUpperDeck, UpperDeckVisibility } from './CabinUpperDeck';
import { BedroomGuard, CabinStaircase } from './CabinStructure';
import { stairDestination, type CabinResidentView } from './cabinStairs';
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
import { HabitatBedroom, HabitatFurniture } from './HabitatFurniture';
import { MediaObjects } from './media/MediaObjects';
import { FeatureSurfaces } from './FeatureSurfaces';
import { AlarmClock3D, AlarmClockSurface } from './clock/AlarmClock';
import { ScheduleProvider } from './schedule/ScheduleContext';
import { ScheduleSurfaces } from './schedule/ScheduleSurfaces';
import { BOOK_POSITION } from './schedule/SchedulePaper';
import { SCHEDULE_BOOK_POSITION } from './schedule/bookLayout';
import { OrbitalResidents } from './OrbitalResidents';
import { CatInteraction } from './cat/CatInteraction';
import catMeowUrl from '../../../assets/audio/cat/tuanzi-meow.mp3';
import { shelfPoint, shelfVector } from './library/catalog';
import { sideLibraryCamera } from './library/sideCamera';
import { JOURNAL_PAGE_POSITION } from './journalLayout';

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
  viewMode: SpacecraftViewMode;
  boosting: boolean;
  onViewModeChange: (mode: SpacecraftViewMode) => void;
  onEnterCabin: () => void;
}
interface CabinCameraProps {
  cabinView: CabinView;
  viewRevision: number;
  onCabinViewChange: (view: CabinView) => void;
}
type CameraRigProps = OrbitalSceneProps & CabinCameraProps & {
  flight: SpacecraftFlightState;
  outfitPreview: boolean;
  residentView: React.MutableRefObject<CabinResidentView>;
  onUpperVisibility: (visible: boolean) => void;
};

function CameraRig(props: CameraRigProps) {
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
  const initializedCamera = useRef<THREE.Camera | null>(null);
  const initialTarget = useMemo(() => (props.outfitPreview ? OUTFIT_TARGET : props.viewMode === 'cabin' ? HOME_TARGET : SHIP_TARGET).toArray() as [number, number, number], []);
  const narrow = size.width < 720;
  const aspect = size.width / Math.max(1, size.height);
  const cabinFrames = useMemo(() => ({
    overview: cabinCameraFrame('overview', aspect),
    lower: cabinCameraFrame('lower', aspect),
    upper: cabinCameraFrame('upper', aspect),
  }), [aspect]);
  const deckCamera = useRef({ viewRevision: props.viewRevision, settling: false, onStairs: false, upperVisible: !props.outfitPreview });
  const stairEye = useRef(new THREE.Vector3());
  const stairTarget = useRef(new THREE.Vector3());
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
    const firstView = initializedCamera.current !== camera;
    if (!firstView && !resized) return;
    const showOutfit = props.outfitPreview && firstView;
    initializedCamera.current = camera;
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
      const frame = cabinFrames[props.cabinView];
      const look = origin.clone().add(showOutfit ? OUTFIT_TARGET : frame.target);
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = HOME_ZOOM; camera.fov = CAMERA_FOV; camera.updateProjectionMatrix(); }
      camera.position.copy(showOutfit ? outfitCameraPosition(aspect) : frame.position).add(origin);
      deckCamera.current.viewRevision = props.viewRevision;
      deckCamera.current.settling = false;
      controls.current.target.copy(look);
      controls.current.update();
    }
  }, [camera, size.width, size.height, aspect, cabinFrames, orbitDistance]);
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
      const frame = cabinFrames[props.cabinView];
      target.current.copy(origin).add(frame.target);
      destination.current.copy(origin).add(frame.position);
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
    if (!props.focusedObject && props.transition.phase !== 'returning' && props.transition.phase !== 'error'
      && props.transition.action?.kind !== 'travel') return;
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
      if (props.focusedObject === 'clock' && props.transition.toScene === 'habitat') target.current.add(new THREE.Vector3(...UPPER_DECK_OFFSET));
      destination.current.copy(target.current).add(offset);
      // Frame the shelf and slot together, including on portrait touchscreens.
      if (props.focusedObject === 'computer') destination.current.z = target.current.z + Math.max(pose.offset[2], 2.25 / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * (size.width / size.height)) + 0.25);
    } else {
      const frame = cabinFrames[props.cabinView];
      target.current.copy(origin).add(frame.target);
      destination.current.copy(origin).add(frame.position);
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

    const resident = props.residentView.current;
    const deck = deckCamera.current;
    const inHabitat = flight.mode === 'cabin' && props.sceneId === 'habitat';
    const ascent = inHabitat ? resident.stairAscent : null;
    const onStairs = ascent !== null;
    if (deck.onStairs && !onStairs && inHabitat) {
      props.onCabinViewChange(resident.deck);
      deck.settling = true;
    }
    deck.onStairs = onStairs;
    if (deck.viewRevision !== props.viewRevision) {
      deck.viewRevision = props.viewRevision;
      deck.settling = true;
    }
    const upperVisible = !inHabitat || (props.focusedObject
      ? props.focusedObject === 'clock'
      : onStairs || props.cabinView !== 'lower');
    if (deck.upperVisible !== upperVisible) {
      deck.upperVisible = upperVisible;
      props.onUpperVisibility(upperVisible);
    }
    if (!moving.current) {
      const adjusting = inHabitat && !locked && (onStairs || deck.settling);
      controls.current.enabled = !locked && !adjusting;
      if (!adjusting) return;
      const end = cabinFrames[props.cabinView];
      const eye = onStairs ? stairEye.current.lerpVectors(cabinFrames.lower.position, cabinFrames.upper.position, ascent) : end.position;
      const pivot = onStairs ? stairTarget.current.lerpVectors(cabinFrames.lower.target, cabinFrames.upper.target, ascent) : end.target;
      const blend = props.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * (onStairs ? 6 : 10));
      camera.position.lerp(eye, blend);
      controls.current.target.lerp(pivot, blend);
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.zoom - HOME_ZOOM) > .001) {
        camera.zoom = THREE.MathUtils.lerp(camera.zoom, HOME_ZOOM, blend);
        camera.updateProjectionMatrix();
      }
      camera.lookAt(controls.current.target);
      if (!onStairs && camera.position.distanceToSquared(eye) < .0001 && controls.current.target.distanceToSquared(pivot) < .0001) {
        camera.position.copy(eye);
        controls.current.target.copy(pivot);
        controls.current.update();
        deck.settling = false;
        controls.current.enabled = !locked;
      }
      return;
    }
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
  const locked = inTransition || props.gestureActive || !!props.focusedObject || !['idle', 'active', 'error'].includes(props.transition.phase);
  const inCabin = props.viewMode === 'cabin';
  return <OrbitControls ref={controls} enabled={!locked} enablePan={false} enableDamping dampingFactor={0.08}
    minDistance={inCabin ? 5 : 14} maxDistance={inCabin ? cabinFrames.overview.distance * 1.5 : orbitDistance * 2.4}
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

function OrbitalLighting({ objects, sceneId, sun }: Pick<WorldSceneProps, 'objects' | 'sceneId'> & { sun: SunState }) {
  const lamp = useRef<THREE.PointLight>(null);
  const roomWarm = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const earthshine = useRef<THREE.DirectionalLight>(null);
  const scene = useThree(state => state.scene);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const [lampX, lampY] = sceneId === 'habitat' ? UPPER_DECK_OFFSET : [0, 0];
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
    <pointLight ref={lamp} position={[LAMP_POSITION[0] + lampX + .08, 1.74 + lampY, LAMP_POSITION[2] + .07]} color="#ffc17a" intensity={5.2} distance={10} decay={1.85} />
    <pointLight ref={roomWarm} position={[2.1, 2.2, 0.2]} color="#ffdcb5" intensity={2.8} distance={9} decay={1.9} />
  </>;
}
function WorldContent(props: OrbitalSceneProps & CabinCameraProps & { catMenuOpen: boolean; outfitPreview: boolean }) {
  const [walkTarget, setWalkTarget] = useState<[number, number, number] | null>(null);
  const [upperVisible, setUpperVisible] = useState(!props.outfitPreview);
  const residentView = useRef<CabinResidentView>({ deck: 'lower', stairAscent: null });
  const sofaTime = useRef<number | null>(null);
  const interaction = useRef<NonNullable<WorldSceneProps['onApproach']> | null>(null);
  const sun = useMemo(createSunState, []);
  const flight = useMemo(() => createFlightState(props.viewMode), []);
  const { outfitPreview } = props;
  const initialCameraPos = useMemo(() => {
    const aspect = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 10;
    if (outfitPreview) return outfitCameraPosition(aspect).toArray() as [number, number, number];
    if (props.viewMode === 'approach') return approachStartPosition(aspect).toArray() as [number, number, number];
    if (props.viewMode === 'orbit') return orbitHomePosition(aspect).toArray() as [number, number, number];
    return cabinCameraFrame(props.cabinView, aspect).position.toArray() as [number, number, number];
  }, []);
  const inCabin = props.viewMode === 'cabin';
  const showInterior = inCabin || props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin';
  const canWalk = inCabin && !props.catMenuOpen && !props.focusedObject && !props.gestureActive
    && (!props.library || props.library.flow.current.phase === 'idle') && ['idle', 'active', 'error'].includes(props.transition.phase);
  const walkTo = (id: WorldSceneId, point: [number, number, number]) => {
    if (!canWalk || props.sceneId !== id) return;
    void roomAudio.unlock();
    setWalkTarget(point);
  };
  useEffect(() => { setWalkTarget(null); }, [props.sceneId, inCabin]);
  return <ScheduleProvider adapters={props.adapters}>
    <color attach="background" args={['#080714']} />
    <PerspectiveCamera makeDefault fov={CAMERA_FOV} position={initialCameraPos} near={0.08} far={2000} />
    <CameraRig {...props} flight={flight} residentView={residentView} onUpperVisibility={setUpperVisible} />
    <Cosmos reducedMotion={props.reducedMotion} sun={sun} flight={flight} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.55} color="#ffe9cc" position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 8, 1]} />
      <Lightformer intensity={0.55} color="#d7c8e0" position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 4, 1]} />
    </Environment>
    <UpperDeckVisibility.Provider value={upperVisible}>
    {(['habitat', 'observatory'] as WorldSceneId[]).map(id => {
      const focusedObject = inCabin && id === props.sceneId ? props.focusedObject : null;
      const world = { ...props, sceneId: id, objects: props.sceneObjects[id], focusedObject,
        onHover: (objectId: string | null, hint?: string) => {
          if (inCabin && focusedObject) props.onHover(objectId, hint);
        },
        onAction: (action: Parameters<typeof props.onAction>[0]) => {
          if (!inCabin || id !== props.sceneId) return;
          props.onAction(action);
        },
        // A panorama click is a request to walk over; once focused, the props are already in reach.
        onApproach: (point: [number, number, number], action: WorldAction, perform: () => void) => {
          if (!inCabin || id !== props.sceneId) return false;
          if (focusedObject) { perform(); return true; }
          return interaction.current?.(point, action, perform) ?? false;
        },
      };
      const onFloorClick = (point: [number, number, number]) => walkTo(id, point);
      return <group key={id} position={SCENE_ORIGINS[id]} visible={id === props.sceneId || (props.transition.action?.kind === 'travel' && props.transition.phase !== 'active' && props.transition.phase !== 'error')}>
        {id === props.sceneId && <OrbitalLighting objects={world.objects} sceneId={id} sun={sun} />}
        {id === 'habitat' && <SpacecraftHull flight={flight} sun={sun} reducedMotion={props.reducedMotion} onEnterCabin={props.onEnterCabin} />}
        <group visible={showInterior}>
          <HabitatShell world={world} deck="lower" onFloorClick={onFloorClick} />
          {id === 'habitat' && <ScheduleSurfaces {...world} visible={inCabin && props.sceneId === 'habitat'} />}
          {id === 'habitat' && <>
            <CabinStaircase onCross={() => walkTo(id, stairDestination(residentView.current.deck))} />
            <CabinUpperDeck>
              <HabitatShell world={world} deck="upper" onFloorClick={onFloorClick} />
              <BedroomGuard />
              <AlarmClock3D {...world} />
              <Suspense fallback={null}><HabitatBedroom world={world} sofaTime={sofaTime} /></Suspense>
            </CabinUpperDeck>
          </>}
          <Suspense fallback={null}><HabitatFurniture {...world} /><MediaObjects {...world} /></Suspense>
          <FeatureSurfaces {...world} />
          {id === props.sceneId && <>
            <OrbitalResidents {...world} outfit={readOutfit(props.sceneObjects.habitat.wardrobe?.itemId)} catMenuOpen={props.catMenuOpen} sofaTime={sofaTime} onHover={(objectId, hint) => { if (inCabin) props.onHover(objectId, hint); }} interaction={interaction}
              deckView={residentView} upperVisible={upperVisible}
              showNearbyHints={props.cabinView === 'overview' || props.cabinView === residentView.current.deck}
              approachEnabled={inCabin && !props.focusedObject && ['idle', 'active', 'error'].includes(props.transition.phase)}
              walkTarget={walkTarget} onArrive={() => setWalkTarget(null)}
              enabled={canWalk && (!props.library || props.library.view.phase === 'idle')} />
          </>}
        </group>
      </group>;
    })}
    </UpperDeckVisibility.Provider>
  </ScheduleProvider>;
}
const visibleSceneEvents: NonNullable<React.ComponentProps<typeof Canvas>['events']> = state => ({
  ...events(state),
  filter: hits => hits.filter(hit => {
    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  }),
});

const CABIN_VIEWS: [CabinView, string][] = [['overview', '全景'], ['lower', '一层'], ['upper', '二层']];

export function OrbitalScene(props: OrbitalSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const [catMenu, setCatMenu] = useState<WorldAction | null>(null);
  const outfitPreview = useMemo(() => props.viewMode === 'cabin' && !!previewOutfit(window.location.search), []);
  const [view, setView] = useState<{ mode: CabinView; revision: number }>({ mode: outfitPreview ? 'lower' : 'overview', revision: 0 });
  const selectView = (mode: CabinView) => setView(current => ({ mode, revision: current.revision + 1 }));
  useEffect(() => {
    if (props.viewMode === 'cabin') return () => roomAudio.stopCatMeow();
  }, [props.viewMode]);
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
    <Canvas events={visibleSceneEvents} shadows dpr={[1, 1.6]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
      <WorldContent {...props} catMenuOpen={!!catMenu} outfitPreview={outfitPreview}
        cabinView={view.mode} viewRevision={view.revision} onCabinViewChange={selectView} onAction={action => {
        if (action.kind === 'pet' && action.objectId === 'pet') setCatMenu(action);
        else props.onAction(action);
      }} />
    </Canvas>
    {props.sceneId === 'habitat' && props.viewMode === 'cabin' && !props.focusedObject && !catMenu
      && ['idle', 'active', 'error'].includes(props.transition.phase) && (
      <nav className="orbital-floor-views" aria-label="生活舱视角">
        {CABIN_VIEWS.map(([mode, label]) => <button key={mode} type="button" className="orbital-flight-pill"
          aria-pressed={view.mode === mode} onClick={() => selectView(mode)}>{label}</button>)}
      </nav>
    )}
    {catMenu && <CatInteraction onChoose={choice => {
      setCatMenu(null);
      if (choice) {
        roomAudio.playCatMeow(catMeowUrl);
        props.onAction({ ...catMenu, payload: { itemId: choice } });
      }
    }} />}
    <AlarmClockSurface
      focused={props.viewMode === 'cabin' && props.sceneId === 'habitat' && props.focusedObject === 'clock' && ['active', 'error'].includes(props.transition.phase)}
      isMuted={props.isMuted}
      onReturn={props.onReturn}
      onFocusClock={() => props.onAction({ sceneId: 'habitat', objectId: 'clock', kind: 'inspect' })}
    />
  </div>;
}
