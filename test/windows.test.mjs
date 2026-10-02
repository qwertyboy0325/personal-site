import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampToViewport, cascadePosition, stackZ, MAX_WINDOWS, Z_BASE, MOVE_STEP } from '../src/windows.js';
import { fileName, metaLine, wrapIndex } from '../src/viewer-content.js';
import { gallery } from '../src/content.js';

const VW = 1440;
const VH = 900;

test('clampToViewport: a window can be dragged anywhere but never off screen', () => {
  assert.deepEqual(clampToViewport(100, 100, 400, 300, VW, VH), { x: 100, y: 100 });
  assert.deepEqual(clampToViewport(-500, -500, 400, 300, VW, VH), { x: 8, y: 8 }, 'top-left is held at the margin');
  assert.deepEqual(clampToViewport(5000, 5000, 400, 300, VW, VH), { x: VW - 400 - 8, y: VH - 300 - 8 }, 'bottom-right too');
  assert.deepEqual(clampToViewport(VW - 400 - 8, VH - 300 - 8, 400, 300, VW, VH), { x: VW - 408, y: VH - 308 }, 'exactly at the limit is allowed');
});

test('clampToViewport: a window bigger than the viewport pins to the margin instead of going negative', () => {
  assert.deepEqual(clampToViewport(300, 300, 2000, 2000, VW, VH), { x: 8, y: 8 });
  const p = clampToViewport(0, 0, VW, VH, VW, VH);
  assert.ok(p.x >= 8 && p.y >= 8);
});

test('clampToViewport: never returns NaN, even for odd input sizes', () => {
  for (const [w, h, vw, vh] of [[0, 0, 0, 0], [1, 1, 1, 1], [400, 300, 100, 100], [520, 600, 320, 480]]) {
    const p = clampToViewport(50, 50, w, h, vw, vh);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify([w, h, vw, vh, p]));
  }
});

test('cascadePosition: each new window steps down-right, stays on screen, and wraps instead of walking away', () => {
  const w = 520;
  const h = 560;
  const first = cascadePosition(0, w, h, VW, VH);
  const second = cascadePosition(1, w, h, VW, VH);
  assert.ok(second.x > first.x && second.y > first.y, 'cascades');
  assert.equal(second.x - first.x, 30);
  for (let n = 0; n < 20; n++) {
    const p = cascadePosition(n, w, h, VW, VH);
    assert.ok(p.x >= 8 && p.y >= 8 && p.x + w <= VW - 8 + 0.0001 && p.y + h <= VH - 8 + 0.0001, `window ${n} at ${JSON.stringify(p)}`);
  }
  assert.deepEqual(cascadePosition(MAX_WINDOWS, w, h, VW, VH), first, 'it wraps after MAX_WINDOWS');
});

test('cascadePosition: works on a small laptop screen too', () => {
  for (let n = 0; n < MAX_WINDOWS; n++) {
    const p = cascadePosition(n, 520, 560, 1000, 640);
    assert.ok(p.x >= 8 && p.y >= 8, JSON.stringify(p));
  }
});

test('stackZ: back to front gets strictly increasing z-indexes starting at Z_BASE', () => {
  assert.deepEqual(stackZ([]), []);
  assert.deepEqual(stackZ(['a', 'b', 'c']), [Z_BASE, Z_BASE + 1, Z_BASE + 2]);
  assert.ok(Z_BASE + MAX_WINDOWS < 60, 'windows stay below the page wipe (60), the reticle (70) and the toast (90)');
});

test('wrapIndex: ← from the first goes to the last, → from the last goes to the first', () => {
  assert.equal(wrapIndex(0, 4), 0);
  assert.equal(wrapIndex(-1, 4), 3);
  assert.equal(wrapIndex(4, 4), 0);
  assert.equal(wrapIndex(5, 4), 1);
  assert.equal(wrapIndex(-5, 4), 3);
  assert.equal(wrapIndex(2.7, 4), 2, 'fractions are truncated');
});

test('fileName and metaLine describe each gallery item like an OS window would', () => {
  assert.equal(fileName('assets/gallery/black-hole-scene.jpg'), 'black-hole-scene.jpg');
  assert.equal(fileName('plain.png'), 'plain.png');
  for (const g of gallery) {
    assert.match(fileName(g.src), /^[a-z0-9-]+\.(jpg|mp4)$/);
    assert.match(metaLine(g), new RegExp(`^${g.width}×${g.height} · (JPG|MP4)$`));
  }
});

test('keyboard moving: the step is a sensible size', () => {
  assert.ok(MOVE_STEP >= 8 && MOVE_STEP <= 64);
});

test('windows.js: accessible dialog markup, text only, Esc/arrows handled, drag does not hijack buttons or touch', async () => {
  const src = await readFile(new URL('../src/windows.js', import.meta.url), 'utf8');
  assert.match(src, /setAttribute\('role', 'dialog'\)/);
  assert.match(src, /setAttribute\('aria-modal', 'false'\)/, 'non-modal: the rest of the page stays usable');
  assert.match(src, /aria-labelledby/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /e\.altKey && e\.key\.startsWith\('Arrow'\)/, 'a keyboard alternative to dragging');
  assert.match(src, /e\.pointerType === 'touch'/, 'no dragging on touch');
  assert.match(src, /e\.target\.closest\('button'\)/, 'the close button is not a drag handle');
  assert.match(src, /setPointerCapture/);
  assert.match(src, /!e\.target\.closest\?\.\('video'\)/, 'arrow keys are left to the video controls');
  assert.ok(!/innerHTML\s*=\s*[^`]*\$\{(?!id)/.test(src), 'no content interpolated into innerHTML');
  assert.match(src, /stopMedia\(w\.stage\)/, 'video is stopped when closing or switching');
  assert.match(src, /isConnected/, 'focus goes back to the opener only if it still exists');
});

test('styles: windows sit above the page and below the wipe, reticle and toast; the close button is touch sized; motion respects the setting', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#windows \{[^}]*pointer-events: none/, 'the layer never blocks the page');
  assert.match(css, /\.win \{[^}]*pointer-events: auto/);
  assert.match(css, /\.wclose, \.wprev, \.wnext \{[^}]*min-height: 44px/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{ \.win \{ animation: win-in/, 'the open animation only runs when motion is allowed');
  assert.match(css, /\.wbar \{[^}]*touch-action: none/);
  assert.match(css, /\.win\.is-front \{/);
});

test('main.js: wide screens with a mouse use windows, everything else uses the modal dialog', async () => {
  const js = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(js, /\(min-width: 1000px\) and \(hover: hover\) and \(pointer: fine\)/);
  assert.match(js, /floatingViewer\.matches \? windows\.open\(index, from\) : lightbox\.open\(index, from\)/);
  assert.match(js, /windows\.refresh\(\)/, 'language changes reach open windows');
});
