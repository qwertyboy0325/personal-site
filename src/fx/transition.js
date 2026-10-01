// ASCII transitions: a grid of character cells that covers content and then
// resolves away. Pure logic + a draw(ctx) that only calls 2D-context methods,
// so it runs under Node with a fake context (see test/transition.test.mjs).
//
// Progress `p` goes 0 -> 1: at p = 0 every cell is covered, at p = 1 none is.
// For a "cover" phase the controller simply runs the same maths with 1 - p.

import { hash } from './rain.js';

export const EFFECTS = ['dissolve', 'scan', 'rain'];
export const TRANSITION_MODES = ['auto', ...EFFECTS, 'off'];
export const GLYPHS = [...'01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾﾀﾁﾂ#%&$@*+=<>/\\|{}[]:;'];

const TRAIL = 3; // rows of fading glyphs behind a scan / rain front
const LINGER = 0.07; // how long a dissolved cell lingers as a fading glyph
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const COVERED = Object.freeze({ bgA: 1, a: 0.55, lead: false });

/** State of the cell at (col,row), or null when it is fully revealed. */
export function cellState(effect, col, row, cols, rows, p, seed = 0) {
  if (p >= 1) return null;
  if (p <= 0) return COVERED;

  if (effect === 'dissolve') {
    const t = hash(col, row, seed);
    if (t > p) return COVERED;
    const u = (p - t) / LINGER; // 0 just resolved .. 1 gone
    return u < 1 ? { bgA: 0.6 * (1 - u), a: 1 - 0.5 * u, lead: u < 0.4 } : null;
  }

  // scan (one front for the whole grid) and rain (one front per column)
  let f;
  if (effect === 'rain') {
    const q = clamp01((p - hash(col, 7, seed) * 0.45) / 0.55);
    f = q * (rows + TRAIL + 1) - 1;
  } else {
    f = p * (rows + TRAIL - 0.5) - 0.5;
  }
  if (row >= f) return COVERED;
  const u = (f - row) / TRAIL; // 0 at the front .. 1 at the end of the trail
  if (u >= 1) return null;
  return { bgA: 0.9 - 0.8 * u, a: 1 - 0.6 * u, lead: u < 0.34 };
}

/**
 * Draw one frame. `colors` = { bg, dim, lead }. `region` optionally restricts
 * the cells drawn ({ c0, c1, r0, r1 }, end-exclusive). Returns { covered, total }.
 */
export function drawCells(ctx, o) {
  const { effect, p, cols, rows, cellW, cellH, seed = 0, frame = 0, colors, region } = o;
  const c0 = region?.c0 ?? 0;
  const c1 = Math.min(cols, region?.c1 ?? cols);
  const r0 = region?.r0 ?? 0;
  const r1 = Math.min(rows, region?.r1 ?? rows);
  const solid = []; // fully opaque runs: [x, y, w]
  const soft = []; // partially transparent cells: [x, y, alpha]
  const glyphs = []; // [char, x, y, alpha, lead]
  let covered = 0;

  for (let r = r0; r < r1; r++) {
    let runStart = -1;
    for (let c = c0; c <= c1; c++) {
      const s = c < c1 ? cellState(effect, c, r, cols, rows, p, seed) : null;
      const opaque = s?.bgA === 1;
      if (opaque && runStart < 0) runStart = c;
      if (!opaque && runStart >= 0) { solid.push([runStart * cellW, r * cellH, (c - runStart) * cellW]); runStart = -1; }
      if (!s) continue;
      covered++;
      if (!opaque) soft.push([c * cellW, r * cellH, s.bgA]);
      const ch = GLYPHS[Math.floor(hash(c, r, frame + seed) * GLYPHS.length)];
      glyphs.push([ch, c * cellW, r * cellH, s.a, s.lead]);
    }
  }

  ctx.fillStyle = colors.bg;
  for (const [x, y, w] of solid) ctx.fillRect(x, y, w, cellH);
  for (const [x, y, a] of soft) { ctx.globalAlpha = a; ctx.fillRect(x, y, cellW, cellH); }
  ctx.textBaseline = 'top';
  for (const lead of [false, true]) {
    ctx.fillStyle = lead ? colors.lead : colors.dim;
    for (const [ch, x, y, a, l] of glyphs) {
      if (l !== lead) continue;
      ctx.globalAlpha = a;
      ctx.fillText(ch, x, y + 1);
    }
  }
  ctx.globalAlpha = 1;
  return { covered, total: (c1 - c0) * (r1 - r0) };
}

export const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2);

/** Pick the effect for this transition ('auto' rotates through them). */
export function chooseEffect(mode, rand = Math.random) {
  if (EFFECTS.includes(mode)) return mode;
  return EFFECTS[Math.floor(rand() * EFFECTS.length)];
}
