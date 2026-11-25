import type { PaperPickup } from './cabinActions';
import { previewOutfit, readOutfit, type ResidentOutfit } from './wardrobe/outfit';
import { LAMP_POSITION, UPPER_DECK_OFFSET } from './cabinLayout';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, events, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldObjectState, type WorldSceneId, type WorldSceneProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import type { CabinView } from './cabinView';
import type { CameraAnchorId } from './camera/CameraPresets';
import { setCameraRay } from './camera/CameraTransition';
import { cameraHitVisible } from './camera/SceneVisibilityManager';
import { CameraManager, type CabinCameraProps, type CameraInput, type OrbitalSceneProps } from './camera/CameraManager';
import { CabinUpperDeck, UpperDeckVisibility } from './CabinUpperDeck';
import { BedroomGuard, CabinStaircase } from './CabinStructure';
import { stairDestination, type CabinResidentView } from './cabinStairs';
import { Cosmos, createSunState, type SunState } from './Cosmos';
import { HabitatShell, preloadHabitatShell } from './HabitatShell';
import { SpacecraftHull } from './SpacecraftHull';
import { createFlightState } from './spacecraftFlight';
import { HabitatBedroom, HabitatFurniture } from './HabitatFurniture';
import { MediaObjects } from './media/MediaObjects';
import { FeatureSurfaces } from './FeatureSurfaces';
import { AlarmClock3D, AlarmClockSurface } from './clock/AlarmClock';
import { ScheduleProvider } from './schedule/ScheduleContext';
import { ScheduleSurfaces } from './schedule/ScheduleSurfaces';
import { OrbitalResidents } from './OrbitalResidents';
import { CatInteraction } from './cat/CatInteraction';
import catMeowUrl from '../../../assets/audio/cat/tuanzi-meow.mp3';

const SUN_DAY_COLOR = new THREE.Color('#fff2e2');
const SUN_LIMB_COLOR = new THREE.Color('#ff9d62');
const SKY_DAY_COLOR = new THREE.Color('#f6f2eb');
const SKY_DUSK_COLOR = new THREE.Color('#f6be96');
const SKY_SHADOW_COLOR = new THREE.Color('#8ea8d8');
const GROUND_DAY_COLOR = new THREE.Color('#d4c7b8');
const GROUND_DUSK_COLOR = new THREE.Color('#685a64');
const GROUND_SHADOW_COLOR = new THREE.Color('#393d4e');
const EARTHSHINE_DAY_COLOR = new THREE.Color('#9ec4ee');
const EARTHSHINE_DUSK_COLOR = new THREE.Color('#f0b48c');
const EARTHSHINE_NIGHT_COLOR = new THREE.Color('#7ca8e2');
const SUN_INTENSITY = 1.65;

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
    if (lamp.current) lamp.current.intensity = THREE.MathUtils.damp(lamp.current.intensity, objects.lamp?.active === false ? 0 : 4.8, 5, delta);
    if (roomWarm.current) roomWarm.current.intensity = THREE.MathUtils.damp(roomWarm.current.intensity, 2.4 + 0.6 * (1 - daylight), 3, delta);
    if (ambient.current) {
      ambient.current.intensity = THREE.MathUtils.damp(ambient.current.intensity, 0.48 + 0.44 * daylight + 0.08 * warmth, 3, delta);
      ambient.current.color.lerpColors(SKY_SHADOW_COLOR, SKY_DAY_COLOR, daylight).lerp(SKY_DUSK_COLOR, warmth * 0.45);
      ambient.current.groundColor.lerpColors(GROUND_SHADOW_COLOR, GROUND_DAY_COLOR, daylight).lerp(GROUND_DUSK_COLOR, warmth * 0.38);
    }
    if (key.current) {
      key.current.position.copy(sun.light).multiplyScalar(18);
      key.current.intensity = SUN_INTENSITY * daylight;
      key.current.color.lerpColors(SUN_DAY_COLOR, SUN_LIMB_COLOR, warmth * 0.85);
    }
    if (earthshine.current) {
      earthshine.current.intensity = 0.38 + 0.24 * (1 - daylight) + 0.14 * warmth;
      earthshine.current.color.lerpColors(EARTHSHINE_NIGHT_COLOR, EARTHSHINE_DAY_COLOR, daylight).lerp(EARTHSHINE_DUSK_COLOR, warmth * 0.55);
    }
    scene.environmentIntensity = 0.44 + 0.46 * daylight;
  });
  return <>
    <primitive object={sunTarget} />
    <hemisphereLight ref={ambient} args={['#f6f2eb', '#d4c7b8', 0.58]} />
    <directionalLight ref={key} target={sunTarget} color="#fff2e2" intensity={SUN_INTENSITY} position={sun.light.toArray().map(n => n * 18) as [number, number, number]} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}
      shadow-camera-near={0.1} shadow-camera-far={60} shadow-normalBias={0.012} shadow-bias={-0.0001} />
    <directionalLight ref={earthshine} target={sunTarget} color="#9ec4ee" intensity={0.38} position={[-11, 4.5, -10]} />
    <pointLight ref={lamp} position={[LAMP_POSITION[0] + lampX + .08, 1.74 + lampY, LAMP_POSITION[2] + .07]} color="#ffdf98" intensity={4.8} distance={9.5} decay={1.85} />
    <pointLight ref={roomWarm} position={[2.1, 2.2, 0.2]} color="#faf3e8" intensity={2.4} distance={9.5} decay={1.85} />
  </>;
}
function useCabinLoadStage(open: boolean, residentSettled: boolean) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!open || stage === 4) return;
    let frame = 0;
    // Give the current batch a paint before letting the next batch start parsing.
    // Slow or failed character loads must not hold the rest of the room indefinitely.
    const delay = stage === 0 ? (residentSettled ? 0 : 1200) : 200;
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setStage(stage + 1));
      });
    }, delay);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [open, stage, residentSettled]);
  return { furniture: stage >= 1, equipment: stage >= 2, plush: stage >= 3, cat: stage >= 4 };
}

function WorldContent(props: OrbitalSceneProps & CabinCameraProps & { catMenuOpen: boolean; outfitPreview: boolean; cameraInput: CameraInput }) {
  const [walkTarget, setWalkTarget] = useState<[number, number, number] | null>(null);
  const [upperVisible, setUpperVisible] = useState(!props.outfitPreview);
  const residentView = useRef<CabinResidentView>({ deck: 'lower', stairAscent: null });
  const sofaTime = useRef<number | null>(null);
  const paperPickup = useRef<PaperPickup | null>(null);
  const interaction = useRef<NonNullable<WorldSceneProps['onApproach']> | null>(null);
  const sun = useMemo(createSunState, []);
  const flight = useMemo(() => createFlightState(props.viewMode), []);
  const { outfitPreview } = props;
  const inCabin = props.viewMode === 'cabin';
  const showInterior = inCabin || props.viewMode === 'entering-cabin' || props.viewMode === 'leaving-cabin';
  const [visitedCabin, setVisitedCabin] = useState(showInterior);
  const [visitedObservatory, setVisitedObservatory] = useState(false);
  const [visitedUpperDeck, setVisitedUpperDeck] = useState(upperVisible);
  const [hullReady, setHullReady] = useState(false);
  const [residentSettled, setResidentSettled] = useState(false);
  const onHullReady = useCallback(() => setHullReady(true), []);
  const onResidentMounted = useCallback((outfit: ResidentOutfit, ready: boolean) => {
    setResidentSettled(true);
    props.onOutfitMounted(outfit, ready);
  }, [props.onOutfitMounted]);
  const isTravelling = props.transition.action?.kind === 'travel'
    && props.transition.phase !== 'active' && props.transition.phase !== 'error';
  const needsObservatory = props.sceneId === 'observatory'
    || (isTravelling && props.transition.toScene === 'observatory');
  const cabinLoading = useCabinLoadStage(showInterior, residentSettled);
  const canWalk = inCabin && !props.catMenuOpen && !props.focusedObject && !props.gestureActive
    && (!props.library || props.library.flow.current.phase === 'idle') && ['idle', 'active', 'error'].includes(props.transition.phase);
  const walkTo = (id: WorldSceneId, point: [number, number, number]) => {
    if (!canWalk || props.sceneId !== id) return;
    void roomAudio.unlock();
    setWalkTarget(point);
  };
  useEffect(() => { setWalkTarget(null); }, [props.sceneId, inCabin]);
  useEffect(() => {
    if (!showInterior) return;
    setVisitedCabin(true);
    if (needsObservatory) setVisitedObservatory(true);
    if (upperVisible) setVisitedUpperDeck(true);
  }, [showInterior, needsObservatory, upperVisible]);
  useEffect(() => {
    if (!hullReady || props.viewMode !== 'orbit' || visitedCabin) return;
    const timer = window.setTimeout(preloadHabitatShell, 1200);
    return () => window.clearTimeout(timer);
  }, [hullReady, props.viewMode, visitedCabin]);
  return <ScheduleProvider adapters={props.adapters}>
    <color attach="background" args={['#080714']} />
    <CameraManager {...props} flight={flight} residentView={residentView} onUpperVisibility={setUpperVisible} />
    <Cosmos reducedMotion={props.reducedMotion} sun={sun} flight={flight} />
    <Environment resolution={128} frames={1}>
      <Lightformer form="rect" intensity={1.55} color="#faf7f2" position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 8, 1]} />
      <Lightformer intensity={0.85} color="#c8e0f6" position={[5, 1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 4, 1]} />
    </Environment>
    <UpperDeckVisibility.Provider value={upperVisible}>
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
          if (!inCabin || id !== props.sceneId) return false;
          if (focusedObject) { perform(); return true; }
          if (id === 'habitat' && props.cameraInput.deferClick?.(() => { interaction.current?.(point, action, perform); })) return true;
          return interaction.current?.(point, action, perform) ?? false;
        },
      };
      const onFloorClick = (point: [number, number, number]) => {
        const walk = () => walkTo(id, point);
        if (id !== 'habitat' || !props.cameraInput.deferClick?.(walk)) walk();
      };
      return <group key={id} position={SCENE_ORIGINS[id]} visible={id === props.sceneId || isTravelling}>
        {id === props.sceneId && <OrbitalLighting objects={world.objects} sceneId={id} sun={sun} />}
        {id === 'habitat' && (!inCabin || hullReady) && <SpacecraftHull flight={flight} sun={sun} reducedMotion={props.reducedMotion}
          onEnterCabin={props.onEnterCabin} onReady={onHullReady} />}
        {(showInterior || visitedCabin) && <group name={id === 'habitat' ? 'Habitat_Interior' : undefined} visible={showInterior}>
          <HabitatShell world={world} deck="lower" onFloorClick={onFloorClick} />
          {id === 'habitat' && cabinLoading.furniture && <ScheduleSurfaces {...world} paperPickup={paperPickup}
            visible={inCabin && props.sceneId === 'habitat'} />}
          {id === 'habitat' && <>
            <CabinStaircase onCross={() => walkTo(id, stairDestination(residentView.current.deck))} />
            <CabinUpperDeck>
              <HabitatShell world={world} deck="upper" onFloorClick={onFloorClick} />
              <BedroomGuard />
              {cabinLoading.furniture && (upperVisible || visitedUpperDeck) && <>
                <AlarmClock3D {...world} />
                <Suspense fallback={null}><HabitatBedroom world={world} sofaTime={sofaTime} /></Suspense>
              </>}
            </CabinUpperDeck>
          </>}
          {cabinLoading.furniture && <>
            <Suspense fallback={null}><HabitatFurniture {...world} /></Suspense>
            <FeatureSurfaces {...world} />
          </>}
          {(cabinLoading.equipment || focusedObject === 'computer' || focusedObject === 'music-player')
            && <Suspense fallback={null}><MediaObjects {...world} /></Suspense>}
          {id === props.sceneId && <>
            <OrbitalResidents {...world} outfit={readOutfit(props.sceneObjects.habitat.wardrobe?.itemId)} catMenuOpen={props.catMenuOpen} sofaTime={sofaTime} paperPickup={paperPickup} onHover={(objectId, hint) => { if (inCabin) props.onHover(objectId, hint); }} interaction={interaction}
              inspectionId={focusedObject === 'wardrobe' && props.transition.phase === 'active' && props.transition.action?.kind === 'select' ? props.transition.id : undefined}
              onInspectionEnd={props.onReturn} onOutfitMounted={onResidentMounted}
              prefetchSeat={cabinLoading.equipment} loadPlush={cabinLoading.plush} loadCat={cabinLoading.cat}
              deckView={residentView} upperVisible={upperVisible} quickAscent={props.quickAscent} onQuickAscentAvailable={props.onQuickAscentAvailable}
              showNearbyHints={props.cabinView === 'overview' || props.cabinView === residentView.current.deck}
              approachEnabled={inCabin && !props.focusedObject && ['idle', 'active', 'error'].includes(props.transition.phase)}
              walkTarget={walkTarget} onArrive={() => setWalkTarget(null)}
              enabled={canWalk && (!props.library || props.library.view.phase === 'idle')} />
          </>}
        </group>}
      </group>;
    })}
    </UpperDeckVisibility.Provider>
  </ScheduleProvider>;
}
const visibleSceneEvents: NonNullable<React.ComponentProps<typeof Canvas>['events']> = state => ({
  ...events(state),
  compute: (event, root) => {
    root.pointer.set(event.offsetX * 2 / root.size.width - 1, 1 - event.offsetY * 2 / root.size.height);
    setCameraRay(root.raycaster, root.pointer, root.camera);
  },
  filter: hits => hits.filter(hit => cameraHitVisible(hit.object)),
});

const DETAIL_VIEWS: [CameraAnchorId, string][] = [
  ['bedroom', '卧室'], ['desktop', '桌面'], ['bed', '床铺'], ['music-player', '唱片机'], ['resident', 'Luna'],
];

const CABIN_VIEWS: [CabinView, string][] = [['overview', '全景'], ['lower', '一层'], ['upper', '二层']];

export function OrbitalScene(props: OrbitalSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<number | null>(null);
  const mouseRelease = useRef(-Infinity);
  const cancelClick = useCallback(() => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }, []);
  const cameraInput = useMemo<CameraInput>(() => ({ request: null, pick: null, deferClick: null, cancelPendingClick: cancelClick }), [cancelClick]);
  useEffect(() => {
    cameraInput.deferClick = run => {
      if (performance.now() - mouseRelease.current > 20) return false;
      cancelClick();
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        if (current.current.viewMode === 'cabin' && !current.current.focusedObject) run();
      }, 320);
      return true;
    };
    return () => { cameraInput.deferClick = null; cancelClick(); };
  }, [cameraInput, cancelClick]);
  useEffect(cancelClick, [cancelClick, props.viewMode, props.transition.id]);
  const [catMenu, setCatMenu] = useState<WorldAction | null>(null);
  const outfitPreview = useMemo(() => props.viewMode === 'cabin' && !!previewOutfit(window.location.search), []);
  const quickAscent = useRef<(() => boolean) | null>(null);
  const [canAscend, setCanAscend] = useState(false);
  const [blackout, setBlackout] = useState<'black' | 'reveal' | null>(null);
  const [view, setView] = useState<{ mode: CabinView; revision: number; cut: boolean }>({ cut: false, mode: outfitPreview ? 'lower' : 'overview', revision: 0 });
  const selectView = (mode: CabinView, cut = false) => {
    cancelClick();
    setView(current => ({ mode, cut, revision: current.revision + 1 }));
  };
  useEffect(() => {
    if (blackout !== 'black') return;
    // Leave a fully black frame on screen before moving the resident and selecting the upper camera.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (quickAscent.current?.()) selectView('upper', true);
        // Give the scene a render at the new deck before revealing it.
        frame = requestAnimationFrame(() => setBlackout('reveal'));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [blackout]);
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
    onPointerUpCapture={event => {
      if (event.target instanceof HTMLCanvasElement && event.pointerType === 'mouse' && event.button === 0) mouseRelease.current = performance.now();
    }}
    onPointerCancel={() => { cancelClick(); props.onGesture(false); }}
    onWheel={e => { if (!e.defaultPrevented && props.focusedObject && !props.activeGame && e.deltaY > 45) props.onReturn(); }}
    onDoubleClick={event => {
      if (!(event.target instanceof HTMLCanvasElement) || props.activeGame) return;
      if (props.focusedObject) props.onReturn();
      else if (cameraInput.pick?.(event.nativeEvent)) cancelClick();
    }}>
    <Canvas events={visibleSceneEvents} shadows dpr={[1, 1.6]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
      <WorldContent {...props} catMenuOpen={!!catMenu} outfitPreview={outfitPreview} cameraInput={cameraInput}
        quickAscent={quickAscent} onQuickAscentAvailable={setCanAscend} cutToDeck={view.cut} cabinView={view.mode} viewRevision={view.revision} onCabinViewChange={selectView} onAction={action => {
        if (action.kind === 'pet' && action.objectId === 'pet') setCatMenu(action);
        else props.onAction(action);
      }} />
    </Canvas>
    {props.sceneId === 'habitat' && props.viewMode === 'cabin' && !props.focusedObject && !catMenu
      && ['idle', 'active', 'error'].includes(props.transition.phase) && (
      <nav className="orbital-floor-views" aria-label="生活舱视角">
        {CABIN_VIEWS.map(([mode, label]) => <button key={mode} type="button" className="orbital-flight-pill"
          aria-pressed={view.mode === mode} onClick={() => selectView(mode)}>{label}</button>)}
        <button type="button" className="orbital-flight-pill" onClick={() => selectView('overview')}>重置视角</button>
        <details className="orbital-camera-subjects">
          <summary className="orbital-flight-pill">观察对象</summary>
          <div className="orbital-camera-subject-list">
            {DETAIL_VIEWS.map(([id, name]) => <button key={id} type="button" className="orbital-flight-pill" onClick={event => {
              cancelClick();
              cameraInput.request = id;
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}>{name}</button>)}
          </div>
        </details>
        {canAscend && <button type="button" className="orbital-flight-pill is-primary"
          disabled={!!blackout} onClick={() => setBlackout('black')}>快速上楼</button>}
      </nav>
    )}
    {blackout && createPortal(<div aria-hidden="true" className={`orbital-stair-blackout ${blackout}`}
      onAnimationEnd={() => setBlackout(null)} />, document.body)}
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
