import type { JournalEntry, JournalPage } from '../../../types/world';

const BOOK_KEY = 'pocketworld:journal:book:v1';
const ENTRIES_KEY = 'pocketworld:journal:entries:v1';
const TODAY_KEY = 'pocketworld:journal:today';

export const todayDate = () => new Date().toLocaleDateString('sv-SE');

export function emptyJournal(): JournalEntry {
  return { id: 'today', date: todayDate(), text: '', updatedAt: '' };
}

function readJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  const raw = storage.getItem(key);
  try { return raw === null ? null : JSON.parse(raw); }
  catch { return null; }
}

function isEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<JournalEntry>;
  return typeof entry.id === 'string' && typeof entry.date === 'string' &&
    typeof entry.text === 'string' && typeof entry.updatedAt === 'string';
}

export function journalPages(entry: JournalEntry): JournalPage[] {
  const pages = Array.isArray(entry.pages) ? entry.pages.filter(page => page && typeof page.text === 'string') : [];
  return pages.length ? pages : [{ text: entry.text, date: entry.date }];
}

export function loadLocalJournal(storage: Pick<Storage, 'getItem'>): JournalEntry {
  const saved = readJson(storage, BOOK_KEY);
  if (isEntry(saved)) return saved;

  const entries = readJson(storage, ENTRIES_KEY);
  const legacy = readJson(storage, TODAY_KEY) as Partial<JournalEntry> | null;
  const previous = legacy && typeof legacy.text === 'string' ? {
    id: typeof legacy.id === 'string' ? legacy.id : 'today',
    date: typeof legacy.date === 'string' ? legacy.date : todayDate(),
    text: legacy.text,
    updatedAt: typeof legacy.updatedAt === 'string' ? legacy.updatedAt : '',
    pages: legacy.pages,
  } : null;
  const history = Array.isArray(entries) ? entries.filter(isEntry) : [];
  if (!previous) {
    return history.length ? { ...history[0], pages: history.flatMap(journalPages) } : emptyJournal();
  }

  const matching = history.findIndex(entry => entry.id === previous.id ||
    (entry.date === previous.date && entry.text === previous.text));
  if (matching !== -1) {
    const stored = history[matching];
    if (previous.pages?.length) {
      history[matching] = previous.updatedAt >= stored.updatedAt ? previous : {
        ...stored, pages: [{ text: stored.text, date: stored.date }, ...journalPages(previous).slice(1)],
      };
    } else if (previous.updatedAt > stored.updatedAt) history[matching] = previous;
  } else if (previous.text || previous.pages?.length || !history.length) {
    history.push(previous);
  }
  return { ...history[0], pages: history.flatMap(journalPages) };
}

export function saveLocalJournal(storage: Pick<Storage, 'setItem'>, entry: JournalEntry) {
  storage.setItem(BOOK_KEY, JSON.stringify(entry));
}
