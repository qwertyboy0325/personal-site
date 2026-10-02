import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { SITE_URL, ui, profile } from '../src/content.js';
import { cardHtml, OG_WIDTH, OG_HEIGHT } from '../scripts/make-og.mjs';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const html = await read('index.html');
const meta = (key, attr = 'property') => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

test('SITE_URL is an https address that ends with a slash', () => {
  assert.match(SITE_URL, /^https:\/\/[a-z0-9.-]+\/(?:[a-z0-9._~-]+\/)*$/i);
});

test('canonical, og:url and the JSON-LD url all say the same address as SITE_URL', () => {
  assert.equal(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1], SITE_URL);
  assert.equal(meta('og:url'), SITE_URL);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.url, SITE_URL);
  assert.equal(ld.name, profile.name);
});

test('share preview tags are complete, absolute and consistent', () => {
  const image = `${SITE_URL}assets/og.png`;
  assert.equal(meta('og:type'), 'website');
  assert.equal(meta('og:site_name'), profile.name);
  assert.equal(meta('og:title'), ui.en.documentTitle);
  assert.equal(meta('twitter:title', 'name'), ui.en.documentTitle);
  assert.ok(meta('og:description').length >= 60 && meta('og:description').length <= 200);
  assert.equal(meta('og:image'), image);
  assert.equal(meta('twitter:image', 'name'), image);
  assert.equal(meta('og:image:type'), 'image/png');
  assert.equal(meta('og:image:width'), String(OG_WIDTH));
  assert.equal(meta('og:image:height'), String(OG_HEIGHT));
  assert.equal(meta('twitter:card', 'name'), 'summary_large_image');
  const alt = meta('og:image:alt');
  assert.ok(alt.length >= 40 && alt.length <= 420);
  assert.equal(meta('twitter:image:alt', 'name'), alt);
  assert.equal(meta('og:locale'), 'en_US');
});

test('the share image exists, is a 1200x630 PNG and stays small', async () => {
  const buf = await readFile(new URL('../assets/og.png', import.meta.url));
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.deepEqual(pngSize(buf), { width: OG_WIDTH, height: OG_HEIGHT });
  assert.ok((await stat(new URL('../assets/og.png', import.meta.url))).size < 200 * 1024, 'under 200 KB (crawlers allow far more, chat apps are slow with big previews)');
  assert.ok(!buf.includes('Exif') && !buf.includes('tEXt') && !buf.includes('iTXt'), 'no metadata chunks');
});

test('the card is drawn from the site data (name, role, one-line intro, banner, address)', () => {
  const card = cardHtml();
  for (const text of [profile.name, ui.en.role, ui.en.ogLine, SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, ''), ui.en.status.claims]) assert.ok(card.includes(text.replace(/&/g, '&amp;')), text);
  assert.ok(card.includes('█████'), 'the banner');
  assert.ok(ui.zh.ogLine && ui.zh.ogLine !== ui.en.ogLine);
  assert.ok(!/<script|https?:\/\/[^"' ]*\.(?:js|css)/.test(card), 'a plain picture, nothing loaded');
});

test('sitemap.xml and robots.txt point at the same site', async () => {
  const sitemap = await read('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [SITE_URL]);
  assert.match(sitemap.match(/<lastmod>([^<]+)<\/lastmod>/)[1], /^\d{4}-\d{2}-\d{2}$/);
  const robots = await read('robots.txt');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.ok(robots.includes(`Sitemap: ${SITE_URL}sitemap.xml`));
});

test('licence: MIT for the code, with the media explicitly kept out', async () => {
  const licence = await read('LICENSE');
  assert.match(licence, /^MIT License\n\nCopyright \(c\) \d{4} Ezra Wu\n/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  assert.match(licence, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal(JSON.parse(await read('package.json')).license, 'MIT');
  const notice = await read('assets/NOTICE.md');
  assert.match(notice, /photographs/);
  assert.match(notice, /not\*\* licensed\s+under the MIT License/);
  assert.match(await read('README.md'), /照片與其他圖片、影片不在 MIT 範圍內/);
});

test('the dev server serves the sitemap as XML (so what you preview is what crawlers get)', async () => {
  const src = await read('scripts/serve.mjs');
  assert.match(src, /'\.xml': 'application\/xml; charset=utf-8'/);
});
