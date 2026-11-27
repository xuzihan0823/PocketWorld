import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const entry = fileURLToPath(new URL('./mario-sandbox.tsx', import.meta.url));
const moduleDir = dirname(entry);
const { outputFiles: [compiled], metafile } = buildSync({
  entryPoints: [entry],
  absWorkingDir: moduleDir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.webp': 'dataurl' },
  external: ['react'],
  metafile: true,
  write: false,
});
const mod = { exports: {} };
new Function('module', 'require', compiled.text)(mod, createRequire(import.meta.url));
const { default: MarioSandbox, roomHref } = mod.exports;

test('sandbox exports a component and bundles the real game without room or other runtime dependencies', () => {
  assert.equal(typeof MarioSandbox, 'function');
  const inputs = Object.keys(metafile.inputs).map(path => resolve(moduleDir, path));
  assert.ok(inputs.includes(resolve(moduleDir, 'index.tsx')));
  assert.ok(inputs.includes(resolve(moduleDir, 'FishingGame.tsx')));
  const art = ['bay-dusk.webp', 'dock-street.webp', 'tackle-interior.webp', 'market-interior.webp', 'career-gallery.webp', 'tavern-mark.webp', 'seafood-menu.webp']
    .map(name => resolve(moduleDir, '../../../assets/games/ski', name));
  assert.ok(art.every(asset => inputs.includes(asset)));
  assert.ok(inputs.every(path => dirname(path) === moduleDir || path === resolve(moduleDir, '../../types/storageWrite.ts') || art.includes(path)), inputs.join('\n'));
});

test('room navigation removes all dev values but preserves path, other parameters and fragment', () => {
  const href = roomHref('https://example.test/pocket/?dev=mario&sun=.4&tag=a%20b&tag=%E6%BD%AE&flag=&dev=shooter#desk');
  const url = new URL(href);
  assert.equal(url.origin + url.pathname + url.hash, 'https://example.test/pocket/#desk');
  assert.deepEqual([...url.searchParams], [['sun', '.4'], ['tag', 'a b'], ['tag', '潮'], ['flag', '']]);
  assert.equal(roomHref('https://example.test/pocket/?dev=mario#desk'), 'https://example.test/pocket/#desk');
});
