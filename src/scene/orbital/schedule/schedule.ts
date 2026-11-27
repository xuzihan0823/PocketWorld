import type { ScheduleEntry } from '../../../types/world';

export const SCHEDULE_KEY = 'pocketworld:schedule:notebook:v3';
export const SCHEDULE_ROWS = 8;
export const TODO_ROWS = 3;
export const TOMORROW_ROWS = 2;
export interface SchedulePage {
  id: string;
  number: number;
  date: string;
  entries: ScheduleEntry[];
  todos: { text: string; completed: boolean }[];
  tomorrow: string[];
  notes: string;
}
export interface PaperBall { id: string; seed: number }
export const PAPER_BALL_RADIUS = 0.08;
export const PAPER_BALL_Y = 0.105;
export function paperBallPosition(seed: number): [number, number, number] {
  return [0.25 + Math.sin(seed * 2.4) * 0.65, PAPER_BALL_Y, -0.68 + Math.cos(seed * 1.8) * 0.45];
}
export function paperBallBoxes(balls: readonly PaperBall[], inflate = 0): [number, number, number, number][] {
  const radius = PAPER_BALL_RADIUS + inflate;
  return balls.map(ball => {
    const [x, , z] = paperBallPosition(ball.seed);
    return [x - radius, x + radius, z - radius, z + radius];
  });
}
export interface ScheduleNotebook {
  version: 3;
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
  return { id, number, date: today(),
    entries: Array.from({ length: SCHEDULE_ROWS }, (_, i) => ({ id: `${id}-${i}`, time: `${String(8 + i * 2).padStart(2, '0')}:00`, title: '', content: '', completed: false })),
    todos: Array.from({ length: TODO_ROWS }, () => ({ text: '', completed: false })),
    tomorrow: Array(TOMORROW_ROWS).fill(''), notes: '' };
}
export function migrateSchedule(entries: ScheduleEntry[] = []): ScheduleNotebook {
  const pages: SchedulePage[] = [];
  for (let i = 0; i < Math.max(1, entries.length); i += SCHEDULE_ROWS) {
    const page = createSchedulePage(pages.length + 1);
    entries.slice(i, i + SCHEDULE_ROWS).forEach((entry, index) => { page.entries[index] = { ...entry, content: entry.content ?? '' }; });
    pages.push(page);
  }
  return { version: 3, current: pages[0], posted: [], queued: pages.slice(1), discarded: [] };
}
export function isScheduleEntry(value: unknown): value is ScheduleEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ScheduleEntry;
  return typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.time === 'string' && typeof entry.completed === 'boolean' && (entry.content === undefined || typeof entry.content === 'string');
}
function validNotebook(value: unknown, version: 1 | 2 | 3): value is ScheduleNotebook {
  if (!value || typeof value !== 'object') return false;
  const state = value as ScheduleNotebook;
  if (state.syncRemovedIds !== undefined && (!Array.isArray(state.syncRemovedIds) || !state.syncRemovedIds.every(id => typeof id === 'string'))) return false;
  const page = (p: SchedulePage) => p && typeof p.id === 'string' && Number.isSafeInteger(p.number) && p.number > 0 && typeof p.date === 'string' && Array.isArray(p.entries) && p.entries.length === (version === 1 ? 2 : version === 2 ? 17 : SCHEDULE_ROWS) && p.entries.every(isScheduleEntry)
    && (version === 1 || (Array.isArray(p.todos) && p.todos.length === (version === 2 ? 8 : TODO_ROWS) && p.todos.every(item => item && typeof item.text === 'string' && typeof item.completed === 'boolean') && Array.isArray(p.tomorrow) && p.tomorrow.length === (version === 2 ? 4 : TOMORROW_ROWS) && p.tomorrow.every(text => typeof text === 'string') && typeof p.notes === 'string'));
  if ((state.version as number) !== version || !page(state.current) || !Array.isArray(state.posted) || !state.posted.every(page) || !Array.isArray(state.queued) || !state.queued.every(page) || !Array.isArray(state.discarded) || !state.discarded.every(p => p && typeof p.id === 'string' && Number.isFinite(p.seed))) return false;
  const ids = [state.current, ...state.posted, ...state.queued].map(p => p.id);
  return new Set(ids).size === ids.length;
}
export function isScheduleNotebook(value: unknown): value is ScheduleNotebook { return validNotebook(value, 3); }
export function readScheduleNotebook(storage: Pick<Storage, 'getItem'>): ScheduleNotebook | null {
  const current = storage.getItem(SCHEDULE_KEY);
  const previous = storage.getItem('pocketworld:schedule:notebook:v2');
  const raw = current ?? previous ?? storage.getItem('pocketworld:schedule:notebook:v1');
  if (raw === null) return null;
  const saved: unknown = JSON.parse(raw);
  if (current !== null) {
    if (!isScheduleNotebook(saved)) throw new Error('日程存档格式无法读取，原始存档已保留。');
    return saved;
  }
  const version = previous !== null ? 2 : 1;
  if (!validNotebook(saved, version)) throw new Error('日程存档格式无法读取，原始存档已保留。');
  let number = Math.max(saved.current.number, ...saved.posted.map(page => page.number), ...saved.queued.map(page => page.number));
  const overflow: SchedulePage[] = [];
  const upgrade = (page: SchedulePage): SchedulePage => {
    const entries = page.entries.filter((entry, i) => entry.title.trim() || entry.content?.trim() || entry.completed ||
      (entry.time.trim() && entry.time !== (version === 2 ? `${String(i + 6).padStart(2, '0')}:00` : '')));
    const todos = (page.todos ?? []).filter(item => item.text.trim() || item.completed);
    const tomorrow = (page.tomorrow ?? []).filter(text => text.trim());
    const count = Math.max(1, Math.ceil(entries.length / SCHEDULE_ROWS), Math.ceil(todos.length / TODO_ROWS), Math.ceil(tomorrow.length / TOMORROW_ROWS));
    const pages = Array.from({ length: count }, (_, index) => {
      const next = createSchedulePage(index === 0 ? page.number : ++number);
      if (index === 0) next.id = page.id;
      next.date = page.date; next.notes = index === 0 ? page.notes ?? '' : '';
      entries.slice(index * SCHEDULE_ROWS, (index + 1) * SCHEDULE_ROWS).forEach((item, i) => { next.entries[i] = { ...item }; });
      todos.slice(index * TODO_ROWS, (index + 1) * TODO_ROWS).forEach((item, i) => { next.todos[i] = { ...item }; });
      tomorrow.slice(index * TOMORROW_ROWS, (index + 1) * TOMORROW_ROWS).forEach((item, i) => { next.tomorrow[i] = item; });
      return next;
    });
    overflow.push(...pages.slice(1));
    return pages[0];
  };
  const upgraded = { ...saved, version: 3 as const, current: upgrade(saved.current), posted: saved.posted.map(upgrade), queued: saved.queued.map(upgrade) };
  return { ...upgraded, queued: [...upgraded.queued, ...overflow] };
}
export function tearSchedulePage(state: ScheduleNotebook): ScheduleNotebook {
  const nextNumber = Math.max(state.current.number, ...state.posted.map(page => page.number), ...state.queued.map(page => page.number)) + 1;
  return { ...state,
    current: state.queued[0] ?? createSchedulePage(nextNumber),
    queued: state.queued.slice(1),
    discarded: [...state.discarded, { id: state.current.id, seed: state.current.number }].slice(-24) };
}
export function openSchedulePage(state: ScheduleNotebook): ScheduleNotebook {
  const pages = [state.current, ...state.queued].sort((a, b) => a.number - b.number);
  if (pages[0].id === state.current.id) return state;
  return { ...state, current: pages[0], queued: pages.slice(1) };
}
export function updateSchedulePage(state: ScheduleNotebook, page: SchedulePage): ScheduleNotebook {
  return state.current.id === page.id ? { ...state, current: page }
    : { ...state, queued: state.queued.map(draft => draft.id === page.id ? page : draft) };
}
export function turnSchedulePage(state: ScheduleNotebook, direction: -1 | 1): ScheduleNotebook {
  const pages = [state.current, ...state.queued].sort((a, b) => a.number - b.number);
  const index = pages.findIndex(page => page.id === state.current.id) + direction;
  if (index < 0 || (!pages[index] && pages.length >= 32)) return state;
  const current = pages[index] ?? createSchedulePage(Math.max(...pages.map(page => page.number), ...state.posted.map(page => page.number)) + 1);
  return { ...state, current, queued: pages.filter(page => page.id !== current.id) };
}
export function discardSchedulePage(state: ScheduleNotebook, id: string): ScheduleNotebook {
  const page = state.posted.find(p => p.id === id);
  if (!page) return state;
  return { ...state, posted: state.posted.filter(p => p.id !== id), discarded: [...state.discarded, { id, seed: page.number }].slice(-24) };
}
export function flattenSchedule(state: ScheduleNotebook): ScheduleEntry[] {
  return [...state.posted, state.current, ...state.queued].flatMap(page => page.entries);
}
