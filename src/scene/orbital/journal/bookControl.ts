import { Vector3, type Texture } from 'three';

export interface BoundBookControl {
  spread: number;
  cursor: number;
  ready: boolean;
  revision: number;
  textures: Map<number, Texture>;
  hand: { side: number; reach: number; grip: number; point: Vector3; normal: Vector3 };
  onSettled?: () => void;
  onPaperPointer?: (page: number, u: number, v: number, kind: 'down' | 'move' | 'up' | 'wheel', shift: boolean, delta?: number, pointer?: PointerEvent) => boolean | void;
}

export const createBookControl = (): BoundBookControl => ({
  spread: 0, cursor: 0, ready: false, revision: 0, textures: new Map(),
  hand: { side: 0, reach: 0, grip: 0, point: new Vector3(), normal: new Vector3() },
});
