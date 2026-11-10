import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.ok(process.env.BASELINE_GLB, 'Set BASELINE_GLB to the previous accepted export');
const scratch = path.resolve(process.env.LEG_FRAMES || 'art/resident/generated/leg-frames');
const out = path.resolve(process.env.LAB_OUT || 'art/resident/tripo-transitions');
await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(out, { recursive: true });
await fs.copyFile(process.env.BASELINE_GLB, 'art/resident/generated/leg-before.glb');
const variants = [{ key: 'before', label: '修正前', url: '/art/resident/generated/leg-before.glb' },
  { key: 'after', label: '修正后', url: '/models/resident/luna-tripo-transitions.glb' }];
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [], samples = [];
const ffmpeg = args => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { stdio: 'inherit' });
const strip = (files, target) => ffmpeg([...files.flatMap(f => ['-i', f]), '-filter_complex', `hstack=inputs=${files.length}`, '-frames:v', '1', target]);
const still = (variant, i, kind) => path.join(scratch, `${variant}-${i}-${kind}.png`);
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.REVIEW_ORIGIN || 'http://127.0.0.1:8950') + '/scripts/resident-leg-review.html');
  await page.waitForFunction(() => window.ready);
  const capture = async (variant, clip, time, options) => page.evaluate(async ({ variant, clip, time, options }) =>
    window.audit(variant.url, clip, time, options), { variant, clip, time, options });
  const poses = [['Rest', 0, 'Rest Pose'], ['SitCycle', 2.2, '停止 · 视频 2.20 s'],
    ['Walk', .2, '左屏腿屈曲 · 视频 2.60 s'], ['Walk', .8, '右屏腿屈曲 · 视频 3.20 s']];
  for (const variant of variants) {
    for (const [i, [clip, time, label]] of poses.entries()) {
      for (const [kind, options] of [['skin', {}], ['bones', { overlay: true }], ['clay', { clay: true }]]) {
        const r = await capture(variant, clip, time, { ...options, title: variant.label + ' · ' + label });
        await fs.writeFile(still(variant.key, i, kind), Buffer.from(r.image, 'base64'));
        if (kind === 'bones') samples.push({ variant: variant.key, clip, time, joints: r.joints });
      }
    }
    strip(poses.map((_, i) => still(variant.key, i, 'bones')), path.join(out, `front-diagnosis-${variant.key}.png`));
  }
  strip([1, 2, 3].flatMap(i => variants.map(v => still(v.key, i, 'skin'))), path.join(out, 'front-surface-comparison.png'));
  strip([2, 3].flatMap(i => variants.map(v => still(v.key, i, 'clay'))), path.join(out, 'front-clay-comparison.png'));
  for (const variant of variants) {
    for (const kind of ['skin', 'bones']) await fs.mkdir(path.join(scratch, variant.key, kind), { recursive: true });
    for (let frame = 0; frame < 180; frame++) {
      const total = frame / 30, clip = total < 2.4 ? 'SitCycle' : 'Walk', time = total < 2.4 ? total : (total - 2.4) % 1.2;
      for (const kind of ['skin', 'bones']) {
        const r = await capture(variant, clip, time, { overlay: kind === 'bones', title: `${variant.label} · 完整视频 ${total.toFixed(2)} s` });
        await fs.writeFile(path.join(scratch, variant.key, kind, String(frame).padStart(5, '0') + '.png'), Buffer.from(r.image, 'base64'));
      }
    }
  }
  for (const kind of ['skin', 'bones']) {
    const target = path.join(out, kind === 'skin' ? 'front-orthographic.mp4' : 'front-orthographic-joints.mp4');
    ffmpeg([...variants.flatMap(v => ['-framerate', '30', '-i', path.join(scratch, v.key, kind, '%05d.png')]),
      '-filter_complex', 'hstack=inputs=2', '-frames:v', '180', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
    ffmpeg(['-i', target, '-f', 'null', '-']);
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=nb_frames,duration', '-of', 'json', target], { encoding: 'utf8' })).streams[0];
    assert.equal(+probe.nb_frames, 180); assert.equal(+probe.duration, 6);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'leg-render-validation.json'), JSON.stringify({ camera: { type: 'orthographic', height: .62, target: [0, .28, 0], eye: [0, .28, 3] },
    video: { fps: 30, frames: 180, duration: 6, mapping: '0–2.4 SitCycle; 2.4–6 Walk' }, samples, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ stills: 4, videos: 2, errors }));
} finally { await browser.close(); }
