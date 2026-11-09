import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const engineDirectory = resolve(root, 'src/games/shooter/survival/dist');
const pinballTest = 'src/games/shooter/engine.test.mjs';

for (const [entry, filename] of [
  ['src/games/shooter/survival/engine.ts', 'engine.cjs'],
  ['src/games/shooter/engine.ts', 'pinball-engine.cjs'],
]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'error',
    build: {
      target: 'node24',
      outDir: engineDirectory,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(root, entry),
        formats: ['cjs'],
        fileName: () => filename,
      },
    },
  });
}

const tests = globSync('src/**/*.test.mjs', { cwd: root })
  .filter(file => resolve(root, file) !== resolve(root, pinballTest))
  .sort();

for (const args of [
  ['--test', ...tests],
  [pinballTest, resolve(engineDirectory, 'pinball-engine.cjs')],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
