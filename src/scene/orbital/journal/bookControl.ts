import type { Texture } from 'three';

export interface BoundBookControl {
  spread: number;
  cursor: number;
  ready: boolean;
  revision: number;
  textures: Map<number, Texture>;
  onSettled?: () => void;
  onPaperPointer?: (page: number, u: number, v: number, kind: 'down' | 'move' | 'up' | 'wheel', shift: boolean, delta?: number, pointer?: PointerEvent) => boolean | void;
}

export const createBookControl = (): BoundBookControl => ({ spread: 0, cursor: 0, ready: false, revision: 0, textures: new Map() });
