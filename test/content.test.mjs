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
