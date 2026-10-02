import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { guiHtml, activeKey } from '../src/gui.js';
import { projects, works, gallery, skillGroups, profile, ui, LANGS } from '../src/content.js';

const count = (s, re) => (s.match(re) ?? []).length;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
// Visible text of the HTML: tags removed, entities decoded, whitespace collapsed.
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]).replace(/\s+/g, ' ');

test('guiHtml: one card per project and per work, each wired to its command', () => {
  for (const lang of LANGS) {
    const html = guiHtml(lang);
    projects.forEach((_, i) => assert.ok(html.includes(`data-cmd="project ${i + 1}"`), `${lang}: project ${i + 1}`));
    works.forEach((_, i) => assert.ok(html.includes(`data-cmd="work ${i + 1}"`), `${lang}: work ${i + 1}`));
    assert.equal(count(html, /data-cmd="project \d+"/g), projects.length);
    assert.equal(count(html, /data-cmd="work \d+"/g), works.length);
    assert.ok(html.includes('data-cmd="about"'));
  }
});

test('guiHtml: shows the same titles and tags the terminal shows, in each language', () => {
  for (const lang of LANGS) {
    const text = plain(guiHtml(lang));
    for (const p of projects) { assert.ok(text.includes(p.slug), p.slug); assert.ok(text.includes(p[lang].tag), `${p.slug}/${lang} tag`); }
    for (const w of works) { assert.ok(text.includes(w[lang].title), `${w.slug}/${lang} title`); assert.ok(text.includes(w[lang].tag)); }
    for (const g of skillGroups) { assert.ok(text.includes(g[lang][0])); for (const item of g[lang][1]) assert.ok(text.includes(item), item); }
    assert.ok(text.includes(profile.name));
    assert.ok(text.includes(ui[lang].welcome));
  }
});

test('guiHtml: each work card carries its kind label, with a colour class', () => {
  const html = guiHtml('en');
  assert.match(html, /class="gkind k-visual">Visual and 3D/);
  assert.match(html, /class="gkind k-think">Research and thinking/);
  assert.match(html, /class="gkind k-design">Design/);
  assert.match(guiHtml('zh'), /視覺與 3D/);
});

test('guiHtml: tools become chips, other skills become a list, stack chips come from the project', () => {
  const html = guiHtml('en');
  assert.match(html, /class="gchips gtools">(<i>[^<]+<\/i>)+/);
  assert.match(html, /<i>C#<\/i><i>\.NET 8<\/i><i>PostgreSQL<\/i>/);
  assert.match(html, /<ul class="glist">/);
});

test('guiHtml: accessible structure (labelled sections, real buttons, safe external link)', () => {
  const html = guiHtml('en');
  for (const id of ['g-projects', 'g-works', 'g-gallery', 'g-play', 'g-skills', 'g-contact']) {
    assert.ok(html.includes(`aria-labelledby="${id}"`) && html.includes(`id="${id}"`), id);
  }
  assert.equal(count(html, /<button type="button" class="gcard gbtn/g), projects.length + works.length + gallery.length + 2); // + the about button + the mirror card
  assert.match(html, /<a class="gbtn glink" href="https:\/\/github\.com\/qwertyboy0325" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<pre class="gbanner" aria-hidden="true">/);
  assert.ok(!/\son\w+=|\sstyle=|<script/i.test(html), 'no inline handlers, styles or scripts (CSP)');
});

test('guiHtml: nothing from content can break out of its markup', () => {
  // Every dynamic value passes through esc(); prove it by checking the output never contains raw angle brackets from text.
  for (const lang of LANGS) {
    const html = guiHtml(lang);
    const tags = html.match(/<[^>]*>/g) ?? [];
    for (const tag of tags) assert.match(tag, /^<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>$/i, tag);
  }
});

test('activeKey: numbers, slugs, case and spacing resolve; everything else is null', () => {
  assert.equal(activeKey('project 2'), 'project 2');
  assert.equal(activeKey('  PROJECT   1 '), 'project 1');
  assert.equal(activeKey('project vox-proof'), 'project 2');
  assert.equal(activeKey('work black-hole'), 'work 1');
  assert.equal(activeKey('work 6'), 'work 6');
  assert.equal(activeKey('work posture-wearable'), 'work 6');
  assert.equal(activeKey('about'), 'about');
  for (const bad of ['project 0', `project ${projects.length + 1}`, `work ${works.length + 1}`, 'project', 'work nonsense', 'projects', 'works', 'skills', '', null, undefined, 'project 1.5', 'project -1']) {
    assert.equal(activeKey(bad), null, String(bad));
  }
});

test('every card key matches what activeKey produces for its own command', () => {
  for (const lang of LANGS) {
    for (const m of guiHtml(lang).matchAll(/data-cmd="([^"]+)" data-key="([^"]+)"/g)) {
      assert.equal(m[1], m[2], 'cmd and key agree');
      assert.equal(activeKey(m[1]), m[1], `${m[1]} lights up its own card`);
    }
  }
});

test('the GUI uses only content from content.js (no private or invented material)', async () => {
  const src = await readFile(new URL('../src/gui.js', import.meta.url), 'utf8');
  assert.ok(!/NT\$|Flux|client|客戶|password|token/i.test(src));
  assert.ok(!/innerHTML\s*=\s*[^`'"]*\+/.test(src), 'no string-concatenated innerHTML');
});

test('styles: cards are keyboard-visible, touch-sized and show the active state', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.gbtn:hover, \.gbtn:focus-visible \{/);
  assert.match(css, /\.gcard\.active \{/);
  assert.match(css, /\.glink \{[^}]*min-height: 44px/);
  assert.match(css, /\.k-visual \{[^}]*\} \.k-think/);
});

test('guiHtml: a thumbnail card per picture, with real dimensions, lazy loading and an empty alt (the title is beside it)', () => {
  for (const lang of LANGS) {
    const html = guiHtml(lang);
    assert.equal(count(html, /data-cmd="view \d+"/g), gallery.length);
    gallery.forEach((g, i) => {
      assert.ok(html.includes(`data-cmd="view ${i + 1}"`));
      assert.ok(html.includes(`src="${g.thumb}" width="${g.thumbWidth}" height="${g.thumbHeight}" alt="" loading="lazy"`), g.slug);
      assert.ok(plain(html).includes(g[lang].title));
    });
    assert.equal(count(html, /class="shot-play"/g), gallery.filter((g) => g.kind === 'video').length, 'a play badge on videos only');
  }
});

test('activeKey: `view` resolves by number and by name', () => {
  assert.equal(activeKey('view 2'), 'view 2');
  assert.equal(activeKey('VIEW  black-hole-evolution'), `view ${gallery.findIndex((g) => g.slug === 'black-hole-evolution') + 1}`);
  assert.equal(activeKey(`view ${gallery.length + 1}`), null);
  assert.equal(activeKey('view'), null);
  assert.equal(activeKey('gallery'), null);
});
