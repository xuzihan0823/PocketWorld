import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { WorldSceneProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { PAPER_PICKUP_PREFIX, type PaperPickup } from '../cabinActions';
import { useSchedule } from './ScheduleContext';
import { discardSchedulePage, paperBallPosition, tearSchedulePage, turnSchedulePage } from './schedule';
import { BOOK_POSITION, FloorPaperBall, FlyingPaper, GLASS_POSITION, PostedPaper, type PaperFlight } from './SchedulePaper';
import { roomAudio } from '../../audioEngine';
import './schedule.css';

export function ScheduleSurfaces(props: WorldSceneProps & { visible: boolean; paperPickup: React.RefObject<PaperPickup | null> }) {
  const { book, state, commit, ready, error, retry, collectPaper } = useSchedule();
  const { size } = useThree();
  const narrow = size.width < 720;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flight, setFlight] = useState<PaperFlight | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const bookView = props.focusedObject === 'schedule';
  const glassView = props.focusedObject === 'schedule-glass';
  const focused = props.visible && (bookView || glassView);
  const selectedIndex = Math.max(0, state.posted.findIndex(page => page.id === selectedId));
  const selected = state.posted[selectedIndex];
  const settled = ['active', 'error', 'idle'].includes(props.transition.phase);
  useEffect(() => setMessage(''), [state.current, props.focusedObject]);

  const turn = (direction: -1 | 1) => {
    if (!bookView || busy.current || !settled || !ready || !book.current.ready) return;
    const next = turnSchedulePage(state, direction);
    if (next === state) return;
    (document.activeElement as HTMLElement)?.blur?.();
    if (!commit(next)) return;
    roomAudio.playSfx('paper');
    book.current.ready = false;
    props.onGesture(false);
    setMessage('');
  };
  const switchView = () => {
    if (busy.current || !settled) return;
    props.onGesture(false);
    props.onAction({ sceneId: props.sceneId, objectId: glassView ? 'schedule' : 'schedule-glass', kind: glassView ? 'plan' : 'inspect' });
  };
  const tear = (from: [number, number, number]) => {
    if (busy.current || !settled || !ready || !book.current.ready) return;
    const page = state.current;
    (document.activeElement as HTMLElement)?.blur?.();
    if (!commit(tearSchedulePage(state))) return;
    roomAudio.playSfx('paper-tear');
    busy.current = true;
    book.current.ready = false;
    setFlight({ kind: 'tear', page, from });
    props.onGesture(false);
  };
  useEffect(() => {
    if (!bookView) return;
    book.current.onTurn = turn;
    book.current.onTear = () => tear(BOOK_POSITION);
    book.current.onPaperPointer = (page, u, v, kind) => {
      if (kind !== 'down') return false;
      if (v > 0.9 && (page % 2 ? u < 0.15 : u > 0.85)) { turn(page % 2 ? -1 : 1); return; }
    };
    return () => {
      book.current.onTurn = undefined; book.current.onTear = undefined; book.current.onPaperPointer = undefined;
    };
  }, [bookView, state, ready, settled]);
  useEffect(() => {
    if (!focused) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
      if (event.code === 'KeyV') { event.preventDefault(); switchView(); }
      if (bookView && event.code === 'KeyX') {
        event.preventDefault(); event.stopPropagation(); tear(BOOK_POSITION);
      }
      if (bookView && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
        event.preventDefault(); event.stopPropagation(); turn(event.code === 'ArrowLeft' ? -1 : 1);
      }
      if (glassView && !busy.current && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
        event.preventDefault();
        const next = state.posted[selectedIndex + (event.code === 'ArrowLeft' ? -1 : 1)];
        if (next) { roomAudio.playSfx('paper'); setSelectedId(next.id); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [focused, bookView, glassView, selectedIndex, state, ready, settled, props.onAction]);
  const discard = () => {
    if (busy.current || !settled || !selected) return;
    if (!commit(discardSchedulePage(state, selected.id))) return;
    roomAudio.playSfx('paper-crumple');
    busy.current = true;
    setFlight({ kind: 'discard', page: selected });
    setSelectedId(state.posted[selectedIndex + 1]?.id ?? state.posted[selectedIndex - 1]?.id ?? null);
    setMessage('这张安排已揉成纸团，留在地面上。');
  };
  const blocked = !ready || !!flight || !settled;
  return <>
    {state.posted.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3).map(page => {
      const offset = state.posted.indexOf(page) - selectedIndex;
      if (flight && (flight.page.id === page.id || offset === 0)) return null;
      return <PostedPaper key={page.id} page={page} position={[GLASS_POSITION[0] + offset * 0.68, GLASS_POSITION[1] - Math.abs(offset) * 0.035, GLASS_POSITION[2]]} onSelect={() => {
        if (busy.current || !props.visible || !focused || !settled) return;
        setSelectedId(page.id);
        if (!glassView) props.onAction({ sceneId: props.sceneId, objectId: 'schedule-glass', kind: 'inspect' });
      }} />;
    })}
    {state.discarded.filter(ball => flight?.page.id !== ball.id).map(ball => {
      const world = { ...props, onApproach: (_point: [number, number, number], action: Parameters<typeof props.onAction>[0]) => {
        if (!props.visible || !ready || busy.current) return false;
        return props.onApproach?.(paperBallPosition(ball.seed), action, () => { collectPaper(ball.id); }) ?? false;
      } };
      return <ObjectHandle key={ball.id} id={PAPER_PICKUP_PREFIX + ball.id} action="select" hint="捡起纸团" panorama
        world={world} onClick={event => event.stopPropagation()}><FloorPaperBall ball={ball} pickup={props.paperPickup} /></ObjectHandle>;
    })}
    {flight && <FlyingPaper flight={flight} reducedMotion={props.reducedMotion} onComplete={() => { busy.current = false; setFlight(null); }} />}
    {focused && !flight && (glassView || message || error) && <Html center transform={!narrow} position={glassView ? [GLASS_POSITION[0], GLASS_POSITION[1] - 0.52, GLASS_POSITION[2] + 0.018] : BOOK_POSITION} distanceFactor={narrow ? undefined : 0.62} zIndexRange={[24, 21]}>
      <div className="schedule-paper-tools" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        {glassView && (selected ? <nav aria-label="玻璃日程翻页"><button disabled={blocked || selectedIndex === 0} onClick={() => { roomAudio.playSfx('paper'); setSelectedId(state.posted[selectedIndex - 1].id); }} aria-label="上一张安排">‹</button><span>{selectedIndex + 1} / {state.posted.length}</span><button disabled={blocked || selectedIndex >= state.posted.length - 1} onClick={() => { roomAudio.playSfx('paper'); setSelectedId(state.posted[selectedIndex + 1].id); }} aria-label="下一张安排">›</button><button disabled={blocked} onClick={discard}>揉掉这张</button></nav> : <p>玻璃上没有贴过的日程 · V 返回书本</p>)}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}<button onClick={retry}>{props.adapters?.schedule ? '重试同步' : '重试保存'}</button></p>}
      </div>
    </Html>}
  </>;
}
