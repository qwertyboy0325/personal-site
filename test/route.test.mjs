import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, lineForHash, titleFor, crumbsFor, documentTitle } from '../src/route.js';
import { execute, PUBLIC_COMMANDS, complete, LAYOUT_MODES } from '../src/engine.js';
import { renderEntry } from '../src/render.js';
import { projects, works, gallery, ui } from '../src/content.js';
import { isPhoto } from '../src/photos.js';
import { readFile } from 'node:fs/promises';

const ctx = (lang = 'en', extra = {}) => ({ lang, theme: 'dark', history: [], ...extra });
const firstPhoto = gallery.find(isPhoto);
const firstRender = gallery.find((g) => !isPhoto(g));

test('routeFor: the main sections are pages with their own address', () => {
  for (const name of ['about', 'projects', 'works', 'gallery', 'photos', 'skills', 'contact', 'help']) {
    const r = routeFor(name);
    assert.deepEqual([r.path, r.hash, r.cmd, r.section], [[name], name, name, name], name);
  }
  assert.deepEqual(routeFor('home'), { path: [], hash: '', cmd: 'home', section: null });
  assert.equal(routeFor('~').cmd, 'home', 'the ~ alias');
});

test('routeFor: an entry is found by number or by name, in any letter case, through the aliases', () => {
  const pr = projects[1];
  for (const line of ['project 2', `project ${pr.slug}`, `PROJECT ${pr.slug.toUpperCase()}`]) {
    assert.deepEqual(routeFor(line), { path: ['projects', pr.slug], hash: `projects/${pr.slug}`, cmd: `project ${pr.slug}`, section: 'projects' }, line);
  }
  assert.equal(routeFor(`work 1`).hash, `works/${works[0].slug}`);
  assert.equal(routeFor(`work ${works[2].slug}`).cmd, `work ${works[2].slug}`);
  assert.equal(routeFor('repos').cmd, 'projects', 'the repos alias');
  assert.equal(routeFor('pictures').cmd, 'gallery');
  assert.equal(routeFor('images').cmd, 'gallery');
});

test('routeFor: pictures live under #gallery, photographs under #photos', () => {
  assert.equal(routeFor(`view ${firstRender.slug}`).hash, `gallery/${firstRender.slug}`);
  assert.equal(routeFor(`view ${firstPhoto.slug}`).hash, `photos/${firstPhoto.slug}`);
  assert.equal(routeFor(`view ${gallery.indexOf(firstPhoto) + 1}`).hash, `photos/${firstPhoto.slug}`, 'by number');
  assert.equal(routeFor('view').cmd, 'gallery', '`view` alone is the gallery page');
  assert.equal(routeFor('photo').cmd, 'photos', 'photo alias');
});

test('routeFor: things that are not pages are null (so the output is appended, not shown as a page)', () => {
  for (const line of ['theme dark', 'lang zh', 'clear', 'history', 'fx off', 'hud off', 'mode log', 'echo hi', 'ls', 'cat about.md', 'ascii', '3d cube', 'cube', 'neofetch', 'whoami', 'nonsense', '', '   ', 'project 99', 'project nope', 'work 0', 'view 999', 'view nope']) {
    assert.equal(routeFor(line), null, JSON.stringify(line));
  }
});

test('every page route is a command that really shows something (no page leads to an error)', () => {
  const lines = ['home', 'about', 'projects', 'works', 'gallery', 'photos', 'skills', 'contact', 'help', ...projects.map((p) => `project ${p.slug}`), ...works.map((w) => `work ${w.slug}`), ...gallery.map((g) => `view ${g.slug}`)];
  for (const line of lines) {
    const route = routeFor(line);
    assert.ok(route, line);
    const out = execute(route.cmd, ctx());
    assert.ok(out.blocks.length && !out.blocks.some((b) => b.t === 'err'), `${line} -> ${route.cmd}`);
  }
});

test('lineForHash: every page address leads back to its command, and only valid ones do', () => {
  const lines = ['home', 'about', 'projects', 'works', 'gallery', 'photos', 'skills', 'contact', 'help', ...projects.map((p) => `project ${p.slug}`), ...works.map((w) => `work ${w.slug}`), ...gallery.map((g) => `view ${g.slug}`)];
  const seen = new Set();
  for (const line of lines) {
    const route = routeFor(line);
    assert.ok(!seen.has(route.hash) || route.hash === '', `unique address: ${route.hash}`);
    seen.add(route.hash);
    assert.equal(lineForHash(`#${route.hash}`), route.cmd, route.hash);
    assert.equal(lineForHash(route.hash), route.cmd, 'with or without the #');
  }
  assert.equal(lineForHash(''), 'home');
  assert.equal(lineForHash('#'), 'home');
  assert.equal(lineForHash('#home'), 'home');
  assert.equal(lineForHash('#/about'), 'about', 'a leading slash is tolerated');
  assert.equal(lineForHash('#ABOUT'), 'about', 'case does not matter');
  assert.equal(lineForHash('#projects/'), 'projects', 'a trailing slash is tolerated');
  for (const bad of ['#nope', '#projects/nope', '#photos/' + firstRender.slug, '#gallery/' + firstPhoto.slug, '#a/b/c', '#%E0%A4%A', '#about/extra', '#help/1', '#view', '#project', '#theme']) {
    assert.equal(lineForHash(bad), null, bad);
  }
});

test('lineForHash keeps the old section addresses working (#works, #contact...)', () => {
  for (const name of ['about', 'projects', 'works', 'gallery', 'skills', 'contact', 'help']) assert.equal(lineForHash(`#${name}`), name);
});

test('titles and breadcrumbs', () => {
  assert.equal(titleFor(routeFor('home'), 'en'), 'Home');
  assert.equal(titleFor(routeFor('projects'), 'zh'), '專案');
  assert.equal(titleFor(routeFor(`project ${projects[0].slug}`), 'en'), projects[0].slug);
  assert.equal(titleFor(routeFor('work 1'), 'zh'), works[0].zh.title);
  assert.equal(titleFor(routeFor(`view ${firstPhoto.slug}`), 'en'), firstPhoto.en.title);
  assert.equal(documentTitle(routeFor('home'), 'en'), ui.en.documentTitle);
  assert.equal(documentTitle(routeFor('projects'), 'en'), `Projects — ${ui.en.documentTitle}`);
  assert.equal(documentTitle(null, 'zh'), ui.zh.documentTitle);
  assert.deepEqual(crumbsFor(routeFor('home')), [{ label: '~', cmd: 'home' }]);
  assert.deepEqual(crumbsFor(routeFor('about')), [{ label: '~', cmd: 'home' }, { label: 'about', cmd: null }]);
  assert.deepEqual(crumbsFor(routeFor('project 1')), [{ label: '~', cmd: 'home' }, { label: 'projects', cmd: 'projects' }, { label: projects[0].slug, cmd: null }]);
  assert.deepEqual(crumbsFor(routeFor(`view ${firstPhoto.slug}`)).map((c) => c.cmd), ['home', 'photos', null]);
  assert.deepEqual(crumbsFor(null), [{ label: '~', cmd: 'home' }]);
  for (const lang of ['en', 'zh']) for (const k of ['home', 'about', 'projects', 'works', 'gallery', 'photos', 'skills', 'contact', 'help']) assert.ok(ui[lang].pages[k], `${lang}.pages.${k}`);
  for (const lang of ['en', 'zh']) assert.ok(ui[lang].nav.label && ui[lang].nav.back && ui[lang].nav.forward);
});

test('home and mode commands', () => {
  const home = execute('home', ctx());
  assert.ok(home.blocks.some((b) => b.t === 'row') && !home.blocks.some((b) => b.t === 'err'), 'home shows the welcome screen');
  assert.equal(JSON.stringify(execute('~', ctx()).blocks), JSON.stringify(home.blocks));
  assert.ok(!PUBLIC_COMMANDS.includes('home'), 'home is a hidden command');
  assert.ok(PUBLIC_COMMANDS.includes('mode'));
  assert.deepEqual(LAYOUT_MODES, ['page', 'log']);
  assert.match(JSON.stringify(execute('mode', ctx('en', { mode: 'log' })).blocks), /mode: log/);
  assert.deepEqual(execute('mode log', ctx()).effects, [{ type: 'mode', value: 'log' }]);
  assert.deepEqual(execute('mode page', ctx()).effects, [{ type: 'mode', value: 'page' }]);
  assert.equal(execute('mode banana', ctx()).blocks[0].t, 'err');
  assert.deepEqual(execute('mode nope', ctx('zh')).effects, []);
  assert.match(JSON.stringify(execute('mode', ctx('zh')).blocks), /一次顯示一頁/);
  assert.deepEqual(complete('mode l'), { line: 'mode log ', options: [] });
  assert.ok(JSON.stringify(execute('help', ctx()).blocks).includes('page | log'));
});

test('sheet blocks render as accessible thumbnails that open the viewer, with the title as a link to the page', () => {
  const html = renderEntry(execute('photos', ctx()).blocks, {});
  const items = [...html.matchAll(/<li class="sheet-item">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, gallery.filter(isPhoto).length);
  for (const item of items) {
    assert.match(item, /<button type="button" class="sheet-open" data-open="\d+" aria-label="[^"]+: [^"]+">/);
    assert.match(item, /<img class="sheet-img" src="assets\/gallery\/[^"]+-thumb\.jpg" width="\d+" height="\d+" alt="" loading="lazy" decoding="async">/, 'decorative thumbnail with reserved size');
    assert.match(item, /<button type="button" class="cmd" data-cmd="view \d+">\d+\. [^<]+<\/button>/);
  }
  const g = renderEntry(execute('gallery', ctx()).blocks, {});
  assert.match(g, /▶ video/, 'the video is marked');
  assert.equal((g.match(/class="shot-play"/g) ?? []).length, 1, 'only the video has a play badge');
  // Without JavaScript (the static page) it is plain pictures with real alt text.
  const plain = renderEntry(execute('gallery', ctx()).blocks, { interactive: false });
  assert.ok(!plain.includes('<button') && !plain.includes('data-open'));
  assert.match(plain, /<img class="sheet-img" src="[^"]+" width="\d+" height="\d+" alt="A black hole, prepared for viewing"/);
  // Titles with markup characters are escaped.
  const evil = renderEntry([{ t: 'sheet', open: 'Open', items: [{ index: 1, slug: 'x', thumb: 'a"b.jpg', width: 1, height: 1, title: '<script>alert(1)</script>', play: null }] }], {});
  assert.ok(!evil.includes('<script>') && evil.includes('&lt;script&gt;') && evil.includes('a&quot;b.jpg'));
});

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('index.html: the location bar sits between the title bar and the screen, starts hidden, with named buttons', async () => {
  const html = await read('index.html');
  const bar = html.match(/<nav class="crumbs" id="crumbs" aria-label="Location" hidden>([\s\S]*?)<\/nav>/);
  assert.ok(bar, 'the nav exists');
  assert.ok(html.indexOf('</header>') < html.indexOf('id="crumbs"') && html.indexOf('id="crumbs"') < html.indexOf('id="screen"'));
  assert.match(bar[1], /<button type="button" class="crumb-step" id="crumb-back" aria-label="Back" title="Back" disabled>/);
  assert.match(bar[1], /<button type="button" class="crumb-step" id="crumb-fwd" aria-label="Forward" title="Forward" disabled>/);
  assert.match(bar[1], /<ol class="crumb-path" id="crumb-path"><\/ol>/);
});

test('stylesheet: the location bar keeps its space before JS reveals it, is touch-sized on phones, and is not printed', async () => {
  const css = await read('src/styles.css');
  assert.match(css, /html\[data-hud\] \.crumbs\[hidden\] \{ display: flex !important; visibility: hidden; \}/);
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 640px\) \{ \.crumb-step \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(css, /@media print \{ \.crumbs \{ display: none !important; \} \}/);
  assert.match(css, /\.sheet \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(132px, 1fr\)\);/);
  assert.match(css, /\.sheet-open \{[^}]*aspect-ratio: 3 \/ 2;/, 'every cell has the same shape, whatever the picture');
  assert.match(css, /\.sheet-img \{[^}]*object-fit: contain;/, 'portrait pictures are not cropped');
});

test('main.js: pages replace each other, push history entries, and answer Back / Forward and hand-typed addresses', async () => {
  const src = await read('src/main.js');
  assert.match(src, /import \{ routeFor, lineForHash, crumbsFor, documentTitle \} from '\.\/route\.js'/);
  assert.match(src, /history\.pushState\(\{ i: state\.navI \}/);
  assert.match(src, /addEventListener\('popstate'/);
  assert.ok(!src.includes("addEventListener('hashchange'"), 'one handler for address changes (popstate also fires for hash edits)');
  assert.match(src, /if \(asPage\) \{ stopFaces\(\); log\.replaceChildren\(\); \}/);
  assert.match(src, /store\.set\('mode', fx\.value\)/);
  assert.match(src, /closest\('\.shot-open, \.sheet-open'\)/, 'thumbnails on a sheet open the viewer');
});
