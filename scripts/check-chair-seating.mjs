import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright');
const output = path.resolve(process.env.CHAIR_OUTPUT || 'chair-review.local');
await fs.mkdir(output, { recursive: true });
const port = Number(process.env.CHAIR_PORT || 8964);
const server = await createServer({ root: process.cwd(), server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
let browser, page;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  page = await context.newPage(); const errors = [], resourceErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) resourceErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(`http://127.0.0.1:${port}/?resident=tripo`);
  await page.waitForFunction(() => window.tripoRoomAudit);
  const setup = async () => { await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/.vite/deps/@react-three_fiber.js'));
    const fiber = await import(url), store = [...fiber._roots.values()][0].store, state = store.getState();
    const actor = state.scene.getObjectByName('OrbitalResidents_habitat').getObjectByName('OrbitalResident');
    const chair = state.scene.getObjectByName('Furniture_habitat').getObjectByName('OfficeChair');
    let mesh; actor.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    const vec = () => actor.position.clone(), bone = n => mesh.skeleton.bones.find(b => b.name.replace(/[^\w]/g, '') === 'mixamorig' + n);
    const feet = { Left: [], Right: [] }, pelvis = [], dress = [], hair = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const weights = {};
      for (let c = 0; c < 4; c++) {
        const name = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(i, c)].name;
        const w = mesh.geometry.attributes.skinWeight.getComponent(i, c);
        const key = name.startsWith('Dress_') ? 'dress' : name.startsWith('Hair_') ? 'hair' : name.includes('Hips') || name.includes('UpLeg') ? 'pelvis' : name.includes('LeftFoot') || name.includes('LeftToe') ? 'Left' : name.includes('RightFoot') || name.includes('RightToe') ? 'Right' : 'other';
        weights[key] = (weights[key] || 0) + w;
      }
      for (const side of ['Left', 'Right']) if (weights[side] > .5) feet[side].push(i);
      if (weights.dress > .25) dress.push(i);
      if (weights.hair > .25) hair.push(i);
      if (weights.pelvis > .8 && !weights.dress && !weights.hair) pelvis.push(i);
    }
    const snapshot = () => {
      actor.updateWorldMatrix(true, true); mesh.skeleton.update();
      const s = actor.userData.chairSeating, soles = {}, knees = {};
      for (const side of ['Left', 'Right']) {
        soles[side] = Math.min(...feet[side].map(i => actor.parent.worldToLocal(mesh.getVertexPosition(i, vec()).applyMatrix4(mesh.matrixWorld)).y));
        const h = bone(side + 'UpLeg').getWorldPosition(vec()), k = bone(side + 'Leg').getWorldPosition(vec()), f = bone(side + 'Foot').getWorldPosition(vec());
        knees[side] = 180 - h.sub(k).angleTo(f.sub(k)) * 180 / Math.PI;
      }
      const contact = ids => ids.map(i => chair.worldToLocal(mesh.getVertexPosition(i, vec()).applyMatrix4(mesh.matrixWorld))).filter(p => Math.abs(p.x) < .21 && p.z > -.20 && p.z < .18 && p.y > .15 && p.y < .5);
      const butt = contact(pelvis), skirt = contact(dress);
      return { phase: s?.phase ?? 'STANDING', clipTime: s?.clipTime, turnProgress: s?.turnProgress, bound: s?.bound, position: actor.position.toArray(), yaw: actor.rotation.y, soles, knees,
        pelvisSurfaceMin: Math.min(...butt.map(p => p.y)), skirtSurfaceMin: Math.min(...skirt.map(p => p.y)), chairPosition: chair.position.toArray(), audit: window.tripoRoomAudit.snapshot() };
    };
    let reviewView;
    const camera = view => { reviewView = view; };
    state.internal.subscribers.push({ priority: 0, store, ref: { current: () => {
      if (!reviewView) return;
      const view = reviewView;
      if (view === 'room') { state.camera.fov = 34; state.camera.position.set(11, 10.05, 14); state.camera.lookAt(0, 1.05, 0); state.camera.updateProjectionMatrix(); return; }
      const target = actor.getWorldPosition(vec()).add(vec().set(0, .72, 0));
      const direction = view === 'front' ? vec().set(0, .10, 1) : view === 'side' ? vec().set(1, .08, 0) : vec().set(.7, .3, 1);
      direction.applyAxisAngle(vec().set(0, 1, 0), 3.0915926535897933).multiplyScalar(1.35);
      state.camera.position.copy(target).add(direction); state.camera.lookAt(target);
      state.camera.fov = 70;
      state.camera.updateProjectionMatrix();
    } } });
    const project = object => { const p = object.getWorldPosition(vec()).project(state.camera); return { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight }; };
    window.chairReview = { state, actor, chair, mesh, snapshot, camera, project, samples: [], frames: [] };
    const recordSamples = () => { if (window.chairReview.samples.length < 600) window.chairReview.samples.push(snapshot()); };
    window.chairReview.timer = setInterval(recordSamples, 100);
  }); }; await setup();
  const start = async () => page.evaluate(() => {
    const chunks = [], stream = document.querySelector('canvas').captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4500000 });
    window.chairReview.recording = { recorder, stream, chunks };
    recorder.ondataavailable = e => chunks.push(e.data); recorder.start(250);
  });
  const stop = async name => {
    const data = await page.evaluate(async () => {
      const { recorder, stream, chunks } = window.chairReview.recording;
      await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
      stream.getTracks().forEach(t => t.stop());
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let raw = ''; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(raw);
    });
    await fs.writeFile(path.join(output, name + '.webm'), Buffer.from(data, 'base64'));
  };
  await start();
  const point = await page.evaluate(() => window.chairReview.project(window.chairReview.chair.getObjectByName('SeatContact')));
  await page.mouse.click(point.x, point.y);
  try { await page.waitForFunction(() => window.chairReview.actor.userData.chairSeating?.phase === 'SEATED_IDLE', {}, { timeout: 45000 }); }
  catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.log(await page.evaluate(() => ({ sample: window.chairReview.snapshot(), ui: document.body.innerText }))); throw error; }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'approach-seated.png') });
  await stop('A-approach');
  const seated = await page.evaluate(() => window.chairReview.snapshot());
  for (const view of ['front', 'side']) {
    await page.evaluate(view => window.chairReview.camera(view), view);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, `${view}-seated.png`) });
    await start();
    await page.keyboard.press('e');
    await page.waitForFunction(() => !window.chairReview.actor.userData.chairSeating?.phase, {}, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(output, `${view}-standing.png`) });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.chairReview.actor.userData.chairSeating?.phase === 'SEATED_IDLE', {}, { timeout: 15000 });
    await page.waitForTimeout(800);
    await stop(`B-${view}-stand-sit`);
  }
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const noScoot = await page.evaluate(() => window.chairReview.snapshot());
  const samples = await page.evaluate(() => { clearInterval(window.chairReview.timer); return window.chairReview.samples; });
  // A real floor click while seated queues navigation until the rise/exit completes.
  await page.evaluate(() => window.chairReview.camera('room')); await page.waitForTimeout(150);
  const floor = await page.evaluate(() => { const r = window.chairReview, p = r.actor.parent.localToWorld(r.actor.position.clone().set(-.4, 0, .5)).project(r.state.camera); return { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight }; });
  await page.mouse.click(floor.x, floor.y);
  await page.waitForFunction(() => { const a = window.chairReview.actor; return !a.userData.chairSeating?.phase && Math.hypot(a.position.x + .4, a.position.z - .5) < .08; }, {}, { timeout: 20000 });
  const floorExit = await page.evaluate(() => window.chairReview.snapshot());
  const clickChair = async () => { const p = await page.evaluate(() => window.chairReview.project(window.chairReview.chair.getObjectByName('SeatContact'))); await page.mouse.click(p.x, p.y); };
  await clickChair(); await page.waitForFunction(() => window.chairReview.actor.userData.chairSeating?.phase === 'ALIGN', {}, { timeout: 25000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.chairReview.actor.userData.chairSeating?.phase, {}, { timeout: 10000 });
  const cancelled = await page.evaluate(() => window.chairReview.snapshot());
  await page.waitForTimeout(300); await page.keyboard.press('e'); await page.waitForFunction(() => window.chairReview.actor.userData.chairSeating?.phase === 'SIT_DOWN', {}, { timeout: 15000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => !window.chairReview.actor.userData.chairSeating?.phase, {}, { timeout: 10000 });
  const interruptedSit = await page.evaluate(() => window.chairReview.snapshot());
  // Narrow touchscreen and reduced motion use the same entry ownership and essential sit/stand sequence.
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await page.waitForFunction(() => window.tripoRoomAudit); await setup();
  const tap = await page.evaluate(() => window.chairReview.project(window.chairReview.chair.getObjectByName('SeatContact')));
  await page.touchscreen.tap(tap.x, tap.y);
  await page.waitForFunction(() => window.chairReview.actor.userData.chairSeating?.phase === 'SEATED_IDLE', {}, { timeout: 45000 });
  const touch = await page.evaluate(() => window.chairReview.snapshot());
  await page.screenshot({ path: path.join(output, 'touch-390.png') });
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify({ seated, noScoot, floorExit, cancelled, interruptedSit, touch, samples, errors, resourceErrors }, null, 2));
  assert.deepEqual(noScoot.position, seated.position); assert.equal(noScoot.audit.moving, false);
  assert.ok(Object.values(seated.soles).every(y => Math.abs(y) < .001));
  assert.ok(seated.pelvisSurfaceMin >= .37 && seated.pelvisSurfaceMin < .38);
  assert.deepEqual(errors, []);
  assert.deepEqual(resourceErrors.filter(r => !r.url.endsWith('/favicon.ico')), []);
  console.log(JSON.stringify({ output, seated, noScoot, floorExit: floorExit.phase, cancelled: cancelled.phase, interruptedSit: interruptedSit.phase, touch: touch.phase, phases: [...new Set(samples.map(s => s.phase))], errors }));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.log(await page.evaluate(() => ({ snapshot: window.chairReview?.snapshot(), ui: document.body.innerText }))); }
  throw error;
} finally { await browser?.close(); await server.close(); }
