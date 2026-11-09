import React, { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fitComputerDisplay, fitExpandedDisplay } from './screen-layout';

const viewportCenter = (_object: THREE.Object3D, _camera: THREE.Camera, size: { width: number; height: number }): number[] => [size.width / 2, size.height / 2];

/** Keep one mounted game; project only its bounds, so DOM text has no CSS 3D scaling. */
export function ComputerScreen({ visible, interactive, expanded = false, collapsed = false, controls = false, allowEmbeddedResume = true, onExpand, onCollapse, onResume, onEject, children }: {
  visible: boolean; interactive: boolean; expanded?: boolean; collapsed?: boolean; controls?: boolean; allowEmbeddedResume?: boolean;
  onExpand?: () => void; onCollapse?: () => void; onResume?: () => void; onEject?: () => void; children: React.ReactNode;
}): React.ReactElement {
  const anchor = useRef<THREE.Group>(null), surface = useRef<HTMLDivElement>(null), previous = useRef('');
  const available = useRef<HTMLDivElement>(null);
  const corners = useMemo(() => [new THREE.Vector3(-.46, .345, 0), new THREE.Vector3(.46, .345, 0), new THREE.Vector3(-.46, -.345, 0), new THREE.Vector3(.46, -.345, 0)], []);
  const projected = useMemo(() => corners.map(() => new THREE.Vector3()), [corners]);
  useFrame(({ camera, size }) => {
    const node = surface.current, object = anchor.current;
    if (!node || !object) return;
    if (!visible) { if (node.style.display !== 'none') node.style.display = 'none'; previous.current = ''; return; }
    camera.updateMatrixWorld(); object.updateWorldMatrix(true, false);
    projected.forEach((p, i) => { p.copy(corners[i]).applyMatrix4(object.matrixWorld).project(camera); p.set((p.x + 1) * size.width / 2, (1 - p.y) * size.height / 2, p.z); });
    const bounds = available.current?.getBoundingClientRect();
    const rect = expanded && bounds ? fitExpandedDisplay(bounds) : fitComputerDisplay(projected, size);
    if (!rect) { node.style.display = 'none'; previous.current = ''; return; }
    const key = `${rect.left}/${rect.top}/${rect.width}/${rect.height}`;
    if (key !== previous.current) {
      Object.assign(node.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      previous.current = key;
    }
  });
  return <group ref={anchor} position={[1.55, 1.68, -2.35]}>
    {/* Html caches z-index while its anchor is still; keep this layer above room HUDs in both modes. */}
    <Html fullscreen calculatePosition={viewportCenter} zIndexRange={[30, 30]} style={{ pointerEvents: 'none' }}>
      <div className="computer-game-layer" data-expanded={expanded} style={{ display: visible ? 'block' : 'none' }} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
        {expanded && <div className="computer-game-backdrop" />}
        <div ref={available} className="computer-game-available" aria-hidden="true" />
        {controls && <nav className="computer-game-controls" aria-label="游戏显示控制">
          {expanded ? <button onClick={onCollapse}>回到电脑</button> : <button onClick={onExpand}>放大游戏</button>}
          {collapsed && allowEmbeddedResume && <button onClick={onResume}>在电脑上继续</button>}
          <button onClick={onEject}>拔出卡带</button>
        </nav>}
      <div ref={surface} data-computer-display="native" style={{ position: 'absolute', display: 'none', overflow: 'hidden', borderRadius: expanded ? 0 : 10, background: '#142d27', color: '#d8e6b9', fontFamily: 'system-ui, sans-serif', fontSize: 16, pointerEvents: interactive ? 'auto' : 'none', touchAction: 'auto' }}>
        {children}
      </div>
      </div>
    </Html>
  </group>;
}
