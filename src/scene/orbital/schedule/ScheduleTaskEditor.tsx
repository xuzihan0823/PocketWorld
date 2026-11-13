import { useMemo, useRef } from 'react';
import type { ScheduleTask } from './schedule';
import { ScheduleTextField } from './ScheduleTextField';
import { tornEdge } from './stripState';

export function ScheduleTaskEditor({ task, index, blocked, removed, onPatch, onGesture, onPeel, onKeyboardPeel }: {
  task: ScheduleTask; index: number; blocked: boolean; removed: boolean;
  onPatch: (patch: Partial<ScheduleTask>) => void; onGesture: (active: boolean) => void;
  onPeel: (event: PointerEvent, element: HTMLElement) => void; onKeyboardPeel: () => void;
}) {
  const paper = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => {
    const points = Array.from({ length: 65 }, (_, i) => `${i / 64 * 100}% ${0.6 + tornEdge(i / 64, task.id.length) * 110}%`);
    return `polygon(${points.join(',')},100% 98.8%,98% 100%,72% 99.4%,49% 100%,26% 99.2%,0% 100%)`;
  }, [task.id]);
  const prefix = `第${index + 1}项`;
  return <div className="schedule-strip-slot" data-task-id={task.id} data-removed={removed}>
    <div ref={paper} className="schedule-task-strip" style={{ clipPath: outline }} aria-hidden={removed}>
      <fieldset disabled={blocked || removed} aria-label={`任务 ${index + 1}`}>
        <ScheduleTextField className="strip-title" aria-label={`${prefix}标题`} title="任务名称" maxLength={60} value={task.title} onValue={title => onPatch({ title })} onGesture={onGesture} />
        <div className="strip-times">
          <ScheduleTextField aria-label={`${prefix}开始时间`} title="开始时间" inputMode="text" maxLength={5} value={task.time} onValue={time => onPatch({ time })} onGesture={onGesture} />
          <span aria-hidden="true">—</span>
          <ScheduleTextField aria-label={`${prefix}结束时间`} title="结束时间" inputMode="text" maxLength={5} value={task.endTime ?? ''} onValue={endTime => onPatch({ endTime })} onGesture={onGesture} />
        </div>
        <ScheduleTextField multiline className="strip-content" aria-label={`${prefix}内容`} title="任务内容" maxLength={600} value={task.content ?? ''} onValue={content => onPatch({ content })} onGesture={onGesture} />
        <div className="strip-metadata">
          <select aria-label={`${prefix}优先级`} title="优先级" value={task.priority ?? 'normal'} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onFocus={() => onGesture(true)} onBlur={() => onGesture(false)} onChange={event => onPatch({ priority: event.target.value as ScheduleTask['priority'] })}>
            <option value="low">从容</option><option value="normal">日常</option><option value="high">优先</option>
          </select>
          <ScheduleTextField aria-label={`${prefix}分类`} title="任务分类" maxLength={20} value={task.category ?? ''} onValue={category => onPatch({ category })} onGesture={onGesture} />
        </div>
      </fieldset>
      <button type="button" className="strip-grip" aria-label={`撕下${prefix}任务`} title="从边缘拖动撕下；按 Enter 贴到桌面" disabled={blocked || removed}
        onPointerDown={event => { event.stopPropagation(); onPeel(event.nativeEvent, paper.current!); }}
        onClick={event => { if (event.detail === 0) onKeyboardPeel(); }}>
        <svg viewBox="0 0 12 150" preserveAspectRatio="none" aria-hidden="true"><path d="M6 4V146" /></svg>
      </button>
      <svg className="strip-perforation" viewBox="0 0 300 4" preserveAspectRatio="none" aria-hidden="true"><path d="M0 2H300" /></svg>
      <div className="strip-tear-shadow" aria-hidden="true" />
    </div>
  </div>;
}
