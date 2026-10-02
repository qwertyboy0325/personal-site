import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scaleFor, dockKey, createDock, DOCK_MAX, DOCK_RADIUS } from '../src/dock.js';
import { NAV } from '../src/engine.js';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('scaleFor: biggest under the pointer, back to 1 at the radius, smooth and symmetric', () => {
  assert.equal(scaleFor(0), DOCK_MAX);
  assert.equal(scaleFor(DOCK_RADIUS), 1);
  assert.equal(scaleFor(DOCK_RADIUS * 3), 1);
  assert.equal(scaleFor(-50), scaleFor(50));
  let prev = Infinity;
  for (let d = 0; d <= DOCK_RADIUS; d += 5) {
    const s = scaleFor(d);
    assert.ok(s <= prev + 1e-12 && s >= 1 && s <= DOCK_MAX, `d=${d} -> ${s}`);
    prev = s;
  }
});

test('scaleFor: awkward input never gives NaN or a shrinking icon', () => {
  for (const v of [NaN, undefined, null, 'x', Infinity, -Infinity]) assert.equal(scaleFor(v), 1);
  assert.equal(scaleFor(0, { max: 2 }), 2);
  assert.equal(scaleFor('0'), DOCK_MAX);
});

test('scaleFor: neighbours of a magnified icon cannot overlap it (the 56px icons sit 14px apart plus their growth)', () => {
  const ICON = 56;
  const GAP = 14;
  const pitch = ICON + GAP;
  const growth = (s) => ((s - 1) * ICON) / 2; // each side
  // Pointer exactly on an icon: the icon and its neighbour both grow towards each other.
  const gapLeft = pitch - ICON - growth(scaleFor(0)) - growth(scaleFor(pitch));
  assert.ok(gapLeft > 0, `gap left between neighbours: ${gapLeft.toFixed(1)}px`);
  // Pointer between two icons: both at the same distance.
  const between = pitch - ICON - 2 * growth(scaleFor(pitch / 2));
  assert.ok(between > 0, `gap left when between two: ${between.toFixed(1)}px`);
});

test('dockKey: commands and their detail pages map to the section they belong to', () => {
  assert.equal(dockKey('about'), 'about');
  assert.equal(dockKey('  Projects '), 'projects');
  assert.equal(dockKey('project 2'), 'projects');
  assert.equal(dockKey('project handoff-semantics'), 'projects');
  assert.equal(dockKey('work 3'), 'works');
  assert.equal(dockKey('view 1'), 'gallery');
  assert.equal(dockKey('gallery'), 'gallery');
  for (const other of ['theme dark', 'lang zh', 'clear', 'cat x', '', null, undefined, 'banana']) assert.equal(dockKey(other), null, String(other));
  for (const k of NAV) assert.equal(dockKey(k), k);
});

/** A tiny fake element tree, enough for createDock. */
function fakeRoot(cmds) {
  const listeners = {};
  const items = cmds.map((c, i) => {
    const attrs = {};
    const vars = {};
    return {
      dataset: { cmd: c },
      attrs,
      vars,
      style: { setProperty: (k, v) => { vars[k] = v; } },
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      getBoundingClientRect: () => ({ left: i * 70, width: 56 }),
    };
  });
  const root = { querySelectorAll: () => items, addEventListener: (t, f) => { listeners[t] = f; } };
  return { root, items, listeners };
}

test('createDock: setActive marks exactly one item and ignores commands that are not sections', () => {
  const { root, items } = fakeRoot([...NAV]);
  const dock = createDock({ root });
  dock.setActive('project 2');
  assert.deepEqual(items.filter((i) => i.attrs['aria-current']).map((i) => i.dataset.cmd), ['projects']);
  dock.setActive('theme light');
  assert.deepEqual(items.filter((i) => i.attrs['aria-current']).map((i) => i.dataset.cmd), ['projects'], 'unchanged');
  dock.setActive('about');
  assert.deepEqual(items.filter((i) => i.attrs['aria-current']).map((i) => i.dataset.cmd), ['about']);
});

test('createDock: the icons swell towards a mouse and settle when it leaves; touch and reduced motion do nothing', () => {
  const a = fakeRoot(['about', 'projects', 'works']);
  createDock({ root: a.root });
  a.listeners.pointermove({ pointerType: 'mouse', clientX: 70 + 28 }); // centre of the middle icon
  const s = a.items.map((i) => Number(i.vars['--s']));
  assert.equal(s[1], DOCK_MAX);
  assert.ok(s[0] < s[1] && s[0] > 1 && Math.abs(s[0] - s[2]) < 1e-9, JSON.stringify(s));
  a.listeners.pointerleave();
  assert.deepEqual(a.items.map((i) => i.vars['--s']), ['1', '1', '1']);

  const t = fakeRoot(['about']);
  createDock({ root: t.root });
  t.listeners.pointermove({ pointerType: 'touch', clientX: 28 });
  assert.equal(t.items[0].vars['--s'], undefined, 'touch does not magnify');

  const r = fakeRoot(['about']);
  createDock({ root: r.root, reduceMotion: true });
  assert.equal(r.listeners.pointermove, undefined, 'reduced motion: no listeners at all');
});

test('index.html: the dock has one button per main command, in order, and starts hidden', async () => {
  const html = await read('index.html');
  const nav = html.match(/<nav class="dock" id="dock"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'dock nav exists');
  assert.match(nav[0], /aria-label="Quick commands" hidden/);
  const cmds = [...nav[1].matchAll(/data-cmd="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cmds, ['about', 'projects', 'works', 'gallery', 'skills', 'contact', 'help']);
  assert.deepEqual(new Set(cmds), NAV, 'every main command is reachable from the dock');
  for (const m of nav[1].matchAll(/<button[^>]*data-cmd="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    assert.match(m[2], /<span class="dock-ico" aria-hidden="true">[^<]+<\/span>/, `${m[1]}: the icon is decoration`);
    assert.match(m[2], new RegExp(`<span class="dock-lbl">${m[1]}</span>`), `${m[1]}: the visible label is the command (so the accessible name matches it)`);
  }
});

test('stylesheet: the dock only exists on wide screens with a mouse, replaces the chips there, and is quiet for reduced motion and print', async () => {
  const css = await read('src/styles.css');
  assert.match(css, /\.dock \{ display: none; \}/);
  const wide = css.match(/@media \(min-width: 1000px\) and \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}\n/)[1];
  assert.match(wide, /html\[data-dock="on"\] \.chips \{ display: none; \}/);
  assert.match(wide, /html\[data-dock="on"\] \.dock \{[^}]*position: fixed[^}]*z-index: 25/);
  assert.match(wide, /--dock-h: 72px/);
  assert.match(css, /height: min\(calc\(100dvh - 48px - var\(--dock-h, 0px\)\), 860px\)/, 'the terminal leaves room for the dock');
  assert.match(css, /\.toast \{[^}]*bottom: calc\(24px \+ var\(--dock-h, 0px\)\)/, 'the toast sits above the dock');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.dock-item \{ transition: border-color/);
  assert.match(css, /\.bar, \.chips, \.dock, \.prompt, \.skip \{ display: none !important; \}/);
  assert.match(wide, /\.dock-item \{[^}]*min-width: 56px; height: 56px/, 'icons are at least 44px (touch-size rule), far more in fact');
  const z = Number(wide.match(/z-index: (\d+)/)[1]);
  assert.ok(z > 1 && z < 30, 'above the page, below the picture windows (30)');
});
