import { useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { Html } from '@react-three/drei';
import type { BoundBookControl } from '../journal/bookControl';
import { BOOK, leafPose, paperHalfThickness } from '../journal/bookModel';
import type { SchedulePage } from './schedule';
import { roomAudio } from '../../audioEngine';

export function scheduleSurfacePoint(leaf: number, left: boolean, x: number, y: number, spread: number, leafCount: number) {
  const u = left ? 1 - x / 560 : x / 560;
  const pose = leafPose(leaf, Number(left), 1, spread, leafCount);
  const column = Math.min(BOOK.segments - 1, Math.floor(u * BOOK.segments)), t = u * BOOK.segments - column;
  const a = pose.points[column], b = pose.points[column + 1], angle = pose.angles[column] - (left ? Math.PI : 0);
  const thickness = paperHalfThickness(u, leafCount) + 0.0015;
  return { position: [a.x + (b.x - a.x) * t - Math.sin(angle) * thickness, a.y + (b.y - a.y) * t + Math.cos(angle) * thickness, (y / 872 - 0.5) * BOOK.height] as [number, number, number], angle };
}

function PaperField({ x, y, width, height, leaf, left, book, leafCount, children }: {
  x: number; y: number; width: number; height: number; leaf: number; left: boolean; book: MutableRefObject<BoundBookControl>; leafCount: number; children: ReactNode;
}) {
  const pose = scheduleSurfacePoint(leaf, left, x + width / 2, y + height / 2, book.current.spread, leafCount);
  return <group position={pose.position} rotation-z={pose.angle}>
    <Html transform rotation-x={-Math.PI / 2} scale={[1, (BOOK.height / 872) / (BOOK.width / 560), 1]} distanceFactor={BOOK.width / 560 * 400} zIndexRange={[24, 23]}>
      <div className="planner-native-field" style={{ width, height }} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>{children}</div>
    </Html>
  </group>;
}

export function SchedulePageEditor({ page, leaf, left = false, book, leafCount, onChange, onGesture, previousDisabled, nextDisabled }: {
  page: SchedulePage; leaf: number; left?: boolean; book: MutableRefObject<BoundBookControl>; leafCount: number; onChange: (page: SchedulePage) => void; onGesture: (active: boolean) => void; previousDisabled: boolean; nextDisabled: boolean;
}) {
  const [detail, setDetail] = useState<number | null>(null);
  const draft = useRef(page), composing = useRef(false);
  draft.current = page;
  const change = (update: (current: SchedulePage) => SchedulePage) => {
    const next = update(draft.current);
    draft.current = next; onChange(next);
  };
  const focus = { onFocus: () => onGesture(true), onBlur: () => onGesture(false) };
  // Html has its own React root; native values must survive delayed scene renders and IME updates.
  const text = (save: (value: string) => void) => ({
    ...focus,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (!composing.current) save(event.currentTarget.value); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; save(event.currentTarget.value); },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) event.stopPropagation(); },
  });
  const entry = (index: number, patch: Partial<SchedulePage['entries'][number]>) => change(current => ({ ...current, entries: current.entries.map((value, i) => i === index ? { ...value, ...patch } : value) }));
  const flip = (direction: -1 | 1) => { (document.activeElement as HTMLElement)?.blur?.(); book.current.onTurn?.(direction); };
  const field = (x: number, y: number, width: number, height: number, children: ReactNode, key: string) => <PaperField key={key} x={x} y={y} width={width} height={height} leaf={leaf} left={left} book={book} leafCount={leafCount}>{children}</PaperField>;
  const label = (value: string) => left ? `左页${value}` : value;
  return <group name={left ? 'Schedule_LeftPageEditor' : 'Schedule_PageEditor'}>
    {field(92, 112, 181, 34, <input type="date" aria-label={label("日程日期")} defaultValue={page.date} {...focus} onChange={event => { const date = event.currentTarget.value; if (date) change(current => ({ ...current, date })); }} />, 'date')}
    {page.entries.map((value, i) => field(48, 212 + i * 73, 210, 40, <div className="planner-native-row">
      <input className="planner-native-time" aria-label={label(`第${i + 1}项时间`)} defaultValue={value.time} maxLength={5} {...text(time => entry(i, { time }))} />
      <input aria-label={label(`第${i + 1}项标题`)} defaultValue={value.title} title={value.content || value.title} maxLength={60} {...text(title => entry(i, { title }))} />
      <button aria-label={label(`第${i + 1}项详情`)} onClick={() => setDetail(i)}>详情</button>
    </div>, value.id))}
    {page.todos.map((value, i) => field(295, 211 + i * 45, 212, 38, <div className="planner-native-todo">
      <input type="checkbox" aria-label={label(`完成待办${i + 1}`)} checked={value.completed} {...focus} onChange={event => { const completed = event.currentTarget.checked; roomAudio.playSfx('paper-check'); change(current => ({ ...current, todos: current.todos.map((todo, index) => index === i ? { ...todo, completed } : todo) })); }} />
      <input aria-label={label(`待办${i + 1}`)} defaultValue={value.text} maxLength={80} {...text(text => change(current => ({ ...current, todos: current.todos.map((todo, index) => index === i ? { ...todo, text } : todo) })))} />
    </div>, `todo-${i}`))}
    {page.tomorrow.map((value, i) => field(320, 419 + i * 53, 186, 40, <input aria-label={label(`明日计划${i + 1}`)} defaultValue={value} maxLength={80} {...text(value => change(current => ({ ...current, tomorrow: current.tomorrow.map((text, index) => index === i ? value : text) })))} />, `tomorrow-${i}`))}
    {field(297, 591, 210, 193, <textarea aria-label={label("日程备注")} defaultValue={page.notes} maxLength={1200} {...text(notes => change(current => ({ ...current, notes })))} />, 'notes')}
    {field(35, 807, 490, 45, <nav className={`planner-native-nav${left ? '' : ' is-right'}`} aria-label={label(left ? "日程本翻页" : "日程本翻页与撕页")}><span className="sr-only" role="status" aria-label={label("日程书当前页")}>第 {page.number} 页 · 在书页上直接编辑</span>{left ? <button disabled={previousDisabled} aria-label={label("日程上一页")} onClick={() => flip(-1)}>上一页</button> : <><button className="planner-native-tear" aria-label={label("撕掉这页")} onClick={() => book.current.onTear?.()}>撕掉这页</button><button disabled={nextDisabled} aria-label={label("日程下一页")} onClick={() => flip(1)}>下一页</button></>}</nav>, 'navigation')}
    {detail !== null && field(50, Math.min(678, 250 + detail * 73), 210, 100, <textarea className="planner-native-detail" aria-label={label(`第${detail + 1}项内容`)} defaultValue={page.entries[detail].content ?? ''} maxLength={600} autoFocus {...text(content => entry(detail, { content }))} onBlur={() => { onGesture(false); setDetail(null); }} />, 'detail')}
  </group>;
}
