import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { JournalEntry, JournalPage, JournalWeather } from '../../../types/world';
import type { BoundBookControl } from './bookControl';
import { BOOK, leafPose, paperHalfThickness } from './bookModel';
import { journalPageTexture, paintJournalPage } from './pageTexture';
import { journalTextStop, type JournalTextLayout, type JournalTextStop } from './textLayout';
import { JOURNAL_WEATHER } from './weather';
import { journalPages, todayDate } from './journalStorage';

/** Map a printed position onto the same bent surface used by the skinned leaf. */
function journalSurfacePoint(index: number, x: number, y: number, spread: number, leafCount: number) {
  const left = index % 2 === 1, u = left ? 1 - x / 318 : x / 318;
  const pose = leafPose(Math.floor(index / 2), Number(left), 1, spread, leafCount);
  const column = Math.min(BOOK.segments - 1, Math.floor(u * BOOK.segments)), t = u * BOOK.segments - column;
  const a = pose.points[column], b = pose.points[column + 1], angle = pose.angles[column] - (left ? Math.PI : 0);
  const thickness = paperHalfThickness(u, leafCount) + 0.001;
  return {
    position: [(a.x + (b.x - a.x) * t - Math.sin(angle) * thickness), (a.y + (b.y - a.y) * t + Math.cos(angle) * thickness), (y / 428 - 0.5) * BOOK.height] as [number, number, number],
    angle,
  };
}

function PaperButton({ index, x, y, spread, leafCount, children }: { index: number; x: number; y: number; spread: number; leafCount: number; children: React.ReactNode }) {
  const pose = journalSurfacePoint(index, x, y, spread, leafCount);
  return <group position={pose.position} rotation-z={pose.angle}>
    <Html transform rotation-x={-Math.PI / 2} distanceFactor={BOOK.width / 318 * 400} zIndexRange={[22, 21]}>
      {children}
    </Html>
  </group>;
}

export function JournalEditor({ entry, book, leafCount, saveState, onChange, onGesture }: {
  entry: JournalEntry; book: MutableRefObject<BoundBookControl>; leafCount: number; saveState: string; onChange: (entry: JournalEntry) => void; onGesture: (active: boolean) => void;
}) {
  const [pages, setPages] = useState(() => journalPages(entry));
  const pagesRef = useRef(pages), callbacks = useRef({ entry, onChange, onGesture });
  callbacks.current = { entry, onChange, onGesture };
  const [page, setPage] = useState(0), [turning, setTurning] = useState(!book.current.ready || book.current.cursor !== 0);
  const inputs = useRef(new Map<number, HTMLTextAreaElement>()), layouts = useRef(new Map<number, JournalTextLayout>());
  const scroll = useRef(new Map<number, number>()), focus = useRef<number | null>(null), blink = useRef(true);
  const drag = useRef<{ page: number; anchor: number } | null>(null);
  const touch = useRef<{ page: number; id: number; x: number; y: number; lastY: number; moved: boolean } | null>(null);
  const caretStop = useRef<(JournalTextStop & { page: number }) | null>(null);
  const narrow = useThree(state => state.size.width < 720);
  const touchControls = narrow || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  const host = useRef<HTMLDivElement>(null), anchor = useRef<THREE.Group>(null);
  const activeOffset = (input: HTMLTextAreaElement) => input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
  const visualCaret = (index: number, offset: number) => caretStop.current?.page === index && caretStop.current.offset === offset ? caretStop.current : undefined;
  const paint = (index: number, reveal = false) => {
    const value = pagesRef.current[index] ?? { text: '' }, left = index % 2 === 1;
    let texture = book.current.textures.get(index) as THREE.CanvasTexture | undefined;
    if (!texture) {
      texture = journalPageTexture(value, index, callbacks.current.entry.date, left);
      book.current.textures.set(index, texture); book.current.revision++;
    }
    const input = inputs.current.get(index), editing = focus.current === index && input;
    const selection = editing ? { start: input.selectionStart, end: input.selectionEnd, caret: blink.current, point: visualCaret(index, activeOffset(input)) } : undefined;
    let offset = scroll.current.get(index) ?? 0;
    let layout = paintJournalPage(texture, value, index, callbacks.current.entry.date, left, offset, selection);
    if (reveal && editing) {
      const caret = selection?.point ?? layout.carets[Math.min(activeOffset(input), value.text.length)];
      if (caret.y - offset > 366) offset = Math.ceil((caret.y - 366) / 28) * 28;
      if (caret.y - offset < 102) offset = Math.max(0, caret.y - 102);
      scroll.current.set(index, offset);
      layout = paintJournalPage(texture, value, index, callbacks.current.entry.date, left, offset, selection);
    }
    layouts.current.set(index, layout);
  };
  const save = (index: number, patch: Partial<JournalPage>) => {
    if (patch.text !== undefined) caretStop.current = null;
    const next = pagesRef.current.slice();
    while (next.length <= index) next.push({ text: '', date: todayDate() });
    next[index] = { ...next[index], ...patch }; pagesRef.current = next; setPages(next);
    callbacks.current.onChange({ ...callbacks.current.entry, text: next[0].text, pages: next, updatedAt: new Date().toISOString() });
    blink.current = true; paint(index, true);
  };
  const toggleWeather = (index: number, weather: JournalWeather) => save(index, { weather: pagesRef.current[index]?.weather === weather ? undefined : weather });
  const turn = (direction: number) => {
    const destination = book.current.spread * 2 + direction * 2;
    if (!book.current.ready || destination < 0 || destination > leafCount * 2) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); focus.current = null; drag.current = null;
    const next = pagesRef.current.slice();
    while (next.length <= Math.min(destination, leafCount * 2 - 1)) next.push({ text: '', date: todayDate() });
    if (next.length !== pagesRef.current.length) {
      pagesRef.current = next; setPages(next);
    }
    const needed = new Set([page - 1, page, destination - 1, destination]);
    for (const [index, texture] of book.current.textures) {
      if (needed.has(index)) continue;
      texture.dispose();
      book.current.textures.delete(index);
      layouts.current.delete(index);
      book.current.revision++;
    }
    for (const index of needed) if (index >= 0 && index < leafCount * 2) paint(index);
    book.current.spread = destination / 2; book.current.ready = false; setTurning(true);
    callbacks.current.onGesture(false);
  };

  useLayoutEffect(() => {
    book.current.spread = 0;
    book.current.textures.forEach(texture => texture.dispose()); book.current.textures.clear(); book.current.revision++;
    paint(0);
    book.current.onSettled = () => { setPage(book.current.spread * 2); setTurning(false); };
    const release = () => { drag.current = null; touch.current = null; };
    const keepEditorFocus = (event: MouseEvent) => {
      if (focus.current !== null && event.target instanceof HTMLCanvasElement) event.preventDefault();
    };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    window.addEventListener('mousedown', keepEditorFocus, true);
    return () => {
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      window.removeEventListener('mousedown', keepEditorFocus, true);
      book.current.onSettled = undefined; callbacks.current.onGesture(false);
      const index = focus.current; focus.current = null; if (index !== null) paint(index);
    };
  }, [book]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (focus.current !== null) { blink.current = !blink.current; paint(focus.current); } }, 530);
    return () => window.clearInterval(timer);
  }, [book]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      if (!event.repeat) turn(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const handlePaperPointer: NonNullable<BoundBookControl['onPaperPointer']> = (index, u, v, kind, shift, delta, pointer) => {
    if (index !== page && index !== page - 1) return;
    const input = inputs.current.get(index), layout = layouts.current.get(index);
    if (!input || !layout) return;
    const x = u * 318, y = v * 428;
    const scrollBy = (amount: number) => {
      const end = layout.carets[layout.carets.length - 1];
      scroll.current.set(index, Math.max(0, Math.min(Math.max(0, end.y - 354), (scroll.current.get(index) ?? 0) + amount)));
      paint(index);
    };
    if (kind === 'wheel') { scrollBy((delta ?? 0) * 0.5); return; }
    if (pointer?.pointerType === 'touch') {
      if (!pointer.isPrimary) return;
      if (kind === 'down') {
        if (y >= 80 && y <= 376) touch.current = { page: index, id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, lastY: y, moved: false };
        return;
      }
      const gesture = touch.current;
      if (!gesture || gesture.page !== index || gesture.id !== pointer.pointerId) return;
      if (kind === 'move') {
        if (!gesture.moved && Math.hypot(pointer.clientX - gesture.x, pointer.clientY - gesture.y) < 6) return;
        if (!gesture.moved) input.blur();
        gesture.moved = true;
        scrollBy(gesture.lastY - y); gesture.lastY = y;
        return;
      }
      touch.current = null;
      if (gesture.moved || y < 80 || y > 376) return;
      const stop = journalTextStop(layout, x, y, scroll.current.get(index) ?? 0);
      caretStop.current = { ...stop, page: index };
      input.setSelectionRange(stop.offset, stop.offset);
      input.focus({ preventScroll: true }); blink.current = true; paint(index);
      return;
    }
    if (y < 80 || y > 376 || (kind === 'move' && drag.current?.page !== index)) return;
    if (kind === 'up') { drag.current = null; return; }
    const stop = journalTextStop(layout, x, y, scroll.current.get(index) ?? 0);
    const at = stop.offset;
    if (kind === 'down') {
      const start = shift ? input.selectionStart : at;
      drag.current = { page: index, anchor: start };
    }
    const start = drag.current?.anchor ?? at;
    caretStop.current = { ...stop, page: index };
    input.setSelectionRange(Math.min(start, at), Math.max(start, at), at < start ? 'backward' : 'forward');
    if (kind === 'down') input.focus({ preventScroll: true });
    blink.current = true; paint(index);
  };
  useLayoutEffect(() => {
    const control = book.current;
    control.onPaperPointer = handlePaperPointer;
    return () => { control.onPaperPointer = undefined; };
  });

  useFrame(({ camera, gl }) => {
    const index = focus.current;
    if (index === null || !book.current.ready || !host.current || !anchor.current) return;
    const input = inputs.current.get(index), layout = layouts.current.get(index);
    if (!input || !layout) return;
    const offset = Math.min(activeOffset(input), pagesRef.current[index].text.length);
    const caret = visualCaret(index, offset) ?? layout.carets[offset];
    const point = journalSurfacePoint(index, caret.x, caret.y - (scroll.current.get(index) ?? 0), page / 2, leafCount);
    const world = anchor.current.localToWorld(new THREE.Vector3(...point.position)).project(camera);
    const canvas = gl.domElement.getBoundingClientRect(), origin = host.current.getBoundingClientRect();
    input.style.left = `${canvas.left + (world.x + 1) * canvas.width / 2 - origin.left}px`;
    input.style.top = `${canvas.top + (1 - world.y) * canvas.height / 2 - origin.top - 16}px`;
  });

  const visible = [page - 1, page].filter(index => index >= 0 && index < leafCount * 2);
  return <group ref={anchor} name="Journal_Editor">
    <Html position={[0, 0, 0]} zIndexRange={[23, 23]} style={{ pointerEvents: 'none' }}>
      <div ref={host} className="world-journal-content world-journal-native-layer" data-turning={turning} aria-busy={turning}>
        {!turning && visible.map(index => <textarea key={index} ref={input => { if (input) inputs.current.set(index, input); else inputs.current.delete(index); }}
          aria-label={index % 2 ? '日记左页正文' : '日记右页正文'} data-page={index} defaultValue={pages[index]?.text ?? ''} readOnly={turning} wrap="off" spellCheck={false}
          onFocus={() => { focus.current = index; blink.current = true; callbacks.current.onGesture(true); paint(index, true); }}
          onBlur={() => { if (focus.current === index) { focus.current = null; caretStop.current = null; } callbacks.current.onGesture(false); paint(index); }}
          onChange={event => save(index, { text: event.target.value })} onSelect={() => { blink.current = true; paint(index, true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) { event.stopPropagation(); return; }
            if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { caretStop.current = null; return; }
            const input = event.currentTarget, layout = layouts.current.get(index);
            if (!layout) return;
            event.preventDefault();
            const active = activeOffset(input), caret = visualCaret(index, active) ?? layout.carets[active];
            const stop = event.key === 'Home' ? journalTextStop(layout, 0, caret.y, 0)
              : event.key === 'End' ? journalTextStop(layout, 400, caret.y, 0)
              : journalTextStop(layout, caret.x, caret.y + (event.key === 'ArrowDown' ? 28 : -28), 0);
            const at = stop.offset;
            const start = event.shiftKey ? input.selectionDirection === 'backward' ? input.selectionEnd : input.selectionStart : at;
            caretStop.current = { ...stop, page: index };
            input.setSelectionRange(Math.min(start, at), Math.max(start, at), at < start ? 'backward' : 'forward');
            blink.current = true; paint(index, true);
          }} />)}
        {!turning && visible.map(index => <span className="sr-only" key={`number-${index}`} aria-label={`第 ${index + 1} 页`}>{String(index + 1).padStart(2, '0')}</span>)}
        <span className="sr-only" role="status">{saveState || '本页自动保存'}</span>
      </div>
    </Html>
    {!turning && visible.map(index => {
      const left = index % 2 === 1, inset = left ? 24 : 32;
      return <group key={index}>
        <PaperButton index={index} x={left ? 242 : 250} y={39} spread={page / 2} leafCount={leafCount}>
          <input key={index} className="world-journal-paper-hit world-journal-date-hit" type="text" data-page={index} aria-label={left ? '左页日期' : '右页日期'} title="点击后直接输入日期" placeholder="YYYY-MM-DD" spellCheck={false}
            defaultValue={pages[index]?.date ?? entry.date} onPointerDown={event => event.stopPropagation()}
            onFocus={() => callbacks.current.onGesture(true)} onBlur={() => callbacks.current.onGesture(false)}
            onChange={event => save(index, { date: event.currentTarget.value })} />
        </PaperButton>
        {!touchControls && JOURNAL_WEATHER.map((weather, i) => <PaperButton key={weather.id} index={index} x={inset + 42 + i * 27} y={39} spread={page / 2} leafCount={leafCount}>
          <div role="group" aria-label={left ? '左页天气' : '右页天气'}>
            <button className="world-journal-paper-hit" type="button" aria-label={weather.label} title={weather.label} aria-pressed={pages[index]?.weather === weather.id}
              onPointerDown={event => event.stopPropagation()} onClick={() => toggleWeather(index, weather.id)} />
          </div>
        </PaperButton>)}
        {!touchControls && <PaperButton index={index} x={left ? 12 : 305} y={400} spread={page / 2} leafCount={leafCount}>
          <button className="world-journal-paper-hit" type="button" aria-label={left ? '上一页' : '下一页'} title={left ? '上一页' : '下一页'} onPointerDown={event => event.stopPropagation()} onClick={() => turn(left ? -1 : 1)} />
        </PaperButton>}
      </group>;
    })}
    {touchControls && !turning && <Html center calculatePosition={(_object, _camera, size) => [size.width / 2, size.height * 0.73]} zIndexRange={[22, 22]}>
      <nav className="world-journal-touch-tools" aria-label="日记本操作" onPointerDown={event => event.stopPropagation()}>
        {visible.map(index => {
          const left = index % 2 === 1, side = left ? '左页' : '右页';
          return <div className="world-journal-touch-row" key={index}>
            <span>{side}</span>
            <div role="group" aria-label={`${side}天气`}>
              {JOURNAL_WEATHER.map(weather => <button key={weather.id} type="button" aria-label={weather.label} aria-pressed={pages[index]?.weather === weather.id} onClick={() => toggleWeather(index, weather.id)}>{weather.label}</button>)}
            </div>
            <button type="button" aria-label={left ? '上一页' : '下一页'} onClick={() => turn(left ? -1 : 1)}>{left ? '‹' : '›'}</button>
          </div>;
        })}
      </nav>
    </Html>}
  </group>;
}
