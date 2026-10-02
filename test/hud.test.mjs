import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatClock, formatUptime, sessionId, formatSpeed, pushSample, sparkPoints, recentCommands } from '../src/hud-format.js';
import { execute, complete, PUBLIC_COMMANDS, HUD_MODES } from '../src/engine.js';
import { projects, THEMES, ui } from '../src/content.js';
import { renderBlocks } from '../src/render.js';

const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], ...over });
const text = (line, c) => renderBlocks(execute(line, c ?? ctx()).blocks).replace(/<[^>]+>/g, '');

test('formatClock is zero-padded 24-hour time', () => {
  assert.equal(formatClock(new Date(2026, 9, 1, 9, 5, 3)), '09:05:03');
  assert.equal(formatClock(new Date(2026, 9, 1, 0, 0, 0)), '00:00:00');
  assert.equal(formatClock(new Date(2026, 9, 1, 23, 59, 59)), '23:59:59');
});

test('formatUptime: MM:SS, then H:MM:SS, never negative', () => {
  assert.equal(formatUptime(0), '00:00');
  assert.equal(formatUptime(59_999), '00:59');
  assert.equal(formatUptime(61_000), '01:01');
  assert.equal(formatUptime(3_599_000), '59:59');
  assert.equal(formatUptime(3_600_000), '1:00:00');
  assert.equal(formatUptime(36_000_000 + 61_000), '10:01:01');
  assert.equal(formatUptime(-5000), '00:00');
});

test('sessionId is 8 uppercase hex digits and deterministic for a given source', () => {
  assert.match(sessionId(), /^[0-9A-F]{8}$/);
  assert.equal(sessionId(() => 0), '00000000');
  assert.equal(sessionId(() => 0.999), 'FFFFFFFF');
  let i = 0;
  assert.equal(sessionId(() => ((i++ % 16) + 0.5) / 16), '01234567');
});

test('formatSpeed rounds and clamps', () => {
  assert.equal(formatSpeed(0), '0 px/s');
  assert.equal(formatSpeed(1234.6), '1235 px/s');
  assert.equal(formatSpeed(-3), '0 px/s');
});

test('pushSample keeps the newest values and does not mutate its input', () => {
  const a = [1, 2, 3];
  const b = pushSample(a, 4, 3);
  assert.deepEqual(b, [2, 3, 4]);
  assert.deepEqual(a, [1, 2, 3]);
  assert.equal(pushSample([], 9, 60).length, 1);
});

test('sparkPoints scales into the box, clamps wild values and tolerates bad input', () => {
  assert.equal(sparkPoints([], 120, 32), '');
  assert.equal(sparkPoints([35], 120, 32, 70), '120,16');
  assert.equal(sparkPoints([0, 70], 120, 32, 70), '0,32 120,0');
  assert.equal(sparkPoints([-50, 500], 120, 32, 70), '0,32 120,0');
  const pts = sparkPoints([60, NaN, Infinity, 30, 60], 100, 20, 60).split(' ');
  assert.equal(pts.length, 5);
  for (const pt of pts) for (const n of pt.split(',')) assert.ok(Number.isFinite(Number(n)), pt);
});

test('recentCommands: newest first, distinct, capped', () => {
  assert.deepEqual(recentCommands([]), []);
  assert.deepEqual(recentCommands(['a', 'b', 'a', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(recentCommands(['1', '2', '3', '4', '5', '6', '7'], 3), ['7', '6', '5']);
});

test('every project has a short, readable map label', () => {
  for (const p of projects) {
    assert.ok(p.short && p.short.length <= 9, `${p.slug}: "${p.short}"`);
    assert.match(p.short, /^[a-z0-9-]+$/);
  }
  assert.equal(new Set(projects.map((p) => p.short)).size, projects.length, 'labels are unique');
  assert.ok(projects.length <= 4, 'the map has four satellite slots');
});

test('hud command: show, set, reject, localised', () => {
  assert.deepEqual(HUD_MODES, ['on', 'off']);
  assert.ok(PUBLIC_COMMANDS.includes('hud'));
  assert.match(text('hud', ctx({ hud: 'on' })), /hud: on/);
  assert.deepEqual(execute('hud OFF', ctx()).effects, [{ type: 'hud', value: 'off' }]);
  assert.deepEqual(execute('hud on', ctx()).effects, [{ type: 'hud', value: 'on' }]);
  const bad = execute('hud sideways', ctx());
  assert.deepEqual(bad.effects, []);
  assert.match(renderBlocks(bad.blocks), /unknown mode/);
  assert.match(text('hud off', ctx({ lang: 'zh' })), /概覽區/);
  assert.deepEqual(execute('gui off', ctx()).effects, [{ type: 'hud', value: 'off' }], '`gui` is an alias');
  assert.equal(complete('hud o').options.length, 2, 'on / off are both candidates');
  assert.ok(ui.en.hudRecent && ui.zh.hudRecent && ui.en.hudEmpty && ui.zh.hudEmpty);
});

test('matrix is a real theme: selectable and styled with readable contrast', async () => {
  assert.ok(THEMES.includes('matrix'));
  assert.deepEqual(execute('theme matrix', ctx()).effects, [{ type: 'theme', value: 'matrix' }]);
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const block = css.match(/:root\[data-theme="matrix"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(block, 'matrix variables are defined');
  for (const v of ['--bg', '--panel', '--bar', '--fg', '--dim', '--accent', '--accent2', '--link', '--err', '--line', '--sel']) assert.ok(block.includes(`${v}:`), v);
  const hex = (name) => block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const fg of ['--fg', '--dim', '--accent', '--accent2', '--link', '--err']) {
    assert.ok(ratio(hex(fg), hex('--panel')) >= 4.5, `${fg} on --panel = ${ratio(hex(fg), hex('--panel')).toFixed(2)}`);
    assert.ok(ratio(hex(fg), hex('--bar')) >= 4.5, `${fg} on --bar`);
  }
});

test('index.html: the overview pane and tabs exist and start hidden (JS reveals them)', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<aside class="gui" id="gui" aria-label="[^"]+" hidden>/);
  assert.match(html, /<nav class="tabs" id="tabs" aria-label="[^"]+" hidden>/);
  assert.match(html, /data-view="gui" aria-pressed="false"/);
  assert.match(html, /data-view="term" aria-pressed="true"/);
  assert.ok(!html.includes('hud-left') && !html.includes('hud-right'), 'the old side columns are gone');
});

test('stylesheet: split screen on wide screens, tabs on narrow ones, hidden in print', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.gui, \.tabs \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 1000px\)\s*\{[^@]*html\[data-hud="on"\] \.gui \{ display: flex; grid-column: 1; \}/);
  assert.match(css, /@media \(min-width: 1000px\)\s*\{[^@]*html\[data-hud="on"\] \.window \{[^}]*grid-column: 2;/, 'the terminal is pinned to column 2 so it does not jump when the overview appears');
  assert.match(css, /@media \(max-width: 999\.98px\)\s*\{[^@]*html\[data-hud="on"\] \.tabs \{ display: flex/);
  assert.match(css, /html\[data-hud="on"\]\[data-view="gui"\] \.window \{ display: none; \}/);
  assert.match(css, /@media print \{ \.gui, \.tabs \{ display: none !important; \} \}/);
  assert.match(css, /\.recent-btn \{[^}]*min-height: 24px/, 'targets meet the 24px WCAG 2.2 minimum');
  assert.match(css, /\.tab \{[^}]*min-height: 44px/, 'tabs are touch-sized');
  assert.ok(!css.includes('.node-core') && !css.includes('.map-lines'), 'the old project map styles are gone');
});
