import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '../../../types/world';
import { useSchedule } from './ScheduleContext';
import { discardSchedulePage, MAX_POSTED_SCHEDULES, postSchedulePage, schedulePageError, SCHEDULE_FULL_MESSAGE, type SchedulePage } from './schedule';
import { FloorPaperBall, FlyingPaper, GLASS_POSITION, PostedPaper, type PaperFlight } from './SchedulePaper';
import { BOOK_POSITION, PAGE_DISTANCE_FACTOR, PAGE_LOCAL_POSITION } from './bookLayout';
import { ScheduleBook } from './ScheduleBook';
import './schedule.css';

export function ScheduleSurfaces(props: WorldSceneProps & { visible: boolean }) {
  const { state, commit, ready, error, retry } = useSchedule();
  const { camera, size } = useThree();
  const narrow = size.width < 720;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flight, setFlight] = useState<PaperFlight | null>(null);
  const article = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; pageId: string; width: number; height: number } | null>(null);
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
  const update = (index: number, field: 'title' | 'time' | 'content', value: string) => {
    const entries = [...state.current.entries] as SchedulePage['entries'];
    entries[index] = { ...entries[index], [field]: value };
    commit({ ...state, current: { ...state.current, entries } }, { retainDraftOnError: true });
  };
  const updateDate = (date: string) => commit({ ...state, current: { ...state.current, date } }, { retainDraftOnError: true });
  const post = (from: [number, number, number]) => {
    if (busy.current || !settled || !ready) return;
    if (state.posted.length >= MAX_POSTED_SCHEDULES) {
      props.onFeatureError(SCHEDULE_FULL_MESSAGE);
      return;
    }
    const invalid = schedulePageError(state.current);
    if (invalid) { props.onFeatureError(invalid); return; }
    const page = state.current;
    if (!commit(postSchedulePage(state))) return;
    busy.current = true;
    setSelectedId(page.id);
    setFlight({ kind: 'post', page, from });
    props.onGesture(false);
    props.onAction({ sceneId: props.sceneId, objectId: 'schedule-glass', kind: 'inspect' });
  };
  const discard = () => {
    if (busy.current || !settled || !selected) return;
    if (!commit(discardSchedulePage(state, selected.id))) return;
    busy.current = true;
    setFlight({ kind: 'discard', page: selected });
    setSelectedId(state.posted[selectedIndex + 1]?.id ?? state.posted[selectedIndex - 1]?.id ?? null);
  };
  const resetDrag = () => {
    const held = drag.current;
    drag.current = null;
    if (article.current) {
      article.current.style.transform = '';
      article.current.classList.remove('is-dragging');
      if (held && article.current.hasPointerCapture(held.pointerId)) article.current.releasePointerCapture(held.pointerId);
    }
    if (held) props.onGesture(false);
  };
  useEffect(() => {
    if (!focused || !bookView) resetDrag();
  }, [focused, bookView]);
  useEffect(() => {
    window.addEventListener('blur', resetDrag);
    return () => { window.removeEventListener('blur', resetDrag); resetDrag(); };
  }, []);
  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!event.isPrimary) { resetDrag(); return; }
    if (!bookView || !ready || busy.current || !settled || event.button !== 0 || drag.current) return;
    if ((event.target as HTMLElement).closest('input, textarea, button, a, select, [contenteditable]')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pageId: state.current.id, width: rect.width, height: rect.height };
    (document.activeElement as HTMLElement)?.blur?.();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onGesture(true);
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (Math.hypot(dx, dy) < 6) return;
    event.preventDefault();
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.style.transform = `translate(${dx * event.currentTarget.offsetWidth / held.width}px, ${dy * event.currentTarget.offsetHeight / held.height}px)`;
  };
  const finishDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    resetDrag();
    const threshold = Math.min(96, Math.max(56, held.height * 0.14));
    if (held.pageId !== state.current.id || -dy < threshold || -dy < Math.abs(dx) * 1.2) return;
    const from = new THREE.Vector3(...BOOK_POSITION).project(camera);
    from.x += dx * 2 / size.width;
    from.y -= dy * 2 / size.height;
    from.unproject(camera);
    post(from.toArray() as [number, number, number]);
  };
  const blocked = !ready || !!flight || !settled;
  const editor = focused && !flight && settled && <Html transform={!narrow} center={narrow} position={bookView ? PAGE_LOCAL_POSITION : [GLASS_POSITION[0], GLASS_POSITION[1], GLASS_POSITION[2] + 0.018]}
      calculatePosition={narrow ? (_object, _camera, viewport) => [viewport.width / 2, viewport.height * 0.48] : undefined}
      rotation={bookView ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} distanceFactor={narrow ? undefined : bookView ? PAGE_DISTANCE_FACTOR : 0.62} zIndexRange={[24, 21]}>
      <article ref={article} tabIndex={-1} className={`schedule-sheet ${glassView ? 'is-posted' : 'is-book'}`} aria-label={bookView ? '日程书当前页' : '玻璃上的日程'} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={resetDrag} onLostPointerCapture={resetDrag} onWheel={e => e.stopPropagation()}>
        {bookView && <div className="schedule-paper-drag" aria-hidden="true" />}
        {bookView ? <input className="schedule-date" type="text" inputMode="text" aria-label="日程日期" maxLength={10} autoComplete="off" spellCheck={false} disabled={blocked}
          value={state.current.date} onChange={event => updateDate(event.target.value)} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} />
          : selected && <time className="schedule-date">{selected.date}</time>}
        <header className="schedule-heading"><h2>{glassView && !selected ? '玻璃上的安排' : '今天的安排'}</h2></header>
        {!ready ? <div className="schedule-empty"><p>{error || '正在翻开日程……'}</p>{error && <button onClick={retry}>重新读取</button>}</div> : bookView ? <>
          <div className="schedule-tasks">{state.current.entries.map((entry, index) => <fieldset key={entry.id} disabled={blocked} aria-label={`任务 ${index + 1}`}>
            <div className="schedule-task-heading"><label className="schedule-title"><span>标题</span><input aria-label={`第${index + 1}项标题`} maxLength={60} value={entry.title} onChange={e => update(index, 'title', e.target.value)} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} /></label>
              <label className="schedule-time"><span>时间</span><input type="text" inputMode="text" maxLength={5} autoComplete="off" spellCheck={false} aria-label={`第${index + 1}项时间`} value={entry.time} onChange={e => update(index, 'time', e.target.value)} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} /></label></div>
            <label className="schedule-content"><span>内容</span><textarea aria-label={`第${index + 1}项内容`} maxLength={600} rows={2} value={entry.content ?? ''} onChange={e => update(index, 'content', e.target.value)} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} /></label>
          </fieldset>)}</div>
          <div className="schedule-page-number" aria-label={`第 ${state.current.number} 页`}>{String(state.current.number).padStart(2, '0')}</div>
        </> : selected ? <>
          <div className="schedule-posted-tasks">{selected.entries.map(entry => <section key={entry.id}><div><time>{entry.time}</time></div><h3>{entry.title}</h3><p>{entry.content}</p></section>)}</div>
          <div className="schedule-actions"><nav aria-label="玻璃日程翻页"><button disabled={blocked || selectedIndex === 0} onClick={() => setSelectedId(state.posted[selectedIndex - 1].id)} aria-label="上一张安排">上一张</button><span>{selectedIndex + 1} / {state.posted.length}</span><button disabled={blocked || selectedIndex >= state.posted.length - 1} onClick={() => setSelectedId(state.posted[selectedIndex + 1].id)} aria-label="下一张安排">下一张</button></nav><button className="schedule-discard" disabled={blocked} onClick={discard}>揉掉这张</button></div>
          <div className="schedule-page-number" aria-label={`第 ${selected.number} 页`}>{String(selected.number).padStart(2, '0')}</div>
        </> : <div className="schedule-empty"><p>这里还没有贴上安排。</p></div>}
        {ready && error && <p className="schedule-error" role="alert">{error}<button onClick={retry}>{props.adapters?.schedule ? '重试同步' : '重试保存'}</button></p>}
      </article>
    </Html>;
  return <>
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
    {flight && <FlyingPaper flight={flight} reducedMotion={props.reducedMotion} onComplete={() => { busy.current = false; setFlight(null); }} />}
  </>;
}
