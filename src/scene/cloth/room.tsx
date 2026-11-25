import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame } from '@react-three/fiber';
import * as T from 'three';
import '../../styles.css';
import { App } from '../../App';
import { RoomExperiment } from './roomSlot';
import { garmentRegion, type Region } from './binding';
import { FixedClock, Xpbd, type ClothSolver } from './physics';

const url = new URL(location.href);
url.searchParams.set('view', 'cabin');
url.searchParams.set('outfit', 'ribbon');
history.replaceState(null, '', url);
const engine = url.searchParams.get('solver') ?? 'off';
const hz = url.searchParams.get('hz') === '30' ? 30 : 60;
type Factory = (r: Region) => Promise<ClothSolver>;
async function factory(): Promise<Factory> {
  if (engine === 'rapier') {
    const { makeRapier } = await import('./rapier');
    return (r) => makeRapier(r.profile, r.balls, true);
  }
  return async (r) => new Xpbd(r.profile);
}

function Probe({ make }: { make: Factory }) {
  const state = useRef<{
    mesh: T.SkinnedMesh;
    root: T.Object3D;
    solver?: ClothSolver;
    region?: Region;
    release(): void;
  }>();
  const clock = useRef(new FixedClock());
  const sample = useRef({ frames: 0, solve: 0, collision: 0, geometry: 0, advances: 0 });
  useEffect(() => {
    const clear = () => {
      clock.current.remainder = 0;
    };
    document.addEventListener('visibilitychange', clear);
    return () => {
      document.removeEventListener('visibilitychange', clear);
      state.current?.release();
      state.current = undefined;
    };
  }, []);
  useFrame(({ scene }, dt) => {
    let active = state.current;
    if (active) {
      let node: T.Object3D | null = active.mesh;
      while (node && node !== scene) node = node.parent;
      if (!node) {
        active.release();
        state.current = undefined;
        active = undefined;
        clock.current.remainder = 0;
      }
    }
    if (!active) {
      const root = scene.getObjectByName('OrbitalResident');
      let mesh: T.SkinnedMesh | undefined;
      root?.traverse((o) => {
        if (
          o instanceof T.SkinnedMesh &&
          !Array.isArray(o.material) &&
          o.material.name.includes('Ribbon jacket and painted face')
        )
          mesh = o;
      });
      if (!mesh) return;
      const target = mesh,
        geometry = mesh.geometry,
        material = mesh.material as T.MeshStandardMaterial;
      let release = () => {};
      if (engine !== 'off') {
        // Only this instance owns the attribute and shader; keep the wardrobe cache reusable.
        const g = geometry.clone(),
          m = material.clone();
        m.onBeforeCompile = material.onBeforeCompile;
        m.customProgramCacheKey = () => material.customProgramCacheKey();
        target.geometry = g;
        target.material = m;
        release = () => {
          target.geometry = geometry;
          target.material = material;
          g.dispose();
          m.dispose();
        };
      }
      active = {
        mesh,
        root: root!,
        release: () => {
          active?.solver?.dispose();
          release();
        },
      };
      state.current = active;
      if (engine !== 'off') {
        mesh.updateWorldMatrix(true, false);
        root!.updateMatrixWorld(true);
        active.region = garmentRegion(mesh, 'Left');
        const owned = active;
        make(active.region)
          .then((solver) => {
            if (state.current === owned) owned.solver = solver;
            else solver.dispose();
          })
          .catch((error) => {
            reportError(error);
          });
      }
    }
    const { region, solver } = active;
    if (document.hidden || (region && !solver)) return;
    const s = sample.current;
    s.frames++;
    if (region && solver) {
      // OrbitalResidents samples at priority -1. Bone matrices and shape keys are now final.
      active.root.updateWorldMatrix(true, false);
      active.root.updateMatrixWorld(true);
      region.sample(0);
      let stepped = false;
      clock.current.advance(dt, hz, (tick) => {
        for (let j = 0; j < 2; j++) {
          const before = performance.now();
          solver.step(tick / 2, region.targets, region.balls);
          s.solve += performance.now() - before;
          s.collision += solver.collisionMs ?? 0;
        }
        stepped = true;
        s.advances++;
      });
      if (stepped) {
        const bind = performance.now();
        region.bind(solver.positions);
        s.geometry += performance.now() - bind;
      }
    }
    Object.assign(window, { pwcsRoom: sample.current });
  }, -0.5);
  return null;
}

function Experiment() {
  const [make, setMake] = useState<Factory>();
  useEffect(() => {
    factory()
      .then((value) => setMake(() => value))
      .catch(reportError);
  }, []);
  return (
    <RoomExperiment.Provider value={make && <Probe make={make} />}>
      <App />
    </RoomExperiment.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Experiment />);
