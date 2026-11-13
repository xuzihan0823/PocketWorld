import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '../../../types/world';
import { useSchedule } from './ScheduleContext';
import { discardSchedulePage, allSchedulePages, patchScheduleTask, placeScheduleTask, turnSchedulePage, scheduleTaskError, type ScheduleTask, type StripPlacement } from './schedule';
import { FloorPaperBall, FlyingPaper, GLASS_POSITION, PostedPaper, type PaperFlight } from './SchedulePaper';
import { BOOK_POSITION, PAGE_DISTANCE_FACTOR, PAGE_LOCAL_POSITION } from './bookLayout';
import { ScheduleBook } from './ScheduleBook';
import './schedule.css';
import { ScheduleTextField } from './ScheduleTextField';
import { ScheduleTaskEditor } from './ScheduleTaskEditor';
import { TaskStrip } from './TaskStrip';
import { useStripDrag } from './useStripDrag';

export function ScheduleSurfaces(props: WorldSceneProps & { visible: boolean }) {
  const { state, commit, ready, error, retry } = useSchedule();
  const { size } = useThree();
  const narrow = size.width < 720;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flight, setFlight] = useState<PaperFlight | null>(null);
  const article = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const dropFrom = useRef<{ id: string; position: THREE.Vector3 } | null>(null);
  const root = useRef<THREE.Group>(null), targets = useRef<THREE.Group>(null);
  const bookView = props.focusedObject === 'schedule';
  const glassView = props.focusedObject === 'schedule-glass';
  const focused = props.visible && (bookView || glassView);
  const selectedIndex = Math.max(0, state.posted.findIndex(page => page.id === selectedId));
  const selected = state.posted[selectedIndex];

  const settled = ['active', 'error', 'idle'].includes(props.transition.phase);
  const switchView = () => {
    if (busy.current || !settled) return;
    props.onGesture(false);
    props.onAction({ sceneId: props.sceneId, objectId: glassView ? 'schedule' : 'schedule-glass', kind: glassView ? 'plan' : 'inspect' });
  };
  useEffect(() => {
    if (!focused) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
      if (event.code === 'KeyV') { event.preventDefault(); switchView(); }
      if (glassView && !busy.current && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
        event.preventDefault();
        const next = state.posted[selectedIndex + (event.code === 'ArrowLeft' ? -1 : 1)];
        if (next) setSelectedId(next.id);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [focused, glassView, selectedIndex, state.posted, settled, props.onAction]);
  useEffect(() => {
    if (focused && settled && !flight) article.current?.focus({ preventScroll: true });
  }, [focused, bookView, settled, flight]);
  const patch = (id: string, fields: Partial<ScheduleTask>) => commit(current => patchScheduleTask(current, id, fields), { retainDraftOnError: true });
  const updateDate = (date: string) => commit(current => ({ ...current, current: { ...current.current, date } }), { retainDraftOnError: true });
  const place = (id: string, placement: StripPlacement | null) => {
    dropFrom.current = strips.moving.current ? { id, position: strips.moving.current.position.clone() } : null;
    return commit(current => {
    let next = placeScheduleTask(current, id, placement);
    // Returning an older slip opens its original page without copying task data.
    const owner = [...next.archive, ...next.queued].find(p => p.entries.some(e => e.id === id));
    if (!placement && owner) next = { ...next, current: owner, archive: [...next.archive.filter(p => p.id !== owner.id), next.current], queued: next.queued.filter(p => p.id !== owner.id) };
    return next;
    });
  };
  const strips = useStripDrag({ root, targets, enabled: focused && settled && ready && !flight, reducedMotion: props.reducedMotion, onGesture: props.onGesture, onError: props.onFeatureError, onPlace: place });
  const keyboardPeel = (task: ScheduleTask, index: number) => {
    const invalid = scheduleTaskError(task); if (invalid) { props.onFeatureError(invalid); return; }
    const used = Object.keys(state.placements).length;
    if (used >= 24) { props.onFeatureError('桌面已有 24 张纸条，请先放回一些。'); return; }
    place(task.id, { surface: 'desk', position: [0.55 + (used % 2) * 0.22, 1.126 + Math.floor(used / 6) * 0.0005, -2.29 - (Math.floor(used / 2) % 2) * 0.12], rotation: index ? 0.025 : -0.025 });
  };
  const discard = () => {
    if (busy.current || !settled || !selected) return;
    if (!commit(discardSchedulePage(state, selected.id))) return;
    busy.current = true;
    setFlight({ kind: 'discard', page: selected });
    setSelectedId(state.posted[selectedIndex + 1]?.id ?? state.posted[selectedIndex - 1]?.id ?? null);
  };
  const blocked = !ready || !!flight || !settled || !!strips.active;
  const editor = focused && !flight && settled && <Html transform={!narrow} center={narrow} position={bookView ? PAGE_LOCAL_POSITION : [GLASS_POSITION[0], GLASS_POSITION[1], GLASS_POSITION[2] + 0.018]}
      calculatePosition={narrow ? (_object, _camera, viewport) => [viewport.width / 2, viewport.height * 0.48] : undefined}
      rotation={bookView ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} distanceFactor={narrow ? undefined : bookView ? PAGE_DISTANCE_FACTOR : 0.62} zIndexRange={[24, 21]}>
      <article ref={article} tabIndex={-1} data-dragging={!!strips.active && strips.active.phase !== 'peeling'} className={`schedule-sheet ${glassView ? 'is-posted' : 'is-book'}`} aria-label={bookView ? '日程书当前页' : '玻璃上的日程'} onPointerDown={event => event.stopPropagation()} onWheel={e => e.stopPropagation()}>
        {bookView ? <ScheduleTextField onGesture={props.onGesture} className="schedule-date" type="text" inputMode="text" aria-label="日程日期" maxLength={10} autoComplete="off" spellCheck={false} disabled={blocked}
          value={state.current.date} onValue={updateDate} />
          : selected && <time className="schedule-date">{selected.date}</time>}
        <header className="schedule-heading"><h2>{glassView && !selected ? '玻璃上的安排' : '今天的安排'}</h2></header>
        {!ready ? <div className="schedule-empty"><p>{error || '正在翻开日程……'}</p>{error && <button onClick={retry}>重新读取</button>}</div> : bookView ? <>
          <div className="schedule-tasks">{state.current.entries.map((entry, index) => <ScheduleTaskEditor key={entry.id} task={entry} index={index} blocked={blocked}
            removed={!!state.placements[entry.id] || strips.active?.id === entry.id && strips.active.phase !== 'peeling'}
            onPatch={fields => patch(entry.id, fields)} onGesture={props.onGesture}
            onPeel={(event, element) => {
              if (Object.keys(state.placements).length >= 24) { props.onFeatureError('桌面已有 24 张纸条，请先放回一些。'); return; }
              strips.start(event, entry, state.current.date, element);
            }} onKeyboardPeel={() => keyboardPeel(entry, index)} />)}</div>
          <nav className="schedule-page-number" aria-label="日程页码">
            {state.archive.length > 0 && <button aria-label="上一页日程" disabled={blocked} onClick={() => commit(current => turnSchedulePage(current, -1))}>‹</button>}
            <span aria-label={`第 ${state.current.number} 页`}>{String(state.current.number).padStart(2, '0')}</span>
            {(state.queued.length > 0 || state.current.entries.every(e => state.placements[e.id])) && <button aria-label="下一页日程" disabled={blocked} onClick={() => commit(current => turnSchedulePage(current, 1))}>›</button>}
          </nav>
          <div className="strip-keyboard-actions">{state.current.entries.filter(e => state.placements[e.id]).map(entry => <button key={entry.id} onClick={() => place(entry.id, null)}>放回「{entry.title}」</button>)}</div>
        </> : selected ? <>
          <div className="schedule-posted-tasks">{selected.entries.map(entry => <section key={entry.id}><div><time>{entry.time}</time></div><h3>{entry.title}</h3><p>{entry.content}</p></section>)}</div>
          <div className="schedule-actions"><nav aria-label="玻璃日程翻页"><button disabled={blocked || selectedIndex === 0} onClick={() => setSelectedId(state.posted[selectedIndex - 1].id)} aria-label="上一张安排">上一张</button><span>{selectedIndex + 1} / {state.posted.length}</span><button disabled={blocked || selectedIndex >= state.posted.length - 1} onClick={() => setSelectedId(state.posted[selectedIndex + 1].id)} aria-label="下一张安排">下一张</button></nav><button className="schedule-discard" disabled={blocked} onClick={discard}>揉掉这张</button></div>
          <div className="schedule-page-number" aria-label={`第 ${selected.number} 页`}>{String(selected.number).padStart(2, '0')}</div>
        </> : <div className="schedule-empty"><p>这里还没有贴上安排。</p></div>}
        {ready && error && <p className="schedule-error" role="alert">{error}<button onClick={retry}>{props.adapters?.schedule ? '重试同步' : '重试保存'}</button></p>}
      </article>
    </Html>;
  return <group ref={root}>
    <ScheduleBook world={props}>{bookView && editor}</ScheduleBook>
    {glassView && editor}
    {state.posted.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3).map(page => {
      const offset = state.posted.indexOf(page) - selectedIndex;
      if (flight && (flight.page.id === page.id || offset === 0)) return null;
      return <PostedPaper key={page.id} page={page} position={[GLASS_POSITION[0] + offset * 0.68, GLASS_POSITION[1] - Math.abs(offset) * 0.035, GLASS_POSITION[2]]} onSelect={() => {
        if (busy.current || !props.visible) return;
        const select = () => {
          setSelectedId(page.id);
          if (!glassView) props.onAction({ sceneId: props.sceneId, objectId: 'schedule-glass', kind: 'inspect' });
        };
        const action = { sceneId: props.sceneId, objectId: 'schedule-glass', kind: 'inspect' as const };
        if (props.onApproach) props.onApproach([0.57, 1.2, -1.96], action, select);
        else select();
      }} />;
    })}
    {state.discarded.filter(ball => flight?.page.id !== ball.id).map(ball => <FloorPaperBall key={ball.id} ball={ball} />)}
    <group ref={targets}>
      <mesh position={[0.1, 1.123, -2.35]} rotation-x={-Math.PI / 2} userData={{ surface: 'desk' }}>
        <planeGeometry args={[1.66, 1.25]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <mesh position={[0.55, BOOK_POSITION[1] + 0.004, -1.96]} rotation={[-Math.PI / 2, 0, 0.08]} userData={{ surface: 'book' }}>
        <planeGeometry args={[0.51, 0.35]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <mesh position={GLASS_POSITION} userData={{ surface: 'glass' }}>
        <planeGeometry args={[1.5, 0.9]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
    {allSchedulePages(state).flatMap(page => page.entries.filter(task => state.placements[task.id] && strips.active?.id !== task.id).map(task =>
      <TaskStrip key={task.id} task={task} date={page.date} placement={state.placements[task.id]} initialPosition={dropFrom.current?.id === task.id ? dropFrom.current.position : undefined} reducedMotion={props.reducedMotion}
        onPointerDown={event => {
          event.stopPropagation();
          if (!focused) { props.onAction({ sceneId: props.sceneId, objectId: 'schedule', kind: 'plan' }); return; }
          strips.start(event.nativeEvent, task, page.date, undefined, state.placements[task.id]);
        }} onReturn={() => { if (focused) place(task.id, null); }} />))}
    {strips.active && strips.active.phase !== 'peeling' && strips.moving.current && <TaskStrip task={strips.moving.current.task} date={strips.moving.current.date} motion={strips.moving} reducedMotion={props.reducedMotion} />}
    {flight && <FlyingPaper flight={flight} reducedMotion={props.reducedMotion} onComplete={() => { busy.current = false; setFlight(null); }} />}
  </group>;
}
