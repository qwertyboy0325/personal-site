import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRain, GLYPHS, hash } from '../src/fx/rain.js';
import { renderFace, FACE } from '../src/fx/face.js';
import { execute, complete } from '../src/engine.js';
import { block } from '../src/render.js';

// A 2D-context stand-in that records what was drawn.
function fakeCtx() {
  const calls = { fillText: [], moveTo: 0, arc: 0, alphas: [] };
  return {
    calls,
    set font(v) {}, set textBaseline(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set globalAlpha(v) { calls.alphas.push(v); },
    fillText: (g, x, y) => calls.fillText.push([g, x, y]),
    beginPath() {}, moveTo() { calls.moveTo++; }, lineTo() {}, stroke() {}, fill() {},
    arc() { calls.arc++; },
  };
}
const seeded = (seed = 1) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

// ---- rain ----------------------------------------------------------------------
test('hash is deterministic and within [0, 1)', () => {
  assert.equal(hash(1, 2, 3), hash(1, 2, 3));
  for (let i = 0; i < 500; i++) { const v = hash(i, i * 7, i * 13); assert.ok(v >= 0 && v < 1); }
});

test('rain: draws only known glyphs, on the cell grid, within bounds', () => {
  const rain = createRain(seeded(7));
  rain.resize(800, 600);
  const ctx = fakeCtx();
  for (let i = 0; i < 120; i++) rain.update(0.016);
  rain.draw(ctx, 2.5, { head: '#fff', body: '#0f0' });
  assert.ok(ctx.calls.fillText.length > 0, 'something is drawn');
  for (const [g, x, y] of ctx.calls.fillText) {
    assert.ok(GLYPHS.includes(g), `unknown glyph ${g}`);
    assert.equal(x % rain.cell, 0);
    assert.equal(y % rain.cell, 0);
    assert.ok(x >= 0 && x < 800 && y >= 0 && y < 600 + rain.cell);
  }
  assert.ok(ctx.calls.alphas.every((a) => a >= 0 && a <= 1), 'alpha stays in range');
});

test('rain: lower quality levels draw fewer glyphs per frame', () => {
  const count = (level) => {
    const rain = createRain(seeded(3));
    rain.resize(1200, 800, level);
    const ctx = fakeCtx();
    rain.draw(ctx, 0, { head: '#fff', body: '#0f0' });
    return rain.columns;
  };
  assert.ok(count(1) < count(0) && count(2) < count(1));
});

test('rain: columns recycle, so the simulation never runs out', () => {
  const rain = createRain(seeded(11));
  rain.resize(400, 300);
  for (let i = 0; i < 4000; i++) rain.update(0.05); // 200 simulated seconds
  const ctx = fakeCtx();
  rain.draw(ctx, 1, { head: '#fff', body: '#0f0' });
  assert.ok(ctx.calls.fillText.length > 0);
});

// ---- face ----------------------------------------------------------------------
const lines = (s) => s.split('\n');

test('face: fits its grid and only uses printable ASCII once resolved', () => {
  const rows = lines(renderFace({ reveal: 1 }));
  assert.ok(rows.length <= FACE.h);
  for (const row of rows) {
    assert.ok(row.length <= FACE.w);
    assert.match(row, /^[\x20-\x7e]*$/);
  }
});

test('face: rendering is deterministic', () => {
  assert.equal(renderFace({ frame: 3, reveal: 0.5 }), renderFace({ frame: 3, reveal: 0.5 }));
});

test('face: blinking closes the eyes, gaze moves the pupils, talking opens the mouth', () => {
  const base = renderFace();
  assert.notEqual(renderFace({ blink: 1 }), base);
  assert.ok(!/@/.test(renderFace({ blink: 1 })), 'no pupils while blinking');
  assert.notEqual(renderFace({ look: { x: 1, y: 0 } }), base);
  assert.notEqual(renderFace({ look: { x: -1, y: 0.5 } }), renderFace({ look: { x: 1, y: 0.5 } }));
  assert.notEqual(renderFace({ talk: 1 }), base);
  assert.notEqual(renderFace({ smile: 0 }), renderFace({ smile: 1 }));
});

test('face: invert flips the shading for light backgrounds', () => {
  assert.notEqual(renderFace({ invert: true }), renderFace({ invert: false }));
});

test('face: the dissolve resolves progressively and ends on the clean face', () => {
  const clean = renderFace({ reveal: 1 });
  const early = renderFace({ reveal: 0.1, frame: 1 });
  const late = renderFace({ reveal: 0.9, frame: 1 });
  const diff = (a, b) => [...a].filter((c, i) => c !== b[i]).length;
  assert.ok(diff(early, clean) > diff(late, clean), 'less resolved = further from the final face');
  assert.equal(renderFace({ reveal: 1.5, frame: 99 }), clean);
});

test('face: never emits NaN or undefined for extreme inputs', () => {
  for (const s of [{ look: { x: 9, y: -9 } }, { talk: 5 }, { blink: -3 }, { smile: 7 }, { reveal: -1 }]) {
    const out = renderFace(s);
    assert.ok(!/NaN|undefined/.test(out), JSON.stringify(s));
  }
});

// ---- commands and rendering ----------------------------------------------------
const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], ...over });
const text = (blocks) => JSON.stringify(blocks);

test('the old background, cursor and overview settings are gone: the page is lit by its photographs now', () => {
  for (const name of ['fx', 'cursor', 'hud', 'gui']) {
    assert.match(text(execute(name, ctx()).blocks), /command not found/, name);
    assert.ok(!complete(name.slice(0, 2)).options.includes(name), name);
  }
});

test('ascii command: returns an accessible, animatable face block with a static frame', () => {
  const out = execute('ascii', ctx());
  const face = out.blocks.find((b) => b.t === 'asciiface');
  assert.ok(face && face.v.includes('\n'));
  const html = block(face);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Animated ASCII face"/);
  assert.match(html, /data-ascii-face/);
  assert.equal(execute('ascii', ctx({ theme: 'light' })).blocks[0].v === face.v, false, 'light theme inverts the ramp');
});

test('ascii block escapes its content (no markup injection)', () => {
  const html = block({ t: 'asciiface', v: '<img src=x onerror=alert(1)>', label: '"><script>' });
  assert.ok(!html.includes('<img') && !html.includes('<script'));
});
