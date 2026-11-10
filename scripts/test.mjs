import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const engineDirectory = resolve(root, 'src/games/shooter/survival/dist');

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
      entry: resolve(root, 'src/games/shooter/survival/engine.ts'),
      formats: ['cjs'],
      fileName: () => 'engine.cjs',
    },
  },
});

const tests = globSync('src/**/*.test.mjs', { cwd: root }).sort();

const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
