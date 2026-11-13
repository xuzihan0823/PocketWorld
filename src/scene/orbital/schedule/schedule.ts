import type { ScheduleEntry } from '../../../types/world';

export const SCHEDULE_KEY = 'pocketworld:schedule:notebook:v2';
export const LEGACY_SCHEDULE_KEY = 'pocketworld:schedule:notebook:v1';
export const MAX_POSTED_SCHEDULES = 5;
export const SCHEDULE_FULL_MESSAGE = '主角：“玻璃已经贴满 5 张啦，先拿掉一张，再贴新的吧。”';
export type StripPhase = 'attached' | 'peeling' | 'detached' | 'dragging' | 'pasted';
export interface ScheduleTask extends ScheduleEntry { endTime?: string; priority?: 'low' | 'normal' | 'high'; category?: string }
export interface StripPlacement { surface: 'desk' | 'glass'; position: [number, number, number]; rotation: number }
export interface SchedulePage {
  id: string;
  number: number;
  date: string;
  entries: [ScheduleTask, ScheduleTask];
}
export interface PaperBall { id: string; seed: number }
export interface ScheduleNotebook {
  version: 2;
  placements: Record<string, StripPlacement>;
  archive: SchedulePage[];
  syncPending?: boolean;
  syncRemovedIds?: string[];
  current: SchedulePage;
  posted: SchedulePage[];
  queued: SchedulePage[];
  discarded: PaperBall[];
}
const today = () => new Date().toLocaleDateString('sv-SE');
export function createSchedulePage(number: number): SchedulePage {
  const id = crypto.randomUUID();
  return { id, number, date: today(), entries: [0, 1].map(i => ({ id: `${id}-${i}`, time: '', title: '', content: '', endTime: '', priority: 'normal', category: '', completed: false })) as SchedulePage['entries'] };
}
export function migrateSchedule(entries: ScheduleEntry[] = []): ScheduleNotebook {
  const pages: SchedulePage[] = [];
  for (let i = 0; i < Math.max(1, entries.length); i += 2) {
    const page = createSchedulePage(pages.length + 1);
    entries.slice(i, i + 2).forEach((entry, index) => { page.entries[index] = { ...entry, content: entry.content ?? '' }; });
    pages.push(page);
  }
  return { version: 2, placements: {}, archive: [], current: pages[0], posted: [], queued: pages.slice(1), discarded: [] };
}
export function isScheduleEntry(value: unknown): value is ScheduleEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ScheduleTask;
  if (entry.endTime !== undefined && typeof entry.endTime !== 'string' || entry.category !== undefined && typeof entry.category !== 'string' || entry.priority !== undefined && !['low', 'normal', 'high'].includes(entry.priority)) return false;
  return typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.time === 'string' && typeof entry.completed === 'boolean' && (entry.content === undefined || typeof entry.content === 'string');
}
export function isScheduleNotebook(value: unknown): value is ScheduleNotebook {
  if (!value || typeof value !== 'object') return false;
  const state = value as ScheduleNotebook;
  if (state.syncRemovedIds !== undefined && (!Array.isArray(state.syncRemovedIds) || !state.syncRemovedIds.every(id => typeof id === 'string'))) return false;
  const page = (p: SchedulePage) => p && typeof p.id === 'string' && Number.isSafeInteger(p.number) && p.number > 0 && typeof p.date === 'string' && Array.isArray(p.entries) && p.entries.length === 2 && p.entries.every(isScheduleEntry);
  if (state.version !== 2 || !page(state.current) || !Array.isArray(state.posted) || !state.posted.every(page) || !Array.isArray(state.queued) || !state.queued.every(page) || !Array.isArray(state.discarded) || !state.discarded.every(p => p && typeof p.id === 'string' && Number.isFinite(p.seed))) return false;
  if (!Array.isArray(state.archive) || !state.archive.every(page) || !state.placements || typeof state.placements !== 'object' || Array.isArray(state.placements)) return false;
  const pages = allSchedulePages(state), ids = pages.map(p => p.id), tasks = pages.flatMap(p => p.entries.map(e => e.id));
  if (new Set(ids).size !== ids.length || new Set(tasks).size !== tasks.length) return false;
  return Object.entries(state.placements).every(([id, placement]) => tasks.includes(id) && isStripPlacement(placement));
}
export function hasScheduleContent(page: SchedulePage) {
  return page.entries.some(entry => entry.title.trim() || entry.time.trim() || entry.content?.trim());
}
export function schedulePageError(page: SchedulePage): string | null {
  if (!hasScheduleContent(page)) return '先写下一件想做的事，再贴到玻璃上。';
  for (const entry of page.entries) {
    if (!(entry.title.trim() || entry.time.trim() || entry.content?.trim())) continue;
    if (!entry.title.trim()) return '请为写好的任务补上标题。';
    if (!/^([01]?\d|2[0-3])[:：][0-5]\d$/.test(entry.time.trim())) return '请输入有效时间，例如 09:00。';
  }
  return null;
}
export function postSchedulePage(state: ScheduleNotebook): ScheduleNotebook {
  if (state.posted.length >= MAX_POSTED_SCHEDULES || schedulePageError(state.current)) return state;
  const nextNumber = Math.max(state.current.number, ...state.posted.map(p => p.number), ...state.queued.map(p => p.number)) + 1;
  return { ...state, current: state.queued[0] ?? createSchedulePage(nextNumber), posted: [...state.posted, state.current], queued: state.queued.slice(1) };
}
export function discardSchedulePage(state: ScheduleNotebook, id: string): ScheduleNotebook {
  const page = state.posted.find(p => p.id === id);
  if (!page) return state;
  const placements = { ...state.placements };
  page.entries.forEach(entry => { delete placements[entry.id]; });
  return { ...state, placements, posted: state.posted.filter(p => p.id !== id), discarded: [...state.discarded, { id, seed: page.number }].slice(-24) };
}
export function flattenSchedule(state: ScheduleNotebook): ScheduleEntry[] {
  return allSchedulePages(state).flatMap(page => page.entries);
}


export function allSchedulePages(state: ScheduleNotebook): SchedulePage[] {
  return [state.current, ...state.posted, ...state.queued, ...state.archive];
}
export function isStripPlacement(value: unknown): value is StripPlacement {
  if (!value || typeof value !== 'object') return false;
  const p = value as StripPlacement;
  return ['desk', 'glass'].includes(p.surface) && Array.isArray(p.position) && p.position.length === 3 && p.position.every(n => Number.isFinite(n) && Math.abs(n) < 20) && Number.isFinite(p.rotation);
}
/** Only migration reads v1; its original key is never overwritten. */
export function upgradeSchedule(value: unknown): ScheduleNotebook | null {
  if (isScheduleNotebook(value)) return value;
  if (!value || typeof value !== 'object' || (value as { version?: number }).version !== 1) return null;
  const upgraded = { ...value, version: 2, placements: {}, archive: [] };
  return isScheduleNotebook(upgraded) ? upgraded : null;
}
export function patchScheduleTask(state: ScheduleNotebook, id: string, patch: Partial<Omit<ScheduleTask, 'id'>>) {
  const page = (p: SchedulePage): SchedulePage => ({ ...p, entries: p.entries.map(e => e.id === id ? { ...e, ...patch, id } : e) as SchedulePage['entries'] });
  return { ...state, current: page(state.current), posted: state.posted.map(page), queued: state.queued.map(page), archive: state.archive.map(page) };
}
export function placeScheduleTask(state: ScheduleNotebook, id: string, placement: StripPlacement | null): ScheduleNotebook {
  if (!flattenSchedule(state).some(e => e.id === id) || placement && !isStripPlacement(placement)) return state;
  const placements = { ...state.placements };
  if (placement) return { ...state, placements: { ...placements, [id]: placement } };
  delete placements[id];
  return { ...state, placements };
}
export function turnSchedulePage(state: ScheduleNotebook, direction: -1 | 1): ScheduleNotebook {
  if (direction === -1) {
    const previous = state.archive[state.archive.length - 1];
    if (!previous) return state;
    return { ...state, current: previous, archive: state.archive.slice(0, -1), queued: [state.current, ...state.queued] };
  }
  if (!state.queued.length && !state.current.entries.every(e => state.placements[e.id])) return state;
  const number = Math.max(...allSchedulePages(state).map(p => p.number)) + 1;
  return { ...state, archive: [...state.archive, state.current], current: state.queued[0] ?? createSchedulePage(number), queued: state.queued.slice(1) };
}
export function scheduleTaskError(task: ScheduleTask): string | null {
  if (!task.title.trim()) return '先写下任务名称，再从边缘撕下纸条。';
  const validTime = (time: string) => /^([01]?\d|2[0-3])[:：][0-5]\d$/.test(time.trim());
  if (task.time && !validTime(task.time) || task.endTime && !validTime(task.endTime)) return '请输入有效时间，例如 09:00。';
  if (task.endTime && !task.time) return '请补上开始时间。';
  const minutes = (time: string) => { const [h, m] = time.split(/[:：]/).map(Number); return h * 60 + m; };
  if (task.time && task.endTime && minutes(task.endTime) <= minutes(task.time)) return '结束时间需要晚于开始时间。';
  return null;
}
