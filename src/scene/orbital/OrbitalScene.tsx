import type { PaperPickup } from './cabinActions';
import { previewOutfit, readOutfit, type ResidentOutfit } from './wardrobe/outfit';
import { CLOCK_POSITION, LAMP_POSITION, UPPER_DECK_OFFSET, WARDROBE_STAND, type CabinDeck } from './cabinLayout';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, events, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldObjectState, type WorldSceneId, type WorldSceneProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { CAMERA_FOV, HOME_TARGET, HOME_ZOOM, OUTFIT_TARGET, outfitCameraPosition, cabinCameraFrame, stairCameraFrames, type CabinView } from './cabinView';
import { CabinFadeGroup, CabinOpacityContext, CabinUpperDeck } from './CabinUpperDeck';
import { CabinZoomRenderer } from './CabinZoomRenderer';
import { cabinDeckOpacity, cabinZoomIsolation, quickCabinFrame, QUICK_CABIN_DURATION, type CabinOpacity } from './cabinCutaway';
import { BedroomGuard, CabinStaircase } from './CabinStructure';
import { stairApproachPoint, stairLanding, type CabinResidentView } from './cabinStairs';
import { Cosmos, createSunState, type SunState } from './Cosmos';
import { HabitatShell, HabitatShellPrewarmer, preloadHabitatShell } from './HabitatShell';
import { ResidentPrewarmer } from './ResidentModel';
import { SpacecraftHull } from './SpacecraftHull';
import {
  BOOST_FOV_KICK,
  ENTER_CABIN_DURATION,
  LEAVE_CABIN_DURATION,
  REDUCED_TRANSITION_DURATION,
  SHIP_TARGET,
  approachStartPosition,
  cabinOpacityForTransition,
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
import type { PaperBallBody } from './schedule/paperBallMotion';
import { BOOK_POSITION } from './schedule/SchedulePaper';
import { SCHEDULE_BOOK_POSITION } from './schedule/bookLayout';
import { OrbitalResidents } from './OrbitalResidents';
import { CatInteraction } from './cat/CatInteraction';
import catMeowUrl from '../../../assets/audio/cat/tuanzi-meow.mp3';
import { shelfPoint, shelfVector } from './library/catalog';
import { JOURNAL_PAGE_POSITION } from './journalLayout';
import { AdaptiveQuality } from './SceneQuality';
import { SCENE_QUALITY, sceneMaxDpr, type QualityLevel } from './adaptiveQuality';

const FOCUS: Record<string, { target: [number, number, number]; offset: [number, number, number] }> = {
  computer: { target: [1.77, 1.68, -2.30], offset: [0, 0.30, 3.5] },
  'music-player': { target: [-0.45, 1.2, -2.0], offset: [.4, 2.5, 3.1] },
  journal: { target: JOURNAL_PAGE_POSITION, offset: [0, 0.97, 0.45] },
  schedule: { target: [SCHEDULE_BOOK_POSITION[0] + 0.02, SCHEDULE_BOOK_POSITION[1] + 0.079, SCHEDULE_BOOK_POSITION[2]], offset: [0, 0.88, 0.48] },
  'schedule-glass': { target: [0.69, 2.53, -3.13], offset: [0, 0.02, 1.75] },
  'book-01': { target: [-.07, 1.03, .9], offset: [1.35, 1.12, 2.5] },
  cabinet: { target: [0, 0.48, .32], offset: [0.9, 0.71, 2.35] },
  wardrobe: { target: [WARDROBE_STAND[0], 1.20, WARDROBE_STAND[1]], offset: [-3.45, .80, 3.80] },
  clock: { target: [-2.06, 1.01, -2.615], offset: [0.10, 0.24, 1.15] },
};
interface OrbitalSceneProps extends WorldSceneProps {
  onOutfitMounted: (outfit: ResidentOutfit, ready: boolean) => void;
  sceneObjects: Record<WorldSceneId, Record<string, WorldObjectState>>;
  gestureActive: boolean;
  viewMode: SpacecraftViewMode;
  boosting: boolean;
  onViewModeChange: (mode: SpacecraftViewMode) => void;
  onEnterCabin: () => void;
  onLeaveCabin?: () => void;
  /** True while the trash-can full-screen clean-up owns the view. */
  cleaning: boolean;
  /** Increments once the clean-up has put loose props back in place. */
  cleanTick: number;
}
interface CabinCameraProps {
  cabinView: CabinView;
  viewRevision: number;
  quickDeck: CabinDeck | null;
  quickTravel: React.MutableRefObject<((target: CabinDeck) => boolean) | null>;
  onQuickTravelFinish: () => void;
  onQuickTravelTarget: (target: CabinDeck | null) => void;
  onCabinViewChange: (view: CabinView) => void;
}
type CameraRigProps = OrbitalSceneProps & CabinCameraProps & {
  flight: SpacecraftFlightState;
  outfitPreview: boolean;
  residentView: React.MutableRefObject<CabinResidentView>;
  deckOpacity: React.MutableRefObject<CabinOpacity>;
};

function CameraRig(props: CameraRigProps) {
  const { camera, size } = useThree();
  const controls = useRef<Controls>(null);
  const fromPosition = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const destination = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
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
  const floorFramingDistance = Math.min(cabinFrames.lower.distance, cabinFrames.upper.distance);
  const stairFrames = useMemo(() => stairCameraFrames(aspect), [aspect]);
  const deckCamera = useRef({ viewRevision: props.viewRevision, settling: false, onStairs: false, zoomRatio: null as number | null });
  const quickFlight = useRef<{ elapsed: number; start: CabinOpacity; zoom: number; moved: boolean } | null>(null);
  const stairEye = useRef(new THREE.Vector3());
  const stairTarget = useRef(new THREE.Vector3());
  const orbitDistance = useMemo(() => orbitDistanceForAspect(aspect), [aspect]);
  const zoomFlight = useRef([HOME_ZOOM, HOME_ZOOM]);
  const cabinFrameScale = (distance: number) => {
    const ratio = deckCamera.current.zoomRatio;
    if (ratio === null) return 1;
    return THREE.MathUtils.clamp(ratio * floorFramingDistance, 5, cabinFrames.overview.distance * 1.5) / distance;
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
      if (showOutfit) camera.position.copy(outfitCameraPosition(aspect));
      else camera.position.lerpVectors(frame.target, frame.position, cabinFrameScale(frame.distance));
      camera.position.add(origin);
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
      props.deckOpacity.current.interior = 0;
      viewFlight.current.active = false;
      return;
    }
    if (props.viewMode === 'cabin') {
      props.flight.hullOpacity = 0;
      props.deckOpacity.current.interior = 1;
      viewFlight.current.active = false;
      return;
    }
    if (!controls.current) return;
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]);
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.current.target);
    if (props.viewMode === 'entering-cabin') {
      props.deckOpacity.current.resident = 1;
      const frame = cabinFrames[props.cabinView];
      target.current.copy(origin).add(frame.target);
      destination.current.lerpVectors(frame.target, frame.position, cabinFrameScale(frame.distance)).add(origin);
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
    const view = `${props.transition.toScene}/${props.focusedObject ?? ''}/${size.width}/${size.height}`;
    if (view === currentView.current && props.transition.phase !== 'returning' && props.transition.phase !== 'error') return;
    currentView.current = view;
    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.current.target);
    if (camera instanceof THREE.PerspectiveCamera) zoomFlight.current = [camera.zoom, props.focusedObject ? 1 : HOME_ZOOM];
    const origin = new THREE.Vector3(...SCENE_ORIGINS[props.transition.toScene]);
    const pose = props.focusedObject ? FOCUS[props.focusedObject] : null;
    if (pose) {
      target.current.copy(origin).add(new THREE.Vector3(...pose.target));
      const offset = new THREE.Vector3(...pose.offset);
      if (props.focusedObject === 'journal') offset.multiplyScalar(Math.max(1, 0.9 / (size.width / size.height)));
      if (props.focusedObject?.startsWith('schedule')) {
        offset.multiplyScalar(Math.max(1, (narrow && props.focusedObject === 'schedule' ? 0.5 : 0.62) / (size.width / size.height)));
        if (narrow && props.focusedObject === 'schedule') target.current.x = origin.x + BOOK_POSITION[0];
      }
      if (props.focusedObject === 'clock' && narrow) {
        target.current.x = origin.x + CLOCK_POSITION[0];
        target.current.y = origin.y + CLOCK_POSITION[1] - 0.10;
        offset.multiplyScalar(Math.max(1, 0.68 / (size.width / size.height)));
      }
      if (props.focusedObject === 'book-01' && narrow) { offset.multiplyScalar(1.6); target.current.y -= .55; }
      if (props.focusedObject === 'book-01' && !narrow) target.current.x += .45;
      if (props.focusedObject === 'cabinet' || props.focusedObject === 'book-01') {
        target.current.sub(origin);
        target.current.fromArray(shelfPoint(props.transition.toScene, target.current.x, target.current.y, target.current.z)).add(origin);
        offset.fromArray(shelfVector(props.transition.toScene, offset.x, offset.y, offset.z));
      }
      if (props.focusedObject === 'wardrobe' && narrow) offset.multiplyScalar(Math.max(1, .51 / aspect));
      if ((props.focusedObject === 'clock' || props.focusedObject === 'wardrobe') && props.transition.toScene === 'habitat') target.current.add(new THREE.Vector3(...UPPER_DECK_OFFSET));
      destination.current.copy(target.current).add(offset);
      // Frame the shelf and slot together, including on portrait touchscreens.
      if (props.focusedObject === 'computer') destination.current.z = target.current.z + Math.max(pose.offset[2], 2.25 / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * (size.width / size.height)) + 0.25);
    } else {
      const frame = cabinFrames[props.cabinView];
      target.current.copy(origin).add(frame.target);
      const scale = props.transition.toScene === 'habitat' ? cabinFrameScale(frame.distance) : 1;
      destination.current.lerpVectors(frame.target, frame.position, scale).add(origin);
    }
    if (props.transition.phase === 'error') {
      if (camera instanceof THREE.PerspectiveCamera) { camera.zoom = zoomFlight.current[1]; camera.updateProjectionMatrix(); }
      camera.position.copy(destination.current);
      controls.current.target.copy(target.current);
      controls.current.update();
      moving.current = false;
    } else { moving.current = true; cameraProgress.current = 0; localFlight.current = props.focusedObject === 'book-01'; }
  }, [props.transition.id, props.focusedObject, props.transition.phase === 'error', props.viewMode, size.width, size.height]);
  useFrame((_, delta) => {
    const flight = props.flight;
    props.deckOpacity.current.zoomFade = null;
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
      flight.hullOpacity = hullOpacityForTransition(vf.mode, raw);
      props.deckOpacity.current.interior = cabinOpacityForTransition(vf.mode, raw);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.zoom = THREE.MathUtils.lerp(zoomFlight.current[0], zoomFlight.current[1], eased);
        camera.updateProjectionMatrix();
      }
      camera.position.lerpVectors(fromPosition.current, destination.current, eased);
      controls.current.target.lerpVectors(fromTarget.current, target.current, eased);
      camera.lookAt(controls.current.target);
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
    const opacity = props.deckOpacity.current;
    const zoomRatio = camera.position.distanceTo(controls.current.target) / floorFramingDistance;
    if (inHabitat && !locked && !moving.current && !deck.settling && !onStairs && !deck.onStairs
      && !quickFlight.current && deck.viewRevision === props.viewRevision) deck.zoomRatio = zoomRatio;
    const isolation = cabinZoomIsolation(deck.zoomRatio ?? zoomRatio);
    if (props.quickDeck && inHabitat && !locked) {
      const nextDeck = props.quickDeck;
      controls.current.enabled = false;
      if (!quickFlight.current) {
        fromPosition.current.copy(camera.position);
        fromTarget.current.copy(controls.current.target);
        quickFlight.current = { elapsed: 0, start: { ...opacity }, zoom: camera instanceof THREE.PerspectiveCamera ? camera.zoom : HOME_ZOOM, moved: false };
        moving.current = false;
      }
      const quick = quickFlight.current;
      quick.elapsed += Math.min(delta, .1);
      const progress = props.reducedMotion ? 1 : Math.min(quick.elapsed / QUICK_CABIN_DURATION, 1);
      const frame = quickCabinFrame(progress, quick.start, nextDeck, isolation);
      opacity.lower = frame.lower;
      opacity.upper = frame.upper;
      opacity.resident = frame.resident;
      if (frame.relocate && !quick.moved) {
        if (!props.quickTravel.current?.(nextDeck)) {
          deck.settling = true;
          props.onQuickTravelFinish();
          return;
        }
        quick.moved = true;
        opacity.resident = props.reducedMotion ? 1 : 0;
        props.onCabinViewChange(nextDeck);
      }
      const blend = easeInOutCubic(progress);
      const end = cabinFrames[nextDeck];
      const eye = stairEye.current.lerpVectors(end.target, end.position, cabinFrameScale(end.distance));
      camera.position.lerpVectors(fromPosition.current, eye, blend);
      controls.current.target.lerpVectors(fromTarget.current, end.target, blend);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.zoom = THREE.MathUtils.lerp(quick.zoom, HOME_ZOOM, blend);
        camera.updateProjectionMatrix();
      }
      camera.lookAt(controls.current.target);
      if (progress === 1) {
        deck.onStairs = false;
        deck.settling = true;
        props.onQuickTravelFinish();
      }
      return;
    }
    quickFlight.current = null;
    const landed = deck.onStairs && !onStairs && inHabitat;
    if (landed) {
      props.onCabinViewChange(resident.deck);
      deck.settling = true;
    }
    deck.onStairs = onStairs;
    if (deck.viewRevision !== props.viewRevision) {
      deck.viewRevision = props.viewRevision;
      deck.settling = true;
    }
    const focusDeck = props.focusedObject === 'clock' || props.focusedObject === 'wardrobe' ? 'upper' : 'lower';
    const activeDeck = landed || props.cabinView === 'overview' ? resident.deck : props.cabinView;
    const view = !inHabitat ? 'overview' : props.focusedObject ? focusDeck : activeDeck;
    const fade = cabinDeckOpacity(view, props.focusedObject ? 1 : isolation, ascent, resident.stairFrom);
    if (flight.mode === 'cabin') {
      for (const part of ['lower', 'upper'] as const) {
        const next = props.reducedMotion ? fade[part] : THREE.MathUtils.damp(opacity[part], fade[part], 11, delta);
        opacity[part] = Math.abs(next - fade[part]) < .008 ? fade[part] : next;
      }
    }
    if (inHabitat && !locked && !moving.current && !onStairs && !landed && !deck.settling) {
      const other = activeDeck === 'lower' ? 'upper' : 'lower';
      if (opacity[activeDeck] === 1 && opacity[other] > 0 && opacity[other] < 1) opacity.zoomFade = other;
    }
    opacity.resident = 1;
    if (!moving.current) {
      const adjusting = inHabitat && !locked && (onStairs || deck.settling);
      controls.current.enabled = !locked && !adjusting;
      if (!adjusting) {
        if (inHabitat && !locked && props.cabinView === 'overview') {
          const pivot = stairTarget.current.lerpVectors(HOME_TARGET, cabinFrames[resident.deck].target, isolation);
          const shift = stairEye.current.subVectors(pivot, controls.current.target);
          if (!props.reducedMotion) shift.multiplyScalar(1 - Math.exp(-Math.min(delta, .1) * 12));
          camera.position.add(shift);
          controls.current.target.add(shift);
          camera.lookAt(controls.current.target);
        }
        return;
      }
      const end = cabinFrames[landed ? resident.deck : props.cabinView];
      const eye = onStairs
        ? stairEye.current.lerpVectors(stairFrames.lower.position, stairFrames.upper.position, ascent)
        : stairEye.current.lerpVectors(end.target, end.position, cabinFrameScale(end.distance));
      const pivot = onStairs ? stairTarget.current.lerpVectors(stairFrames.lower.target, stairFrames.upper.target, ascent) : end.target;
      const blend = props.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * (onStairs ? 6 : 10));
      camera.position.lerp(eye, blend);
      controls.current.target.lerp(pivot, blend);
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.zoom - HOME_ZOOM) > .001) {
        camera.zoom = THREE.MathUtils.lerp(camera.zoom, HOME_ZOOM, blend);
        camera.updateProjectionMatrix();
      }
      camera.lookAt(controls.current.target);
      if (!onStairs && camera.position.distanceToSquared(eye) < .0001 && controls.current.target.distanceToSquared(pivot) < .0001) {
        // Consume the previous drag's remaining damping before restoring the preset.
        const damping = controls.current.enableDamping;
        controls.current.enableDamping = false;
        controls.current.update();
        camera.position.copy(eye);
        controls.current.target.copy(pivot);
        controls.current.update();
        controls.current.enableDamping = damping;
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
    if (progress >= 1) moving.current = false;
  });
  const inTransition = props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin';
  const locked = inTransition || props.cleaning || props.gestureActive || !!props.focusedObject || !['idle', 'active', 'error'].includes(props.transition.phase);
  const inCabin = props.viewMode === 'cabin';
  return <OrbitControls ref={controls} enabled={!locked} enablePan={false} enableDamping dampingFactor={0.08}
    minDistance={inCabin || props.viewMode === 'entering-cabin' ? 5 : 16}
    maxDistance={inCabin ? cabinFrames.overview.distance * 1.5 : orbitDistance * 2.4}
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
const SUN_DAY_COLOR = new THREE.Color('#fff2e2');
const SUN_LIMB_COLOR = new THREE.Color('#ff9d62');
const SKY_DAY_COLOR = new THREE.Color('#f6f2eb');
const SKY_DUSK_COLOR = new THREE.Color('#f6be96');
const SKY_SHADOW_COLOR = new THREE.Color('#8ea8d8');
const GROUND_DAY_COLOR = new THREE.Color('#d4c7b8');
const GROUND_DUSK_COLOR = new THREE.Color('#685a64');
const GROUND_SHADOW_COLOR = new THREE.Color('#393d4e');
const EARTHSHINE_DAY_COLOR = new THREE.Color('#9ec4ee');
const EARTHSHINE_ORBIT_COLOR = new THREE.Color('#78b8ff');
const EARTHSHINE_DUSK_COLOR = new THREE.Color('#f0b48c');
const EARTHSHINE_NIGHT_COLOR = new THREE.Color('#7ca8e2');
const SUN_INTENSITY = 1.65;
const ORBIT_SUN_INTENSITY = 2.25;
const CABIN_EARTHSHINE_POS = new THREE.Vector3(-11, 4.5, -10);
const ORBIT_EARTHSHINE_POS = new THREE.Vector3(7.5, -4.8, 13.5);

function OrbitalLighting({ objects, sceneId, sun, shadowSize }: Pick<WorldSceneProps, 'objects' | 'sceneId'> & { sun: SunState; shadowSize: number }) {
  const lamp = useRef<THREE.PointLight>(null);
  const roomWarm = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const earthshine = useRef<THREE.DirectionalLight>(null);
  const scene = useThree(state => state.scene);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const [lampX, lampY] = sceneId === 'habitat' ? UPPER_DECK_OFFSET : [0, 0];
  useEffect(() => () => { scene.environmentIntensity = 1; }, [scene]);
  useEffect(() => { key.current?.shadow.map?.setSize(shadowSize, shadowSize); }, [shadowSize]);
  useFrame((_, delta) => {
    const daylight = sun.daylight.value;
    const warmth = sun.warmth;
    const orbit = sun.orbitUniform.value;
    if (lamp.current) lamp.current.intensity = THREE.MathUtils.damp(lamp.current.intensity, objects.lamp?.active === false ? 0 : 4.8, 5, delta);
    if (roomWarm.current) roomWarm.current.intensity = THREE.MathUtils.damp(roomWarm.current.intensity, (2.4 + 0.6 * (1 - daylight)) * (1 - orbit * 0.45), 3, delta);
    if (ambient.current) {
      const targetAmbient = THREE.MathUtils.lerp(0.48 + 0.44 * daylight + 0.08 * warmth, 0.24 + 0.28 * daylight + 0.08 * warmth, orbit);
      ambient.current.intensity = THREE.MathUtils.damp(ambient.current.intensity, targetAmbient, 3, delta);
      ambient.current.color.lerpColors(SKY_SHADOW_COLOR, SKY_DAY_COLOR, daylight).lerp(SKY_DUSK_COLOR, warmth * 0.45);
      ambient.current.groundColor.lerpColors(GROUND_SHADOW_COLOR, GROUND_DAY_COLOR, daylight).lerp(GROUND_DUSK_COLOR, warmth * 0.38);
    }
    if (key.current) {
      key.current.position.copy(sun.light).multiplyScalar(18);
      key.current.intensity = THREE.MathUtils.lerp(SUN_INTENSITY, ORBIT_SUN_INTENSITY, orbit) * daylight;
      key.current.color.lerpColors(SUN_DAY_COLOR, SUN_LIMB_COLOR, warmth * 0.85);
    }
    if (earthshine.current) {
      earthshine.current.position.lerpVectors(CABIN_EARTHSHINE_POS, ORBIT_EARTHSHINE_POS, orbit);
      const cabinFill = 0.38 + 0.24 * (1 - daylight) + 0.14 * warmth;
      const orbitFill = 0.34 + 0.56 * daylight + 0.20 * warmth;
      earthshine.current.intensity = THREE.MathUtils.lerp(cabinFill, orbitFill, orbit);
      earthshine.current.color
        .lerpColors(EARTHSHINE_NIGHT_COLOR, EARTHSHINE_DAY_COLOR, daylight)
        .lerp(EARTHSHINE_ORBIT_COLOR, orbit * 0.55)
        .lerp(EARTHSHINE_DUSK_COLOR, warmth * 0.55);
    }
    const cabinEnv = 0.44 + 0.46 * daylight;
    const orbitEnv = 0.22 + 0.38 * daylight;
    scene.environmentIntensity = THREE.MathUtils.lerp(cabinEnv, orbitEnv, orbit);
  });
  return <>
    <primitive object={sunTarget} />
    <hemisphereLight ref={ambient} args={['#f6f2eb', '#d4c7b8', 0.58]} />
    <directionalLight ref={key} target={sunTarget} color="#fff2e2" intensity={SUN_INTENSITY} position={sun.light.toArray().map(n => n * 18) as [number, number, number]} castShadow
      shadow-mapSize={[shadowSize, shadowSize]} shadow-camera-left={-6.8} shadow-camera-right={6.8} shadow-camera-top={6.8} shadow-camera-bottom={-6.8}
      shadow-camera-near={0.1} shadow-camera-far={60} shadow-normalBias={0.012} shadow-bias={-0.0001} />
    <directionalLight ref={earthshine} target={sunTarget} color="#9ec4ee" intensity={0.38} position={[-11, 4.5, -10]} />
    <pointLight ref={lamp} position={[LAMP_POSITION[0] + lampX + .08, 1.74 + lampY, LAMP_POSITION[2] + .07]} color="#ffdf98" intensity={4.8} distance={9.5} decay={1.85} />
    <pointLight ref={roomWarm} position={[2.1, 2.2, 0.2]} color="#faf3e8" intensity={2.4} distance={9.5} decay={1.85} />
  </>;
}
function useCabinLoadStage(open: boolean, residentSettled: boolean, entering: boolean) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!open || stage === 8) return;
    let frame = 0;
    let cancelled = false;
    // Hold heavy GLB mounting briefly while the enter-cabin fly-in starts,
    // then step through fine-grained batches separated by two painted frames.
    const delay = stage === 0
      ? (residentSettled ? (entering ? 420 : 0) : 1200)
      : (entering ? 140 : 60);
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!cancelled) setStage(current => Math.min(8, current + 1));
        });
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [open, stage, residentSettled, entering]);
  return {
    furniture: stage >= 1,
    furnitureStage: stage >= 3 ? 3 : stage >= 2 ? 2 : stage >= 1 ? 1 : 0,
    bedroomStage: stage >= 5 ? 2 : stage >= 4 ? 1 : 0,
    equipment: stage >= 6,
    plush: stage >= 7,
    cat: stage >= 8,
  };
}

function WorldContent(props: OrbitalSceneProps & CabinCameraProps & { catMenuOpen: boolean; outfitPreview: boolean; shadowSize: number }) {
  const [walkTarget, setWalkTarget] = useState<[number, number, number] | null>(null);
  const deckOpacity = useRef<CabinOpacity>({
    ...cabinDeckOpacity(props.cabinView, props.outfitPreview ? 1 : 0),
    resident: 1,
    interior: props.viewMode === 'cabin' ? 1 : 0,
    zoomFade: null,
  });
  const residentView = useRef<CabinResidentView>({ deck: 'lower', stairAscent: null, stairFrom: null });
  const sofaTime = useRef<number | null>(null);
  const paperPickup = useRef<PaperPickup | null>(null);
  const paperBodies = useRef<PaperBallBody[]>([]);
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
  const [visitedCabin, setVisitedCabin] = useState(showInterior);
  const [visitedObservatory, setVisitedObservatory] = useState(false);
  const needsUpperDeck = !outfitPreview || props.cabinView !== 'lower';
  const [visitedUpperDeck, setVisitedUpperDeck] = useState(needsUpperDeck);
  const [hullReady, setHullReady] = useState(false);
  const [residentSettled, setResidentSettled] = useState(false);
  const [prewarmShell, setPrewarmShell] = useState(false);
  const [prewarmResident, setPrewarmResident] = useState(false);
  const onHullReady = useCallback(() => setHullReady(true), []);
  const onResidentMounted = useCallback((outfit: ResidentOutfit, ready: boolean) => {
    setResidentSettled(true);
    props.onOutfitMounted(outfit, ready);
  }, [props.onOutfitMounted]);
  const isTravelling = props.transition.action?.kind === 'travel'
    && props.transition.phase !== 'active' && props.transition.phase !== 'error';
  const needsObservatory = props.sceneId === 'observatory'
    || (isTravelling && props.transition.toScene === 'observatory');
  const activeOutfit = readOutfit(props.sceneObjects.habitat.wardrobe?.itemId);
  const cabinLoading = useCabinLoadStage(showInterior, residentSettled, props.viewMode === 'entering-cabin');
  const canWalk = inCabin && !props.cleaning && !props.catMenuOpen && !props.focusedObject && !props.gestureActive
    && (!props.library || props.library.flow.current.phase === 'idle') && ['idle', 'active', 'error'].includes(props.transition.phase);
  const walkTo = (id: WorldSceneId, point: [number, number, number]) => {
    if (!canWalk || props.cleaning || props.quickDeck || props.sceneId !== id) return;
    void roomAudio.unlock();
    // Crossing decks is a manual stair action: walk to this deck's landing and wait for E.
    setWalkTarget(id === 'habitat' ? stairApproachPoint(residentView.current.deck, [point[0], point[2]]) : point);
  };
  useEffect(() => { setWalkTarget(null); }, [props.sceneId, inCabin]);
  useEffect(() => {
    if (!showInterior) return;
    setVisitedCabin(true);
    if (needsObservatory) setVisitedObservatory(true);
    if (needsUpperDeck) setVisitedUpperDeck(true);
  }, [showInterior, needsObservatory, needsUpperDeck]);
  useEffect(() => {
    if (!hullReady || props.viewMode !== 'orbit' || visitedCabin) return;
    const shellTimer = window.setTimeout(() => {
      preloadHabitatShell();
      setPrewarmShell(true);
    }, 900);
    const residentTimer = window.setTimeout(() => {
      setPrewarmResident(true);
    }, 1600);
    return () => {
      window.clearTimeout(shellTimer);
      window.clearTimeout(residentTimer);
    };
  }, [hullReady, props.viewMode, visitedCabin]);
  return <ScheduleProvider adapters={props.adapters}>
    {!visitedCabin && <>
      <HabitatShellPrewarmer active={prewarmShell} />
      <ResidentPrewarmer active={prewarmResident} outfit={activeOutfit} />
    </>}
    <color attach="background" args={['#080714']} />
    <PerspectiveCamera makeDefault fov={CAMERA_FOV} position={initialCameraPos} near={0.08} far={2000} />
    <CameraRig {...props} flight={flight} residentView={residentView} deckOpacity={deckOpacity} />
    <CabinZoomRenderer opacity={deckOpacity} />
    <Cosmos reducedMotion={props.reducedMotion} sun={sun} flight={flight} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.55} color="#faf7f2" position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 8, 1]} />
      <Lightformer intensity={0.85} color="#c8e0f6" position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 4, 1]} />
    </Environment>
    <CabinOpacityContext.Provider value={deckOpacity}>
    {(['habitat', 'observatory'] as WorldSceneId[]).map(id => {
      if (id === 'observatory' && !needsObservatory && !visitedObservatory) return null;
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
          if (!inCabin || props.quickDeck || id !== props.sceneId) return false;
          if (focusedObject) { perform(); return true; }
          return interaction.current?.(point, action, perform) ?? false;
        },
      };
      const onFloorClick = (point: [number, number, number]) => walkTo(id, point);
      const onWalkToStairs = () => {
        const [x, z] = stairLanding(residentView.current.deck);
        walkTo(id, [x, 0, z]);
      };
      return <group key={id} position={SCENE_ORIGINS[id]} visible={id === props.sceneId || isTravelling}>
        {id === props.sceneId && <OrbitalLighting objects={world.objects} sceneId={id} sun={sun} shadowSize={props.shadowSize} />}
        {id === 'habitat' && (!inCabin || hullReady) && <SpacecraftHull flight={flight} sun={sun} reducedMotion={props.reducedMotion}
          onEnterCabin={props.onEnterCabin} onReady={onHullReady} />}
        {(showInterior || visitedCabin) && <group visible={showInterior}>
          <CabinFadeGroup part="lower" name={id === 'habitat' ? 'Cabin_LowerDeck' : undefined}>
            <HabitatShell world={world} deck="lower" onFloorClick={onFloorClick} />
            {id === 'habitat' && cabinLoading.furniture && <ScheduleSurfaces {...world} cleanTick={props.cleanTick} paperPickup={paperPickup} paperBodies={paperBodies}
              visible={inCabin && props.sceneId === 'habitat'} />}
            {cabinLoading.furniture && <>
              <Suspense fallback={null}><HabitatFurniture {...world} stage={cabinLoading.furnitureStage} /></Suspense>
              <FeatureSurfaces {...world} />
            </>}
            {(cabinLoading.equipment || focusedObject === 'computer' || focusedObject === 'music-player')
              && <Suspense fallback={null}><MediaObjects {...world} /></Suspense>}
          </CabinFadeGroup>
          {id === 'habitat' && <>
            <CabinFadeGroup part="interior" name="Cabin_Staircase_View">
              <CabinStaircase residentView={residentView} onWalkToStairs={onWalkToStairs} />
            </CabinFadeGroup>
            <CabinUpperDeck>
              <HabitatShell world={world} deck="upper" onFloorClick={onFloorClick} />
              <BedroomGuard />
              {cabinLoading.bedroomStage >= 1 && (needsUpperDeck || visitedUpperDeck) && <>
                <AlarmClock3D {...world} />
                <Suspense fallback={null}><HabitatBedroom world={world} sofaTime={sofaTime} stage={cabinLoading.bedroomStage} /></Suspense>
              </>}
            </CabinUpperDeck>
          </>}
          {id === props.sceneId && <>
            <OrbitalResidents {...world} outfit={readOutfit(props.sceneObjects.habitat.wardrobe?.itemId)} catMenuOpen={props.catMenuOpen} sofaTime={sofaTime} paperPickup={paperPickup} paperBodies={paperBodies} onHover={(objectId, hint) => { if (inCabin) props.onHover(objectId, hint); }} interaction={interaction}
              inspectionId={focusedObject === 'wardrobe' && props.transition.phase === 'active' && props.transition.action?.kind === 'select' ? props.transition.id : undefined}
              onInspectionEnd={props.onReturn} onOutfitMounted={onResidentMounted}
              prefetchSeat={cabinLoading.equipment} loadPlush={cabinLoading.plush} loadCat={cabinLoading.cat}
              deckView={residentView} deckOpacity={deckOpacity} quickTravel={props.quickTravel} onQuickTravelTarget={props.onQuickTravelTarget}
              showNearbyHints={!props.cleaning && (props.cabinView === 'overview' || props.cabinView === residentView.current.deck)}
              approachEnabled={inCabin && !props.cleaning && !props.focusedObject && ['idle', 'active', 'error'].includes(props.transition.phase)}
              walkTarget={walkTarget} onArrive={() => setWalkTarget(null)}
              enabled={canWalk && (!props.library || props.library.view.phase === 'idle')} />
          </>}
        </group>}
      </group>;
    })}
    </CabinOpacityContext.Provider>
  </ScheduleProvider>;
}
const visibleSceneEvents: NonNullable<React.ComponentProps<typeof Canvas>['events']> = state => ({
  ...events(state),
  filter: hits => hits.filter(hit => {
    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
      if (!node.visible || node.userData.cabinInteractive === false) return false;
    }
    return true;
  }),
});

export function OrbitalScene(props: OrbitalSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const [catMenu, setCatMenu] = useState<WorldAction | null>(null);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(2);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
    dpr: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
  }));
  useEffect(() => {
    const syncViewport = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    });
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);
  const quality = SCENE_QUALITY[qualityLevel];
  const maxDpr = sceneMaxDpr(quality.dpr, viewport.width, viewport.height, viewport.dpr);
  const outfitPreview = useMemo(() => props.viewMode === 'cabin' && !!previewOutfit(window.location.search), []);
  const quickTravel = useRef<((target: CabinDeck) => boolean) | null>(null);
  const [quickTarget, setQuickTarget] = useState<CabinDeck | null>(null);
  const [quickDeck, setQuickDeck] = useState<CabinDeck | null>(null);
  const [view, setView] = useState<{ mode: CabinView; revision: number }>({ mode: outfitPreview ? 'lower' : 'overview', revision: 0 });
  const selectView = (mode: CabinView) => setView(current => ({ mode, revision: current.revision + 1 }));
  const showCabinControls = props.sceneId === 'habitat' && props.viewMode === 'cabin' && !props.cleaning && !props.focusedObject && !catMenu
    && ['idle', 'active', 'error'].includes(props.transition.phase);
  const canQuickTravel = showCabinControls && !props.gestureActive && !quickDeck;
  useEffect(() => {
    if (!canQuickTravel || !quickTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyR' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      event.preventDefault();
      setQuickDeck(quickTarget);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canQuickTravel, quickTarget]);
  useEffect(() => {
    if (!showCabinControls || props.gestureActive) setQuickDeck(null);
  }, [showCabinControls, props.gestureActive]);
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
    <Canvas events={visibleSceneEvents} shadows dpr={[1, maxDpr]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
      <AdaptiveQuality paused={!!props.activeGame || props.cleaning || !!quickDeck || !['cabin', 'orbit'].includes(props.viewMode)} onChange={setQualityLevel} />
      <WorldContent {...props} catMenuOpen={!!catMenu} outfitPreview={outfitPreview} shadowSize={quality.shadowSize}
        quickDeck={quickDeck} quickTravel={quickTravel} onQuickTravelFinish={() => setQuickDeck(null)} onQuickTravelTarget={setQuickTarget}
        cabinView={view.mode} viewRevision={view.revision} onCabinViewChange={selectView} onAction={action => {
          if (quickDeck) return;
        if (action.kind === 'pet' && action.objectId === 'pet') setCatMenu(action);
        else props.onAction(action);
      }} />
    </Canvas>
    {showCabinControls && (quickTarget || props.onLeaveCabin) && (
      <nav className="orbital-cabin-controls" aria-label="生活舱导航">
        {quickTarget && <button type="button" className="orbital-flight-pill" aria-keyshortcuts="R"
          disabled={!canQuickTravel} onClick={() => setQuickDeck(quickTarget)}>
          {quickTarget === 'upper' ? '快速上楼' : '快速下楼'}<kbd className="orbital-keycap" aria-hidden="true">R</kbd>
        </button>}
        {props.onLeaveCabin && <button type="button" className="orbital-flight-pill" aria-keyshortcuts="F" onClick={props.onLeaveCabin}>
          出舱巡航<kbd className="orbital-keycap" aria-hidden="true">F</kbd>
        </button>}
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
