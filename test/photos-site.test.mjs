// The whole photography feature, exercised with a COPY of the site that contains two
// photographs (the real site has none yet): commands, help, completion, overview,
// shooting details, the home page, and the static page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isPhoto, shotProblems } from '../src/photos.js';

const REAL = fileURLToPath(new URL('..', import.meta.url));

const photo = (n, slug, camera) => `  {
    slug: '${slug}', kind: 'image', set: 'photo',
    src: 'assets/gallery/${slug}.jpg', width: 1600, height: 1067,
    thumb: 'assets/gallery/${slug}-thumb.jpg', thumbWidth: 480, thumbHeight: 320,
    shot: { camera: '${camera}', lens: 'TEST 50mm F1.8', focal: 50, aperture: 1.8, shutter: '1/250', iso: 100 },
    en: { title: 'Photo ${n} title', caption: 'First sentence of photo ${n}. Second sentence.', alt: 'A photo used only by the tests, number ${n}.' },
    zh: { title: '照片 ${n} 標題', caption: '第 ${n} 張照片的第一句。第二句。', alt: '只給測試用的照片，編號 ${n}。' },
  },
`;

/** content.js without the real photographs (so the tests below can control exactly which photos exist). */
const withoutRealPhotos = (text) => text.replace(/\n  \{\n    slug: '[^']+',\n    kind: 'image',\n    set: 'photo',[\s\S]*?\n  \},/g, '');

/** A copy of src/ whose gallery holds the four renders plus `extra` photos (default: two test photos), imported fresh. */
async function siteWithPhotos(extra = photo(1, 'photo-test-one', 'TESTCO One') + photo(2, 'photo-test-two', 'TESTCO Two')) {
  const dir = mkdtempSync(join(tmpdir(), 'photos-site-'));
  cpSync(join(REAL, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(REAL, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(REAL, 'index.html'), join(dir, 'index.html'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const file = join(dir, 'src/content.js');
  const text = withoutRealPhotos(readFileSync(file, 'utf8'));
  const at = text.indexOf('export const skillGroups');
  const close = text.lastIndexOf('];', at);
  writeFileSync(file, text.slice(0, close) + extra + text.slice(close));
  const load = (rel) => import(`${pathToFileURL(join(dir, rel)).href}?t=${Math.random()}`);
  return { dir, load, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const ctx = (lang = 'en') => ({ lang, theme: 'dark', history: [] });
const textOf = (blocks) => JSON.stringify(blocks);

test('without photos: no photos command, no mention in help, nothing changes', async () => {
  const site = await siteWithPhotos('');
  try {
    const { execute, PUBLIC_COMMANDS, HAS_PHOTOS, complete } = await site.load('src/engine.js');
    assert.equal(HAS_PHOTOS, false);
    assert.ok(!PUBLIC_COMMANDS.includes('photos'));
    assert.ok(execute('photos', ctx()).blocks[0].t === 'err', 'unknown command, as for any other word');
    assert.ok(execute('photography', ctx()).blocks[0].t === 'err');
    assert.ok(!textOf(execute('help', ctx()).blocks).includes('my photographs'));
    assert.ok(!textOf(execute('gallery', ctx()).blocks).includes('photographs'), 'the gallery list has no empty "photographs" group');
    assert.ok(!JSON.stringify(complete('pho', ctx())).includes('photos'));
    const { renderPage } = await site.load('src/page.js');
    for (const lang of ['en', 'zh']) {
      const html = renderPage(lang);
      assert.ok(!html.includes('id="photos"'), `${lang}: no empty photo section on the page`);
      assert.ok(!html.includes('href="#photos"'), `${lang}: and no link to one`);
      assert.match(html, /<section class="hero"[\s\S]*?<img src="assets\/gallery\/[^"]+"/, `${lang}: the hero still has a picture`);
    }
  } finally { site.done(); }
});

test('the real site: the photographs are live, in order, with their shooting details', async () => {
  const { gallery } = await import('../src/content.js');
  const { execute, HAS_PHOTOS, PUBLIC_COMMANDS } = await import('../src/engine.js');
  const { renderEntry } = await import('../src/render.js');
  const photos = gallery.map((g, i) => [g, i]).filter(([g]) => isPhoto(g));
  assert.equal(HAS_PHOTOS, photos.length > 0);
  assert.equal(photos.length, 12, 'all twelve chosen photographs');
  assert.ok(PUBLIC_COMMANDS.includes('photos'));
  assert.deepEqual(photos.map(([, i]) => i + 1), Array.from({ length: 12 }, (_, i) => i + 5), 'they come after the four project pictures');
  const list = renderEntry(execute('photos', ctx()).blocks, {});
  for (const [g, i] of photos) assert.ok(list.includes(`data-cmd="view ${i + 1}"`) && list.includes(g.en.title) && list.includes(`data-open="${i + 1}"`), g.slug);
  const first = execute('view 5', ctx()).blocks.find((b) => b.t === 'image');
  assert.match(first.shot, /^NIKON Z 6 · NIKKOR Z 35mm f\/1\.8 S · 35 mm · f\/1\.8 · 1\/3200 s · ISO 100$/);
  for (const [g] of photos) assert.deepEqual(shotProblems(g.shot), [], g.slug);
});

test('with photos: the command, aliases, help and completion appear', async () => {
  const site = await siteWithPhotos();
  try {
    const { execute, PUBLIC_COMMANDS, HAS_PHOTOS, complete } = await site.load('src/engine.js');
    const { renderEntry } = await site.load('src/render.js');
    assert.equal(HAS_PHOTOS, true);
    assert.deepEqual(PUBLIC_COMMANDS.slice(0, 6), ['about', 'projects', 'works', 'gallery', 'photos', 'view']);
    for (const name of ['photos', 'photo', 'photography']) {
      const out = execute(name, ctx());
      assert.equal(out.blocks[0].v, 'photos', name);
      const html = renderEntry(out.blocks, {});
      assert.ok(html.includes('5. Photo 1 title') && html.includes('6. Photo 2 title'), `${name}: numbers continue the gallery's (5, 6)`);
      assert.ok(!html.includes('A black hole, prepared'), `${name}: only photos`);
      assert.ok(html.includes('view 5'), `${name}: the hint points at the first photo`);
      assert.ok(html.includes('class="sheet"') && html.includes('data-open="5"'), `${name}: a contact sheet`);
    }
    assert.ok(textOf(execute('help', ctx()).blocks).includes('my photographs'));
    assert.ok(textOf(execute('help', ctx('zh')).blocks).includes('我的攝影'));
    assert.ok(JSON.stringify(complete('pho', ctx())).includes('photos'));
    const zh = renderEntry(execute('photos', ctx('zh')).blocks, {});
    assert.ok(zh.includes('照片 1 標題') && zh.includes('每張照片下方有拍攝資訊'));
  } finally { site.done(); }
});

test('with photos: `gallery` shows two labelled groups and `view` carries the shooting details', async () => {
  const site = await siteWithPhotos();
  try {
    const { execute } = await site.load('src/engine.js');
    const { renderEntry: render } = await site.load('src/render.js');
    const g = render(execute('gallery', ctx()).blocks, {});
    assert.ok(g.indexOf('from my projects') < g.indexOf('1. A black hole') && g.indexOf('4. ') < g.indexOf('photographs') && g.indexOf('photographs') < g.indexOf('5. Photo 1 title'));
    const view = execute('view 5', ctx()).blocks.find((b) => b.t === 'image');
    assert.equal(view.shot, 'TESTCO One · TEST 50mm F1.8 · 50 mm · f/1.8 · 1/250 s · ISO 100');
    assert.equal(view.index, 5);
    assert.equal(execute('view photo-test-two', ctx()).blocks.find((b) => b.t === 'image').index, 6, 'by name too');
    assert.equal(execute('view 1', ctx()).blocks.find((b) => b.t === 'image').shot, '', 'renders have no shooting details');
    const { renderEntry } = await site.load('src/render.js');
    const html = renderEntry(execute('view 5', ctx()).blocks, {});
    assert.match(html, /<span class="exif">TESTCO One · TEST 50mm F1\.8 · 50 mm · f\/1\.8 · 1\/250 s · ISO 100<\/span>/);
    assert.ok(!renderEntry(execute('view 1', ctx()).blocks, {}).includes('class="exif"'));
  } finally { site.done(); }
});

test('with photos: the page shows them with their exposure, and the static page lists them', async () => {
  const site = await siteWithPhotos();
  try {
    const { renderPage } = await site.load('src/page.js');
    const en = renderPage('en');
    const sec = en.slice(en.indexOf('id="photos"'), en.indexOf('id="lab"'));
    assert.deepEqual([...sec.matchAll(/<a class="pic" href="[^"]+" data-open="(\d+)"/g)].map((m) => m[1]), ['5', '6'], 'the photos that exist, in order, opening the viewer at their place in the gallery');
    assert.match(sec, /Photo 1 title/);
    assert.match(sec, /<span class="exif" data-exif="50\|1\.8\|1\/250">50mm · f\/1\.8 · 1\/250<\/span>/);
    assert.ok(!/TESTCO|TEST 50mm/.test(sec), 'the page shows the exposure only; camera and lens stay in the viewer');
    assert.match(renderPage('zh'), /照片 1 標題/);
    assert.match(en, /href="#photos" data-sec="photos"/);
    const { buildStatic } = await site.load('scripts/prerender.mjs');
    assert.ok(buildStatic().includes('Photo 1 title'));
  } finally { site.done(); }
});

test('the viewers show the shooting details line under the caption', async () => {
  const box = readFileSync(join(REAL, 'src/lightbox.js'), 'utf8');
  for (const [name, src] of [['lightbox', box]]) {
    assert.match(src, /shotLine\(g\)/, `${name} reads the details`);
    assert.match(src, /exif\.textContent = shot/, `${name} inserts them as text (never HTML)`);
    assert.match(src, /className = 'exif'/);
  }
  const css = readFileSync(join(REAL, 'src/styles.css'), 'utf8');
  assert.match(css, /\.entry \.exif, \.viewer \.exif \{ display: block;/);
});
