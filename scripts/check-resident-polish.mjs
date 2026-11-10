import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const out = path.resolve(process.env.LAB_OUT || 'art/resident/tripo-dynamics/polish');
const reports = [];
try {
  for (const variant of process.env.BASELINE_GLB ? ['before', 'after'] : ['after']) {
    const folder = path.join(out, variant); await fs.mkdir(folder, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (variant === 'before') {
      const body = await fs.readFile(process.env.BASELINE_GLB);
      await page.route('**/luna-tripo-dynamics.glb', route => route.fulfill({ contentType: 'model/gltf-binary', body }));
    }
    await page.goto(process.env.LAB_URL || 'http://127.0.0.1:8941/?dev=resident');
    await page.waitForFunction(() => window.residentAudit?.ready);
    await page.getByLabel('身体往返移动').uncheck();
    await page.getByRole('button', { name: '暂停动作', exact: true }).click();
    await page.evaluate(() => window.residentAudit.setAutomatic(false));
    for (const pose of ['ArmsUp', 'Sit', 'LieDown']) {
      for (const mode of ['static', 'dynamic']) {
        const audit = await page.evaluate(({ pose, mode }) => {
          const lab = window.residentAudit, enabled = mode === 'dynamic';
          lab.configure({ hair: enabled, dress: enabled, collisions: enabled });
          lab.setPose(pose, 2); lab.advance(2);
          return { mesh: lab.meshAudit(), contacts: lab.surfaceContacts(), simulation: lab.snapshot() };
        }, { pose, mode });
        assert.equal(audit.mesh.finite, true); assert.equal(audit.mesh.bones, 103);
        assert.equal(audit.mesh.triangles, variant === 'before' ? 18525 : 18659);
        const { tails, rotations, ...simulation } = audit.simulation;
        reports.push({ variant, pose, mode, mesh: audit.mesh, contacts: audit.contacts, simulation });
        if (variant === 'after' && ['Sit', 'LieDown'].includes(pose)) {
          assert.equal(audit.contacts.dress.penetrating, 0);
          assert.ok(audit.contacts.hair.maxDepth < .0011);
        }
        for (const view of ['front', 'side', 'back']) {
          await page.evaluate(view => window.residentAudit.camera(view, true), view);
          await page.locator('canvas').screenshot({ path: path.join(folder, `${pose.toLowerCase()}-${view}-${mode}.png`) });
        }
      }
    }
    // Same frozen pose plateau and body trajectory, sampled while springs still carry inertia.
    await page.getByRole('button', { name: '播放动作', exact: true }).click();
    await page.getByLabel('身体往返移动').check();
    for (const pose of ['ArmsUp', 'Sit', 'LieDown']) for (const mode of ['static', 'dynamic']) {
      await page.evaluate(({ pose, mode }) => {
        const lab = window.residentAudit, enabled = mode === 'dynamic';
        lab.configure({ hair: enabled, dress: enabled, collisions: enabled });
        lab.setPose(pose, 2); lab.advance(.6);
      }, { pose, mode });
      for (const view of ['front', 'side', 'back']) {
        await page.evaluate(view => window.residentAudit.camera(view, true), view);
        await page.locator('canvas').screenshot({ path: path.join(folder, `${pose.toLowerCase()}-${view}-moving-${mode}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await fs.writeFile(path.join(out, 'comparison-validation.json'), JSON.stringify({ platform: `${os.platform()} ${os.release()}`, browser: await browser.version(),
    description: 'Held at clip time 2 s, no body translation; static disables all three runtime switches; dynamic settles for 2 s. Corrective morphs remain part of both base poses.',
    movingDescription: 'Additional moving images start at clip time 2 s and advance the same body trajectory for 0.6 s. The base pose stays on its plateau while the springs carry inertia.',
    contactMetric: 'Mesh vertices, skin-influence classification, depth over 0.001 against the eight approximate body capsules. This is not an exact body-surface or cloth self-collision test.', reports }, null, 2) + '\n');
  console.log(JSON.stringify(reports.map(({ variant, pose, mode, contacts }) => ({ variant, pose, mode, contacts })), null, 2));
} finally { await browser.close(); }
