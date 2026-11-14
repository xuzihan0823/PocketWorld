import { SuppliedAsset } from '../SuppliedAsset';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameCartridgeProps, GameId } from '../../../types/game';
import type { WorldAction, WorldSceneProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox } from '../Primitives';
import { ComputerScreen } from './ComputerScreen';
import { CartridgePickup } from './CartridgePickup';
import { RecordPlayer } from './RecordPlayer';
import { CARTRIDGE_SLOT as SLOT, cartridgePosition, cartridgeTransferPoint } from './cartridge-motion';

type Point = [number, number, number];
const gameModules = import.meta.glob<{ default: React.ComponentType<GameCartridgeProps> }>('../../../games/*/index.tsx');
const gameNames: Record<GameId, string> = { mario: '奶娃滑雪大冒险', shooter: '团团魔法录' };
const gameColors: Record<GameId, string> = { mario: '#cb795a', shooter: '#8b72b3' };

function Label({ children, position, width = 180 }: { children: React.ReactNode; position: Point; width?: number }) {
  return <Html center position={position} distanceFactor={4} style={{ pointerEvents: 'none', width, textAlign: 'center', color: '#f3e6c9', font: '12px monospace', textShadow: '0 1px 3px #242723', userSelect: 'none', overflowWrap: 'anywhere' }}><span>{children}</span></Html>;
}

function Cartridge({ game }: { game: GameId }) {
  return <group>
    <SuppliedAsset name="cartridge" size={[.22, .075, .25]} fit="contact" rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -.0375]} fallback={<>    <SoftBox dims={[0.22, 0.25, 0.075]} color={gameColors[game]} radius={0.016} />
    <SoftBox dims={[0.16, 0.11, 0.008]} position={[0, 0.025, 0.043]} color="#ece0bd" radius={0.005} />
    <SoftBox dims={[0.13, 0.024, 0.012]} position={[0, -0.115, 0]} color="#bba269" radius={0.003} />
</>} />
    <mesh position={[0, 0.027, 0.05]}><circleGeometry args={[0.032, game === 'mario' ? 8 : 3]} /><meshStandardMaterial color={gameColors[game]} /></mesh>
  </group>;
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
    if (t === 1) { finished.current = true; onDone(); }
  });
  return <group ref={group} position={transfer.from}>{transfer.game ? <Cartridge game={transfer.game} /> : null}</group>;
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

  const begin = (next: Omit<Transfer, 'key'>) => {
    const value = { ...next, key: ++serial.current };
    transferRef.current = value;
    setTransfer(value);
  };
  const focus = (id: 'computer' | 'music-player') => {
    const world = latest.current;
    if (world.focusedObject !== id) world.onAction({ sceneId: world.sceneId, objectId: id, kind: 'inspect' });
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
    else if (id.startsWith('game-cartridge-')) {
      focus('computer');
    } else if (id === 'game-slot') eject();
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

    {(['mario', 'shooter'] as const).map(game => <CartridgePickup key={game} id={`game-cartridge-${game}`} world={world} position={cartridgePosition(game)}
      enabled={sceneVisible && computerFocused && !props.activeGame && !transfer && ['idle', 'active', 'error'].includes(props.transition.phase)}
      onGrab={() => {
        if (pickupRef.current || transferRef.current || latest.current.activeGame) return false;
        pickupRef.current = game; setPickup(game); setNearSlot(false); return true;
      }} onNearSlot={setNearSlot} onInspect={() => focus('computer')}
      onDrop={(from, insert) => {
        pickupRef.current = null; setPickup(null); setNearSlot(false);
        if (!sceneVisible) return;
        if (insert) { focus('computer'); begin({ game, from, to: SLOT }); }
        else if (from.some((value, axis) => value !== cartridgePosition(game)[axis])) begin({ game, from, to: cartridgePosition(game), returnOnly: true });
      }}>
      {props.activeGame !== game && transfer?.game !== game && <Cartridge game={game} />}
    </CartridgePickup>)}
    <ObjectHandle id="game-slot" action="eject" hint={props.activeGame || transfer?.game ? '拔出卡带，退出游戏' : '空卡槽 · 离开电脑'} world={world} drag="y" position={SLOT}>
      <SoftBox dims={[0.41, 0.13, 0.17]} position={[0, -0.08, 0]} color="#b6ac94" />
      <SoftBox dims={[0.25, 0.012, 0.085]} position={[0, -0.008, 0]} color={pickup ? nearSlot ? '#a9dba3' : '#d7b46e' : '#303d38'} />
      {props.activeGame && !transfer?.game && <Cartridge game={props.activeGame} />}
    </ObjectHandle>
    {pickup && <Label position={[SLOT[0], 1.84, SLOT[2]]} width={220}>{nearSlot ? '松手插入卡带' : '拖到此处卡槽 · 松手插入'}</Label>}
    <ObjectHandle id="game-pause" action="toggle" hint={paused ? '扳动拨杆，继续游戏' : '扳动拨杆，暂停游戏'} world={world} position={[2.57, 1.15, -2.05]}>
      <SoftBox dims={[0.1, 0.05, 0.1]} color="#485d54" />
      <SoftBox dims={[0.025, 0.095, 0.025]} position={[0, 0.04, 0]} rotation={[paused ? -0.4 : 0.4, 0, 0]} color="#cfb976" />
    </ObjectHandle>
    <ObjectHandle id="computer-exit" action="close" hint="握住电脑侧把手，离开电脑" world={world} position={[2.15, 1.42, -2.29]}>
      <SoftBox dims={[0.045, 0.21, 0.08]} color="#8c8e77" />
    </ObjectHandle>
    <ObjectHandle id="computer" action="inspect" hint="靠近屏幕，选择一张游戏卡带" world={world} position={[1.55, 1.68, -2.36]}>
      <mesh><planeGeometry args={[0.92, 0.69]} /><meshBasicMaterial color="#182e28" /></mesh>
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
          <span>{transfer?.game ? transfer.returnOnly ? '卡带正在归位' : transfer.eject ? '正在拔出卡带' : '正在插入卡带' : props.activeGame ? loadError?.game === props.activeGame ? loadError.text : computerFocused ? '正在读取卡带…' : '游戏已暂停，靠近电脑继续' : '按住卡带，拖到右侧卡槽后松手'}</span>
          <span style={{ fontSize: 14, color: '#c1cbb2' }}>拔出卡带退出 · 拨杆暂停 · 音箱旋钮静音</span>
        </div>}
      </div>
    </ComputerScreen>}
    {transfer && <TransferObject key={transfer.key} transfer={transfer} reduced={props.reducedMotion} onDone={() => finishTransfer(transfer)} />}
  </group>;
};
