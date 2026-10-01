import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, TRANSITION_MODES, GLYPHS, cellState, drawCells, easeInOut, chooseEffect } from '../src/fx/transition.js';

const COLORS = { bg: '#000', dim: '#0a0', lead: '#fff' };
const GRIDS = [[1, 1], [7, 3], [40, 12], [120, 30]];

function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    fillText: (...a) => calls.push(['fillText', ...a]),
  };
  return ctx;
}

const coveredCount = (effect, cols, rows, p, seed = 3) => {
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cellState(effect, c, r, cols, rows, p, seed)) n++;
  return n;
};

test('modes list the effects plus auto and off', () => {
  assert.deepEqual(EFFECTS, ['dissolve', 'scan', 'rain']);
  assert.deepEqual(TRANSITION_MODES, ['auto', 'dissolve', 'scan', 'rain', 'off']);
  assert.ok(GLYPHS.length > 20);
});

test('every effect: fully covered at p=0, fully revealed at p=1', () => {
  for (const effect of EFFECTS) {
    for (const [cols, rows] of GRIDS) {
      assert.equal(coveredCount(effect, cols, rows, 0), cols * rows, `${effect} ${cols}x${rows} p=0`);
      assert.equal(coveredCount(effect, cols, rows, 1), 0, `${effect} ${cols}x${rows} p=1`);
      assert.equal(coveredCount(effect, cols, rows, 1.5), 0, `${effect} p>1`);
      assert.equal(coveredCount(effect, cols, rows, -1), cols * rows, `${effect} p<0`);
    }
  }
});

test('every effect: the covered area never grows as progress increases', () => {
  for (const effect of EFFECTS) {
    for (const [cols, rows] of [[40, 12], [120, 30]]) {
      let prev = Infinity;
      for (let i = 0; i <= 100; i++) {
        const n = coveredCount(effect, cols, rows, i / 100);
        assert.ok(n <= prev, `${effect} ${cols}x${rows}: ${n} > ${prev} at step ${i}`);
        prev = n;
      }
    }
  }
});

test('cell state values are always valid', () => {
  for (const effect of EFFECTS) {
    for (let i = 1; i < 100; i++) {
      for (let r = 0; r < 12; r += 3) {
        for (let c = 0; c < 40; c += 5) {
          const s = cellState(effect, c, r, 40, 12, i / 100, 9);
          if (!s) continue;
          assert.ok(s.bgA > 0 && s.bgA <= 1, `bgA ${s.bgA}`);
          assert.ok(s.a > 0 && s.a <= 1, `a ${s.a}`);
          assert.equal(typeof s.lead, 'boolean');
        }
      }
    }
  }
});

test('cellState is deterministic for the same seed and differs between seeds', () => {
  const grid = (seed) => Array.from({ length: 200 }, (_, i) => JSON.stringify(cellState('dissolve', i % 20, Math.floor(i / 20), 20, 10, 0.5, seed)));
  assert.deepEqual(grid(1), grid(1));
  assert.notDeepEqual(grid(1), grid(2));
});

test('scan reveals from the top; the bottom is still covered mid-way', () => {
  assert.equal(cellState('scan', 5, 0, 20, 20, 0.5), null);
  assert.ok(cellState('scan', 5, 19, 20, 20, 0.5));
  // the whole row moves together
  for (let c = 0; c < 20; c++) assert.deepEqual(cellState('scan', c, 10, 20, 20, 0.5), cellState('scan', 0, 10, 20, 20, 0.5));
});

test('rain falls per column: columns are at different stages', () => {
  const states = Array.from({ length: 30 }, (_, c) => JSON.stringify(cellState('rain', c, 8, 30, 20, 0.4, 5)));
  assert.ok(new Set(states).size > 1, 'all columns identical');
});

test('dissolve is noisy: neighbouring cells resolve at different times', () => {
  const states = Array.from({ length: 60 }, (_, c) => cellState('dissolve', c, 0, 60, 1, 0.5, 1) === null);
  assert.ok(states.some(Boolean) && states.some((x) => !x));
});

test('drawCells: full cover merges each row into a single opaque run', () => {
  const ctx = fakeCtx();
  const out = drawCells(ctx, { effect: 'scan', p: 0, cols: 30, rows: 10, cellW: 9, cellH: 18, colors: COLORS });
  assert.deepEqual(out, { covered: 300, total: 300 });
  const rects = ctx.calls.filter((c) => c[0] === 'fillRect');
  assert.equal(rects.length, 10, 'one rect per row, not per cell');
  assert.deepEqual(rects[0], ['fillRect', 0, 0, 270, 18]);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillText').length, 300);
  assert.equal(ctx.globalAlpha, 1, 'alpha restored');
});

test('drawCells: nothing is drawn when fully revealed', () => {
  for (const effect of EFFECTS) {
    const ctx = fakeCtx();
    const out = drawCells(ctx, { effect, p: 1, cols: 30, rows: 10, cellW: 9, cellH: 18, colors: COLORS });
    assert.equal(out.covered, 0);
    assert.equal(ctx.calls.length, 0, effect);
  }
});

test('drawCells: region restricts what is drawn', () => {
  const ctx = fakeCtx();
  const out = drawCells(ctx, { effect: 'dissolve', p: 0, cols: 50, rows: 20, cellW: 9, cellH: 18, colors: COLORS, region: { c0: 10, c1: 20, r0: 5, r1: 8 } });
  assert.deepEqual(out, { covered: 30, total: 30 });
  for (const call of ctx.calls) {
    if (call[0] === 'fillRect') assert.ok(call[1] >= 90 && call[2] >= 90 && call[2] < 8 * 18, JSON.stringify(call));
  }
});

test('drawCells: every number handed to the canvas is finite', () => {
  for (const effect of EFFECTS) {
    for (const p of [0, 0.13, 0.5, 0.87, 0.999]) {
      const ctx = fakeCtx();
      drawCells(ctx, { effect, p, cols: 37, rows: 13, cellW: 8.4, cellH: 18, colors: COLORS, frame: 4, seed: 11 });
      for (const [kind, ...args] of ctx.calls) {
        for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${kind} ${a}`);
        if (kind === 'fillText') assert.ok(GLYPHS.includes(args[0]));
      }
    }
  }
});

test('drawCells: leading glyphs use the bright colour, the rest the dim colour', () => {
  const styles = new Set();
  const ctx = fakeCtx();
  Object.defineProperty(ctx, 'fillStyle', { set: (v) => styles.add(v), get: () => undefined });
  drawCells(ctx, { effect: 'scan', p: 0.5, cols: 20, rows: 20, cellW: 9, cellH: 18, colors: COLORS });
  assert.ok(styles.has(COLORS.bg) && styles.has(COLORS.dim) && styles.has(COLORS.lead));
});

test('easeInOut: endpoints and monotonic', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const v = easeInOut(i / 100); assert.ok(v >= prev); prev = v; }
});

test('chooseEffect: explicit modes win, auto picks any effect', () => {
  for (const e of EFFECTS) assert.equal(chooseEffect(e), e);
  assert.equal(chooseEffect('auto', () => 0), 'dissolve');
  assert.equal(chooseEffect('auto', () => 0.5), 'scan');
  assert.equal(chooseEffect('auto', () => 0.99), 'rain');
  assert.ok(EFFECTS.includes(chooseEffect('off')));
});
