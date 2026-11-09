import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const out = path.resolve(process.env.LAB_OUT || 'art/resident/tripo-dynamics/polish');
await fs.mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], failedRequests = [], faviconWarnings = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') {
    if (message.location().url.endsWith('/favicon.ico')) faviconWarnings.push(message.text());
    else errors.push(`${message.text()} ${message.location().url}`);
  } });
  page.on('response', response => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto(process.env.LAB_URL || 'http://127.0.0.1:8941/?dev=resident');
  await page.waitForFunction(() => window.residentAudit?.ready, null, { timeout: 30000 });
  await page.getByLabel('身体往返移动').uncheck();
  await page.getByRole('button', { name: '暂停动作', exact: true }).click();
  await page.evaluate(() => window.residentAudit.setAutomatic(false));
  const poses = [];
  for (const pose of ['Rest', 'Walk', 'ArmsUp', 'Sit', 'LieDown']) {
    await page.getByLabel('测试动作').selectOption(pose);
    const result = await page.evaluate(pose => {
      const lab = window.residentAudit;
      lab.configure({ hair: true, dress: true, collisions: true });
      lab.setPose(pose, pose === 'Walk' ? .3 : 2);
      lab.advance(2);
      const { tails, rotations, ...simulation } = lab.snapshot();
      return { pose, simulation, mesh: lab.meshAudit() };
    }, pose);
    poses.push(result);
    assert.equal(result.mesh.bones, 103); assert.equal(result.mesh.triangles, 18659); assert.equal(result.mesh.finite, true);
    await page.screenshot({ path: path.join(out, `three-${pose.toLowerCase()}.png`) });
    if (['ArmsUp', 'Sit', 'LieDown'].includes(pose)) {
      await page.evaluate(() => window.residentAudit.camera('side'));
      await page.screenshot({ path: path.join(out, `three-${pose.toLowerCase()}-side.png`) });
      await page.evaluate(() => window.residentAudit.camera('threeQuarter'));
    }
  }
  await page.evaluate(() => window.residentAudit.setAutomatic(true));
  await page.getByLabel('测试动作').selectOption('Walk');
  await page.getByRole('button', { name: '播放动作', exact: true }).click();
  await page.getByLabel('身体往返移动').check();
  await page.waitForFunction(() => window.residentAudit.performance().samples >= 180, null, { timeout: 30000 });
  const performance = await page.evaluate(() => window.residentAudit.performance());
  await page.getByRole('button', { name: '静态对比', exact: true }).click();
  for (const label of ['头发动态', '裙摆动态', '身体碰撞约束']) assert.equal(await page.getByLabel(label, { exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '启用动态', exact: true }).click();
  for (const label of ['头发动态', '裙摆动态', '身体碰撞约束']) {
    await page.getByLabel(label, { exact: true }).uncheck(); assert.equal(await page.getByLabel(label, { exact: true }).isChecked(), false);
    await page.getByLabel(label, { exact: true }).check();
  }
  await page.getByLabel('显示碰撞体').check();
  await page.screenshot({ path: path.join(out, 'three-colliders.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'three-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const recovery = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await recovery.emulateMedia({ reducedMotion: 'reduce' });
  await recovery.route('**/luna-tripo-dynamics.glb', route => route.abort(), { times: 2 });
  await recovery.goto(process.env.LAB_URL || 'http://127.0.0.1:8941/?dev=resident');
  await recovery.getByRole('alert').waitFor();
  await recovery.unroute('**/luna-tripo-dynamics.glb');
  await recovery.getByRole('button', { name: '重新加载', exact: true }).click();
  await recovery.waitForFunction(() => window.residentAudit?.ready, null, { timeout: 30000 });
  assert.equal(await recovery.getByLabel('头发动态', { exact: true }).isChecked(), false);
  assert.equal(await recovery.getByLabel('裙摆动态', { exact: true }).isChecked(), false);
  assert.equal(await recovery.getByLabel('身体往返移动').isChecked(), false);
  await recovery.getByRole('button', { name: '播放动作', exact: true }).waitFor();
  await recovery.close();
  const report = { browser: `${await browser.version()} on ${os.platform()} ${os.release()}; no physical-device benchmark`, poses, performance, errors, failedRequests, faviconWarnings,
    switches: 'hair, dress, collisions, static, movement, pause: passed', recovery: 'failed GLB fetch then retry: passed',
    reducedMotion: 'Rest, no autoplay, no movement or springs by default: passed', mobile: '390x844 responsive layout; simulated viewport' };
  await fs.writeFile(path.join(out, 'browser-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  if (process.env.RECORD_PREVIEW === '1') {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, recordVideo: { dir: out, size: { width: 1100, height: 850 } } });
    const videoPage = await context.newPage();
    await videoPage.goto(process.env.LAB_URL || 'http://127.0.0.1:8941/?dev=resident');
    await videoPage.waitForFunction(() => window.residentAudit?.performance().samples >= 240, null, { timeout: 30000 });
    await videoPage.getByLabel('身体往返移动').uncheck();
    await videoPage.getByRole('button', { name: '暂停动作', exact: true }).click();
    await videoPage.waitForFunction(() => window.residentAudit?.performance().samples >= 480, null, { timeout: 30000 });
    const video = videoPage.video();
    await context.close();
    await video.saveAs(path.join(out, 'motion-preview.webm')); await video.delete();
  }
} finally { await browser.close(); }
