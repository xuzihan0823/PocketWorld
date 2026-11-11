import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const host = document.querySelector<HTMLElement>('#view')!;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor('#e7ecf2'); renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(33, 1, .01, 30);
camera.position.set(1.05, .87, 1.95);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .50, 0); controls.minDistance = .6; controls.maxDistance = 4; controls.update();
scene.add(new THREE.HemisphereLight('#e8f4ff', '#a6a0a6', 2.3));
const light = new THREE.DirectionalLight('#fff8ef', 2.6); light.position.set(2, 3, 3); scene.add(light);
const fill = new THREE.DirectionalLight('#cadfff', 1.2); fill.position.set(-2, 1, -2); scene.add(fill);
const grid = new THREE.GridHelper(4, 40, '#a5b5c8', '#c9d3df'); scene.add(grid);
const resize = () => { camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); };
const observer = new ResizeObserver(resize); observer.observe(host); resize();
const file = `${import.meta.env.BASE_URL}models/resident/luna-tripo-animated.glb`;
el<HTMLAnchorElement>('download').href = file;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, time = 0, duration = 1;
let mixer: THREE.AnimationMixer | undefined, action: THREE.AnimationAction | undefined, asset: THREE.Group | undefined;
let helper: THREE.SkeletonHelper | undefined;
const meshes: THREE.SkinnedMesh[] = [], auxiliary: { bone: THREE.Bone; rest: THREE.Quaternion }[] = [];
const axis = new THREE.Vector3(1, 0, 0), offset = new THREE.Quaternion();
const updateButton = () => { el('play').textContent = playing ? '暂停' : '播放'; };
updateButton();
el('play').onclick = () => { playing = !playing; updateButton(); };
el('reset').onclick = () => { time = 0; playing = true; updateButton(); };
el<HTMLInputElement>('timeline').oninput = e => { time = Number((e.target as HTMLInputElement).value); playing = false; updateButton(); };
el('pose').onchange = () => { time = 0; };
el('skeleton').onchange = () => { if (helper) helper.visible = el<HTMLInputElement>('skeleton').checked; };
for (const part of ['hair', 'dress']) el(part).oninput = () => { el(part + 'Value').textContent = el<HTMLInputElement>(part).value + '°'; };
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => { b.onclick = () => {
  const side = b.dataset.camera; camera.position.set(side === 'side' ? 2.1 : 0, .65, side === 'side' ? 0 : side === 'back' ? -2.1 : 2.1); controls.update();
}; });
new GLTFLoader().loadAsync(file).then(gltf => {
  asset = gltf.scene; scene.add(asset);
  let bones = 0;
  asset.traverse(o => {
    if (o instanceof THREE.SkinnedMesh) { o.frustumCulled = false; meshes.push(o); }
    if (o instanceof THREE.Bone) {
      bones++;
      if (o.name.startsWith('Hair_') || o.name.startsWith('Dress_')) auxiliary.push({ bone: o, rest: o.quaternion.clone() });
    }
  });
  mixer = new THREE.AnimationMixer(asset); action = mixer.clipAction(gltf.animations[0]);
  action.play(); action.paused = true; duration = gltf.animations[0].duration;
  el<HTMLInputElement>('timeline').max = String(duration);
  helper = new THREE.SkeletonHelper(asset); helper.visible = false;
  (helper.material as THREE.LineBasicMaterial).depthTest = false; helper.renderOrder = 10; scene.add(helper);
  el('status').textContent = `${bones} 根骨骼 · ${auxiliary.length} 根裙发骨骼 · ${duration.toFixed(2)} 秒原始动画`;
}).catch(error => { el('status').textContent = `加载失败：${error.message}`; });
let previous = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  if (asset && mixer && action) {
    const bind = el<HTMLSelectElement>('pose').value === 'bind';
    if (playing && !document.hidden && !bind) time = (time + dt) % duration;
    if (bind) meshes.forEach(m => m.skeleton.pose());
    else { action.time = time; mixer.update(0); }
    for (const { bone, rest } of auxiliary) {
      const part = bone.name.startsWith('Hair_') ? 'hair' : 'dress';
      bone.quaternion.copy(rest).multiply(offset.setFromAxisAngle(axis, Number(el<HTMLInputElement>(part).value) * Math.PI / 180));
    }
    el<HTMLInputElement>('timeline').value = String(time); el('clock').textContent = time.toFixed(2) + ' s';
  }
  controls.update(); renderer.render(scene, camera);
});
window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null); observer.disconnect(); controls.dispose(); mixer?.stopAllAction();
  if (asset && mixer) mixer.uncacheRoot(asset);
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
    geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  } });
  for (const m of materials) { for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); m.dispose(); }
  textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); meshes.forEach(m => m.skeleton.dispose()); renderer.dispose();
}, { once: true });
