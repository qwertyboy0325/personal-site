import test from 'node:test';
import assert from 'node:assert/strict';
import { imageToAscii, IMG_RAMP, asciiColumns, createAsciiCache } from '../src/fx/imgascii.js';

/** Build an RGBA image from a function (x, y) -> [r, g, b, a]. */
function make(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}
const grey = (v, a = 255) => [v, v, v, a];
const lines = (s) => s.split('\n');
const levelOf = (ch) => IMG_RAMP.indexOf(ch);

test('shape: the number of columns is respected and rows follow the aspect ratio', () => {
  const img = make(200, 100, () => grey(128));
  const out = lines(imageToAscii(img, { cols: 40 }));
  assert.equal(out.length, 10, '40 cols x (100/200) x 0.5 cell aspect = 10 rows');
  const wide = lines(imageToAscii(make(100, 200, () => grey(128)), { cols: 40, stretch: false }));
  assert.equal(wide.length, 40, 'a tall image gets more rows');
  assert.equal(lines(imageToAscii(make(64, 64, () => grey(255)), { cols: 64 })).length, 32);
  for (const l of out) assert.ok(l.length <= 40);
});

test('solid images map to the ends of the ramp (no contrast stretch applied to flat images)', () => {
  assert.equal(imageToAscii(make(8, 8, () => grey(0)), { cols: 4 }).replace(/\s/g, ''), '', 'black is blank');
  const white = imageToAscii(make(8, 8, () => grey(255)), { cols: 4 });
  assert.ok([...white].every((c) => c === '\n' || c === IMG_RAMP.at(-1)), 'white is the densest character');
  const mid = imageToAscii(make(8, 8, () => grey(128)), { cols: 4 });
  const ch = mid.replace(/\n/g, '')[0];
  assert.ok(levelOf(ch) >= 3 && levelOf(ch) <= 6, `mid-grey -> "${ch}"`);
});

test('a left-to-right gradient gets denser from left to right', () => {
  const img = make(120, 40, (x) => grey(Math.round((x / 119) * 255)));
  const row = lines(imageToAscii(img, { cols: 30 }))[0];
  let prev = -1;
  for (const ch of row) { const l = levelOf(ch); assert.ok(l >= prev, `"${row}" is not monotonic`); prev = l; }
  assert.equal(row[0], ' ');
  assert.equal(row.at(-1), '@');
});

test('contrast stretch lifts a dim image; stretch:false keeps its real brightness', () => {
  const dim = make(60, 20, (x) => grey(40 + Math.round((x / 59) * 20)));
  const stretched = imageToAscii(dim, { cols: 20 });
  const raw = imageToAscii(dim, { cols: 20, stretch: false });
  assert.ok(new Set(stretched.replace(/\n/g, '')).size > new Set(raw.replace(/\n/g, '')).size, 'stretching reveals more levels');
});

test('invert mirrors the ramp (for dark text on a light page)', () => {
  const img = make(60, 20, (x) => grey(Math.round((x / 59) * 255)));
  const a = imageToAscii(img, { cols: 20 });
  const b = imageToAscii(img, { cols: 20, invert: true });
  const rows = (s) => lines(s).map((l) => l.padEnd(20, ' '));
  const A = rows(a);
  const B = rows(b);
  A.forEach((line, i) => [...line].forEach((ch, j) => assert.equal(levelOf(B[i][j]), IMG_RAMP.length - 1 - levelOf(ch))));
});

test('transparent pixels count as black', () => {
  const out = imageToAscii(make(16, 16, () => [255, 255, 255, 0]), { cols: 8 });
  assert.equal(out.replace(/\s/g, ''), '');
  const half = imageToAscii(make(16, 16, (x) => (x < 8 ? [255, 255, 255, 255] : [255, 255, 255, 0])), { cols: 8 });
  assert.match(lines(half)[0], /^@+$/);
});

test('colour is converted with perceptual weights: green is brighter than blue', () => {
  const green = imageToAscii(make(8, 8, () => [0, 255, 0, 255]), { cols: 4, stretch: false });
  const blue = imageToAscii(make(8, 8, () => [0, 0, 255, 255]), { cols: 4, stretch: false });
  assert.ok(levelOf(green[0]) > levelOf(blue[0]));
});

test('deterministic, and only ramp characters appear', () => {
  const img = make(97, 61, (x, y) => grey((x * 7 + y * 13) % 256));
  const a = imageToAscii(img, { cols: 50 });
  assert.equal(a, imageToAscii(img, { cols: 50 }));
  for (const ch of a) assert.ok(ch === '\n' || IMG_RAMP.includes(ch), `unexpected "${ch}"`);
});

test('a custom ramp is honoured', () => {
  const out = imageToAscii(make(20, 20, (x) => grey(x < 10 ? 0 : 255)), { cols: 10, ramp: '.#' });
  assert.ok([...out].every((c) => c === '\n' || c === '.' || c === '#'));
  assert.ok(out.includes('.') && out.includes('#'));
});

test('tiny and awkward sizes never crash and never produce NaN', () => {
  for (const [w, h] of [[1, 1], [1, 50], [50, 1], [3, 7], [1000, 3]]) {
    const out = imageToAscii(make(w, h, (x, y) => grey((x * 31 + y * 17) % 256)), { cols: 16 });
    assert.ok(out.length > 0 || w * h > 0);
    assert.ok(!/NaN|undefined/.test(out), `${w}x${h}`);
  }
  assert.ok(imageToAscii(make(4, 4, () => grey(200)), { cols: 0 }).length >= 0);
  assert.ok(imageToAscii(make(4, 4, () => grey(200)), { cols: NaN, cellAspect: -3 }).length >= 0);
});

test('invalid input is rejected clearly', () => {
  assert.throws(() => imageToAscii(null), RangeError);
  assert.throws(() => imageToAscii({ data: new Uint8ClampedArray(4), width: 0, height: 1 }), RangeError);
  assert.throws(() => imageToAscii({ data: new Uint8ClampedArray(4), width: 2, height: 2 }), /shorter/);
  assert.throws(() => imageToAscii({ data: new Uint8ClampedArray(16), width: 1.5, height: 2 }), RangeError);
});

test('fast enough for a full-size image (the browser downsamples first, this is the worst case)', () => {
  const big = make(1024, 1024, (x, y) => grey((x ^ y) & 255));
  const start = performance.now();
  imageToAscii(big, { cols: 72 });
  assert.ok(performance.now() - start < 1500, `${(performance.now() - start).toFixed(0)}ms`);
});

test('asciiColumns: about one character per 7 px, clamped, and safe with odd input', () => {
  assert.equal(asciiColumns(705), 101);
  assert.equal(asciiColumns(330), 47);
  assert.equal(asciiColumns(140), 40, 'a tiny picture is not mush');
  assert.equal(asciiColumns(5000), 110, 'a huge one is not a wall of text');
  assert.equal(asciiColumns(700, { cell: 10 }), 70);
  for (const bad of [0, -5, NaN, undefined, null, 'x', Infinity]) assert.ok(Number.isInteger(asciiColumns(bad)) && asciiColumns(bad) >= 40 && asciiColumns(bad) <= 110, String(bad));
  let prev = 0;
  for (let w = 100; w <= 1200; w += 25) { const c = asciiColumns(w); assert.ok(c >= prev, `monotonic at ${w}`); prev = c; }
});

test('detail sharpens: a faint shape on a strong gradient becomes visible (a plain conversion lets the gradient hide it)', () => {
  // Brightness rises steadily left to right; a small square is only slightly brighter than its surroundings.
  const img = make(200, 100, (x, y) => grey(Math.round(20 + (x / 199) * 180 + (x > 80 && x < 120 && y > 30 && y < 70 ? 14 : 0))));
  const rows = (o) => lines(imageToAscii(img, { cols: 50, ...o })).map((l) => l.padEnd(50, ' '));
  const differing = (r) => {
    const mid = Math.floor(r.length / 2);
    let n = 0;
    for (let col = 21; col <= 29; col++) if (levelOf(r[mid][col]) !== levelOf(r[0][col])) n++; // inside the square vs the same column above it
    return n;
  };
  const plain = differing(rows({ detail: 0 }));
  const sharp = differing(rows({ detail: 1.2 }));
  assert.ok(sharp > plain, `the square shows in ${sharp} columns with detail, ${plain} without`);
  assert.equal(imageToAscii(img, { cols: 50 }), imageToAscii(img, { cols: 50, detail: 0 }), 'off by default');
});

test('detail leaves flat images, solid colours and the shape of the output alone', () => {
  const flat = make(40, 40, () => grey(128));
  assert.equal(imageToAscii(flat, { cols: 20, detail: 2 }), imageToAscii(flat, { cols: 20 }));
  const a = lines(imageToAscii(make(97, 61, (x, y) => grey((x * 7 + y * 13) % 256), { cols: 30 }), { cols: 30, detail: 1.5, clip: 0.05 }));
  assert.equal(a.length, lines(imageToAscii(make(97, 61, (x, y) => grey((x * 7 + y * 13) % 256)), { cols: 30 })).length);
  for (const bad of [NaN, -3, 99, undefined]) assert.ok(!/NaN|undefined/.test(imageToAscii(make(30, 20, (x) => grey(x * 8)), { cols: 15, detail: bad, clip: bad })), String(bad));
});

test('clip ignores a few glare cells so they do not wash out the rest', () => {
  // A mostly dark gradient with one blazing white cell.
  const img = make(100, 50, (x, y) => (x === 99 && y === 0 ? grey(255) : grey(Math.round((x / 99) * 80))));
  const plain = lines(imageToAscii(img, { cols: 50 }));
  const clipped = lines(imageToAscii(img, { cols: 50, clip: 0.02 }));
  const used = (rows) => new Set(rows.join('')).size;
  assert.ok(used(clipped) >= used(plain), `${used(clipped)} vs ${used(plain)} characters in use`);
  assert.ok(levelOf(clipped[clipped.length - 1][Math.min(40, clipped[clipped.length - 1].length - 1)]) > levelOf(plain[plain.length - 1][Math.min(40, plain[plain.length - 1].length - 1)]), 'the picture itself uses more of the range');
});

test('gamma: below 1 lifts the shadows, above 1 deepens them, 1 changes nothing, odd values are ignored', () => {
  const img = make(120, 20, (x) => grey(Math.round((x / 119) * 255)));
  const mean = (g) => { const row = lines(imageToAscii(img, { cols: 30, gamma: g }))[0].padEnd(30, ' '); return [...row].reduce((a, ch) => a + levelOf(ch), 0) / row.length; };
  assert.ok(mean(0.6) > mean(1) && mean(1) > mean(1.8), `${mean(0.6)} > ${mean(1)} > ${mean(1.8)}`);
  assert.equal(imageToAscii(img, { cols: 30, gamma: 1 }), imageToAscii(img, { cols: 30 }));
  for (const bad of [0, -2, NaN, 'x', undefined, Infinity]) assert.equal(imageToAscii(img, { cols: 30, gamma: bad }).includes('NaN'), false, String(bad));
});

test('createAsciiCache: remembers finished pictures, forgets the least recently used, keys by picture, width and theme', () => {
  const c = createAsciiCache(3);
  assert.notEqual(c.key('a', 100, false), c.key('a', 100, true));
  assert.notEqual(c.key('a', 100, false), c.key('a', 99, false));
  assert.notEqual(c.key('a', 100, false), c.key('b', 100, false));
  assert.equal(c.get('x'), undefined);
  c.set('1', 'one'); c.set('2', 'two'); c.set('3', 'three');
  assert.equal(c.get('1'), 'one'); // 1 is now the most recent, so 2 is next to go
  c.set('4', 'four');
  assert.deepEqual([c.has('1'), c.has('2'), c.has('3'), c.has('4')], [true, false, true, true]);
  assert.equal(c.size, 3);
  c.set('4', 'FOUR'); // replacing does not grow it
  assert.equal(c.get('4'), 'FOUR');
  assert.equal(c.size, 3);
  assert.equal(c.get('3'), 'three');
  assert.equal(createAsciiCache().size, 0);
});
