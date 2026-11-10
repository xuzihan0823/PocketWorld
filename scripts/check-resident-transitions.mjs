import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { load } from './resident-glb-loader.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const out = path.resolve(process.env.LAB_OUT || 'art/resident/tripo-transitions');
const scratch = path.resolve(process.env.TRANSITION_FRAMES || 'art/resident/generated/transition-frames');
const capture = !process.argv.includes('--audit-only');
const fps = 24;
const views = ['front', 'side', 'back'];
const clips = [
  { name: 'SitCycle', title: '步行 → 坐下 → 起身', seconds: 9, active: [2.75, 7.15],
    phases: [[1.44, '步行接近'], [2.4, '减速停稳'], [4.1, '屈膝坐下'], [5.8, '坐姿停留'], [7.5, '起身'], [9, '站稳']] },
  { name: 'LieCycle', title: '坐下 → 躺卧 → 起身', seconds: 13, active: [1., 12.],
    phases: [[.6, '站立准备'], [2.3, '坐下'], [2.9, '坐稳'], [5, '经坐姿后躺'], [7.8, '躺卧停留'],
      [9.9, '回到坐姿'], [10.7, '坐稳'], [12.4, '起身'], [13, '站稳']] },
];
const label = { front: '正面', side: '侧面', back: '背面' };
const errors = [];
const report = [];
let expectedFrames = 0;
for (const clip of clips) expectedFrames += clip.seconds * fps;

try {
  await fs.mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 576, height: 620 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(request.failure()?.errorText ?? request.url()));
  await page.goto(process.env.LAB_URL || 'http://127.0.0.1:8941/?dev=resident&asset=transitions');
  await page.waitForFunction(() => window.residentAudit?.ready);
  await page.getByLabel('测试动作').selectOption('SitCycle');
  await page.waitForFunction(() => window.residentAudit.cycleSample().hips[2] < -.15);
  assert.equal(await page.getByLabel('身体往返移动').isDisabled(), true);
  await page.getByLabel('测试动作').selectOption('LieCycle');
  assert.equal(await page.getByLabel('检查时刻').getAttribute('max'), '13');
  await page.getByRole('button', { name: '重播本段' }).click();
  await page.waitForFunction(() => window.residentAudit.cycleSample().time > .12);
  await page.getByRole('button', { name: '暂停动作', exact: true }).click();
  const pausedAt = await page.evaluate(() => window.residentAudit.cycleSample().time);
  await page.evaluate(() => window.residentAudit.advance(.15));
  assert.equal(await page.evaluate(() => window.residentAudit.cycleSample().time), pausedAt);
  await page.evaluate(() => window.residentAudit.setAutomatic(false));
  await page.getByRole('button', { name: '播放动作', exact: true }).click();
  await page.addStyleTag({ content: '.resident-lab-view { inset: 0 !important; } .resident-lab-panel { display: none; }' });
  const names = await page.evaluate(() => window.residentAudit.clips);
  assert.deepEqual(names, ['Walk', 'ArmsUp', 'Sit', 'LieDown', 'SitCycle', 'LieCycle']);

  for (const mode of ['static', 'dynamic']) {
    const enabled = mode === 'dynamic';
    await page.evaluate(enabled => window.residentAudit.configure({ hair: enabled, dress: enabled, collisions: enabled }), enabled);
    if (capture) for (const view of views) await fs.mkdir(path.join(scratch, mode, view), { recursive: true });
    let globalFrame = 0;
    for (const clip of clips) {
      await page.evaluate(name => window.residentAudit.setPose(name, 0), clip.name);
      const mesh = await page.evaluate(() => window.residentAudit.meshAudit());
      assert.equal(mesh.finite, true); assert.equal(mesh.bones, 103); assert.equal(mesh.triangles, 18659);
      const samples = [];
      let maxHipsStep = 0, maxHeadStep = 0, maxMorphStep = 0, maxOriginalMorphStep = 0, maxAngle = 0;
      let previous;
      for (let frame = 0; frame < clip.seconds * fps; frame += 12) {
        // Time is stepped inside one live scene. Each image has exactly five
        // fixed simulation ticks between it and the next, independent of capture speed.
        const frames = await page.evaluate(({ frame, fps, clip, views, label, capture, enabled }) => {
          const lab = window.residentAudit;
          const source = document.querySelector('.resident-lab-view canvas');
          const canvas = document.createElement('canvas');
          canvas.width = 576; canvas.height = 720;
          const ctx = canvas.getContext('2d');
          const results = [];
          for (let i = frame; i < Math.min(frame + 12, clip.seconds * fps); i++) {
            const time = i / fps;
            const sample = lab.cycleSample();
            const angle = lab.snapshot().maxAngle;
            let contacts;
            if (i % 3 === 0 && time >= clip.active[0] && time <= clip.active[1]) {
              contacts = { before: lab.surfaceContacts(false), after: lab.surfaceContacts() };
            }
            const images = {};
            if (capture) for (const view of views) {
              lab.camera(view);
              ctx.fillStyle = '#f2f5fa'; ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(source, 0, 64, 576, 620);
              ctx.fillStyle = '#233e60'; ctx.font = '600 22px "Microsoft YaHei", sans-serif';
              ctx.fillText((enabled ? '动态' : '静态') + '  ·  ' + label[view], 20, 29);
              ctx.font = '14px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#496078';
              ctx.fillText(enabled ? '基础动作 + 120 Hz 裙发弹簧与身体碰撞' : '基础动作 + Blender 姿势修正', 20, 52);
              ctx.font = '15px "Microsoft YaHei", sans-serif';
              ctx.fillText(clip.title + '  /  ' + clip.phases.find(([end]) => time < end)[1], 20, 707);
              ctx.textAlign = 'right'; ctx.fillText(time.toFixed(2) + ' s', 556, 707); ctx.textAlign = 'left';
              images[view] = canvas.toDataURL('image/jpeg', .92).split(',')[1];
            }
            results.push({ time, sample, angle, contacts, images });
            lab.advance(1 / fps, fps);
          }
          return results;
        }, { frame, fps, clip, views, label, capture, enabled });
        for (const { time, sample, angle, contacts, images } of frames) {
          assert.ok(Math.abs(sample.time - time) < 1e-5, JSON.stringify({ clip: clip.name, time, got: sample.time }));
          assert.ok([...sample.hips, ...sample.head, ...sample.morphs].every(Number.isFinite));
          assert.ok(sample.morphs.every(value => value >= -1e-6 && value <= 1 + 1e-6));
          assert.equal(sample.morphs.length, 49);
          const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
          if (previous) {
            maxHipsStep = Math.max(maxHipsStep, distance(sample.hips, previous.hips));
            maxHeadStep = Math.max(maxHeadStep, distance(sample.head, previous.head));
            maxMorphStep = Math.max(maxMorphStep, ...sample.morphs.map((x, i) => Math.abs(x - previous.morphs[i])));
            maxOriginalMorphStep = Math.max(maxOriginalMorphStep, ...sample.morphs.slice(0, 15).map((x, i) => Math.abs(x - previous.morphs[i])));
          }
          maxAngle = Math.max(maxAngle, angle);
          if (contacts) samples.push({ time, ...contacts });
          if (capture) for (const view of views) {
            await fs.writeFile(path.join(scratch, mode, view, String(globalFrame).padStart(5, '0') + '.jpg'), Buffer.from(images[view], 'base64'));
          }
          previous = sample;
          globalFrame++;
        }
      }
      // Verify one-shot completion and that all correctives clear when leaving the clip.
      const finished = await page.evaluate(() => {
        const lab = window.residentAudit;
        lab.advance(.5);
        return lab.cycleSample();
      });
      assert.ok(Math.abs(finished.time - finished.duration) < 1e-5);
      assert.ok(Math.abs(finished.duration - clip.seconds) <= 1 / 30 + 1e-5);
      assert.ok(finished.morphs.every(value => Math.abs(value) < 1e-5));
      // New walk targets are 0.1 s apart: 1/24 s changes their linear weights
      // by 0.4167. Preserve the stricter bound on all original targets.
      assert.ok(maxHipsStep < .04 && maxHeadStep < .05 && maxOriginalMorphStep < .25 && maxMorphStep < .43,
        JSON.stringify({ maxHipsStep, maxHeadStep, maxMorphStep }));
      assert.ok(enabled ? maxAngle > .02 : maxAngle < .002);
      const aggregate = side => Object.fromEntries(['hair', 'dress'].map(part => {
        const values = samples.map(sample => sample[side][part]);
        return [part, { meanPenetrating: values.reduce((sum, item) => sum + item.penetrating, 0) / values.length,
          maxDepth: Math.max(...values.map(item => item.maxDepth)), minHeight: Math.min(...values.map(item => item.minHeight)) }];
      }));
      const summary = { clip: clip.name, mode, frames: clip.seconds * fps, contactSamples: samples.length,
        maxHipsStep, maxHeadStep, maxMorphStep, maxAngle, before: aggregate('before'), after: aggregate('after') };
      for (const part of ['hair', 'dress']) assert.ok(summary.after[part].meanPenetrating < summary.before[part].meanPenetrating, JSON.stringify(summary));
      if (clip.name === 'LieCycle') assert.ok(summary.after.hair.minHeight > -.001 && summary.after.dress.minHeight > -.001);
      console.log(JSON.stringify(summary));
      report.push({ ...summary, samples });
    }
    assert.equal(globalFrame, expectedFrames);
  }
  await page.evaluate(() => window.residentAudit.setPose('Rest', 0));
  assert.ok(await page.evaluate(() => window.residentAudit.cycleSample().morphs.every(value => value === 0)));
  const stored = await load('public/models/resident/luna-tripo-transitions.glb'); stored.rest();
  const expectedHips = stored.bone('Hips').getWorldPosition(stored.bone('Hips').position.clone()).toArray();
  const restoredHips = await page.evaluate(() => window.residentAudit.cycleSample().hips);
  assert.ok(restoredHips.every((value, i) => Math.abs(value - expectedHips[i]) < 1e-6), 'Rest must match the stored glTF transforms');
  assert.deepEqual(errors, []);
  const video = [];
  if (capture) for (const view of views) {
    const target = path.join(out, view + '.mp4');
    const input = mode => path.join(scratch, mode, view, '%05d.jpg');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-y', '-framerate', String(fps),
      '-i', input('static'), '-framerate', String(fps), '-i', input('dynamic'), '-filter_complex', 'hstack=inputs=2',
      '-frames:v', String(expectedFrames), '-c:v', 'libx264', '-crf', '20', '-preset', 'fast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target], { stdio: 'inherit' });
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames,duration', '-of', 'json', target], { encoding: 'utf8' })).streams[0];
    assert.equal(Number(probe.nb_frames), expectedFrames);
    assert.equal(Number(probe.duration), 22);
    assert.equal(probe.avg_frame_rate, '24/1');
    video.push({ file: view + '.mp4', ...probe, bytes: (await fs.stat(target)).size });
    console.log(JSON.stringify(video.at(-1)));
  }
  await fs.writeFile(path.join(out, 'browser-validation.json'), JSON.stringify({
    platform: os.platform() + ' ' + os.release(), browser: await browser.version(), fps,
    contactMetric: 'Actual skinned vertices against eight approximate body capsules, depth over 0.001. Baseline removes only the 10 new sequence keys from the same rendered pose.',
    sampleInterval: 'Every third frame during active contact intervals. Before and after share the same pose, body capsules and spring state.',
    clips: clips.map(({ name, seconds, active }) => ({ name, seconds, active })),
    controls: 'sequence selection, replay, pause, seek bounds and one-shot ending checked',
    samples: report, video, errors,
  }, null, 2) + '\n');
} finally { await browser.close(); }
