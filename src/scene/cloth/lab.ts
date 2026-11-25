import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FixedClock, Xpbd, distance, type ClothSolver } from './physics';
import { garmentRegion, patchRegion, type Region } from './binding';
import { createActor, motions, releaseMeshes, type Motion } from './actor';
import { sleeveView } from './sleeveView';
import { createSleeveAudit } from './sleeveSurface';

const el = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
const form = el<HTMLFormElement>('config'),
  params = new URLSearchParams(location.search);
for (const select of form.querySelectorAll('select'))
  if ([...select.options].some((o) => o.value === params.get(select.name)))
    select.value = params.get(select.name)!;
form.onsubmit = (event) => {
  event.preventDefault();
  location.search = new URLSearchParams([...new FormData(form)].map(([k, v]) => [k, String(v)])).toString();
};
const config = new FormData(form),
  mode = String(config.get('scene')),
  engine = config.get('solver');
const hz = Number(config.get('hz')),
  substeps = Number(config.get('steps')),
  self = config.get('self') === 'on';
const motion = el<HTMLSelectElement>('motion');
for (const name of ['动作轮播', ...motions]) motion.add(new Option(name, name));
motion.disabled = mode === 'sheet';

interface Sample {
  frame: number;
  solve: number;
  collision: number | null;
  geometry: number;
  controller: number;
  ticks: number;
}
function stats(samples: Sample[]) {
  const n = samples.length,
    frames = samples.map((s) => s.frame).sort((a, b) => a - b);
  const mean = (field: keyof Sample) => samples.reduce((s, row) => s + (row[field] ?? 0), 0) / n;
  return {
    frames: n,
    fps: 1000 / mean('frame'),
    p95: frames[Math.ceil(0.95 * n) - 1],
    solve: mean('solve'),
    collision: samples.some((s) => s.collision === null) ? null : mean('collision'),
    geometry: mean('geometry'),
    controller: mean('controller'),
    steps: mean('ticks'),
  };
}
function quality(region: Region, solver: ClothSolver) {
  const { profile, targets, balls } = region,
    p = solver.positions;
  let stretch = 0,
    penetration = 0,
    pinError = 0,
    bend = 0,
    overlap = 0;
  const neighbors = new Set<number>(),
    count = p.length / 3;
  for (const edges of [profile.structural, profile.shear, profile.bend])
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i],
        b = edges[i + 1];
      neighbors.add(Math.min(a, b) * count + Math.max(a, b));
      const rest = distance(profile.rest, a, b),
        len = distance(p, a, b);
      if (edges === profile.structural) stretch = Math.max(stretch, len / rest - 1);
      if (edges === profile.bend) bend += Math.abs(len / rest - 1);
    }
  for (let i = 0; i < count; i++) {
    if (profile.pins.includes(i)) {
      pinError = Math.max(
        pinError,
        Math.hypot(
          p[3 * i] - targets[3 * i],
          p[3 * i + 1] - targets[3 * i + 1],
          p[3 * i + 2] - targets[3 * i + 2],
        ),
      );
      continue;
    }
    for (const b of balls)
      penetration = Math.max(
        penetration,
        b.radius + profile.thickness - Math.hypot(p[3 * i] - b.x, p[3 * i + 1] - b.y, p[3 * i + 2] - b.z),
      );
  }
  for (let i = 0; i < count; i++)
    for (let j = 0; j < i; j++)
      if (!neighbors.has(j * count + i) && distance(p, i, j) < profile.thickness * 1.98) overlap++;
  return {
    particles: count,
    mapped: region.mappedVertices,
    finite: p.every(Number.isFinite),
    stretch,
    bendChordChange: bend / (profile.bend.length / 2),
    pinError,
    penetration,
    overlap,
    surface: region.surfaceContact?.(),
  };
}

async function start() {
  const viewport = el('viewport'),
    renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  viewport.append(renderer.domElement);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const stage = new T.Scene();
  stage.background = new T.Color('#c6d1cc');
  const camera = new T.PerspectiveCamera(34, 1, 0.01, 30);
  camera.position.set(0.8, 1.25, 2.5);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0.78, 0);
  orbit.update();
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(viewport);
  stage.add(new T.HemisphereLight(0xffffff, 0xa4a698, 2.1));
  const sun = new T.DirectionalLight(0xfff1dc, 2.3);
  sun.position.set(2, 4, 3);
  stage.add(sun);
  const floor = new T.GridHelper(6, 30, 0x88978e, 0xafbcb3);
  floor.position.y = -0.012;
  stage.add(floor);
  const actors: Awaited<ReturnType<typeof createActor>>[] = [];
  const regions: Region[] = [],
    solvers: ClothSolver[] = [],
    wires: T.Mesh[] = [];
  let raf = 0,
    disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    resize.disconnect();
    orbit.dispose();
    for (const s of solvers) s.dispose();
    for (const a of actors) a.dispose();
    releaseMeshes(stage);
    renderer.dispose();
  }
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) dispose();
  });
  try {
    if (mode === 'sheet') regions.push(patchRegion(stage));
    else {
      const actor = await createActor(stage, mode === 'skirt', mode === 'multi' ? -0.48 : 0);
      actors.push(actor);
      if (mode === 'arm') regions.push(patchRegion(stage, actor.skin));
      if (['sleeve', 'both', 'multi', 'skirt'].includes(mode))
        regions.push(garmentRegion(actor.skin, 'Left', mode === 'skirt', mode === 'sleeve' && params.get('legacy') !== '1', mode === 'sleeve'));
      if (['both', 'multi'].includes(mode)) regions.push(garmentRegion(actor.skin, 'Right'));
      if (mode === 'multi') {
        const second = await createActor(stage, true, 0.48);
        actors.push(second);
        regions.push(garmentRegion(second.skin, 'Left', true));
        camera.position.z = 3.1;
      }
    }
    for (const region of regions) {
      const solver =
        engine === 'rapier'
          ? await (await import('./rapier')).makeRapier(region.profile, region.balls, self)
          : new Xpbd(region.profile, self);
      solvers.push(solver);
      const geom = new T.BufferGeometry();
      geom.setAttribute('position', new T.BufferAttribute(solver.positions, 3).setUsage(T.DynamicDrawUsage));
      geom.setIndex(region.profile.triangles);
      const wire = new T.Mesh(
        geom,
        new T.MeshBasicMaterial({ color: 0x135f50, wireframe: true, depthTest: false }),
      );
      wire.frustumCulled = false;
      wire.visible = false;
      wire.renderOrder = 2;
      stage.add(wire);
      wires.push(wire);
    }
    if (mode === 'sheet') {
      const b = regions[0].balls[0],
        ball = new T.Mesh(
          new T.SphereGeometry(b.radius, 30, 18),
          new T.MeshStandardMaterial({ color: 0xb97251 }),
        );
      ball.position.set(b.x, b.y, b.z);
      stage.add(ball);
    }
    const wireButton = el<HTMLButtonElement>('wire');
    wireButton.onclick = () => {
      const show = wireButton.getAttribute('aria-pressed') === 'false';
      wireButton.setAttribute('aria-pressed', String(show));
      wireButton.textContent = show ? '隐藏代理' : '显示代理';
      for (const wire of wires) wire.visible = show;
    };
    const clock = new FixedClock(),
      samples: Sample[] = [];
    let previous = 0,
      time = 0,
      paused = false,
      active: Motion = '待机',
      lastReport = 0;
    const compare = el<HTMLButtonElement>('compare');
    let audit: ReturnType<typeof createSleeveAudit> | undefined;
    const getAudit = () => audit ??= createSleeveAudit(regions[0].sleeveLayers!.mesh);
    const compareView = regions[0]?.sleeveLayers && sleeveView(regions[0], wires[0], renderer, stage, camera, orbit, getAudit);
    compare.hidden = !compareView;
    const totals = { physicsSteps: 0, solverMs: 0, frames: 0, longFrames: 0, maxFrameMs: 0 };
    let resumeOnClose = false;
    const pause = el<HTMLButtonElement>('pause');
    function resetClock() {
      previous = 0;
      clock.remainder = 0;
    }
    pause.onclick = () => {
      paused = !paused;
      pause.textContent = paused ? '继续' : '暂停';
      resetClock();
    };
    function toggleComparison() {
      if (!compareView) return;
      if (!compareView.showing) resumeOnClose = !paused;
      compareView.toggle();
      paused = compareView.showing || !resumeOnClose;
      compare.textContent = compareView.showing ? '返回当前袖面' : '同帧四层对照';
      pause.disabled = wireButton.disabled = compareView.showing;
      pause.textContent = paused ? '继续' : '暂停';
      resetClock();
    }
    compare.onclick = toggleComparison;
    // Optional repeatable inspection link. Stop after the requested physics substep.
    const inspectStep = compareView ? Number(params.get('atStep')) : 0;
    let simulatedSteps = 0, openSnapshot = false;
    document.addEventListener('visibilitychange', resetClock);
    const phaseEnds = [6, 8, 12, 14, 19.25, 29, 34.25];
    function frame(now: number) {
      if (disposed) return;
      const elapsed = previous ? (now - previous) / 1000 : 0;
      previous = now;
      const row: Sample = {
        frame: elapsed * 1000,
        solve: 0,
        collision: 0,
        geometry: 0,
        controller: 0,
        ticks: 0,
      };
      if (!paused && !document.hidden)
        clock.advance(elapsed, hz, (dt) => {
          if (openSnapshot) return;
          for (let s = 0; s < substeps; s++) {
            time += dt / substeps;
            active =
              motion.value === '动作轮播'
                ? motions[phaseEnds.findIndex((end) => time % 34.25 < end)]
                : (motion.value as Motion);
            const before = performance.now();
            for (const a of actors) {
              a.select(active);
              a.update(dt / substeps);
            }
            for (const r of regions) r.sample(time);
            row.controller += performance.now() - before;
            regions.forEach((r, i) => {
              const step = performance.now();
              solvers[i].step(dt / substeps, r.targets, r.balls);
              row.solve += performance.now() - step;
              const c = solvers[i].collisionMs;
              if (c === null) row.collision = null;
              else if (row.collision !== null) row.collision += c;
            });
            row.ticks++;
            simulatedSteps++;
            if (simulatedSteps === inspectStep) { openSnapshot = true; break; }
          }
        });
      if (row.ticks) {
        const before = performance.now();
        regions.forEach((r, i) => {
          r.bind(solvers[i].positions);
          wires[i].geometry.attributes.position.needsUpdate = true;
        });
        row.geometry = performance.now() - before;
      }
      if (openSnapshot) { toggleComparison(); openSnapshot = false; }
      if (compareView?.showing) compareView.draw();
      else renderer.render(stage, camera);
      if ((!paused || row.ticks > 0) && elapsed > 0 && !document.hidden) {
        totals.physicsSteps += row.ticks;
        totals.solverMs += row.solve;
        totals.frames++;
        if (row.frame > 50) totals.longFrames++;
        totals.maxFrameMs = Math.max(totals.maxFrameMs, row.frame);
        samples.push(row);
        if (samples.length > 600) samples.shift();
      }
      if (now - lastReport > 550 && samples.length) {
        const m = stats(samples);
        lastReport = now;
        el('metrics').textContent =
          '平均 FPS     ' +
          m.fps.toFixed(1) +
          '\nP95 帧时间   ' +
          m.p95.toFixed(2) +
          ' ms\n求解 / 帧    ' +
          m.solve.toFixed(2) +
          ' ms\n碰撞 / 帧    ' +
          (m.collision?.toFixed(2) ?? 'N/A') +
          ' ms\n映射 / 帧    ' +
          m.geometry.toFixed(2) +
          ' ms\n动画与锚点   ' +
          m.controller.toFixed(2) +
          ' ms';
        el('status').textContent =
          (actors.length ? active + ' · ' : '') +
          regions.reduce((n, r) => n + r.mappedVertices, 0) +
          ' 个映射顶点 · 丢弃 ' +
          clock.dropped +
          ' 步';
      }
      raf = requestAnimationFrame(frame);
    }
    el('inspect').onclick = () => {
      el('quality').textContent = regions
        .map((r, i) => {
          const q = quality(r, solvers[i]);
          let contact = '';
          if (r.sleeveLayers) {
            const { raw, final } = r.sleeveLayers;
            const hits = getAudit().measure(raw, final);
            contact = `\n第 ${simulatedSteps} 步 · ${time.toFixed(3)} s · ${active}` +
              `\n袖面 × 衣身（三角面对）\n蒙皮 ${hits.skinned} · 未限幅 ${hits.raw} · 最终 ${hits.final}` +
              `\n最终新增 ${hits.added} · 消除 ${hits.removed}` +
              `\n袖面 × 腋下内衬 ${hits.facing.join(' → ')}` +
              `\n分区面数 · 袖外 ${hits.counts.outer} / 朝内 ${hits.counts.inward} / 袖缘 ${hits.counts.rim}` +
              `\n衣身 ${hits.counts.torso} / 内衬 ${hits.counts.facing} / 裸手 ${hits.counts.skin}`;
          }
          return (
            '最大边伸长 ' +
            (100 * q.stretch).toFixed(1) +
            '% · 非邻接粒子重叠 ' +
            q.overlap +
            '\n碰撞代理侵入 ' +
            (1000 * q.penetration).toFixed(1) +
            ' mm' +
            (q.surface ? '\n渲染顶点对球壳 ' + (1000 * q.surface.correctedDepth).toFixed(1) + ' mm' : '') + contact
          );
        })
        .join('\n');
    };
    Object.assign(window, {
      pwcs: {
        reset() {
          samples.length = 0;
          Object.assign(totals, { physicsSteps: 0, solverMs: 0, frames: 0, longFrames: 0, maxFrameMs: 0 });
          clock.dropped = 0;
          resetClock();
        },
        report: () => ({
          ...stats(samples),
          cumulative: { ...totals, msPerPhysicsStep: totals.physicsSteps ? totals.solverMs / totals.physicsSteps : 0,
            droppedSimulationMs: 1000 * clock.dropped / hz },
          snapshot: compareView?.showing ?? false,
          simulatedSteps,
          time,
          active,
          dropped: clock.dropped,
          quality: regions.map((r, i) => quality(r, solvers[i])),
          viewport: [renderer.domElement.width, renderer.domElement.height],
          hz,
          substeps,
          mode,
          engine,
        }),
      },
    });
    raf = requestAnimationFrame(frame);
  } catch (error) {
    dispose();
    throw error;
  }
}
start().catch((e) => {
  el('status').textContent = '加载失败 · ' + String(e);
  console.error(e);
});
