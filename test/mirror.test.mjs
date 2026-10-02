import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mirrorColumns, mirrorRows, frameLetters, errorKey, mirrorFps, frameInterval, smooth, SAMPLES_PER_CHAR } from '../src/fx/mirror.js';
import { execute, PUBLIC_COMMANDS, complete } from '../src/engine.js';
import { renderEntry } from '../src/render.js';
import { ui, LANGS } from '../src/content.js';
import { guiHtml } from '../src/gui.js';

const ctx = (lang = 'en') => ({ lang, theme: 'dark', history: [] });
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('mirrorColumns: about one character per 7 px, between 36 and 100, safe with odd input', () => {
  assert.equal(mirrorColumns(700), 100);
  assert.equal(mirrorColumns(350), 50);
  assert.equal(mirrorColumns(100), 36);
  assert.equal(mirrorColumns(5000), 100);
  for (const bad of [0, -1, NaN, undefined, null, 'x', Infinity]) assert.ok(Number.isInteger(mirrorColumns(bad)) && mirrorColumns(bad) >= 36 && mirrorColumns(bad) <= 100, String(bad));
});

test('mirrorRows: follows the video shape, with characters twice as tall as wide', () => {
  assert.equal(mirrorRows(100, 640, 480), 38);
  assert.equal(mirrorRows(100, 1280, 720), 28);
  assert.equal(mirrorRows(100, 480, 640), 67, 'a portrait video (a phone held upright)');
  for (const [w, h] of [[0, 0], [NaN, 5], [640, 0], [undefined, undefined]]) assert.ok(mirrorRows(60, w, h) >= 1, `${w}x${h}`);
});

test('frameLetters: a frame becomes text of the requested width, brighter parts denser (inverted on a light page)', () => {
  const w = 120, h = 48;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round((x / (w - 1)) * 255); data.set([v, v, v, 255], (y * w + x) * 4); }
  const dark = frameLetters({ data, width: w, height: h }, { cols: 30 }).split('\n');
  assert.ok(dark.every((l) => l.length <= 30) && dark.length >= 5);
  assert.equal(dark[0][0], ' ');
  assert.equal(dark[0].at(-1), '@');
  const light = frameLetters({ data, width: w, height: h }, { cols: 30, invert: true }).split('\n');
  assert.equal(light[0][0], '@', 'dark text on a light page: the dark side is dense');
  assert.deepEqual(frameLetters({ data, width: w, height: h }, { cols: 30 }), frameLetters({ data, width: w, height: h }, { cols: 30 }), 'deterministic');
});

test('errorKey: every kind of camera failure maps to a message that exists in both languages', () => {
  const cases = { NotAllowedError: 'denied', PermissionDeniedError: 'denied', SecurityError: 'denied', NotFoundError: 'none', OverconstrainedError: 'none', NotReadableError: 'busy', AbortError: 'busy', InsecureContext: 'insecure', Unsupported: 'unsupported', TypeError: 'other', Whatever: 'other' };
  for (const [name, key] of Object.entries(cases)) assert.equal(errorKey({ name }), key, name);
  assert.equal(errorKey(null), 'other');
  assert.equal(errorKey(undefined), 'other');
  for (const lang of LANGS) for (const k of ['denied', 'none', 'busy', 'insecure', 'unsupported', 'other']) assert.ok(ui[lang].mirror.errors[k]?.length > 4, `${lang}.errors.${k}`);
});

test('mirrorFps: gentler when reduced motion is on', () => {
  assert.ok(mirrorFps(true) < mirrorFps(false));
  assert.ok(mirrorFps(true) >= 1 && mirrorFps(false) <= 30);
});

test('the mirror command: listed in help, completes, shows the explanation and the three buttons, and `mirror off` turns it off', () => {
  assert.ok(PUBLIC_COMMANDS.includes('mirror'));
  assert.deepEqual(complete('mirr'), { line: 'mirror ', options: [] });
  assert.deepEqual(complete('mirror o'), { line: 'mirror off ', options: [] });
  assert.ok(JSON.stringify(execute('help', ctx()).blocks).includes('see yourself drawn in letters'));
  assert.ok(JSON.stringify(execute('help', ctx('zh')).blocks).includes('用字元畫出你自己'));
  const out = execute('mirror', ctx());
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].t, 'mirror');
  assert.deepEqual(out.effects, []);
  const html = renderEntry(out.blocks, {});
  assert.match(html, /<figure class="mirror" data-mirror data-state="ready" aria-label="Camera mirror">/);
  assert.match(html, /<button type="button" class="mirror-btn" data-mirror-start>▶ Turn on camera<\/button>/);
  assert.match(html, /<button type="button" class="mirror-btn" data-mirror-stop hidden>/);
  assert.match(html, /<button type="button" class="mirror-btn" data-mirror-copy hidden>/);
  assert.match(html, /<pre class="mirror-ascii" aria-hidden="true" hidden><\/pre>/);
  assert.match(html, /<p class="mirror-status" role="status" aria-live="polite"><\/p>/);
  assert.match(html, /Nothing is recorded, saved or sent anywhere/);
  assert.match(renderEntry(execute('mirror', ctx('zh')).blocks, {}), /不會被錄影、儲存，也不會傳到任何地方/);
  const off = execute('mirror off', ctx());
  assert.deepEqual(off.effects, [{ type: 'mirror', value: 'off' }]);
  assert.deepEqual(execute('mirror OFF', ctx()).effects, [{ type: 'mirror', value: 'off' }]);
  const plain = renderEntry(out.blocks, { interactive: false });
  assert.ok(!plain.includes('<button') && plain.includes('Nothing is recorded'), 'without JavaScript only the explanation is shown');
});

test('the overview has a card for it, in both languages', () => {
  for (const lang of LANGS) {
    const html = guiHtml(lang);
    assert.match(html, /data-cmd="mirror" data-key="mirror"/);
    assert.ok(html.includes(ui[lang].mirrorCard));
    assert.ok(typeof ui[lang].gui.sections.play === 'string' && ui[lang].gui.sections.play.length >= 2, `${lang}: the section has a name`);
    assert.ok(html.includes(`// ${ui[lang].gui.sections.play}`));
    assert.ok(!html.includes('undefined'), `${lang}: no missing text in the overview`);
  }
});

test('privacy by construction: the code never records, saves, uploads or draws the camera into anything that leaves the page', async () => {
  const walk = async (dir) => (await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })).flatMap((e) => e);
  const files = [];
  const collect = async (dir) => { for (const e of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) { const rel = `${dir}/${e.name}`; if (e.isDirectory()) await collect(rel); else if (e.name.endsWith('.js')) files.push(rel); } };
  await collect('src');
  assert.ok(files.includes('src/fx/mirror.js'));
  for (const f of files) {
    const text = await read(f);
    assert.ok(!/MediaRecorder|captureStream|\.toDataURL\(|\.toBlob\(|createObjectURL|localStorage\.setItem\([^)]*(stream|video|camera)/i.test(text), `${f} must not record or export camera data`);
  }
  const src = await read('src/fx/mirror.js');
  assert.match(src, /audio: false/, 'no microphone');
  assert.match(src, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/, 'the camera is released');
  assert.match(src, /visibilitychange/, 'and turned off when the tab is hidden');
  assert.match(src, /pagehide/);
  assert.match(src, /fig\.isConnected/, 'and when the page moves on');
  assert.match(src, /if \(!window\.isSecureContext\)/);
  assert.ok(!/getUserMedia\([^)]*\)[^;]*;[\s\S]{0,40}$/.test('') );
});

test('the camera is only requested after pressing the button (never on load, never from the address)', async () => {
  const src = await read('src/fx/mirror.js');
  const calls = [...src.matchAll(/getUserMedia\(/g)].length;
  assert.equal(calls, 1, 'one place asks for the camera');
  assert.match(src, /start\.addEventListener\('click', begin\)/);
  // The mirror is a page with its own address, but the address only shows the explanation: nothing starts without the button.
  const { lineForHash, routeFor } = await import('../src/route.js');
  assert.equal(lineForHash('#mirror'), 'mirror');
  assert.deepEqual(routeFor('mirror'), { path: ['mirror'], hash: 'mirror', cmd: 'mirror', section: 'mirror' });
  assert.equal(routeFor('mirror off'), null, 'turning it off is an action, not a page');
  const main = await read('src/main.js');
  assert.ok(!/getUserMedia/.test(main), 'only the mirror module asks for the camera');
});

test('frameInterval: the target rate when frames are cheap, slower when they are expensive, never slower than 4 per second', () => {
  assert.equal(frameInterval(0, 15), 1000 / 15);
  assert.equal(frameInterval(NaN, 15), 1000 / 15);
  assert.equal(frameInterval(2, 15), 1000 / 15, 'a 2 ms frame leaves plenty of room');
  assert.equal(frameInterval(30, 15), 120, 'a 30 ms frame: spend about a quarter of the time on it');
  assert.equal(frameInterval(500, 15), 250, 'but never wait more than a quarter of a second');
  assert.equal(frameInterval(10, 6), 1000 / 6);
  let prev = 0;
  for (let cost = 0; cost <= 100; cost += 5) { const v = frameInterval(cost, 15); assert.ok(v >= prev, `monotonic at ${cost}`); prev = v; }
});

test('smooth: a running average that moves towards each new measurement and starts from the first one', () => {
  assert.equal(smooth(0, 5), 5);
  assert.equal(smooth(NaN, 7), 7);
  assert.ok(Math.abs(smooth(10, 20) - 11.5) < 1e-9);
  let avg = 0;
  for (let i = 0; i < 100; i++) avg = smooth(avg, 40);
  assert.ok(Math.abs(avg - 40) < 1e-6);
  assert.equal(SAMPLES_PER_CHAR, 3);
});

test('the frame loop does not touch the page more than it must (no layout reads or style writes for an unchanged frame)', async () => {
  const src = await read('src/fx/mirror.js');
  const frame = src.slice(src.indexOf('function frame(now)'), src.indexOf('async function begin()'));
  assert.ok(!/clientWidth|clientHeight|getBoundingClientRect|offsetWidth/.test(frame), 'no layout reads inside the frame loop');
  assert.match(frame, /if \(text !== shown\)/, 'identical text is not written again');
  assert.match(frame, /if \(key !== metrics\)/, 'font size and line height only when the size changed');
  assert.match(src, /new ResizeObserver/);
});
