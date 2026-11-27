import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const engine = require('./dist/engine.cjs');
const sandbox = { exports: {}, require: () => engine };
const source = readFileSync(new URL('./minimap.ts', import.meta.url), 'utf8');
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, sandbox);
const { drawMinimap, MINIMAP_SIZE } = sandbox.exports;

test('radar follows player movement, drops dead and distant enemies, and rings the boss', () => {
  let path = [];
  const filled = [];
  const outlined = [];
  const context = {
    clearRect() { filled.length = outlined.length = 0; },
    save() {}, restore() {}, clip() {}, fillRect() {}, strokeRect() {},
    beginPath() { path = []; },
    arc(x, y, radius) { path.push({ x, y, radius }); },
    moveTo() {}, lineTo() {}, closePath() {},
    fill() { filled.push(...path); },
    stroke() { outlined.push(...path); },
  };
  const run = engine.createRun();
  const { x, y } = run.player;
  const enemy = { x: x + 240, y, hp: 10, kind: 0 };
  const boss = { x, y: y - 320, hp: 80, kind: 3 };
  run.enemies = [enemy, boss, { x, y: y + 100, hp: 0, kind: 0 }, { x, y: y + 960, hp: 10, kind: 0 }];
  drawMinimap(context, run);
  const center = MINIMAP_SIZE / 2;
  assert.equal(filled.length, 2);
  assert.ok(filled[0].x > center && filled[0].y === center);
  assert.ok(filled[1].x === center && filled[1].y < center);
  const bossPoint = filled[1];
  assert.ok(outlined.some(p => p.x === bossPoint.x && p.y === bossPoint.y && p.radius > bossPoint.radius));

  run.player.x += 300;
  boss.hp = 0;
  drawMinimap(context, run);
  assert.equal(filled.length, 1, 'dead and distant threats stay off the radar');
  assert.ok(filled[0].x < center, 'moving past the enemy flips it to the other side of the player');
});
