import type { ScheduleEntry } from '../../types/world';

export const SCHEDULE_KEY = 'pocketworld:schedule:notebook:v1';
export const MAX_POSTED_SCHEDULES = 5;
export const SCHEDULE_FULL_MESSAGE = '主角：“玻璃已经贴满 5 张啦，先拿掉一张，再贴新的吧。”';
export interface SchedulePage {
  id: string;
  number: number;
  date: string;
  entries: [ScheduleEntry, ScheduleEntry];
}
export interface PaperBall { id: string; seed: number }
export interface ScheduleNotebook {
  version: 1;
  syncPending?: boolean;
  current: SchedulePage;
  posted: SchedulePage[];
  queued: SchedulePage[];
  discarded: PaperBall[];
}
const today = () => new Date().toLocaleDateString('sv-SE');
export function createSchedulePage(number: number): SchedulePage {
  const id = crypto.randomUUID();
  return { id, number, date: today(), entries: [0, 1].map(i => ({ id: `${id}-${i}`, time: '', title: '', content: '', completed: false })) as SchedulePage['entries'] };
}
export function migrateSchedule(entries: ScheduleEntry[] = []): ScheduleNotebook {
  const pages: SchedulePage[] = [];
  for (let i = 0; i < Math.max(1, entries.length); i += 2) {
    const page = createSchedulePage(pages.length + 1);
    entries.slice(i, i + 2).forEach((entry, index) => { page.entries[index] = { ...entry, content: entry.content ?? '' }; });
    pages.push(page);
  }
  return { version: 1, current: pages[0], posted: [], queued: pages.slice(1), discarded: [] };
}
export function isScheduleEntry(value: unknown): value is ScheduleEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ScheduleEntry;
  return typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.time === 'string' && typeof entry.completed === 'boolean' && (entry.content === undefined || typeof entry.content === 'string');
}
export function isScheduleNotebook(value: unknown): value is ScheduleNotebook {
  if (!value || typeof value !== 'object') return false;
  const state = value as ScheduleNotebook;
  const page = (p: SchedulePage) => p && typeof p.id === 'string' && Number.isSafeInteger(p.number) && p.number > 0 && typeof p.date === 'string' && Array.isArray(p.entries) && p.entries.length === 2 && p.entries.every(isScheduleEntry);
  if (state.version !== 1 || !page(state.current) || !Array.isArray(state.posted) || !state.posted.every(page) || !Array.isArray(state.queued) || !state.queued.every(page) || !Array.isArray(state.discarded) || !state.discarded.every(p => p && typeof p.id === 'string' && Number.isFinite(p.seed))) return false;
  const ids = [state.current, ...state.posted, ...state.queued].map(p => p.id);
  return new Set(ids).size === ids.length;
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
  return { ...state, posted: state.posted.filter(p => p.id !== id), discarded: [...state.discarded, { id, seed: page.number }].slice(-24) };
}
export function flattenSchedule(state: ScheduleNotebook): ScheduleEntry[] {
  return [...state.posted, state.current, ...state.queued].flatMap(page => page.entries);
}
