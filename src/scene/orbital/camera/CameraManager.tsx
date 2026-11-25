import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldSceneId, type WorldObjectState, type WorldSceneProps } from '../../../types/world';
import { roomAudio } from '../../audioEngine';
import { CAMERA_FOV, HOME_ZOOM, OUTFIT_TARGET, outfitCameraPosition, stairCameraFrames, type CabinView } from '../cabinView';
import type { CabinResidentView } from '../cabinStairs';
import {
  BOOST_FOV_KICK, ENTER_CABIN_DURATION, LEAVE_CABIN_DURATION, REDUCED_TRANSITION_DURATION, SHIP_TARGET,
  approachStartPosition, easeInOutCubic, easeOutQuart, hullOpacityForTransition, orbitDistanceForAspect,
  orbitHomePosition, stepFlightState, type SpacecraftFlightState, type SpacecraftViewMode,
} from '../spacecraftFlight';
import { interactionPose } from './InteractionCameraPresets';
import { CAMERA_ANCHORS, INSPECT_FOV, anchorBounds, panoramaBounds, panoramaFrame, type CameraAnchorId } from './CameraPresets';
import { fitCameraBounds } from './CameraFraming';
import { CameraProjection, interpolateEye, perspectiveHalfHeight, setCameraRay } from './CameraTransition';
import { useCameraController } from './CameraController';
import { CameraCollision, followCameraRoute } from './CameraCollision';
import { SceneVisibilityManager, cameraHitVisible } from './SceneVisibilityManager';
import type { ResidentOutfit } from '../wardrobe/outfit';

export interface OrbitalSceneProps extends WorldSceneProps {
  onOutfitMounted: (outfit: ResidentOutfit, ready: boolean) => void;
  sceneObjects: Record<WorldSceneId, Record<string, WorldObjectState>>;
  gestureActive: boolean;
  viewMode: SpacecraftViewMode;
  boosting: boolean;
  onViewModeChange: (mode: SpacecraftViewMode) => void;
  onEnterCabin: () => void;
}
export interface CabinCameraProps {
  cabinView: CabinView;
  viewRevision: number;
  cutToDeck: boolean;
  quickAscent: React.MutableRefObject<(() => boolean) | null>;
  onQuickAscentAvailable: (available: boolean) => void;
  onCabinViewChange: (view: CabinView) => void;
}
export interface CameraInput {
  request: CameraAnchorId | null;
  pick: ((event: MouseEvent) => boolean) | null;
  deferClick: ((run: () => void) => boolean) | null;
  cancelPendingClick: () => void;
}

type CameraManagerProps = OrbitalSceneProps & CabinCameraProps & {
  flight: SpacecraftFlightState;
  outfitPreview: boolean;
  residentView: React.MutableRefObject<CabinResidentView>;
  cameraInput: CameraInput;
  onUpperVisibility: (visible: boolean) => void;
};

interface Pose {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  lens: THREE.Vector2;
  zoom: number;
  fov: number;
  mix: number;
}

type Flight = {
  from: Pose;
  to: Pose;
  elapsed: number;
  duration: number;
  drive?: 'progress' | 'sceneProgress';
  spacecraft?: 'entering-cabin' | 'leaving-cabin';
  interrupted?: boolean;
  route?: THREE.Vector3[] | null;
};

function makePose(eye: THREE.Vector3, target: THREE.Vector3, zoom: number, mix: number, fov = CAMERA_FOV): Pose {
  return { eye, target, lens: new THREE.Vector2(), zoom, mix, fov };
}

export function CameraManager(props: CameraManagerProps) {
  const size = useThree(state => state.size);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const get = useThree(state => state.get);
  const set = useThree(state => state.set);
  const aspect = Math.max(.1, size.width / Math.max(1, size.height));
  const origin = useMemo(() => new THREE.Vector3(...SCENE_ORIGINS[props.sceneId]), [props.sceneId]);
  const habitat = props.sceneId === 'habitat';
  const camera = useMemo(() => Object.assign(new THREE.PerspectiveCamera(CAMERA_FOV, 1, .08, 2000), { manual: true }), []);
  const projection = useMemo(() => new CameraProjection(), []);
  const collision = useMemo(() => new CameraCollision(), []);
  const visibility = useMemo(() => new SceneVisibilityManager(collision), [collision]);
  const lastEye = useRef<THREE.Vector3 | null>(null);
  const interior = useRef<THREE.Object3D | undefined>(undefined);
  const deckPoints = useMemo(() => (['lower', 'upper'] as const).map(deck => {
    const box = panoramaBounds(deck);
    const point = box.getCenter(new THREE.Vector3());
    point.y = THREE.MathUtils.lerp(box.min.y, box.max.y, .29);
    return { point: point.add(origin), deck };
  }), [origin]);
  const tracked = useRef(new THREE.Vector3());
  const trackedDelta = useRef(new THREE.Vector3());
  const frame = useMemo(() => panoramaFrame(props.cabinView, aspect), [aspect, props.cabinView]);
  const stairs = useMemo(() => stairCameraFrames(aspect), [aspect]);
  const flight = useRef<Flight | null>(null);
  const mix = useRef(1);
  const saved = useRef<Pose | null>(null);
  const visual = useRef<{ id: CameraAnchorId; node: THREE.Object3D; deck: 'upper' | 'lower'; minDistance: number } | null>(null);
  const stairFollow = useRef({ active: false, cancelled: false });
  const upperVisible = useRef(!props.outfitPreview);
  const initial = useRef(false);
  const revision = useRef(props.viewRevision);
  const lastInteraction = useRef('');
  const lastFocused = useRef<string | null>(null);
  const previousViewMode = useRef(props.viewMode);
  const previousAspect = useRef(aspect);
  const stairEye = useRef(new THREE.Vector3()), stairPivot = useRef(new THREE.Vector3());
  const cameraView = props.library?.cameraView;
  const sideSlot = cameraView === 'side' ? props.library?.view.book?.slotId : undefined;
  const sideReading = !!sideSlot && ['open', 'reading', 'turn', 'close'].includes(props.library!.view.phase);
  const cabin = props.viewMode === 'cabin';
  const free = cabin && habitat && !props.focusedObject;
  const inOrbit = props.viewMode === 'orbit' || props.viewMode === 'approach';
  const cutting = props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin';
  const interactionMoving = cabin && !!props.focusedObject && props.transition.phase === 'entering' && !props.gestureActive;
  const panBounds = useMemo(() => panoramaBounds('overview').clone().expandByScalar(.65).translate(origin), [origin]);
  const controls = useCameraController(gl.domElement, camera, {
    enabled: !props.activeGame && (free || inOrbit || cutting || interactionMoving),
    isOrthographic: () => mix.current < .5 && !visual.current,
    panBounds: free ? panBounds : null,
    minDistance: () => free ? visual.current?.minDistance ?? .65 : interactionMoving ? .65 : 16,
    maxDistance: free ? frame.distance * 1.6 : orbitDistanceForAspect(aspect) * 2.4,
    minZoom: HOME_ZOOM * .66,
    maxZoom: HOME_ZOOM * Math.max(2.7, frame.radius / 1.8),
    reducedMotion: props.reducedMotion,
    onInput: () => {
      props.cameraInput.cancelPendingClick();
      if (flight.current?.spacecraft) flight.current.interrupted = true;
      else if (flight.current) {
        // Complete only the optical handoff from the last drawn pose.
        const to = flight.current.to;
        if (to.mix === mix.current) flight.current = null;
        else {
          const from = capture();
          flight.current = { from, to: { ...from, mix: to.mix }, elapsed: 0, duration: .25, interrupted: true };
        }
      }
      if (stairFollow.current.active) stairFollow.current.cancelled = true;
      if (props.flight.mode === 'approach') {
        props.flight.mode = 'orbit';
        props.flight.approachProgress = 1;
        props.onViewModeChange('orbit');
      }
    },
  });

  function capture(): Pose {
    const pose = makePose(camera.position.clone(), controls.target.clone(), camera.zoom, mix.current, camera.fov);
    if (camera.view?.enabled) pose.lens.set(camera.view.offsetX, camera.view.offsetY);
    return pose;
  }

  function setLens(x: number, y: number) {
    if (x || y) camera.setViewOffset(size.width, size.height, x, y, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
  }

  function apply(pose: Pose) {
    camera.position.copy(pose.eye);
    controls.target.copy(pose.target);
    camera.zoom = pose.zoom;
    camera.fov = pose.fov;
    mix.current = pose.mix;
    setLens(...pose.lens.toArray());
    camera.lookAt(controls.target);
  }

  function cabinPose(id: WorldSceneId = props.sceneId) {
    const offset = id === props.sceneId ? origin : new THREE.Vector3(...SCENE_ORIGINS[id]);
    return makePose(frame.position.clone().add(offset), frame.target.clone().add(offset), HOME_ZOOM, id === 'habitat' ? 0 : 1);
  }

  function orbitPose() {
    return makePose(orbitHomePosition(aspect).add(origin), SHIP_TARGET.clone().add(origin), 1, 1);
  }

  function start(to: Pose, duration: number, drive?: Flight['drive'], spacecraft?: Flight['spacecraft']) {
    controls.clear();
    const route = habitat ? collision.route(camera.position, to.eye) : null;
    flight.current = { from: capture(), to, route, elapsed: 0, duration: props.reducedMotion ? Math.min(.14, duration) : duration, drive, spacecraft };
  }

  useLayoutEffect(() => {
    const original = get().camera;
    return () => set({ camera: original });
  }, [get, set]);

  useEffect(() => () => visibility.dispose(), [visibility]);

  useEffect(() => {
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (event: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!free || props.gestureActive || rect.width <= 0 || rect.height <= 0) return false;
      pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height);
      setCameraRay(ray, pointer, get().camera);
      const candidates = CAMERA_ANCHORS.flatMap(anchor => {
        const node = scene.getObjectByName(anchor.nodeName);
        return node && cameraHitVisible(node) ? [{ anchor, node }] : [];
      });
      // Test real occluders too, so a double click cannot select through an opaque wall.
      const interior = scene.getObjectByName('Habitat_Interior');
      if (!interior) return false;
      interior.updateWorldMatrix(true, true);
      const hit = ray.intersectObject(interior, true).find(intersection => cameraHitVisible(intersection.object));
      if (!hit) return false;
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        const candidate = candidates.find(entry => entry.node === node);
        if (candidate) {
          props.cameraInput.request = candidate.anchor.id;
          return true;
        }
      }
      return false;
    };
    props.cameraInput.pick = pick;
    return () => { props.cameraInput.pick = null; };
  }, [free, get, gl, props.cameraInput, props.gestureActive, scene]);

  useFrame((_, delta) => {
    if (size.width <= 0 || size.height <= 0) return;
    camera.aspect = aspect;
    if (habitat) {
      if (!interior.current?.parent) interior.current = scene.getObjectByName('Habitat_Interior');
      if (interior.current) visibility.refresh(interior.current, delta);
    }
    const spacecraft = props.flight;
    if (!initial.current) {
      initial.current = true;
      const pose = cabin ? cabinPose() : orbitPose();
      if (props.outfitPreview) {
        pose.target.copy(OUTFIT_TARGET).add(origin);
        pose.eye.copy(outfitCameraPosition(aspect)).add(origin);
        pose.mix = 1;
      } else if (props.viewMode === 'approach') pose.eye.copy(approachStartPosition(aspect)).add(origin);
      apply(pose);
    }
    if (previousViewMode.current !== props.viewMode) {
      previousViewMode.current = props.viewMode;
      spacecraft.mode = props.viewMode;
      if (props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin') {
        const entering = props.viewMode === 'entering-cabin';
        saved.current = null;
        visual.current = null;
        start(entering ? cabinPose() : orbitPose(), entering ? ENTER_CABIN_DURATION : LEAVE_CABIN_DURATION, undefined, props.viewMode);
      }
    }

    const resident = props.residentView.current;
    const ascent = cabin && habitat ? resident.stairAscent : null;
    const following = ascent !== null && !stairFollow.current.cancelled;
    if (ascent === null && stairFollow.current.active) {
      if (!stairFollow.current.cancelled) props.onCabinViewChange(resident.deck);
      stairFollow.current.cancelled = false;
    }
    if (following && !stairFollow.current.active) {
      visual.current = null;
      flight.current = null;
      controls.clear();
    }
    stairFollow.current.active = ascent !== null;

    const cutToDeck = props.cutToDeck && revision.current !== props.viewRevision;
    if (revision.current !== props.viewRevision) {
      revision.current = props.viewRevision;
      visual.current = null;
      if (stairFollow.current.active) stairFollow.current.cancelled = true;
      if (cutToDeck) {
        flight.current = null;
        controls.clear();
        apply(cabinPose());
        lastEye.current?.copy(camera.position);
      } else if (cabin && !props.focusedObject) start(cabinPose(), .65);
    }

    if (cabin && lastFocused.current !== props.focusedObject) {
      if (!lastFocused.current && props.focusedObject) saved.current = capture();
      lastFocused.current = props.focusedObject;
    }
    const worldKey = `${props.focusedObject && props.transition.phase !== 'error' ? 'focus' : props.transition.id}/${props.focusedObject ?? ''}/${aspect}/${cameraView ?? ''}/${sideSlot ?? ''}/${sideReading}`;
    const worldStarting = props.focusedObject || props.transition.phase === 'returning' || props.transition.phase === 'error'
      || props.transition.action?.kind === 'travel';
    if (cabin && worldStarting && props.transition.phase !== 'idle' && props.transition.phase !== 'preparing' && lastInteraction.current !== worldKey) {
      lastInteraction.current = worldKey;
      const shot = interactionPose(props, size, sideSlot, sideReading);
      const travel = props.transition.action?.kind === 'travel';
      const destination = travel ? cabinPose(props.transition.toScene) : shot ?? saved.current ?? cabinPose();
      if (!shot) {
        if (!saved.current) visual.current = null;
        saved.current = null;
      }
      if (props.transition.phase === 'error') { flight.current = null; apply(destination); }
      else {
        const book = props.focusedObject === 'book-01';
        start(destination, book ? .8 : .65, book || props.transition.phase === 'active' ? undefined : travel ? 'sceneProgress' : 'progress');
      }
    }

    const request = props.cameraInput.request;
    if (request && free) {
      props.cameraInput.request = null;
      const anchor = CAMERA_ANCHORS.find(candidate => candidate.id === request);
      const node = anchor && scene.getObjectByName(anchor.nodeName);
      if (anchor && node) {
        if (stairFollow.current.active) stairFollow.current.cancelled = true;
        const bounds = anchorBounds(anchor, node, origin);
        const fit = fitCameraBounds(bounds, anchor.direction, aspect, INSPECT_FOV);
        visual.current = {
          id: anchor.id, node, deck: anchor.deck ?? resident.deck, minDistance: Math.max(.65, fit.radius * 1.4),
        };
        node.getWorldPosition(tracked.current);
        start(makePose(fit.target.clone().addScaledVector(anchor.direction, fit.distance), fit.target, 1, 1, INSPECT_FOV), .76);
      }
    } else if (request && !free) props.cameraInput.request = null;

    if (previousAspect.current !== aspect) {
      if (free && !flight.current && previousAspect.current >= .1) {
        const ratio = Math.min(1, aspect) / Math.min(1, previousAspect.current);
        camera.zoom *= ratio;
      }
      previousAspect.current = aspect;
    }

    const mounted = visual.current;
    if (mounted?.id === 'resident' && !props.focusedObject && !flight.current?.spacecraft) {
      mounted.node.getWorldPosition(trackedDelta.current).sub(tracked.current);
      tracked.current.add(trackedDelta.current);
      mounted.deck = resident.deck;
      if (flight.current && !flight.current.interrupted) {
        flight.current.to.eye.add(trackedDelta.current);
        flight.current.to.target.add(trackedDelta.current);
      } else {
        camera.position.add(trackedDelta.current);
        controls.target.add(trackedDelta.current);
      }
    }

    const visible = !habitat || (props.focusedObject ? ['clock', 'wardrobe'].includes(props.focusedObject)
      : ascent !== null || (visual.current ? visual.current.deck === 'upper' : props.cabinView !== 'lower'));
    if (upperVisible.current !== visible) {
      upperVisible.current = visible;
      props.onUpperVisibility(visible);
    }

    spacecraft.boosting = props.boosting && (spacecraft.mode === 'orbit' || spacecraft.mode === 'approach');
    const wasApproaching = spacecraft.mode === 'approach';
    const finishedApproach = stepFlightState(spacecraft, delta, props.reducedMotion);
    roomAudio.setThrusterBoost(spacecraft.boost);
    if (wasApproaching) {
      const progress = easeOutQuart(spacecraft.approachProgress);
      const end = orbitPose();
      camera.position.lerpVectors(approachStartPosition(aspect).add(origin), end.eye, progress);
      camera.position.y += Math.sin(progress * Math.PI) * 1.4;
      controls.target.copy(end.target);
      if (finishedApproach) props.onViewModeChange('orbit');
    }

    const transition = flight.current;
    if (transition) {
      transition.elapsed += Math.min(delta, .1);
      const elapsed = Math.min(1, transition.elapsed / transition.duration);
      const progress = transition.drive
        ? THREE.MathUtils.clamp(props.motion.current[transition.drive], 0, 1) : easeInOutCubic(elapsed);
      const { from, to } = transition;
      if (!transition.interrupted) {
        controls.target.lerpVectors(from.target, to.target, progress);
        if (transition.route) followCameraRoute(camera.position, transition.route, progress);
        else if (transition.spacecraft) camera.position.lerpVectors(from.eye, to.eye, progress);
        else interpolateEye(camera.position, from.eye, from.target, to.eye, to.target, controls.target, progress);
        if (transition.drive === 'sceneProgress' && !props.reducedMotion) camera.position.y += Math.sin(progress * Math.PI) * 3;
        camera.zoom = THREE.MathUtils.lerp(from.zoom, to.zoom, progress);
        camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, progress);
        setLens(THREE.MathUtils.lerp(from.lens.x, to.lens.x, progress), THREE.MathUtils.lerp(from.lens.y, to.lens.y, progress));
      }
      mix.current = THREE.MathUtils.lerp(from.mix, to.mix, progress);
      if (transition.spacecraft) spacecraft.hullOpacity = hullOpacityForTransition(transition.spacecraft, progress);
      if (progress >= 1) {
        flight.current = null;
        if (transition.spacecraft) {
          const settled = transition.spacecraft === 'entering-cabin' ? 'cabin' : 'orbit';
          spacecraft.mode = settled;
          props.onViewModeChange(settled);
        }
      }
    } else if (following && !props.focusedObject && ascent !== null && !stairFollow.current.cancelled) {
      const t = props.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 6);
      stairEye.current.lerpVectors(stairs.lower.position, stairs.upper.position, ascent).add(origin);
      stairPivot.current.lerpVectors(stairs.lower.target, stairs.upper.target, ascent).add(origin);
      camera.position.lerp(stairEye.current, t);
      controls.target.lerp(stairPivot.current, t);
      camera.zoom = THREE.MathUtils.lerp(camera.zoom, HOME_ZOOM, t);
      mix.current = Math.max(0, mix.current - delta * 4);
    }

    if (inOrbit) {
      const fov = CAMERA_FOV + (props.reducedMotion ? 0 : spacecraft.boost * BOOST_FOV_KICK);
      camera.fov = THREE.MathUtils.damp(camera.fov, fov, 6, delta);
    }
    camera.lookAt(controls.target);
    controls.update(delta);
    if (habitat && lastEye.current) collision.resolve(camera.position, lastEye.current);
    if (!lastEye.current) lastEye.current = camera.position.clone();
    else lastEye.current.copy(camera.position);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    const active = projection.sync(camera, controls.target, mix.current) as RootState['camera'];
    if (habitat && interior.current) {
      const subject = props.focusedObject ?? visual.current?.id ?? null;
      const isOverview = cabin && !subject && ascent === null && props.cabinView === 'overview';
      const deck = props.focusedObject ? (visible ? 'upper' : 'lower') : visual.current?.deck
        ?? (props.cabinView === 'overview' ? undefined : props.cabinView);
      const floorTarget = !subject && ascent === null && deckPoints.find(point => point.deck === deck);
      visibility.update(active, isOverview ? deckPoints : [floorTarget || { point: controls.target, deck }], isOverview ? 'overview' : props.cabinView,
        subject, visible, following, cabin, props.reducedMotion || cutToDeck, delta);
    }
    if (get().camera !== active) set({ camera: active });
  }, -2);
  return null;
}
