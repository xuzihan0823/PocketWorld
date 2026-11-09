import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SecondaryMotion, type SecondaryOptions } from './SecondaryMotion';
import './resident-lab.css';

type Clip = 'Rest' | 'Walk' | 'ArmsUp' | 'Sit' | 'LieDown';
interface LabControls {
  pose: Clip; playing: boolean; moving: boolean; debug: boolean; options: SecondaryOptions;
}
interface LabApi {
  ready: boolean; clips: string[]; setPose: (name: Clip, time?: number) => void;
  configure: (options: Partial<SecondaryOptions>) => void;
  advance: (seconds: number, fps?: number) => ReturnType<SecondaryMotion['snapshot']>;
  snapshot: () => ReturnType<SecondaryMotion['snapshot']>;
  render: () => void; setAutomatic: (automatic: boolean) => void;
  camera: (side: 'front' | 'side' | 'back' | 'threeQuarter', close?: boolean) => void;
  meshAudit: () => { finite: boolean; triangles: number; bones: number; vertices: number };
  surfaceContacts: () => Record<string, { vertices: number; penetrating: number; maxDepth: number }>;
  performance: () => { meanMs: number; maxMs: number; samples: number };
}
declare global { interface Window { residentAudit?: LabApi } }

const poses: [Clip, string][] = [['Rest', '站立'], ['Walk', 'Walk'], ['ArmsUp', '双臂上举'], ['Sit', '坐下'], ['LieDown', '躺下']];

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); skeletons.forEach(value => value.dispose());
}

export default function ResidentLab() {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<LabApi>();
  const [status, setStatus] = useState('正在加载角色与四段测试动画…');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [config, setConfig] = useState<LabControls>(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { pose: reduced ? 'Rest' : 'Walk', playing: !reduced, moving: !reduced, debug: false,
      options: { hair: !reduced, dress: !reduced, collisions: true } };
  });
  const live = useRef(config); live.current = config;

  useEffect(() => {
    const container = host.current!;
    let cancelled = false, frame = 0, automatic = true;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setFailed(true); setStatus('无法启动 WebGL，请检查浏览器的硬件加速设置。'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor('#e8edf3');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.append(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '可拖动旋转的角色动作预览');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, .48, 0); controls.minDistance = .65; controls.maxDistance = 3.5;
    let cameraPose: Clip = 'Rest', underside = false;
    const setCamera = (side: 'front' | 'side' | 'back' | 'threeQuarter', close = false) => {
      underside = close && cameraPose === 'LieDown' && side === 'back';
      if (close) {
        const lying = cameraPose === 'LieDown', sitting = cameraPose === 'Sit';
        controls.target.set(0, lying ? .16 : sitting ? .40 : .75, 0);
        const distance = lying ? 1.65 : sitting ? 1.42 : .88;
        const target = controls.target;
        if (lying && side !== 'side' && side !== 'threeQuarter') camera.position.set(0, target.y + (side === 'front' ? distance : -distance), .001);
        else camera.position.set(side === 'front' || side === 'back' ? 0 : distance,
          target.y + .04, side === 'front' ? distance : side === 'back' ? -distance : side === 'side' ? 0 : distance);
        controls.update(); return;
      }
      controls.target.set(0, cameraPose === 'LieDown' ? .16 : cameraPose === 'Sit' ? .38 : .53, 0);
      const y = controls.target.y + .20;
      const positions = { front: [0, y, 2.15], side: [2.15, y, 0], back: [0, y, -2.15], threeQuarter: [1.05, y + .08, 1.9] };
      camera.position.fromArray(positions[side]); controls.update();
    };
    setCamera('threeQuarter');
    scene.add(new THREE.HemisphereLight('#f5f9ff', '#9596a5', 2.6));
    const key = new THREE.DirectionalLight('#fff3e7', 2.8); key.position.set(1, 2, 3); scene.add(key);
    const fill = new THREE.DirectionalLight('#c8e0ff', 1.6); fill.position.set(-2, 1, -1); scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: '#dce4ed', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.009; scene.add(floor);
    const grid = new THREE.GridHelper(3, 30, '#b0bdcd', '#cbd6e2'); scene.add(grid);
    const markerMaterial = new THREE.MeshStandardMaterial({ color: '#8998b0', transparent: true, opacity: .25, depthWrite: false });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(.34, .025, .3), markerMaterial); seat.position.set(0, .235, -.04); scene.add(seat);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(.50, .03, 1.1), markerMaterial); bed.position.set(0, .01, -.01); scene.add(bed);
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let secondary: SecondaryMotion | undefined, mixer: THREE.AnimationMixer | undefined, asset: THREE.Group | undefined;
    let cleanupVisibility = () => {};
    setFailed(false); setStatus('正在加载角色与四段测试动画…');
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/resident/luna-tripo-dynamics.glb`).then(gltf => {
      if (cancelled) { disposeScene(gltf.scene); return; }
      asset = gltf.scene;
      const mover = new THREE.Group(); mover.add(asset); scene.add(mover);
      const meshes: THREE.SkinnedMesh[] = [];
      asset.traverse(object => { if (object instanceof THREE.SkinnedMesh) { object.frustumCulled = false; meshes.push(object); } });
      mixer = new THREE.AnimationMixer(asset);
      secondary = new SecondaryMotion(asset);
      secondary.configure(live.current.options);
      const motion = secondary, animation = mixer;
      const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
      for (const name of ['Walk', 'ArmsUp', 'Sit', 'LieDown']) if (!clips.has(name)) throw new Error(`GLB 缺少 ${name} 测试动作`);
      const debug = new THREE.Group(); scene.add(debug);
      for (const capsule of motion.capsules) {
        const shape = new THREE.Mesh(new THREE.CapsuleGeometry(capsule.radius, capsule.a.distanceTo(capsule.b), 4, 8),
          new THREE.MeshBasicMaterial({ color: '#ca6f40', wireframe: true, transparent: true, opacity: .45, depthTest: false }));
        debug.add(shape);
      }
      const axis = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
      let time = 0, activePose: Clip = 'Rest', action: THREE.AnimationAction | undefined;
      let movingWas = live.current.moving, driftStart = 0, driftOrigin = 0;
      const stats: number[] = [];
      function selectPose(name: Clip, at = 0) {
        motion.reset(); animation.stopAllAction();
        for (const mesh of meshes) mesh.skeleton.pose();
        mover.position.set(0, 0, 0); time = 0; driftStart = 0; driftOrigin = 0;
        movingWas = live.current.moving;
        action = name === 'Rest' ? undefined : animation.clipAction(clips.get(name)!);
        if (action) { action.reset().play(); action.time = at; animation.update(0); }
        activePose = name;
        cameraPose = name;
        underside = false;
        const targetY = name === 'LieDown' ? .16 : name === 'Sit' ? .38 : .53;
        camera.position.y += targetY - controls.target.y; controls.target.y = targetY; controls.update();
        // Capture the freshly sampled clip before the first physics tick restores its base.
        motion.captureBasePose();
        motion.advance(motion.fixedStep, () => {});
        render();
      }
      function baseStep(dt: number) {
        if (live.current.playing) time += dt;
        if (live.current.playing) animation.update(dt);
        if (live.current.moving !== movingWas) {
          movingWas = live.current.moving; driftStart = time; driftOrigin = mover.position.x;
        }
        if (movingWas && live.current.playing) mover.position.x = driftOrigin + .14 * Math.sin((time - driftStart) * 2.2);
      }
      function render() {
        floor.visible = grid.visible = !underside;
        seat.visible = activePose === 'Sit'; bed.visible = activePose === 'LieDown';
        if (underside) bed.visible = false;
        debug.visible = live.current.debug;
        if (debug.visible) for (let i = 0; i < motion.capsules.length; i++) {
          const c = motion.capsules[i], shape = debug.children[i];
          shape.position.copy(c.a).lerp(c.b, .5); direction.copy(c.b).sub(c.a).normalize();
          shape.quaternion.setFromUnitVectors(axis, direction);
        }
        renderer.render(scene, camera);
      }
      const lab: LabApi = { ready: true, clips: [...clips.keys()], setPose: selectPose,
        configure: options => motion.configure(options),
        setAutomatic: enabled => { automatic = enabled; },
        advance: (seconds, fps = 60) => { for (let i = 0; i < Math.round(seconds * fps); i++) motion.advance(1 / fps, baseStep); render(); return motion.snapshot(); },
        snapshot: () => motion.snapshot(), render,
        camera: (side, close) => { setCamera(side, close); render(); },
        performance: () => ({ meanMs: stats.reduce((a, b) => a + b, 0) / Math.max(1, stats.length), maxMs: Math.max(0, ...stats), samples: stats.length }),
        meshAudit: () => {
          const v = new THREE.Vector3(); let finite = true, vertices = 0, triangles = 0;
          for (const mesh of meshes) {
            mesh.skeleton.update(); const p = mesh.geometry.attributes.position;
            vertices += p.count; triangles += (mesh.geometry.index?.count ?? p.count) / 3;
            for (let i = 0; i < p.count; i++) { mesh.getVertexPosition(i, v); finite &&= v.toArray().every(Number.isFinite); }
          }
          return { finite, vertices, triangles, bones: meshes[0].skeleton.bones.length };
        },
        surfaceContacts: () => {
          const result = { hair: { vertices: 0, penetrating: 0, maxDepth: 0 }, dress: { vertices: 0, penetrating: 0, maxDepth: 0 } };
          const point = new THREE.Vector3(), axis = new THREE.Vector3(), closest = new THREE.Vector3();
          for (const mesh of meshes) {
            mesh.skeleton.update(); const attributes = mesh.geometry.attributes;
            for (let i = 0; i < attributes.position.count; i++) {
              const indices = attributes.skinIndex, weights = attributes.skinWeight;
              let part: 'hair' | 'dress' | undefined;
              for (let j = 0; j < 4; j++) if (weights.getComponent(i, j) > .01) {
                const name = mesh.skeleton.bones[indices.getComponent(i, j)].name;
                if (name.startsWith('Hair_')) part = 'hair';
                if (name.startsWith('Dress_')) part = 'dress';
              }
              if (!part) continue;
              mesh.getVertexPosition(i, point); mesh.localToWorld(point);
              let depth = 0;
              for (const c of motion.capsules) if (c.parts.includes(part)) {
                axis.copy(c.b).sub(c.a);
                const t = THREE.MathUtils.clamp(closest.copy(point).sub(c.a).dot(axis) / Math.max(axis.lengthSq(), 1e-12), 0, 1);
                closest.copy(c.a).addScaledVector(axis, t);
                depth = Math.max(depth, c.radius - point.distanceTo(closest));
              }
              result[part].vertices++;
              if (depth > .001) result[part].penetrating++;
              result[part].maxDepth = Math.max(result[part].maxDepth, depth);
            }
          }
          return result;
        } };
      api.current = window.residentAudit = lab;
      selectPose(live.current.pose);
      setStatus(`103 根骨骼 · 50 根辅助骨骼 · ${gltf.animations.length} 段 Blender 测试动作`);
      let previous = performance.now();
      const visibility = () => { motion.reset(); previous = performance.now(); };
      document.addEventListener('visibilitychange', visibility);
      cleanupVisibility = () => document.removeEventListener('visibilitychange', visibility);
      function tick(now: number) {
        if (cancelled) return;
        const delta = (now - previous) / 1000; previous = now;
        if (automatic && !document.hidden) {
          if (activePose !== live.current.pose) selectPose(live.current.pose);
          motion.configure(live.current.options);
          const start = performance.now(); motion.advance(delta, baseStep);
          if (stats.length === 600) stats.shift(); stats.push(performance.now() - start);
          render();
        }
        frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    }).catch(error => { if (!cancelled) { setFailed(true); setStatus(`加载失败：${error.message}`); } });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); cleanupVisibility(); controls.dispose();
      secondary?.dispose(); mixer?.stopAllAction(); if (asset) mixer?.uncacheRoot(asset);
      disposeScene(scene); grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      if (window.residentAudit === api.current) delete window.residentAudit; api.current = undefined;
    };
  }, [retry]);

  const option = (name: keyof SecondaryOptions, value: boolean) => setConfig(c => ({ ...c, options: { ...c.options, [name]: value } }));
  return <main className="resident-lab">
    <div className="resident-lab-view" ref={host} />
    <aside className="resident-lab-panel">
      <p className="resident-lab-kicker">POCKETWORLD · 角色实验室</p>
      <h1>长发与裙摆动态</h1>
      <p role={failed ? 'alert' : 'status'}>{status}</p>
      {failed && <button onClick={() => setRetry(n => n + 1)}>重新加载</button>}
      <label>测试动作<select value={config.pose} onChange={e => setConfig(c => ({ ...c, pose: e.target.value as Clip }))}>
        {poses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><input type="checkbox" checked={config.options.hair} onChange={e => option('hair', e.target.checked)} />头发动态</label>
      <label><input type="checkbox" checked={config.options.dress} onChange={e => option('dress', e.target.checked)} />裙摆动态</label>
      <label><input type="checkbox" checked={config.options.collisions} onChange={e => option('collisions', e.target.checked)} />身体碰撞约束</label>
      <label><input type="checkbox" checked={config.moving} onChange={e => setConfig(c => ({ ...c, moving: e.target.checked }))} />身体往返移动</label>
      <label><input type="checkbox" checked={config.debug} onChange={e => setConfig(c => ({ ...c, debug: e.target.checked }))} />显示碰撞体</label>
      <div className="resident-lab-actions">
        <button onClick={() => setConfig(c => ({ ...c, playing: !c.playing }))}>{config.playing ? '暂停动作' : '播放动作'}</button>
        <button onClick={() => setConfig(c => ({ ...c, options: { hair: false, dress: false, collisions: false } }))}>静态对比</button>
        <button onClick={() => setConfig(c => ({ ...c, options: { hair: true, dress: true, collisions: true } }))}>启用动态</button>
      </div>
      <label>检查时刻<input aria-label="检查时刻" type="range" min="0" max={config.pose === 'Walk' ? '1.2' : '4'} step=".01" defaultValue="0"
        onChange={e => { setConfig(c => ({ ...c, playing: false, moving: false })); api.current?.setPose(config.pose, Number(e.target.value)); }} /></label>
      <div className="resident-lab-actions">
        <button onClick={() => api.current?.camera('front', true)}>正面近景</button>
        <button onClick={() => api.current?.camera('side', true)}>侧面近景</button>
        <button onClick={() => api.current?.camera('back', true)}>背面近景</button>
        <button onClick={() => api.current?.camera('threeQuarter')}>全身视图</button>
      </div>
      <p className="resident-lab-note">拖动旋转，滚轮缩放。暂停动作后仍可观察裙发逐渐稳定。坐垫与床面只用于观察位置。</p>
      <p className="resident-lab-note">动作由 Blender 制作为变形测试片段。碰撞体只近似身体，不包含布料自碰撞、手臂全段或家具碰撞。</p>
    </aside>
  </main>;
}
