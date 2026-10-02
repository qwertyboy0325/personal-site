import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mirrorColumns, mirrorRows, frameLetters, errorKey, mirrorFps, frameInterval, smooth, SAMPLES_PER_CHAR, fitBox, COOLDOWN_MS, SLOW_START_MS, DENSITY, adaptQuality } from '../src/fx/mirror.js';
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

test('fitBox: the biggest picture of the camera\'s shape that fits the view, never stretched or cropped', () => {
  // A wide window and a 4:3 camera: the height is the limit.
  assert.deepEqual(fitBox(1400, 600, 0.75), { w: 800, h: 600 });
  // A tall window: the width is the limit.
  assert.deepEqual(fitBox(500, 900, 0.75), { w: 500, h: 375 });
  // 16:9 camera
  assert.deepEqual(fitBox(1600, 700, 9 / 16), { w: 1244, h: 700 });
  // A phone held upright: the camera is portrait (taller than wide)
  assert.deepEqual(fitBox(380, 640, 4 / 3), { w: 380, h: 507 });
  assert.deepEqual(fitBox(380, 500, 4 / 3), { w: 375, h: 500 });
  // Only the width is limited (the page's own box)
  assert.deepEqual(fitBox(600, Infinity, 0.5), { w: 600, h: 300 });
  assert.deepEqual(fitBox(600, 0, 0.5), { w: 600, h: 300 });
  // Odd input never gives NaN or zero
  for (const [w, h, r] of [[0, 0, 0], [NaN, NaN, NaN], [-5, -5, -1], [1, 1, 1000], ['x', 'y', 'z'], [undefined, undefined, undefined]]) {
    const b = fitBox(w, h, r);
    assert.ok(Number.isInteger(b.w) && Number.isInteger(b.h) && b.w >= 1 && b.h >= 1, JSON.stringify([w, h, r, b]));
  }
  // The shape is kept (to within a pixel) and the result always fits, for many window and camera shapes.
  for (let vw = 200; vw <= 2400; vw += 173) {
    for (let vh = 150; vh <= 1400; vh += 131) {
      for (const ratio of [0.5625, 0.75, 1, 1.3333]) {
        const b = fitBox(vw, vh, ratio);
        assert.ok(b.w <= vw && b.h <= vh + 1, `${vw}x${vh} @${ratio} -> ${b.w}x${b.h} fits`);
        assert.ok(Math.abs(b.h / b.w - ratio) < 1.5 / b.w + 1e-9, `${vw}x${vh} @${ratio} -> ${b.w}x${b.h} keeps its shape`);
        assert.ok(b.w === Math.floor(vw) || Math.abs(b.h - vh) <= 1, 'and is as large as it can be');
      }
    }
  }
});

test('mirrorColumns: the big view may use more characters, still bounded', () => {
  assert.equal(mirrorColumns(1400, { max: 140 }), 140);
  assert.equal(mirrorColumns(700, { max: 140 }), 100);
  assert.equal(mirrorColumns(1400), 100, 'the page\'s own box keeps its limit');
  assert.equal(mirrorColumns(10, { max: 140 }), 36);
  assert.equal(mirrorColumns(NaN, { max: 140, min: 20 }), 20);
});

test('the big view: a modal dialog that fills nearly the window and turns the camera off when it is left', async () => {
  const css = await read('src/styles.css');
  assert.match(css, /\.mirror-stage \{[^}]*width: min\(98vw, 2400px\)[^}]*height: min\(96dvh, 1600px\)/);
  assert.match(css, /\.mirror-stage\[open\] \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.ms-btn \{[^}]*min-width: 44px; min-height: 44px/, 'touch-sized buttons');
  const src = await read('src/fx/mirror.js');
  assert.match(src, /dlg\.showModal\(\)/);
  assert.match(src, /dlg\.addEventListener\('close', \(\) => \{ if \(live\) stop\(\); \}\)/, 'Esc or the close button turns the camera off');
  assert.match(src, /fitBox\(viewW, viewH, ratio\)/, 'sized to the view in the camera\'s own shape');
  for (const lang of LANGS) for (const k of ['copyShort', 'fullscreen', 'closeStage']) assert.ok(ui[lang].mirror[k]?.length >= 2, `${lang}.mirror.${k}`);
});

test('frameLetters: the text has exactly as many lines as the box has rows (the picture is not squashed)', () => {
  for (const [cols, vw, vh] of [[100, 640, 480], [140, 1280, 720], [60, 480, 640], [36, 640, 360]]) {
    const rows = mirrorRows(cols, vw, vh);
    const w = cols * SAMPLES_PER_CHAR;
    const h = rows * SAMPLES_PER_CHAR; // what the mirror draws: the camera squeezed to the character grid
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([(i * 5) & 255, (i * 3) & 255, (i * 7) & 255, 255], i * 4);
    const lines = frameLetters({ data, width: w, height: h }, { cols }).split('\n');
    assert.equal(lines.length, rows, `${cols} columns over a ${vw}x${vh} camera: ${rows} rows`);
    assert.ok(lines.every((l) => l.length <= cols));
  }
});

test('a camera that was only just switched off is tried again before giving up (but only for "in use")', async () => {
  const src = await read('src/fx/mirror.js');
  assert.match(src, /async function openCamera\(retries = 2, delayMs = 350\)/);
  assert.match(src, /errorKey\(e\) !== 'busy'/, 'a blocked or missing camera is reported at once');
  assert.equal((src.match(/getUserMedia\(/g) ?? []).length, 1, 'still exactly one place asks for the camera');
});

test('starting is safe to interrupt and to repeat: a short cool-down after switching off, a camera that arrives late is switched straight off, and a slow start explains itself', async () => {
  assert.ok(COOLDOWN_MS >= 300 && COOLDOWN_MS <= 1500);
  assert.ok(SLOW_START_MS >= 5000 && SLOW_START_MS <= 15000);
  const src = await read('src/fx/mirror.js');
  assert.match(src, /releasedAt \+ COOLDOWN_MS - Date\.now\(\)/);
  assert.match(src, /if \(startToken !== token \|\| !fig\.isConnected\) \{ got\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\); return; \}/, 'a camera that arrives after Stop or a page change is released at once');
  assert.match(src, /startToken = null;/, 'release cancels a start in progress');
  assert.match(src, /stopBtn\.hidden = state !== 'live' && state !== 'starting'/, 'Stop can cancel a start that is taking long');
  assert.match(src, /status\.textContent = t\.slowStart/);
  assert.ok(!/await video\.play\(\)/.test(src), 'never wait on video.play()');
  for (const lang of LANGS) assert.ok(ui[lang].mirror.slowStart.length > 20, `${lang}.slowStart`);
});

test('DENSITY: full screen has the room for finer letters than the big view, and the big view is at least as fine as the page box', () => {
  assert.ok(DENSITY.full.cell < DENSITY.stage.cell && DENSITY.stage.cell <= DENSITY.inline.cell);
  assert.ok(DENSITY.full.max > DENSITY.stage.max && DENSITY.stage.max > DENSITY.inline.max);
  // On a 2300 px wide picture (a 1440p screen): the size of one character, and the amount of text per frame.
  const cols = mirrorColumns(2300, DENSITY.full);
  assert.equal(cols, 420);
  assert.ok(2300 / cols >= 5 && 2300 / cols <= 6, 'about 5 to 6 px per character: fine, but clearly letters');
  assert.ok(cols * mirrorRows(cols, 1280, 720) < 60000, 'bounded amount of text per frame');
  assert.equal(mirrorColumns(1409, DENSITY.stage), 200, 'the windowed big view');
  assert.equal(mirrorColumns(700, DENSITY.inline), 100);
});

test('adaptQuality: finer when there is room, coarser when frames are costly or late, always between 0.4 and 1', () => {
  const target = 1000 / 15;
  assert.equal(adaptQuality(1, 3, 70, target), 1, 'cheap frames at full quality: stay');
  assert.ok(adaptQuality(1, 40, 80, target) < 1, 'a frame that takes 40 ms of 66: lower the detail');
  assert.ok(adaptQuality(1, 5, 140, target) < 1, 'frames arriving late: lower the detail');
  assert.ok(adaptQuality(0.5, 4, 70, target) > 0.5, 'room to spare: creep back up');
  assert.equal(adaptQuality(0.5, 12, 75, target), 0.5, 'in between: leave it');
  assert.equal(adaptQuality(0.4, 100, 300, target), 0.4, 'never below 0.4');
  assert.equal(adaptQuality(1, 1, 60, target), 1, 'never above 1');
  assert.equal(adaptQuality(0.99, 1, 60, target), 1, 'and it stops at 1');
  for (const bad of [NaN, undefined, null, 'x', -3, 9]) { const v = adaptQuality(bad, 10, 70, target); assert.ok(v >= 0.4 && v <= 1, String(bad)); }
  assert.equal(adaptQuality(0.8, NaN, NaN, target), 0.8);
  assert.equal(adaptQuality(0.8, 10, 70, 0), 0.8);
  // A slow device converges: repeatedly applying it with costs that fall as the detail falls settles below 1.
  let q = 1;
  for (let i = 0; i < 40; i++) q = adaptQuality(q, 50 * q * q, 70 + 100 * (1 - q), target);
  assert.ok(q < 0.85 && q >= 0.4, `settled at ${q.toFixed(2)}`);
  // A fast device stays at full detail.
  q = 1;
  for (let i = 0; i < 40; i++) q = adaptQuality(q, 4 * q, 70, target);
  assert.equal(q, 1);
});

test('the mirror follows the browser into real full screen and works out the density again', async () => {
  const src = await read('src/fx/mirror.js');
  assert.match(src, /document\.addEventListener\('fullscreenchange', onFullscreenChange\)/);
  assert.match(src, /document\.addEventListener\('webkitfullscreenchange', onFullscreenChange\)/, 'Safari');
  assert.match(src, /full = Boolean\(stage && el === stage\.dlg\)/);
  assert.match(src, /const tier = stage \? \(full \? DENSITY\.full : DENSITY\.stage\) : DENSITY\.inline;/);
  assert.match(src, /quality = adaptQuality\(quality, avgCost, avgGap, 1000 \/ mirrorFps\(reduceMotion\)\)/);
  assert.match(src, /removeEventListener\('fullscreenchange', onFullscreenChange\)/, 'and lets go of it again');
});
