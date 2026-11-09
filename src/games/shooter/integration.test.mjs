import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist=fileURLToPath(new URL('../../../dist/',import.meta.url));
const assets=path.join(dist,'assets');
function walk(file,seen=new Set()){
  if(seen.has(file))return seen;seen.add(file);
  const text=fs.readFileSync(file,'utf8');
  for(const m of text.matchAll(/\bfrom\s*["'](\.\/[^"']+\.js)["']|\bimport\s*["'](\.\/[^"']+\.js)["']/g))walk(path.resolve(path.dirname(file),m[1]??m[2]),seen);
  return seen;
}
test('production bootstrap loads shared React without eagerly importing room or game',()=>{
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const entry=html.match(/<script[^>]+src="([^"]+)"/)[1];
  const files=[...walk(path.join(dist,entry))];
  assert.ok(files.some(f=>f.includes('react-vendor')));
  assert.ok(files.every(f=>!/(three-vendor|gsap-vendor|App-)/.test(f)));
  assert.ok(!html.includes('three-vendor'));
});
test('standalone dev route includes the real cartridge but skips Three.js and GSAP',()=>{
  const dev=fs.readdirSync(assets).find(f=>/^dev-.*\.js$/.test(f));assert.ok(dev);
  const files=[...walk(path.join(assets,dev))];
  assert.ok(files.every(f=>!/(three-vendor|gsap-vendor|App-)/.test(f)));
  assert.ok(files.some(f=>fs.readFileSync(f,'utf8').includes('imageSmoothingEnabled')));
});
test('room bundle retains the shooter dynamic-import slot',()=>{
  const app=fs.readdirSync(assets).find(f=>/^App-.*\.js$/.test(f));assert.ok(app);
  assert.ok(fs.readFileSync(path.join(assets,app),'utf8').includes('../../../games/shooter/index.tsx'));
  assert.ok([...walk(path.join(assets,app))].some(f=>f.includes('three-vendor')));
});
