import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameCartridgeProps, GameId } from '../../../types/game';
import type { WorldAction, WorldSceneProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox } from '../Primitives';
import { CRT_SCALE, CRT_SCREEN } from './computerLayout';
import { ComputerScreen } from './ComputerScreen';
import { CartridgePickup } from './CartridgePickup';
import { CartridgeDockModel, CartridgeStandModel, GameCartridgeModel, PauseToggleLever } from './CartridgeHardware';
import { RecordPlayer } from './RecordPlayer';
import {
  CARTRIDGE_PAUSE_POS,
  CARTRIDGE_SLOT as SLOT,
  CARTRIDGE_STAND_LEAN,
  cartridgePosition,
  cartridgeTransferPitch,
  cartridgeTransferPoint,
} from './cartridge-motion';
import { COMPUTER_STAND } from '../cabinLayout';

type Point = [number, number, number];
const gameModules = import.meta.glob<{ default: React.ComponentType<GameCartridgeProps> }>('../../../games/*/index.tsx');
const gameNames: Record<GameId, string> = { mario: '奶娃滑雪大冒险', shooter: '团团魔法录' };

function Label({ children, position, width = 180 }: { children: React.ReactNode; position: Point; width?: number }) {
  return <Html center position={position} distanceFactor={4} style={{ pointerEvents: 'none', width, textAlign: 'center', color: '#f3e6c9', font: '12px monospace', textShadow: '0 1px 3px #242723', userSelect: 'none', overflowWrap: 'anywhere' }}><span>{children}</span></Html>;
}

interface Transfer { key: number; from: Point; to: Point; game?: GameId; eject?: boolean; returnOnly?: boolean }
function TransferObject({ transfer, reduced, onDone }: { transfer: Transfer; reduced: boolean; onDone: () => void }) {
  const group = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const finished = useRef(false);
  useFrame((_, delta) => {
    if (!group.current || finished.current) return;
    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / (reduced ? 0.08 : 0.8));
    group.current.position.set(...cartridgeTransferPoint(transfer.from, transfer.to, t));
    group.current.rotation.x = cartridgeTransferPitch(transfer.from, transfer.to, t);
    if (t === 1) { finished.current = true; onDone(); }
  });
  return <group ref={group} position={transfer.from} rotation={[cartridgeTransferPitch(transfer.from, transfer.to, 0), 0, 0]}>
    {transfer.game ? <GameCartridgeModel game={transfer.game} /> : null}
  </group>;
}

class ScreenBoundary extends React.Component<{ children: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? <div style={screenMessage}>卡带暂时无法运行，请拔出后重试。</div> : this.props.children; }
}
const screenMessage: React.CSSProperties = { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '6%', boxSizing: 'border-box', textAlign: 'center', pointerEvents: 'none' };

/** Mount inside each scene's local-origin group. Playback belongs to the shared audio engine. */
export const MediaObjects: React.FC<WorldSceneProps> = props => {
  const latest = useRef(props);
  latest.current = props;
  const serial = useRef(0);
  const transferRef = useRef<Transfer | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [queuedInsertion, setQueuedInsertion] = useState<{ game: GameId; beforeFocus: number } | null>(null);
  const pickupRef = useRef<GameId | null>(null);
  const [pickup, setPickup] = useState<GameId | null>(null);
  const [nearSlot, setNearSlot] = useState(false);
  const [paused, setPaused] = useState(false);
  const [presentation, setPresentation] = useState<'auto' | 'expanded' | 'collapsed' | 'embedded'>('auto');
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 720 || window.innerHeight <= 480);
  const [windowFocused, setWindowFocused] = useState(true);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [loaded, setLoaded] = useState<{ game: GameId; Component: React.ComponentType<GameCartridgeProps> } | null>(null);
  const [loadError, setLoadError] = useState<{ game: GameId; text: string } | null>(null);
  const [score, setScore] = useState({ current: 0, high: 0 });
  const computerFocused = props.focusedObject === 'computer';
  const sceneVisible = props.transition.toScene === props.sceneId && props.transition.phase !== 'leaving' && props.transition.phase !== 'returning' && !(props.transition.phase === 'entering' && props.transition.fromScene !== props.transition.toScene);
  const displayVisible = computerFocused && sceneVisible && ['active', 'error'].includes(props.transition.phase);
  const cartridgesEnabled = sceneVisible && (!props.focusedObject || computerFocused)
    && !props.activeGame && !transfer && !queuedInsertion && ['idle', 'active', 'error'].includes(props.transition.phase);
  const expanded = !!props.activeGame && presentation !== 'collapsed' && presentation !== 'embedded' && (presentation === 'expanded' || narrow);
  const gameActive = displayVisible && presentation !== 'collapsed' && !paused && !hidden && windowFocused && !transfer?.game && !pickup && !loadError;
  const activeComponent = loaded?.game === props.activeGame ? loaded.Component : null;

  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 720 || window.innerHeight <= 480);
    const blur = () => setWindowFocused(false), focus = () => setWindowFocused(true);
    window.addEventListener('resize', resize); window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => { setPresentation('auto'); }, [props.activeGame]);
  useEffect(() => () => {
    transferRef.current = null;
    latest.current.onGesture(false);
  }, []);
  useEffect(() => {
    if (!sceneVisible) {
      transferRef.current = null;
      setTransfer(null);
    }
  }, [sceneVisible]);
  useEffect(() => {
    const pending = transferRef.current;
    if (pending && props.focusedObject !== 'computer') {
      transferRef.current = null;
      setTransfer(null);
    }
  }, [props.focusedObject]);
  useEffect(() => {
    const game = props.activeGame;
    if (!game) { setLoaded(null); setLoadError(null); setScore({ current: 0, high: 0 }); setPaused(false); return; }
    if (loaded?.game === game || !computerFocused || !sceneVisible) return;
    setPaused(false); setLoadError(null); setLoaded(null); setScore({ current: 0, high: 0 });
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      const text = '这张卡带暂时无法运行。拔出卡带后可选择另一张。';
      setLoadError({ game, text });
      latest.current.onFeatureError(text);
    };
    const loader = gameModules[`../../../games/${game}/index.tsx`];
    if (!loader) setLoadError({ game, text: `《${gameNames[game]}》尚未接入。卡带接口已预留，拔出即可返回。` });
    else loader().then(module => {
      if (cancelled) return;
      if (!module.default) { fail(); return; }
      setLoaded({ game, Component: module.default });
    }, fail);
    return () => { cancelled = true; };
  }, [props.activeGame, computerFocused, sceneVisible, loaded]);

  const begin = useCallback((next: Omit<Transfer, 'key'>) => {
    const value = { ...next, key: ++serial.current };
    transferRef.current = value;
    setTransfer(value);
  }, []);
  useEffect(() => {
    if (!queuedInsertion) return;
    if (!sceneVisible || props.activeGame) { setQueuedInsertion(null); return; }
    // World props cross the Canvas boundary and may arrive after this component's local state.
    if (props.transition.id === queuedInsertion.beforeFocus) return;
    if (props.transition.action?.objectId !== 'computer') { setQueuedInsertion(null); return; }
    if (displayVisible) {
      setQueuedInsertion(null);
      const { game } = queuedInsertion;
      if (!transferRef.current && !pickupRef.current) begin({ game, from: cartridgePosition(game), to: SLOT });
    }
  }, [queuedInsertion, sceneVisible, displayVisible, props.activeGame, props.transition, begin]);
  const selectCartridge = (game: GameId) => {
    const world = latest.current;
    if (!cartridgesEnabled || transferRef.current || pickupRef.current || world.activeGame) return;
    if (world.library && world.library.flow.current.phase !== 'idle') return;
    const from = cartridgePosition(game);
    if (displayVisible) { begin({ game, from, to: SLOT }); return; }
    const action: WorldAction = { sceneId: world.sceneId, objectId: 'computer', kind: 'inspect' };
    const openComputer = () => {
      setQueuedInsertion({ game, beforeFocus: latest.current.transition.id });
      latest.current.onAction(action);
    };
    if (world.onApproach) world.onApproach([COMPUTER_STAND[0], from[1], COMPUTER_STAND[1]], action, openComputer);
    else openComputer();
  };
  const eject = useCallback(() => {
    if (transferRef.current || pickupRef.current) return;
    const game = latest.current.activeGame;
    if (game) {
      const value: Transfer = { key: ++serial.current, game, eject: true, from: SLOT, to: cartridgePosition(game) };
      transferRef.current = value;
      setTransfer(value);
      setPaused(true);
    } else latest.current.onReturn();
  }, []);
  const leaveComputer = useCallback(() => {
    setQueuedInsertion(null);
    transferRef.current = null;
    setTransfer(null);
    latest.current.onGameChange(null);
    latest.current.onReturn();
  }, []);
  useEffect(() => {
    if (!computerFocused || (activeComponent && gameActive)) return;
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      (document.activeElement as HTMLElement)?.blur?.();
      leaveComputer();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [computerFocused, activeComponent, gameActive, leaveComputer]);
  const finishTransfer = (value: Transfer) => {
    if (transferRef.current?.key !== value.key) return;
    transferRef.current = null;
    setTransfer(null);
    if (value.game && !value.returnOnly) latest.current.onGameChange(value.eject ? null : value.game);
  };
  const mediaAction = (action: WorldAction) => {
    const id = action.objectId;
    if (!sceneVisible) return;
    if (id === 'game-mute') props.onToggleMute();
    else if (id === 'game-cartridge-mario') selectCartridge('mario');
    else if (id === 'game-cartridge-shooter') selectCartridge('shooter');
    else if (id === 'game-slot') eject();
    else if (id === 'game-pause') setPaused(value => !value);
    else if (id === 'computer-exit') leaveComputer();
    else props.onAction(action);
  };
  const world = { ...props, onAction: mediaAction };
  const updateScore = (current: number, high: number) => {
    if (!Number.isFinite(current) || !Number.isFinite(high)) return;
    const game = props.activeGame;
    if (!game || game !== latest.current.activeGame) return;
    let best = Math.max(0, current, high);
    try {
      const key = `pocketworld:${game}:highscore`;
      const stored = Number(localStorage.getItem(key));
      if (Number.isFinite(stored)) best = Math.max(best, stored);
      localStorage.setItem(key, String(best));
    } catch { /* Scores remain available when storage is disabled. */ }
    setScore(previous => previous.current === current && previous.high === best ? previous : { current, high: best });
  };

  return <group name="MediaObjects">
    <RecordPlayer {...props} />
    <CartridgeStandModel />
    <CartridgeDockModel active={!!props.activeGame} paused={paused} pickup={!!pickup} nearSlot={nearSlot} />

    {(['mario', 'shooter'] as const).map(game => <CartridgePickup key={game} id={`game-cartridge-${game}`} hint={`点击插入《${gameNames[game]}》卡带`} world={world} position={cartridgePosition(game)}
      enabled={cartridgesEnabled}
      onGrab={() => {
        if (pickupRef.current || transferRef.current || latest.current.activeGame) return false;
        pickupRef.current = game; setPickup(game); setNearSlot(false); return true;
      }} onNearSlot={setNearSlot} onSelect={() => selectCartridge(game)}
      onDrop={(from, insert) => {
        pickupRef.current = null; setPickup(null); setNearSlot(false);
        if (!sceneVisible) return;
        if (insert) begin({ game, from, to: SLOT });
        else if (from.some((value, axis) => value !== cartridgePosition(game)[axis])) begin({ game, from, to: cartridgePosition(game), returnOnly: true });
      }}>
      {props.activeGame !== game && transfer?.game !== game && <group rotation={[pickup === game ? 0 : CARTRIDGE_STAND_LEAN, 0, 0]}><GameCartridgeModel game={game} /></group>}
    </CartridgePickup>)}
    <ObjectHandle id="game-slot" action="eject" hint={props.activeGame || transfer?.game ? '拔出卡带，退出游戏' : '空卡槽 · 离开电脑'} world={world} drag="y" position={SLOT}>
      <mesh position={[0, -0.095, 0]}><boxGeometry args={[0.36, 0.12, 0.22]} /><meshBasicMaterial visible={false} /></mesh>
      {props.activeGame && !transfer?.game && <GameCartridgeModel game={props.activeGame} />}
    </ObjectHandle>
    {pickup && <Label position={[SLOT[0], 1.84, SLOT[2]]} width={220}>{nearSlot ? '松手插入卡带' : '拖到此处卡槽 · 松手插入'}</Label>}
    <ObjectHandle id="game-pause" action="toggle" hint={paused ? '扳动拨杆，继续游戏' : '扳动拨杆，暂停游戏'} world={world} position={CARTRIDGE_PAUSE_POS}>
      <mesh position={[0, 0.025, 0]}><boxGeometry args={[0.12, 0.08, 0.12]} /><meshBasicMaterial visible={false} /></mesh>
      <PauseToggleLever paused={paused} />
    </ObjectHandle>
    <ObjectHandle id="computer-exit" action="close" hint="握住电脑侧把手，离开电脑" world={world} position={[2.25, 1.47, -2.32]}>
      <SoftBox dims={[0.045, 0.21, 0.08]} color="#c99852" />
    </ObjectHandle>
    <ObjectHandle id="computer" action="inspect" panorama hint="点击后走近坐下，再使用电脑" world={world} position={CRT_SCREEN}>
      <mesh scale={CRT_SCALE}><planeGeometry args={[0.92, 0.69]} /><meshBasicMaterial visible={false} /></mesh>
    </ObjectHandle>
    {/* The DOM display must not paint over a physical cartridge moving in front of the CRT. */}
    {(sceneVisible || activeComponent) && <ComputerScreen visible={displayVisible && !pickup && !transfer?.game} interactive={displayVisible && !!activeComponent && presentation !== 'collapsed'}
      expanded={expanded} collapsed={presentation === 'collapsed'} controls={!!props.activeGame} allowEmbeddedResume={!narrow}
      onExpand={() => setPresentation('expanded')} onCollapse={() => setPresentation('collapsed')} onResume={() => setPresentation('embedded')} onEject={eject}>
      <div aria-label="电脑游戏屏幕" onPointerDown={event => { if (activeComponent) event.stopPropagation(); }} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>

        {props.activeGame && activeComponent ? <ScreenBoundary key={props.activeGame} onError={() => { setLoadError({ game: props.activeGame!, text: '卡带暂时无法运行，请拔出后重试。' }); props.onFeatureError('卡带暂时无法运行，请拔出后重试。'); }}>
          {React.createElement(activeComponent, { width: 800, height: 600, isActive: gameActive, isMuted: props.isMuted, onExit: eject, onScoreChange: updateScore, onGameOver: result => updateScore(result.score, result.highScore) })}
        </ScreenBoundary> : <div style={screenMessage}>
          <strong style={{ fontSize: 24, letterSpacing: 3 }}>POCKET PLAY</strong>
          <span>{transfer?.game ? transfer.returnOnly ? '卡带正在归位' : transfer.eject ? '正在拔出卡带' : '正在插入卡带' : props.activeGame ? loadError?.game === props.activeGame ? loadError.text : computerFocused ? '正在读取卡带…' : '游戏已暂停，靠近电脑继续' : '点击卡带自动插入，也可拖入右侧卡槽'}</span>
          <span style={{ fontSize: 14, color: '#c1cbb2' }}>拔出卡带退出 · 拨杆暂停 · 音箱旋钮静音</span>
        </div>}
      </div>
    </ComputerScreen>}
    {transfer && <TransferObject key={transfer.key} transfer={transfer} reduced={props.reducedMotion} onDone={() => finishTransfer(transfer)} />}
  </group>;
};
