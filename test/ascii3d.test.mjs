import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SIZE, RAMP, surfacePoints, rasterize, renderFrame, REST_POSE } from '../src/fx/ascii3d.js';
import { execute, complete, PUBLIC_COMMANDS } from '../src/engine.js';
import { block } from '../src/render.js';

const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], ...over });
const nonSpace = (s) => [...s].filter((c) => c !== ' ' && c !== '\n').length;

test('shapes: the list and the resting pose', () => {
  assert.deepEqual(SHAPES, ['donut', 'cube', 'sphere']);
  assert.ok(SIZE.cols >= 40 && SIZE.rows >= 20);
  assert.ok(Object.values(REST_POSE).every(Number.isFinite));
});

test('surface samples: bounded count, unit normals, finite numbers, cached', () => {
  for (const shape of SHAPES) {
    const pts = surfacePoints(shape);
    assert.ok(pts.length > 3000 && pts.length < 30000, `${shape}: ${pts.length} points`);
    for (const p of pts.filter((_, i) => i % 97 === 0)) {
      for (const k of ['x', 'y', 'z', 'nx', 'ny', 'nz']) assert.ok(Number.isFinite(p[k]), `${shape}.${k}`);
      assert.ok(Math.abs(Math.hypot(p.nx, p.ny, p.nz) - 1) < 1e-9, `${shape}: normal is not unit length`);
    }
    assert.equal(surfacePoints(shape), pts, 'second call returns the cached array');
  }
  assert.throws(() => surfacePoints('teapot'), RangeError);
});

test('every shape renders inside the grid using only ramp characters', () => {
  for (const shape of SHAPES) {
    const out = renderFrame({ shape, ...REST_POSE });
    const lines = out.split('\n');
    assert.equal(lines.length, SIZE.rows, `${shape} rows`);
    for (const line of lines) assert.ok(line.length <= SIZE.cols, `${shape}: line too wide`);
    for (const ch of out) assert.ok(ch === '\n' || RAMP.includes(ch), `${shape}: unexpected "${ch}"`);
    const fill = nonSpace(out) / (SIZE.cols * SIZE.rows);
    assert.ok(fill > 0.06 && fill < 0.6, `${shape}: ${(fill * 100).toFixed(1)}% filled`);
  }
});

test('rendering is deterministic', () => {
  for (const shape of SHAPES) assert.equal(renderFrame({ shape, ax: 1.1, ay: 2.2 }), renderFrame({ shape, ax: 1.1, ay: 2.2 }));
});

test('rotating changes the picture; different shapes look different', () => {
  for (const shape of SHAPES) assert.notEqual(renderFrame({ shape, ax: 0.2, ay: 0.3 }), renderFrame({ shape, ax: 0.9, ay: 1.4 }), shape);
  const frames = SHAPES.map((shape) => renderFrame({ shape, ...REST_POSE }));
  assert.equal(new Set(frames).size, SHAPES.length);
});

test('a full turn returns to the start (rotation maths is consistent)', () => {
  for (const shape of ['donut', 'sphere']) {
    assert.equal(renderFrame({ shape, ax: 0.4, ay: 0.4 }), renderFrame({ shape, ax: 0.4 + Math.PI * 2, ay: 0.4 + Math.PI * 2 }), shape);
  }
});

test('z-buffer: the nearer surface wins a cell, whatever the order', () => {
  // Two points on the same line of sight; the near one faces the light, the far one faces away.
  const bright = { x: 0, y: 0, z: -0.5, nx: -0.4, ny: 0.6, nz: -0.7 };
  const dark = { x: 0, y: 0, z: 0.5, nx: 0.4, ny: -0.6, nz: 0.7 };
  const opts = { cols: 3, rows: 3, scale: 4 };
  const a = rasterize([bright, dark], opts);
  const b = rasterize([dark, bright], opts);
  assert.equal(a, b, 'order of points must not matter');
  assert.equal(a.split('\n')[1].trim(), RAMP.at(-1), 'the near, lit point is drawn (brightest mark)');
  assert.equal(rasterize([dark], opts).split('\n')[1].trim(), RAMP[1], 'alone, the far unlit point gets the dimmest mark');
});

test('lighting: the side facing the light is brighter than the side facing away', () => {
  const level = (ch) => RAMP.indexOf(ch);
  const rows = renderFrame({ shape: 'sphere', ax: 0, ay: 0 }).split('\n');
  const mid = rows[Math.floor(SIZE.rows / 2)];
  const first = [...mid].findIndex((c) => c !== ' ');
  const lastIdx = mid.length - 1;
  const upperLeft = level(rows[Math.floor(SIZE.rows / 2) - 4][Math.floor(SIZE.cols / 2) - 8]);
  const lowerRight = level(rows[Math.floor(SIZE.rows / 2) + 4][Math.floor(SIZE.cols / 2) + 8]);
  assert.ok(upperLeft > lowerRight, `upper-left ${upperLeft} should be brighter than lower-right ${lowerRight}`);
  assert.ok(first >= 0 && lastIdx > first);
});

test('invert uses the opposite end of the ramp for the same picture', () => {
  const normal = renderFrame({ shape: 'sphere', ...REST_POSE });
  const inverted = renderFrame({ shape: 'sphere', ...REST_POSE, invert: true });
  assert.notEqual(normal, inverted);
  const shape = (s) => [...s].map((c) => (c === ' ' || c === '\n' ? c : 'x')).join('');
  assert.equal(shape(normal), shape(inverted), 'same silhouette');
  const n = RAMP.length;
  [...normal].forEach((c, i) => {
    if (c === ' ' || c === '\n') return;
    assert.equal(RAMP.indexOf(inverted[i]), n - RAMP.indexOf(c), 'mirrored level');
  });
});

test('hostile input never produces NaN, undefined or an exception', () => {
  const weird = [NaN, Infinity, -Infinity, 1e12, -1e12, undefined, null, 'x'];
  for (const shape of SHAPES) {
    for (const v of weird) {
      const out = renderFrame({ shape, ax: v, ay: v, az: v });
      assert.ok(!/NaN|undefined|Infinity/.test(out), `${shape} ${v}`);
      assert.ok(out.split('\n').length <= SIZE.rows);
    }
  }
  for (const [cols, rows] of [[1, 1], [0, 0], [-5, -5], [3.7, 2.2], [200, 100]]) {
    const out = rasterize(surfacePoints('donut'), { cols, rows });
    assert.ok(out.split('\n').length === Math.max(1, Math.floor(rows)));
  }
  assert.doesNotThrow(() => rasterize([], {}));
  assert.equal(rasterize([], { cols: 4, rows: 2 }), '\n', 'empty scene is blank');
});

test('a point behind the camera is not drawn', () => {
  const behind = { x: 0, y: 0, z: -10, nx: 0, ny: 0, nz: -1 };
  assert.equal(nonSpace(rasterize([behind], { cols: 9, rows: 5 })), 0);
});

test('performance guard: 30 frames of every shape stay well under a second and a half', () => {
  const start = performance.now();
  for (let i = 0; i < 30; i++) for (const shape of SHAPES) renderFrame({ shape, ax: i * 0.1, ay: i * 0.17 });
  const ms = performance.now() - start;
  assert.ok(ms < 1500, `${ms.toFixed(0)}ms for 90 frames`);
});

// ---- the `3d` command ------------------------------------------------------------
const model = (line, c = ctx()) => execute(line, c).blocks.find((b) => b.t === 'ascii3d');

test('3d command: default shape, named shapes, aliases', () => {
  assert.ok(PUBLIC_COMMANDS.includes('3d'));
  assert.equal(model('3d').shape, 'donut');
  for (const s of SHAPES) assert.equal(model(`3d ${s}`).shape, s);
  assert.equal(model('3d CUBE').shape, 'cube');
  assert.equal(model('donut').shape, 'donut');
  assert.equal(model('cube').shape, 'cube');
  assert.equal(model('sphere').shape, 'sphere');
  assert.equal(model('torus').shape, 'donut');
});

test('3d command: unknown shape is rejected with the list of shapes', () => {
  const out = execute('3d teapot', ctx());
  assert.equal(out.blocks.some((b) => b.t === 'ascii3d'), false);
  assert.match(JSON.stringify(out.blocks), /teapot.*donut, cube, sphere|donut, cube, sphere/);
});

test('3d block: a static frame is included, labelled, and lighter on light themes', () => {
  const dark = model('3d', ctx({ theme: 'dark' }));
  const light = model('3d', ctx({ theme: 'light' }));
  assert.ok(dark.v.includes('\n') && nonSpace(dark.v) > 100);
  assert.notEqual(dark.v, light.v, 'light theme inverts the ramp');
  assert.ok(dark.label.length > 5);
  const html = block(dark);
  assert.match(html, /<pre class="art ascii3d" role="img" aria-label="[^"]+" data-ascii3d data-shape="donut">/);
});

test('3d block escapes its content and label', () => {
  const html = block({ t: 'ascii3d', shape: '"><script>', v: '<img src=x onerror=alert(1)>', label: '"><b>x' });
  assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b>'), html);
});

test('3d command: localised and completable', () => {
  assert.match(JSON.stringify(execute('3d', ctx({ lang: 'zh' })).blocks), /立體|3D|轉/);
  assert.equal(complete('3d c').line, '3d cube ');
  assert.deepEqual(complete('3d s'), { line: '3d sphere ', options: [] });
  assert.equal(complete('3').line, '3d ');
});

test('the picture is centred on the grid (no half-cell drift to the right or down)', () => {
  for (const shape of ['sphere', 'donut']) {
    const lines = renderFrame({ shape, ax: 0, ay: 0, az: 0 }).split('\n');
    const cols = [];
    const rowsHit = [];
    lines.forEach((line, r) => { [...line].forEach((ch, c) => { if (ch !== ' ') { cols.push(c); rowsHit.push(r); } }); });
    const mid = (v) => (Math.min(...v) + Math.max(...v) + 1) / 2; // +1: a cell spans [k, k+1)
    assert.ok(Math.abs(mid(cols) - SIZE.cols / 2) <= 1, `${shape}: horizontal centre ${mid(cols)} vs ${SIZE.cols / 2}`);
    assert.ok(Math.abs(mid(rowsHit) - SIZE.rows / 2) <= 1, `${shape}: vertical centre ${mid(rowsHit)} vs ${SIZE.rows / 2}`);
  }
});
