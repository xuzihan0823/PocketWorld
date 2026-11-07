export type TrailId = 'valley' | 'forest' | 'night';
export type Partner = 'slide' | 'charge';
export type GamePhase = 'home' | 'select' | 'playing' | 'paused' | 'over';
export interface Trail {
  id: TrailId; name: string; subtitle: string; sky: string; mountain: string;
  pine: string; snow: string; accent: string; baseSpeed: number;
}
export const TRAILS: Trail[] = [
  { id: 'valley', name: '初晴雪谷', subtitle: '开阔缓坡 · 从第一次起跳开始', sky: '#CFE8F3', mountain: '#9DBECF', pine: '#24535B', snow: '#F7FCFF', accent: '#B75435', baseSpeed: 245 },
  { id: 'forest', name: '暮色松林', subtitle: '穿行松林 · 跳跃与收身的节奏', sky: '#EFC9C5', mountain: '#AE98AE', pine: '#3F505D', snow: '#FFF6EF', accent: '#933F52', baseSpeed: 265 },
  { id: 'night', name: '极夜冰原', subtitle: '追着极光 · 更快的冰面与飞跃', sky: '#202E50', mountain: '#405A79', pine: '#223E50', snow: '#E9F5FB', accent: '#8CE2CC', baseSpeed: 285 },
];
export interface SkiInput { jump: boolean; jumpPressed: boolean; tuck: boolean; tilt: number }
export const emptyInput = (): SkiInput => ({ jump: false, jumpPressed: false, tuck: false, tilt: 0 });
export interface SkiPlayer {
  x: number; y: number; vy: number; speed: number; angle: number;
  grounded: boolean; airTime: number; rotation: number; flipping: boolean; tucked: boolean;
  crashTime: number; invulnerable: number; coyote: number; jumpBuffer: number;
  partner: Partner | null; partnerLeft: number; shield: boolean; squash: number;
}
export type FeatureKind = 'rock' | 'branch' | 'ramp' | 'ice' | 'gap' | 'coin' | 'slide' | 'charge';
export interface Feature { id: number; kind: FeatureKind; x: number; width: number; y: number; used: boolean }
export interface Chaser { x: number; offset: number; lane: number; phase: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string }
export type SkiEvent = 'flip' | 'crash' | 'caught' | 'mount' | 'land' | 'coin';
export interface SkiState {
  trail: TrailId; time: number; player: SkiPlayer; chasers: Chaser[]; features: Feature[];
  particles: Particle[]; distance: number; coins: number; flips: number; combo: number;
  bonus: number; score: number; over: boolean; caughtTime: number; cameraY: number;
  nextSegment: number; nextId: number; message: string; messageTime: number; events: SkiEvent[];
}
export interface RenderOptions { phase: GamePhase; reducedMotion: boolean }
