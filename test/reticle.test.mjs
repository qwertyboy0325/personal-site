import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CURSOR_MODES, LABEL_W, LABEL_H, IDLE_MS, BURST_GLYPHS, burstParticles, formatCoords, labelPlacement, describeTarget, ease } from '../src/fx/reticle.js';
import { execute, complete, PUBLIC_COMMANDS } from '../src/engine.js';
import { renderBlocks } from '../src/render.js';

const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], ...over });
const text = (line, c) => renderBlocks(execute(line, c ?? ctx()).blocks).replace(/<[^>]+>/g, '');

test('formatCoords pads to four digits and never goes negative', () => {
  assert.equal(formatCoords(812, 304), 'X 0812  Y 0304');
  assert.equal(formatCoords(0, 0), 'X 0000  Y 0000');
  assert.equal(formatCoords(-5, -1), 'X 0000  Y 0000');
  assert.equal(formatCoords(12.6, 7.4), 'X 0013  Y 0007');
  assert.equal(formatCoords(12345, 1), 'X 12345  Y 0001');
});

test('labelPlacement keeps the label on screen from every edge and corner', () => {
  const vw = 1280;
  const vh = 800;
  for (const x of [0, 1, 400, vw - 1, vw]) {
    for (const y of [0, 1, 400, vh - 1, vh]) {
      const p = labelPlacement(x, y, vw, vh);
      assert.ok(p.x >= 4 && p.x + LABEL_W <= vw, `x=${x} -> ${p.x}`);
      assert.ok(p.y >= 4 && p.y + LABEL_H <= vh, `y=${y} -> ${p.y}`);
    }
  }
  assert.deepEqual(labelPlacement(100, 100, vw, vh), { x: 120, y: 120 }, 'default is below-right of the tip');
  assert.ok(labelPlacement(vw - 10, 100, vw, vh).x < vw - 10, 'flips to the left near the right edge');
  assert.ok(labelPlacement(100, vh - 10, vw, vh).y < vh - 10, 'flips above near the bottom edge');
});

const el = (props, closestResult = 'self') => ({ ...props, closest() { return closestResult === 'self' ? this : closestResult; } });

test('describeTarget: nothing clickable means seeking', () => {
  assert.deepEqual(describeTarget(null), { lock: false, text: 'SEEK' });
  assert.deepEqual(describeTarget(undefined), { lock: false, text: 'SEEK' });
  assert.deepEqual(describeTarget(el({}, null)), { lock: false, text: 'SEEK' });
});

test('describeTarget: command buttons lock on and name the command', () => {
  assert.deepEqual(describeTarget(el({ dataset: { cmd: 'project 1' }, tagName: 'BUTTON' })), { lock: true, text: 'LOCK ▸ project 1' });
  assert.ok(describeTarget(el({ dataset: { cmd: 'x'.repeat(80) } })).text.length <= 22, 'long names are truncated');
});

test('describeTarget: links show the host, inputs do not lock', () => {
  assert.deepEqual(describeTarget(el({ tagName: 'A', href: 'https://www.github.com/x/y' })), { lock: true, text: 'LINK ↗ github.com' });
  assert.equal(describeTarget(el({ tagName: 'A', href: 'not a url' })).lock, true);
  assert.deepEqual(describeTarget(el({ tagName: 'INPUT' })), { lock: false, text: 'INPUT ▌' });
  assert.deepEqual(describeTarget(el({ tagName: 'BUTTON' })), { lock: true, text: 'LOCK ▸ button' });
});

test('ease converges and snaps, never overshoots', () => {
  let v = 0;
  for (let i = 0; i < 60; i++) { v = ease(v, 100, 0.34); assert.ok(v <= 100); }
  assert.equal(v, 100);
  assert.equal(ease(5, 5, 0.3), 5);
  assert.equal(ease(100, 0, 1), 0);
});

test('cursor command: show, set, reject, in both languages', () => {
  assert.deepEqual(CURSOR_MODES, ['full', 'minimal', 'off']);
  assert.match(text('cursor', ctx({ cursor: 'full' })), /cursor: full/);
  for (const m of CURSOR_MODES) assert.deepEqual(execute(`cursor ${m.toUpperCase()}`, ctx()).effects, [{ type: 'cursor', value: m }]);
  const bad = execute('cursor huge', ctx());
  assert.deepEqual(bad.effects, []);
  assert.match(renderBlocks(bad.blocks), /unknown mode/);
  assert.match(text('cursor minimal', ctx({ lang: 'zh' })), /準星游標/);
});

test('cursor is a listed, completable command', () => {
  assert.ok(PUBLIC_COMMANDS.includes('cursor'));
  assert.equal(complete('cursor m').line, 'cursor minimal ');
  assert.equal(complete('cur').line, 'cursor ');
});

test('cursor assets exist, are valid standalone SVGs and contain nothing active', async () => {
  for (const name of ['cursor.svg', 'cursor-hot.svg']) {
    const svg = await readFile(new URL(`../assets/${name}`, import.meta.url), 'utf8');
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /width="24" height="24"/, 'small on purpose: the cursor should not dominate the page');
    assert.ok(!/<script|\son\w+=|href=|<image|<foreignObject/i.test(svg), name);
  }
});

test('stylesheet wires the cursor assets, a visible focus ring survives, and touch hides the reticle', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /cursor:\s*url\("\.\.\/assets\/cursor\.svg"\)\s*12 12,\s*crosshair/);
  assert.match(css, /cursor-hot\.svg"\)\s*12 12,\s*pointer/);
  assert.match(css, /html\.rt-on input\s*\{\s*cursor:\s*text/, 'text fields keep the I-beam');
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*#reticle\s*\{\s*display:\s*none/);
});

test('burstParticles: eight retro glyphs, one per 45 degrees, landing on whole pixels', () => {
  const ps = burstParticles();
  assert.equal(ps.length, 8);
  assert.deepEqual(ps[0], { glyph: BURST_GLYPHS[0], dx: 26, dy: 0 });
  assert.deepEqual(ps[2], { glyph: BURST_GLYPHS[2], dx: 0, dy: 26 });
  assert.deepEqual(ps[4], { glyph: BURST_GLYPHS[4], dx: -26, dy: 0 });
  for (const p of ps) {
    assert.ok(Number.isInteger(p.dx) && Number.isInteger(p.dy), 'whole pixels, like a retro sprite');
    assert.ok(BURST_GLYPHS.includes(p.glyph));
    assert.ok(Math.hypot(p.dx, p.dy) > 24 && Math.hypot(p.dx, p.dy) < 28, 'all particles land on the same radius');
  }
  assert.equal(new Set(ps.map((p) => `${p.dx},${p.dy}`)).size, 8, 'every direction is distinct');
  assert.equal(burstParticles(10)[0].dx, 10);
  assert.equal(burstParticles(10, ['#'])[3].glyph, '#', 'glyph list wraps around');
});

test('the click effect is stepped (retro), not a smooth tween', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.rt-px \{[^}]*animation: rt-px [\d.]+s steps\(\d+, end\)/);
  assert.match(css, /\.rt-box \{[^}]*animation: rt-box [\d.]+s steps\(\d+, end\)/);
  assert.ok(!css.includes('rt-ping'), 'the old smooth ripple is gone');
});

test('the reticle is quiet by default: hairlines only in full mode, label fades at rest', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.rt-h, \.rt-v \{ display: none;/);
  assert.match(css, /#reticle\[data-mode="full"\] \.rt-h/);
  assert.match(css, /#reticle\.rt-idle \.rt-label \{ opacity: 0; \}/);
  assert.match(css, /\.rt-tgt \{ display: none;/, 'the "SEEK" line only appears when something is locked');
  assert.ok(IDLE_MS >= 800 && IDLE_MS <= 3000);
  assert.ok(LABEL_W <= 130 && LABEL_H <= 44, 'the label stays small');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /finePointer \? 'minimal' : 'off'/, 'default mode is the quiet one');
});
