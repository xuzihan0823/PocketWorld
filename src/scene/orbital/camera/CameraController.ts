import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, Spherical, Vector2, Vector3, type Box3, type PerspectiveCamera } from 'three';
import { perspectiveHalfHeight } from './CameraTransition.ts';

export const CAMERA_POLAR_LIMITS = { minimum: .055, maximum: Math.PI - .055, softZone: .22 };

export interface CameraControlOptions {
  enabled: boolean;
  panBounds: Box3 | null;
  isOrthographic: () => boolean;
  minDistance: () => number;
  maxDistance: number;
  minZoom: number;
  maxZoom: number;
  reducedMotion: boolean;
  onInput: () => void;
}

export function useCameraController(element: HTMLCanvasElement, camera: PerspectiveCamera, options: CameraControlOptions) {
  const latest = useRef(options);
  latest.current = options;
  const control = useMemo(() => {
    const target = new Vector3();
    const rotate = new Vector2(), pan = new Vector2();
    const polar = new Spherical();
    const eye = new Vector3(), axis = new Vector3(), last = new Vector3();
    let zoom = 0;
    return {
      target, rotate, pan,
      addZoom(amount: number) { zoom += amount; },
      clear() { rotate.set(0, 0); pan.set(0, 0); zoom = 0; },
      update(delta: number) {
        const { enabled, isOrthographic, minDistance, maxDistance, minZoom, maxZoom, panBounds, reducedMotion } = latest.current;
        if (!enabled || rotate.lengthSq() + pan.lengthSq() + Math.abs(zoom) < 1e-5) { this.clear(); return; }
        const part = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .06) * 25);
        const height = Math.max(1, element.clientHeight);
        polar.setFromVector3(eye.subVectors(camera.position, target));
        polar.theta -= rotate.x * part * Math.PI * 2 / height;
        const polarChange = -rotate.y * part * Math.PI * 2 / height;
        const { minimum, maximum, softZone } = CAMERA_POLAR_LIMITS;
        const room = polarChange < 0 ? polar.phi - minimum : maximum - polar.phi;
        const resistance = polarChange === 0 ? 1 : MathUtils.clamp(room / softZone, .2, 1);
        polar.phi = MathUtils.clamp(polar.phi + polarChange * resistance, minimum, maximum);
        if (isOrthographic()) {
          camera.zoom = MathUtils.clamp(camera.zoom * Math.exp(-zoom * part), minZoom, maxZoom);
        } else if (zoom !== 0) {
          polar.radius = MathUtils.clamp(polar.radius * Math.exp(zoom * part), minDistance(), maxDistance);
        }
        if (panBounds && pan.lengthSq() > 0) {
          const scale = 2 * perspectiveHalfHeight(camera, polar.radius) * part / height;
          last.copy(target);
          target.addScaledVector(axis.set(1, 0, 0).applyQuaternion(camera.quaternion), -pan.x * scale);
          target.addScaledVector(axis.set(0, 1, 0).applyQuaternion(camera.quaternion), pan.y * scale);
          // Presets may place the pivot on an edge. Keep the previous position if the gesture moves farther out.
          target.x = MathUtils.clamp(target.x, Math.min(last.x, panBounds.min.x), Math.max(last.x, panBounds.max.x));
          target.y = MathUtils.clamp(target.y, Math.min(last.y, panBounds.min.y), Math.max(last.y, panBounds.max.y));
          target.z = MathUtils.clamp(target.z, Math.min(last.z, panBounds.min.z), Math.max(last.z, panBounds.max.z));
        }
        camera.position.setFromSpherical(polar).add(target);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        rotate.multiplyScalar(1 - part);
        pan.multiplyScalar(1 - part);
        zoom *= 1 - part;
      },
    };
  }, [camera, element]);

  useEffect(() => {
    interface HeldPointer { startX: number; startY: number; x: number; y: number; button: number; touch: boolean }
    const pointers = new Map<number, HeldPointer>();
    let dragging = false;
    const cancel = () => { pointers.clear(); dragging = false; control.clear(); };
    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) dragging = false;
    };
    const down = (event: PointerEvent) => {
      if (!latest.current.enabled || (event.button !== 0 && (event.button !== 2 || !latest.current.panBounds))) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, button: event.button, touch: event.pointerType === 'touch' });
    };
    const move = (event: PointerEvent) => {
      const point = pointers.get(event.pointerId);
      if (!point || !latest.current.enabled) return;
      const other = point.touch ? [...pointers].find(([id, p]) => id !== event.pointerId && p.touch)?.[1] : undefined;
      const dx = event.clientX - point.x, dy = event.clientY - point.y;
      const lastDistance = other ? Math.hypot(point.x - other.x, point.y - other.y) : 0;
      point.x = event.clientX;
      point.y = event.clientY;
      if (!dragging) {
        if (Math.hypot(point.x - point.startX, point.y - point.startY) <= (other ? 10 : 6)) return;
        dragging = true;
        latest.current.onInput();
      }
      if (other) {
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (lastDistance > 5 && distance > 5) control.addZoom(Math.log(lastDistance / distance));
        if (latest.current.panBounds) { control.pan.x += dx / 2; control.pan.y += dy / 2; }
      } else if (point.button === 2 && latest.current.panBounds) {
        control.pan.x += dx;
        control.pan.y += dy;
      } else if (point.button === 0) {
        control.rotate.x += dx;
        control.rotate.y += dy;
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!latest.current.enabled || event.deltaY === 0) return;
      event.preventDefault();
      latest.current.onInput();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      control.addZoom(MathUtils.clamp(pixels * .00145, -.32, .32));
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [control, element]);
  return control;
}
