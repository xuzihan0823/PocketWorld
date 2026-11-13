import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { TRAILS } from './model.ts';
import { createRun } from './engine.ts';
import { playerBody, playerPivot, skiContacts } from './character.ts';

let source = await readFile(new URL('./renderer.ts', import.meta.url), 'utf8');
source += '\nexport { mountains, drawPlayer };';
source = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext });
for (const name of ['engine', 'model', 'character']) {
  source = source.replace(`'./${name}'`, JSON.stringify(new URL(`./${name}.ts`, import.meta.url).href));
}
const { mountains, drawPlayer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const niulaiConfig = JSON.parse(await readFile(new URL('../../../assets/games/ski/niulai/animations.json', import.meta.url), 'utf8'));

test('rider feet stay on both animated mount saddles at every roll angle and stance', () => {
  for (const kind of ['slide', 'charge']) for (const grounded of [false, true]) {
    for (const tucked of [false, true]) for (const angle of [0, .4, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
      for (let frame = 0; frame < 8; frame++) {
        const state = createRun('valley');
        const spec = niulaiConfig.actions[kind];
        Object.assign(state.player, { partner: kind, angle, grounded, tucked, squash: .5, flipping: !grounded });
        state.time = (frame + .2) / spec.fps;
        let matrix = [1, 0, 0, 1, 0, 0];
        const stack = [], draws = {};
        const multiply = ([a, b, c, d, e, f]) => {
          const [aa, bb, cc, dd, ee, ff] = matrix;
          matrix = [aa*a+cc*b, bb*a+dd*b, aa*c+cc*d, bb*c+dd*d, aa*e+cc*f+ee, bb*e+dd*f+ff];
        };
        const ctx = {
          save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
          translate(x, y) { multiply([1,0,0,1,x,y]); },
          rotate(a) { multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]); },
          scale(x, y) { multiply([x,0,0,y,0,0]); },
          drawImage(image, ...args) { draws[image] = { matrix: [...matrix], args }; },
        };
        const clip = image => ({ image, anchor: [150,220], frameWidth:280, frameHeight:260, frameCount:1, fps:1, row:0 });
        const mount = { image:'mount', anchor:spec.groundAnchor, rideAnchors:spec.rideAnchors,
          frameWidth:320, frameHeight:360, frameCount:8, fps:spec.fps, row:0 };
        drawPlayer(ctx, state, { rig: Object.fromEntries(['body','legs','skis'].map(name => [name,clip(name)])), niulai: { [kind]:mount } }, 240, 300, false);
        const project = (draw, point) => {
          const [a,b,c,d,e,f] = draw.matrix;
          const [, , sw, sh, dx, dy, dw, dh] = draw.args;
          const x = dx + point[0] * dw / sw, y = dy + point[1] * dh / sh;
          return { x:a*x+c*y+e, y:b*x+d*y+f };
        };
        const actualFrame = draws.mount.args[0] / 320;
        assert.equal(actualFrame, grounded ? frame : 0, 'airborne mount holds its leg pose');
        const seat = project(draws.mount, spec.rideAnchors[actualFrame]);
        const foot = project(draws.legs, [150,220]);
        assert.ok(Math.hypot(seat.x-foot.x, seat.y-foot.y) < 1e-7, `${kind}: saddle drift at ${angle}`);
        assert.ok(Math.abs(draws.mount.matrix[0] - draws.legs.matrix[0]) < 1e-9);
        assert.ok(Math.abs(draws.mount.matrix[1] - draws.legs.matrix[1]) < 1e-9);
        assert.equal(draws.skis, undefined, 'riding never draws detached skis');
      }
    }
  }
});

test('rendered body and ski transforms match collision volumes through landing and tuck poses', () => {
  for (const angle of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
    for (const tucked of [false, true]) {
      const state = createRun('valley');
      Object.assign(state.player, { angle, tucked, squash: 0.6 });
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack = [];
      const transforms = {};
      function multiply([a, b, c, d, e, f]) {
        const [aa, bb, cc, dd, ee, ff] = matrix;
        matrix = [aa * a + cc * b, bb * a + dd * b, aa * c + cc * d, bb * c + dd * d,
          aa * e + cc * f + ee, bb * e + dd * f + ff];
      }
      const ctx = {
        save() { stack.push([...matrix]); },
        restore() { matrix = stack.pop(); },
        translate(x, y) { multiply([1, 0, 0, 1, x, y]); },
        rotate(a) { multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
        scale(x, y) { multiply([x, 0, 0, y, 0, 0]); },
        drawImage(image) { transforms[image] = [...matrix]; },
      };
      const clip = image => ({ image, anchor: [150, 220], frameWidth: 280, frameHeight: 260, frameCount: 1, fps: 1, row: 0 });
      const rig = Object.fromEntries(['body', 'legs', 'skis'].map(layer => [layer, clip(layer)]));
      drawPlayer(ctx, state, { rig }, state.player.x, state.player.y, false);
      function verify(layer, point, expected) {
        const [a, b, c, d, e, f] = transforms[layer];
        assert.ok(Math.abs(a * point.x + c * point.y + e - expected.x) < 1e-9);
        assert.ok(Math.abs(b * point.x + d * point.y + f - expected.y) < 1e-9);
      }
      verify('body', { x: -1, y: -34 }, playerBody(state.player)[0]);
      verify('body', { x: 9, y: -63 }, playerBody(state.player)[2]);
      verify('skis', { x: -39, y: -2 }, skiContacts(state.player)[0]);
      verify('skis', { x: 39, y: -2 }, skiContacts(state.player)[2]);
    }
  }
});

test('crash and caught poses sit the unsquashed rig on the snow instead of flattening the standing pose', () => {
  for (const over of [false, true]) for (const angle of [-.3, 0, .3]) {
    const state = createRun('valley');
    Object.assign(state.player, { angle, crashTime: over ? 0 : 1 });
    state.over = over;
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [], transforms = {};
    const multiply = ([a, b, c, d, e, f]) => {
      const [aa, bb, cc, dd, ee, ff] = matrix;
      matrix = [aa*a+cc*b, bb*a+dd*b, aa*c+cc*d, bb*c+dd*d, aa*e+cc*f+ee, bb*e+dd*f+ff];
    };
    const ctx = {
      save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
      translate(x, y) { multiply([1,0,0,1,x,y]); },
      rotate(a) { multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]); },
      scale(x, y) { multiply([x,0,0,y,0,0]); },
      drawImage(image) { transforms[image] = [...matrix]; },
    };
    const clip = image => ({ image, anchor: [150, 220], frameWidth: 280, frameHeight: 260, frameCount: 1, fps: 1, row: 0 });
    const rig = Object.fromEntries(['body', 'legs', 'skis'].map(layer => [layer, clip(layer)]));
    drawPlayer(ctx, state, { rig, naiwa: {} }, 0, 0, true);
    assert.deepEqual(Object.keys(transforms).sort(), ['body', 'legs', 'skis']);
    for (const [a, b, c, d] of Object.values(transforms)) {
      assert.ok(Math.abs(Math.hypot(a, b) - Math.hypot(c, d)) < 1e-9, 'layers keep their proportions');
    }
    const [, , , , e, f] = transforms.legs;
    const pivot = playerPivot(state.player);
    const groundY = -Math.sin(angle) * e + Math.cos(angle) * (f + pivot) - pivot;
    assert.ok(groundY > -4 && groundY < 2, `feet rest on the slope (${groundY})`);
  }
});

function recordMountains(scroll, trail) {
  const fills = [];
  let path = [];
  const ctx = {
    beginPath() { path = []; },
    moveTo(...points) { path.push(['move', ...points]); },
    lineTo(...points) { path.push(['line', ...points]); },
    bezierCurveTo(...points) { path.push(['cubic', ...points]); },
    quadraticCurveTo(...points) { path.push(['quadratic', ...points]); },
    closePath() {},
    fill() { fills.push({ color: this.fillStyle, path }); },
  };
  mountains(ctx, scroll, trail);
  return fills;
}

for (const trail of TRAILS) {
  test(`${trail.id}: mountain silhouettes cover downhill views and join without vertical seams`, () => {
    for (const scroll of [-40, 0, 850 / .055 - .001, 850 / .055 + .001, 850 / .09 - .001, 850 / .09 + .001, 1e6]) {
      const fills = recordMountains(scroll, trail);
      const bodies = fills.filter(fill => fill.path.some(command => command[0] === 'cubic'));
      assert.equal(bodies.length, 2);
      for (const { path } of bodies) {
        assert.equal(path.filter(command => command[0] === 'move').length, 1);
        assert.ok(path[0][1] < 0);
        const lines = path.filter(command => command[0] === 'line');
        assert.equal(lines.length, 2, 'only the offscreen bottom may have straight closing edges');
        assert.ok(lines[0][1] > 800 && lines[1][1] < 0);
        assert.ok(lines.every(command => command[2] > 600), 'mountain fill must continue below the viewport');
        const ridge = path.slice(1, -2);
        for (let i = 1; i < ridge.length; i++) {
          const previous = ridge[i - 1], next = ridge[i];
          if (previous[0] !== 'cubic' || next[0] !== 'cubic') continue;
          const end = previous.slice(-2);
          if (end[1] !== path[0][2]) continue;
          assert.equal(previous[4], end[1], 'tile ends with a horizontal tangent');
          assert.equal(next[2], end[1], 'next tile starts at the same height and tangent');
          assert.ok(next[1] > end[0]);
        }
      }
    }
  });
}
