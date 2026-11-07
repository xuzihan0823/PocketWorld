import type { MutableRefObject } from 'react';
import type { MusicDisc } from './interactable';

export type WorldSceneId = 'habitat' | 'observatory';
export type WorldActionKind = 'inspect' | 'open' | 'close' | 'read' | 'write' | 'plan' | 'sleep' | 'wake' | 'toggle' | 'select' | 'insert' | 'eject' | 'water' | 'pet' | 'travel' | 'turn-page' | 'sit' | 'stand';
export type WorldPhase = 'idle' | 'preparing' | 'leaving' | 'entering' | 'active' | 'returning' | 'error';
export interface WorldAction {
  sceneId: WorldSceneId;
  objectId: string;
  kind: WorldActionKind;
  payload?: { itemId?: string; direction?: number; destination?: WorldSceneId; value?: number };
}
export interface WorldObjectState {
  open: boolean;
  active: boolean;
  page: number;
  value: number;
  itemId?: string;
}
export const CLOSED_OBJECT: Readonly<WorldObjectState> = { open: false, active: false, page: 0, value: 0 };
export interface WorldTransition {
  id: number;
  phase: WorldPhase;
  action: WorldAction | null;
  fromScene: WorldSceneId;
  toScene: WorldSceneId;
}
export interface WorldMotion { progress: number; sceneProgress: number }
export interface WorldModelProps {
  sceneId: WorldSceneId;
  objects: Record<string, WorldObjectState>;
  books: BookContent[];
  focusedObject: string | null;
  onAction: (action: WorldAction) => void;
  onHover: (id: string | null, hint?: string) => void;
  onGesture: (active: boolean) => void;
  reducedMotion: boolean;
}
export interface WorldSceneProps extends WorldModelProps {
  transition: WorldTransition;
  motion: MutableRefObject<WorldMotion>;
  onReturn: () => void;
  onAddBook: (title: string, author: string, text: string) => BookContent | null;
  onImportMusic: () => void;
  onSelectDisc: (disc: MusicDisc) => void;
  onToggleMusic: () => void;
  onToggleMute: () => void;
  discs: MusicDisc[];
  activeDisc: MusicDisc;
  isMusicPlaying: boolean;
  isMuted: boolean;
  activeGame: 'mario' | 'shooter' | null;
  onGameChange: (game: 'mario' | 'shooter' | null) => void;
  onFeatureError: (message: string) => void;
  adapters?: WorldFeatureAdapters;
}
export interface WorldActionContext {
  action: WorldAction;
  signal: AbortSignal;
  transitionId: number;
  previous: Readonly<WorldObjectState>;
}
export interface WorldActionAdapter {
  prepare?: (context: WorldActionContext) => void | Promise<void>;
  commit?: (context: WorldActionContext) => void | Promise<void>;
  cancel?: (context: WorldActionContext) => void;
}
export interface JournalEntry { id: string; date: string; text: string; updatedAt: string }
export interface ScheduleEntry { id: string; time: string; title: string; completed: boolean; content?: string }
export interface BookContent { id: string; title: string; author?: string; pages: string[] }
export interface SleepSession { startedAt: string; endedAt?: string; sceneId: WorldSceneId }
/** Optional content providers. Geometry and gesture code never depend on a backend. */
export interface WorldFeatureAdapters {
  actions?: Partial<Record<WorldActionKind, WorldActionAdapter>>;
  journal?: { load: (signal: AbortSignal) => Promise<JournalEntry>; save: (entry: JournalEntry, signal: AbortSignal) => Promise<void> };
  schedule?: { load: (signal: AbortSignal) => Promise<ScheduleEntry[]>; save: (entries: ScheduleEntry[], signal: AbortSignal) => Promise<void> };
  library?: { loadBook: (id: string, signal: AbortSignal) => Promise<BookContent>; saveBookmark?: (id: string, page: number, signal: AbortSignal) => Promise<void> };
  sleep?: { onFallAsleep?: (session: SleepSession, signal: AbortSignal) => void | Promise<void>; onWake?: (session: SleepSession, signal: AbortSignal) => void | Promise<void> };
}
export const SCENE_ORIGINS: Record<WorldSceneId, [number, number, number]> = { habitat: [0, 0, 0], observatory: [14, 0, 0] };
