// End-to-end check in real headless Chrome via the DevTools Protocol.
// Zero dependencies. Needs Chrome/Chromium: set CHROME=/path/to/chrome if it
// is not at the macOS default. Screenshots land in .shots/ (gitignored).
//
//   npm run e2e

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = 5199;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${SITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`);
  if (!ok) failures++;
};

// ---- processes ---------------------------------------------------------------
// Live reload is off here: the tests must see exactly what gets deployed.
const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), String(SITE_PORT)], { stdio: 'ignore', env: { ...process.env, LIVERELOAD: '0' } });
const profileDir = await mkdtemp(join(tmpdir(), 'site-e2e-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', // a made-up camera, and no permission prompt (the mirror test)
  'about:blank',
], { stdio: 'ignore' });
const cleanup = async () => { chrome.kill(); server.kill(); await rm(profileDir, { recursive: true, force: true }).catch(() => {}); };
process.on('exit', () => { chrome.kill(); server.kill(); });

async function until(fn, ms = 10000, label = 'condition') {
  const t = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t > ms) throw new Error(`timed out: ${label}`);
    await sleep(100);
  }
}

// ---- minimal CDP client --------------------------------------------------------
const targets = await until(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json().then((l) => l.find((t) => t.type === 'page')), 15000, 'chrome');
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
const logText = () => ev(`document.getElementById('log').innerText`);
const key = async (k, code, vk, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const typeText = async (s) => { await ev(`document.getElementById('cmd').focus()`); await send('Input.insertText', { text: s }); };
const enter = () => key('Enter', 'Enter', 13, '\r');
const shot = async (name, wait = 260) => { await sleep(wait); /* default: let transitions finish */ const r = await send('Page.captureScreenshot', { format: 'png' }); await mkdir(join(ROOT, '.shots'), { recursive: true }); await writeFile(join(ROOT, `.shots/${name}.png`), Buffer.from(r.data, 'base64')); };
const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const load = async (url = BASE) => {
  // Keep the page "visible" and focused even if the machine's window is occluded: a hidden page does not load lazy images or media.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.bringToFront').catch(() => {});
  await send('Page.navigate', { url });
  await until(() => ev(`document.readyState === 'complete'`), 10000, 'load');
};
// Generous on purpose: a busy machine (a render running in another app) must not make the suite flaky.
const bootDone = () => until(() => ev(`document.getElementById('log').getAttribute('aria-live') === 'polite'`), 20000, 'boot');

const scrollTo = (id) => ev(`document.getElementById('${id}').scrollIntoView({ behavior: 'instant', block: 'start' })`);
const termOpen = () => ev(`!document.getElementById('term').hidden`);
const noSideways = () => ev(`document.documentElement.scrollWidth - innerWidth <= 0`);

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  // Pin the browser language so results do not depend on the machine's locale.
  const setLanguage = async (acceptLanguage) => send('Emulation.setUserAgentOverride', { userAgent: await ev('navigator.userAgent'), acceptLanguage });
  await setLanguage('en-US');

  // ---- the page ------------------------------------------------------------------
  console.log('desktop / the page');
  await viewport(1440, 900);
  await load();
  await until(() => ev(`window.__siteReady === true`), 5000, 'ready');
  await sleep(500);
  await shot('01-hero-developing', 0);
  check(await ev(`!!document.querySelector('.hero .dev-canvas')`), 'the hero develops out of letters on a canvas over the photo');
  await until(() => ev(`!document.querySelector('.hero .pic').classList.contains('is-dev')`), 6000, 'hero developed');
  check((await ev(`document.querySelector('.hero [data-exif]').textContent`)) === '14mm · f/22 · 1/125', 'the exposure readout lands on the real values');
  check((await ev(`document.title`)).startsWith('Ezra Wu'), 'title set');
  check((await ev(`document.querySelectorAll('h1').length`)) === 1 && (await ev(`document.querySelector('h1').textContent`)) === 'Ezra Wu', 'one h1: the name');
  check(await ev(`!document.getElementById('cmdline').hidden && !document.getElementById('btn-theme').hidden && !document.getElementById('btn-lang').hidden`), 'the command line and the light / language buttons appear once the script runs');
  check(await noSideways(), 'no sideways scrolling at 1440px');
  await shot('02-hero');

  console.log('flashlight');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 });
  await sleep(900);
  await shot('03-flashlight', 0);
  check(await ev(`!!document.querySelector('.hero .dev-canvas')`), 'the hero keeps its canvas for the flashlight');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 890 });

  console.log('photos develop when they come into view');
  await scrollTo('photos');
  await until(() => ev(`!!document.querySelector('#photos .dev-canvas')`), 4000, 'dissolve started');
  check(true, 'photos dissolve out of letters when seen');
  await until(() => ev(`!document.querySelector('#photos .ph-a .dev-canvas')`), 6000, 'dissolve finished');
  check(await ev(`document.querySelector('.links a[data-sec="photos"]').getAttribute('aria-current') === 'true'`), 'the nav light moves to the section on screen');
  check((await ev(`document.getElementById('cmdline-text').textContent`)).length > 0, 'the command line names a command for this section');
  await shot('04-photos');

  console.log('viewer');
  await ev(`document.querySelector('#photos .ph-a a').click()`);
  await until(() => ev(`!!document.querySelector('dialog.viewer[open]')`), 3000, 'viewer');
  check((await ev(`document.querySelector('dialog.viewer .exif')?.textContent ?? ''`)).includes('NIKON Z 6'), 'a photo opens the viewer with its full shooting details');
  await shot('05-viewer');
  await key('Escape', 'Escape', 27);
  await until(() => ev(`!document.querySelector('dialog.viewer[open]')`), 2000, 'viewer closed');

  console.log('the rest of the page');
  for (const id of ['lab', 'work', 'about']) { await scrollTo(id); await sleep(700); await shot(`06-${id}`); }
  check(await ev(`!!document.querySelector('#lab .card .dev-canvas')`), 'the mirror card stays as letters');
  check(await ev(`document.querySelectorAll('#work .idx a').length`) >= 7, 'the work index lists projects and documents');
  check(await ev(`/@/.test(document.querySelector('[data-face]').textContent)`), 'the face in "about" is drawn');

  // ---- the terminal ------------------------------------------------------------------
  console.log('terminal drawer');
  await ev(`window.scrollTo(0, 0)`);
  await key('~', 'Backquote', 192, '~');
  await until(termOpen, 2000, 'drawer open');
  await bootDone();
  check((await logText()).includes('[ ok ]'), 'the boot lines play the first time it opens');
  check(await ev(`document.activeElement.id === 'cmd' || !matchMedia('(hover: hover) and (pointer: fine)').matches`), 'with a mouse, the prompt has focus', await ev(`JSON.stringify({ active: document.activeElement?.id || document.activeElement?.tagName, fine: matchMedia('(hover: hover) and (pointer: fine)').matches })`));
  await typeText('projects'); await enter();
  await until(async () => (await logText()).includes('handoff-semantics'), 3000, 'projects output');
  await sleep(900);
  check(await ev(`Math.abs(document.getElementById('work').getBoundingClientRect().top) < 120`), 'the page scrolls to the matching section behind the drawer');
  check((await ev(`document.getElementById('cmd').value`)) === '', 'input cleared after Enter');
  await typeText('ab'); await key('Tab', 'Tab', 9);
  check((await ev(`document.getElementById('cmd').value`)) === 'about ', 'Tab completes "ab" to "about "');
  await ev(`document.getElementById('cmd').value = ''`);
  await key('ArrowUp', 'ArrowUp', 38);
  check((await ev(`document.getElementById('cmd').value`)) === 'projects', 'ArrowUp recalls the previous command');
  await ev(`document.getElementById('cmd').value = ''`);
  await ev(`document.querySelector('#log button.cmd[data-cmd="project 1"]').click()`);
  await until(async () => (await logText()).includes('outbox'), 3000, 'project 1 detail');
  check(true, 'clicking a command in the output runs it');
  await typeText('view 6'); await enter();
  await until(() => ev(`!!document.querySelector('#log figure.shot')`), 3000, 'picture');
  await shot('07-terminal', 1200);
  await key('Escape', 'Escape', 27);
  check(!(await termOpen()), 'Esc closes the drawer');

  console.log('light and language');
  await typeText('x'); // the prompt is hidden now: typing goes nowhere, and must not throw
  await ev(`document.getElementById('btn-theme').click()`);
  await sleep(900);
  check((await ev(`localStorage.getItem('theme')`)) === '5200k', 'the light button steps the colour temperature', await ev(`localStorage.getItem('theme')`));
  check((await ev(`document.querySelector('[data-kelvin]').textContent`)).includes('5200K'), 'the footer says how the page is lit');
  await ev(`document.getElementById('btn-lang').click()`);
  await sleep(1200);
  check((await ev(`document.documentElement.lang`)) === 'zh-Hant' && (await ev(`document.querySelector('.links').textContent`)).includes('照片'), 'the language button renders the page in Traditional Chinese');
  check(!(await ev(`!!document.querySelector('.boot-fail')`)), 'no start-up failure notice');
  await shot('08-zh');
  await ev(`document.getElementById('btn-lang').click()`);
  await sleep(1200);
  await ev(`localStorage.setItem('theme', 'auto')`);

  console.log('addresses');
  await load(`${BASE}#works/black-hole`);
  await until(termOpen, 4000, 'deep link opens the terminal');
  await until(async () => (await logText()).includes('Black hole renderer'), 6000, 'deep link output');
  check(true, 'an address the page has no part for opens the terminal on that page');
  await load('about:blank'); // a new hash on the same page is not a new page load
  await load(`${BASE}#about`);
  await until(() => ev(`Math.abs(document.getElementById('about').getBoundingClientRect().top) < 120`), 5000, 'scrolled to #about').catch(() => {}); // the scroll is smooth
  check(!(await termOpen()) && (await ev(`Math.abs(document.getElementById('about').getBoundingClientRect().top) < 120`)), 'an address of a page part just scrolls there', await ev(`JSON.stringify({ open: !document.getElementById('term').hidden, top: Math.round(document.getElementById('about').getBoundingClientRect().top), y: scrollY })`));

  // ---- the mirror ----------------------------------------------------------------------
  console.log('mirror on the page (a made-up camera: nothing real is filmed)');
  await scrollTo('mirror');
  await sleep(400);
  const fig = `document.querySelector('#mirror [data-mirror]')`;
  check((await ev(`${fig}.dataset.state`)) === 'ready' && !(await ev(`!!${fig}.querySelector('video').srcObject`)), 'the camera is not touched until the button is pressed');
  await ev(`document.querySelector('#mirror [data-shutter]').click()`);
  check((await ev(`document.querySelectorAll('#mirror .print').length`)) === 1, 'the shutter prints a frame before the camera is on (the face)');
  await ev(`${fig}.querySelector('[data-mirror-start]').click()`);
  await until(() => ev(`${fig}.dataset.state === 'live' && ${fig}.querySelector('.mirror-ascii').textContent.length > 200`), 10000, 'live');
  check(!(await ev(`!!document.querySelector('dialog.mirror-stage[open]')`)), 'on the page the mirror stays in its light box (no big view)');
  const lensText = () => ev(`${fig}.querySelector('.mirror-ascii').textContent`);
  const before = await lensText();
  await ev(`${fig}.querySelector('[data-focal="85"]').click()`);
  await sleep(600);
  check((await ev(`${fig}.dataset.focal`)) === '85' && (await ev(`${fig}.querySelector('[data-focal="85"]').getAttribute('aria-pressed')`)) === 'true', 'the lens buttons switch to 85mm');
  check((await lensText()) !== before, 'a longer lens shows a closer crop');
  check((await ev(`document.querySelector('#mirror [data-cols]').textContent`)).startsWith('85mm'), 'the readout names the lens');
  await ev(`document.querySelector('#mirror [data-shutter]').click()`);
  const width = (t) => Math.max(...t.split('\n').map((l) => l.length));
  const liveCols = width(await lensText());
  const printCols = width(await ev(`document.querySelector('#mirror .print pre').textContent`));
  check(printCols > liveCols && printCols <= 240, 'the shutter prints finer than the live view', `${printCols} vs ${liveCols}`);
  check((await ev(`document.querySelectorAll('#mirror .print')[0].querySelectorAll('button').length`)) === 2, 'a live print can be copied as it is or at 80 columns');
  await shot('09-mirror-live', 300);
  await ev(`${fig}.querySelector('[data-mirror-stop]').click()`);
  await until(() => ev(`!${fig}.querySelector('video').srcObject`), 3000, 'camera released');
  check(true, 'Stop releases the camera');

  console.log('mirror from the terminal: the big view');
  await key('~', 'Backquote', 192, '~');
  await until(termOpen, 2000, 'drawer');
  await bootDone();
  await typeText('mirror'); await enter();
  await until(() => ev(`!!document.querySelector('#log [data-mirror-start]')`), 3000, 'terminal mirror');
  await ev(`document.querySelector('#log [data-mirror-start]').click()`);
  await until(() => ev(`!!document.querySelector('dialog.mirror-stage[open]') && document.querySelector('dialog.mirror-stage .ms-ascii').textContent.length > 200`), 10000, 'big view');
  check(true, 'the terminal mirror opens the big view');
  check((await ev(`document.querySelectorAll('dialog.mirror-stage [data-focal]').length`)) === 3, 'the big view has the lens buttons too');
  await ev(`document.querySelector('dialog.mirror-stage [data-focal="50"]').click()`);
  check((await ev(`document.querySelector('dialog.mirror-stage [data-focal="50"]').getAttribute('aria-pressed')`)) === 'true', 'and they work there');
  await key('Escape', 'Escape', 27);
  await until(() => ev(`!document.querySelector('dialog.mirror-stage[open]')`), 3000, 'big view closed');
  check(await termOpen(), 'Esc closes the big view first, and leaves the drawer open');
  await key('Escape', 'Escape', 27);

  // ---- reduced motion ----------------------------------------------------------------------
  console.log('reduced motion');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load();
  await sleep(600);
  check(await ev(`!document.querySelector('.hero .pic').classList.contains('is-dev') && !document.querySelector('#photos .dev-canvas')`), 'with reduced motion the pictures are simply there');
  await send('Emulation.setEmulatedMedia', { features: [] });

  // ---- a phone -------------------------------------------------------------------------------
  console.log('phone');
  await setLanguage('zh-TW');
  await ev(`localStorage.clear()`);
  await viewport(390, 844, true);
  await load();
  await sleep(1500);
  check(await noSideways(), 'no sideways scrolling on a phone');
  await shot('10-phone');
  await ev(`document.getElementById('cmdline').click()`);
  await until(termOpen, 2000, 'drawer on phone');
  await bootDone();
  await shot('11-phone-terminal', 800);
  check(await noSideways(), 'the drawer fits a phone');
  await viewport(1440, 900);

  check(consoleErrors.length === 0, 'no console errors / CSP violations', consoleErrors.join(' | '));
} catch (e) {
  failures++;
  console.error(`\nFATAL: ${e.stack ?? e}`);
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
