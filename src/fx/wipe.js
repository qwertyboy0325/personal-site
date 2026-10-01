// DOM side of the ASCII transitions (see transition.js for the maths).
//
//  revealEntry(el)  a canvas laid over a freshly printed entry that dissolves
//                   away. The entry's real text is never touched, so screen
//                   readers, selection and copy/paste are unaffected.
//  run(swap, opts)  a page-level wipe: cover -> swap() -> reveal. Used for
//                   theme / language / clear so the state change happens while
//                   everything is hidden behind glyphs.
//
// Everything is decorative (aria-hidden, no pointer events), skipped under
// prefers-reduced-motion, in a hidden tab, or when the mode is 'off'.

import { drawCells, easeInOut, chooseEffect } from './transition.js';

const FONT_PX = 14;
const CELL_H = 18;
const COVER_MS = 280;
const REVEAL_MS = 400;
const MAX_ENTRY_OVERLAYS = 3;

export function createTransitions({ wipeCanvas, getColors, getMode, reduceMotion = false }) {
  let overlays = 0;
  let wipe = null;
  const enabled = () => !reduceMotion && getMode() !== 'off' && !document.hidden;
  const dprFor = (cap) => Math.min(devicePixelRatio || 1, cap);
  const family = () => getComputedStyle(document.body).fontFamily || 'monospace';

  function cellWidth(ctx) {
    ctx.font = `${FONT_PX}px ${family()}`;
    return Math.max(6, ctx.measureText('M').width || 8.4);
  }

  function revealEntry(el) {
    if (!enabled() || overlays >= MAX_ENTRY_OVERLAYS) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'reveal-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const dpr = dprFor(2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    el.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cellW = cellWidth(ctx);
    const cols = Math.ceil(w / cellW);
    const rows = Math.ceil(h / CELL_H);
    const effect = chooseEffect(getMode());
    const seed = Math.floor(Math.random() * 1e6);
    const duration = Math.min(950, Math.max(420, 300 + rows * 22));
    const colors = getColors();
    const start = performance.now();
    overlays++;

    const done = () => { canvas.remove(); overlays--; };
    const step = (now) => {
      if (!canvas.isConnected) { overlays--; return; } // e.g. the log was cleared meanwhile
      const t = (now - start) / duration;
      if (t >= 1) { done(); return; }
      ctx.clearRect(0, 0, w, h);
      drawCells(ctx, { effect, p: easeInOut(t), cols, rows, cellW, cellH: CELL_H, seed, frame: Math.floor((now - start) / 70), colors });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Cover the page (or `rect`) in glyphs, run swap(), then dissolve to the new state. */
  function run(swap, { rect } = {}) {
    if (!enabled()) { swap(); return; }
    wipe?.finish(); // an earlier wipe completes instantly, including its swap

    const canvas = wipeCanvas;
    const dpr = 1; // glyph noise does not need a retina backing store
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.hidden = false;
    const ctx = canvas.getContext('2d');
    const cellW = cellWidth(ctx);
    const cols = Math.ceil(innerWidth / cellW);
    const rows = Math.ceil(innerHeight / CELL_H);
    const region = rect ? { c0: Math.floor(rect.left / cellW), c1: Math.ceil(rect.right / cellW), r0: Math.floor(rect.top / CELL_H), r1: Math.ceil(rect.bottom / CELL_H) } : undefined;
    const effect = chooseEffect(getMode());
    const seed = Math.floor(Math.random() * 1e6);
    let colors = getColors();
    let swapped = false;
    let raf = 0;
    let fallback = 0;

    const doSwap = () => {
      if (swapped) return;
      swapped = true;
      try { swap(); } finally { colors = getColors(); } // the new theme's colours reveal the new state
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      doSwap();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.hidden = true;
      document.removeEventListener('visibilitychange', onHidden);
      if (wipe?.finish === finish) wipe = null;
    };
    const onHidden = () => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', onHidden);
    fallback = setTimeout(finish, COVER_MS + REVEAL_MS + 800); // never leave the page covered
    wipe = { finish };

    const start = performance.now();
    const draw = (p, now) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCells(ctx, { effect, p, cols, rows, cellW, cellH: CELL_H, seed, frame: Math.floor((now - start) / 70), colors, region });
    };
    const step = (now) => {
      const t = now - start;
      if (t < COVER_MS) {
        draw(1 - easeInOut(t / COVER_MS), now); // covering: progress runs backwards
      } else {
        if (!swapped) { draw(0, now); doSwap(); }
        const u = (t - COVER_MS) / REVEAL_MS;
        if (u >= 1) { finish(); return; }
        draw(easeInOut(u), now);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /** Finish any running page wipe now (its swap included), so the next command sees the final state. */
  const settle = () => wipe?.finish();

  return { revealEntry, run, settle };
}
