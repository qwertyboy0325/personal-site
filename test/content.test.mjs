import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { profile, projects, works, skillGroups, ui, THEMES, LANGS, banner } from '../src/content.js';
import { esc, seg, block } from '../src/render.js';
import { buildStatic, inject } from '../scripts/prerender.mjs';

test('en and zh UI tables define exactly the same keys', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(ui.zh), keys(ui.en));
  assert.deepEqual(keys(ui.zh.cmds), keys(ui.en.cmds));
  assert.deepEqual(keys(ui.zh.labels), keys(ui.en.labels));
  assert.deepEqual(keys(ui.zh.projectLabels), keys(ui.en.projectLabels));
  assert.deepEqual(keys(ui.zh.contactLabels), keys(ui.en.contactLabels));
});

test('function-valued strings are functions in both languages', () => {
  for (const k of Object.keys(ui.en)) assert.equal(typeof ui.zh[k], typeof ui.en[k], k);
});

test('every project has complete en + zh copy and a valid GitHub URL', () => {
  for (const p of projects) {
    assert.match(p.slug, /^[a-z0-9-]+$/);
    assert.ok(p.url.startsWith(`${profile.github}/${p.slug}`), p.slug);
    for (const lang of LANGS) {
      const c = p[lang];
      assert.ok(c.tag && c.summary && c.tech && c.nongoals, `${p.slug}/${lang}`);
      assert.ok(Array.isArray(c.points) && c.points.length > 0, `${p.slug}/${lang}`);
    }
  }
  assert.equal(new Set(projects.map((p) => p.slug)).size, projects.length);
});

test('skill groups are complete in both languages', () => {
  for (const g of skillGroups) for (const lang of LANGS) assert.ok(g[lang][0] && g[lang][1].length, g.key);
});

test('every URL in the content is https', () => {
  const urls = [profile.github, ...projects.map((p) => p.url)];
  for (const u of urls) assert.match(u, /^https:\/\//);
});

test('supported themes and languages are what the CSS and engine expect', () => {
  assert.deepEqual(THEMES, ['dark', 'light', 'amber', 'matrix']);
  assert.deepEqual(LANGS, ['en', 'zh']);
});

test('banner is five rows and fits a narrow phone', () => {
  const rows = banner.split('\n');
  assert.equal(rows.length, 5);
  assert.ok(Math.max(...rows.map((r) => r.length)) <= 30);
});

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
});

test('seg refuses non-https links and drops them to plain text', () => {
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '//example.com', 'https://a b']) {
    const out = seg({ link: bad, text: 'x' });
    assert.ok(!out.includes('<a '), bad);
  }
  assert.match(seg({ link: 'https://example.com', text: 'x' }), /rel="noopener noreferrer"/);
});

test('seg: `sub` renders a dim block line, escaped', () => {
  assert.match(seg({ sub: 'tag <b>' }), /^<span class="dim sub">tag &lt;b&gt;<\/span>$/);
});

test('non-interactive rendering turns command buttons into plain <code>', () => {
  assert.match(seg({ cmd: 'help' }), /<button/);
  assert.ok(!seg({ cmd: 'help' }, { interactive: false }).includes('<button'));
  assert.ok(!block({ t: 'p', v: [{ cmd: 'help' }] }, { interactive: false }).includes('data-cmd'));
});

test('index.html: pre-rendered section is in sync with content (run `npm run build`)', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(inject(html, buildStatic()), html);
});

test('index.html: security and SEO essentials', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
  assert.match(html, /<title>[^<]{10,}<\/title>/);
  assert.match(html, /name="description" content="[^"]{50,}"/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, 'exactly one <h1>');
  assert.ok(!/\son\w+=/.test(html), 'no inline event handlers');
  assert.ok(!/<script(?![^>]*(src=|type="application\/ld\+json"))/.test(html), 'no inline scripts');
  assert.ok(!/\sstyle=/.test(html), 'no inline styles');
  // Nothing may load from a third-party origin.
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith(profile.github));
  assert.deepEqual(external, []);
});

test('index.html: the no-JS fallback contains the real content', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const p of projects) assert.ok(html.includes(p.slug), p.slug);
  assert.ok(html.includes('Backend / Platform Engineer'));
  assert.ok(html.includes(profile.github));
});

test('stylesheet: reduced-motion, focus, and three themes are defined', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  for (const t of THEMES.filter((x) => x !== 'dark')) assert.match(css, new RegExp(`data-theme="${t}"`));
  assert.match(css, /prefers-color-scheme: light/);
  assert.ok(!/@import|url\(http/.test(css), 'no external resources in CSS');
});

// The site is for people who do not write code: engineering terms may only live
// in the `tech` line ("for engineers"), the skills list and tool names.
const JARGON = ['outbox', 'inbox', 'idempotent', 'transactional', 'SKIP LOCKED', 'dead-letter', 'ADR', 'CRDT', 'WASM', 'race', 'canonical', 'kernel', 'replication', 'Testcontainers', 'SRT', 'ASR', 'concurrency', 'multi-tenant', 'migration', 'write-race'];

test('plain-language fields contain no engineering jargon (it belongs in `tech`)', () => {
  const plain = [];
  for (const lang of LANGS) {
    for (const p of projects) {
      const c = p[lang];
      plain.push([`${p.slug}/${lang}/tag`, c.tag], [`${p.slug}/${lang}/summary`, c.summary], [`${p.slug}/${lang}/nongoals`, c.nongoals]);
      c.points.forEach((x, i) => plain.push([`${p.slug}/${lang}/points[${i}]`, x]));
    }
    for (const w of works) {
      const c = w[lang];
      plain.push([`works/${w.slug}/${lang}/title`, c.title], [`works/${w.slug}/${lang}/tag`, c.tag], [`works/${w.slug}/${lang}/summary`, c.summary], [`works/${w.slug}/${lang}/nongoals`, c.nongoals]);
      c.points.forEach((x, i) => plain.push([`works/${w.slug}/${lang}/points[${i}]`, x]));
    }
    for (const [k, v] of Object.entries(ui[lang])) {
      if (['welcome', 'workStyle', 'contactMode'].includes(k)) plain.push([`ui.${lang}.${k}`, v]);
    }
    ui[lang].bio.forEach((x, i) => plain.push([`ui.${lang}.bio[${i}]`, x]));
  }
  for (const [where, text] of plain) {
    for (const word of JARGON) {
      assert.ok(!new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(text), `"${word}" in ${where}: ${text}`);
    }
  }
});

test('every plain summary is short enough to read at a glance', () => {
  for (const lang of LANGS) {
    for (const p of projects) {
      const limit = lang === 'en' ? 420 : 200;
      assert.ok(p[lang].summary.length <= limit, `${p.slug}/${lang} summary is ${p[lang].summary.length} chars (limit ${limit})`);
      assert.ok(p[lang].tag.length <= (lang === 'en' ? 70 : 30), `${p.slug}/${lang} tag too long`);
    }
  }
});

test('works: complete, bilingual, unique, and each belongs to a known kind', () => {
  assert.ok(works.length >= 6);
  assert.equal(new Set(works.map((w) => w.slug)).size, works.length, 'slugs are unique');
  for (const w of works) {
    assert.match(w.slug, /^[a-z0-9-]+$/);
    assert.ok(Object.hasOwn(ui.en.workKinds, w.kind) && Object.hasOwn(ui.zh.workKinds, w.kind), `${w.slug}: unknown kind ${w.kind}`);
    if (w.url) assert.match(w.url, /^https:\/\/github\.com\/qwertyboy0325\//, `${w.slug}: only the owner's own public pages may be linked`);
    for (const lang of LANGS) {
      const c = w[lang];
      assert.ok(c.title && c.tag && c.summary && c.tech && c.nongoals, `${w.slug}/${lang}`);
      assert.ok(Array.isArray(c.points) && c.points.length >= 1, `${w.slug}/${lang} points`);
      assert.ok(c.summary.length <= (lang === 'en' ? 460 : 220), `${w.slug}/${lang} summary is ${c.summary.length} chars`);
      assert.ok(c.nongoals.length > 20, `${w.slug}/${lang}: say what is NOT claimed`);
    }
  }
  assert.deepEqual(Object.keys(ui.en.workKinds), Object.keys(ui.zh.workKinds));
});

test('works are de-identified: no private names, partners, client wording or money', () => {
  const FORBIDDEN = ['Flux', 'Jasslin', 'Shwoo', 'shwoo', 'AlphaLab', 'trading', 'client', '客戶', 'investor', '投資人', 'co-founder', '共同創辦', 'revenue', '營收', 'NT$', 'password', 'token', 'Keychain-item', 'com.lmstudio', '127.0.0.1', 'localhost:'];
  for (const w of works) {
    for (const lang of LANGS) {
      const text = JSON.stringify(w[lang]);
      for (const word of FORBIDDEN) assert.ok(!text.toLowerCase().includes(word.toLowerCase()), `"${word}" in works/${w.slug}/${lang}`);
    }
  }
});

test('the nuclear-sandbox project is presented as effects research and is explicit that it is unfinished', () => {
  const fx = works.find((w) => w.slug === 'explosion-fx');
  assert.ok(fx);
  assert.ok(!fx.url, 'no link: the project is not published');
  assert.match(fx.en.summary, /fictional/i);
  assert.match(fx.en.nongoals, /not a finished|prototype/i);
  assert.match(fx.zh.nongoals, /原型|完成/);
});

test('the posture design is credited as a team project, never as sole authorship', () => {
  const w = works.find((x) => x.slug === 'posture-wearable');
  assert.match(w.en.summary, /by a team/i);
  assert.match(w.zh.summary, /團隊/);
  for (const lang of LANGS) assert.ok(!/\b(I designed|I built|my design)\b|我設計|我的設計/i.test(JSON.stringify(w[lang])), lang);
});

// ---- gallery: files, real dimensions, bilingual text, plain language -----------------------
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gallery } from '../src/content.js';

const rootUrl = (rel) => new URL(`../${rel}`, import.meta.url);

/** Pixel size from a JPEG's SOF marker (no dependencies). */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

test('gallery: every file exists and its declared width/height are the real pixel sizes', () => {
  assert.ok(gallery.length >= 4);
  assert.equal(new Set(gallery.map((g) => g.slug)).size, gallery.length, 'unique slugs');
  for (const g of gallery) {
    const poster = g.kind === 'video' ? g.poster : g.src;
    for (const rel of [g.src, g.thumb, ...(g.poster ? [g.poster] : [])]) assert.ok(existsSync(rootUrl(rel)), `${g.slug}: missing ${rel}`);
    const full = jpegSize(readFileSync(rootUrl(poster)));
    assert.deepEqual([g.width, g.height], [full.width, full.height], `${g.slug}: width/height must match the image (otherwise the page jumps while loading)`);
    const thumb = jpegSize(readFileSync(rootUrl(g.thumb)));
    assert.deepEqual([g.thumbWidth, g.thumbHeight], [thumb.width, thumb.height], `${g.slug}: thumbnail size`);
    assert.ok(['image', 'video'].includes(g.kind));
    if (g.kind === 'video') { assert.ok(g.src.endsWith('.mp4') && g.poster, `${g.slug}: a video needs an mp4 and a poster`); }
  }
});

test('gallery: stays light (per-file and total budget)', () => {
  let total = 0;
  for (const g of gallery) {
    for (const rel of [g.src, g.thumb, ...(g.poster ? [g.poster] : [])]) {
      const kb = statSync(rootUrl(rel)).size / 1024;
      total += kb;
      assert.ok(kb < (rel.endsWith('.mp4') ? 600 : 200), `${rel} is ${kb.toFixed(0)} KB`);
    }
  }
  assert.ok(total < 1200, `gallery assets total ${total.toFixed(0)} KB`);
});

test('gallery: text is complete in both languages, every image has real alt text, and captions say what the picture is not', () => {
  for (const g of gallery) {
    for (const lang of LANGS) {
      const c = g[lang];
      assert.ok(c.title && c.caption && c.alt, `${g.slug}/${lang}`);
      assert.ok(c.alt.length >= (lang === 'en' ? 30 : 15), `${g.slug}/${lang}: alt text should describe the picture`);
      assert.notEqual(c.alt, c.title, 'alt text is not just the title');
      assert.ok(c.caption.length <= (lang === 'en' ? 420 : 200), `${g.slug}/${lang}: caption length ${c.caption.length}`);
    }
    if (g.work) assert.ok(works.some((w) => w.slug === g.work), `${g.slug}: unknown work ${g.work}`);
    if (g.source) assert.match(g.source, /^https:\/\/github\.com\/qwertyboy0325\//);
  }
  const text = JSON.stringify(gallery.map((g) => g.en));
  assert.match(text, /not a film-quality|not meant to look good|work in progress/i, 'the pictures are described honestly');
});

test('gallery: plain language and nothing private', () => {
  const FORBIDDEN = ['/Users/', 'Ezra4', 'localhost', '127.0.0.1', 'token', 'password', 'NT$', 'client', '客戶'];
  for (const g of gallery) {
    for (const lang of LANGS) {
      const text = JSON.stringify(g[lang]);
      for (const word of FORBIDDEN) assert.ok(!text.includes(word), `"${word}" in ${g.slug}/${lang}`);
      for (const word of JARGON) assert.ok(!new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(g[lang].caption + g[lang].title), `"${word}" in ${g.slug}/${lang}`);
    }
  }
});

test('gallery: provenance is documented next to the files', () => {
  const sources = readFileSync(rootUrl('assets/gallery/SOURCES.md'), 'utf8');
  for (const g of gallery) assert.ok(sources.includes(g.src.split('/').at(-1)), `${g.src} is not listed in SOURCES.md`);
  assert.match(sources, /blackhole-rust/);
});

test('index.html: the CSP allows own images and media, and still nothing else', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /img-src 'self'/);
  assert.match(csp, /media-src 'self'/);
  assert.ok(!/(img|media)-src[^;]*(https?:|data:|\*)/.test(csp), 'no external image or media origins');
  assert.ok(!/connect-src/.test(csp), 'the deployed page cannot make network requests (only the dev server adds connect-src)');
});

/** Top-level MP4 box types in order (size + type, no dependencies). */
function mp4Boxes(buf) {
  const out = [];
  for (let i = 0; i + 8 <= buf.length; ) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(i + 8)); // 64-bit size
    if (size < 8) break;
    out.push(type);
    i += size;
  }
  return out;
}

test('video: the index (moov) comes before the data (mdat) so playback can start without reading the end of the file', () => {
  for (const g of gallery.filter((x) => x.kind === 'video')) {
    const boxes = mp4Boxes(readFileSync(rootUrl(g.src)));
    assert.equal(boxes[0], 'ftyp', `${g.src}: not an MP4`);
    assert.ok(boxes.includes('moov') && boxes.includes('mdat'), `${g.src}: ${boxes.join(',')}`);
    assert.ok(boxes.indexOf('moov') < boxes.indexOf('mdat'), `${g.src}: moov is after mdat. Fix with: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`);
  }
});
