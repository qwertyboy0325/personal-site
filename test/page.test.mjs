import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, exposure, ruleText } from '../src/page.js';
import { RAMP, RAMP_WIDE, kelvinOf, kelvinForHour, sunColor, clock, tickExposure, parseExif, decodeFrame, developStep, rampIndex, easeOut } from '../src/light.js';
import { profile, projects, works, gallery, home, ui, LANGS, THEMES } from '../src/content.js';

// ---- the page ---------------------------------------------------------------------------
test('the page has every part, in order, in both languages, with no missing text', () => {
  for (const lang of LANGS) {
    const html = renderPage(lang);
    const order = ['class="nav"', 'class="hero"', 'class="now"', 'id="photos"', 'id="lab"', 'id="work"', 'id="about"', 'id="mirror"', 'id="contact"'].map((s) => html.indexOf(s));
    assert.ok(order.every((i) => i >= 0), `${lang}: every part is there`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${lang}: in reading order`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${lang}: one h1`);
    assert.ok(!/undefined|NaN|\[object/.test(html), `${lang}: no missing text`);
    assert.ok(html.includes(ui[lang].page.line));
  }
});

test('no inline styles, handlers or scripts (the CSP forbids them), and every outside link opens safely', () => {
  for (const lang of LANGS) {
    const html = renderPage(lang);
    assert.ok(!/\sstyle=|\son\w+=|<script/.test(html), lang);
    for (const m of html.matchAll(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) assert.match(m[0], /target="_blank" rel="noopener noreferrer"/, m[0]);
    for (const m of html.matchAll(/<img [^>]*>/g)) {
      assert.match(m[0], /width="\d+" height="\d+"/, `${m[0]}: size reserved, nothing jumps`);
      assert.match(m[0], /alt="[^"]{8,}"/, `${m[0]}: real alt text`);
    }
  }
});

test('pictures are real links to the file (they work without JavaScript) and open the viewer at their place in the gallery', () => {
  const html = renderPage('en');
  for (const m of html.matchAll(/<a class="pic[^"]*" href="([^"]+)" data-open="(\d+)"/g)) {
    const g = gallery[Number(m[2]) - 1];
    assert.ok(g, m[0]);
    assert.equal(m[1], g.src);
  }
  for (const slug of home.photos) assert.ok(html.includes(`assets/gallery/${slug}.jpg`), slug);
  assert.ok(html.includes(`assets/gallery/${home.hero}.jpg`));
});

test('the home choices name things that exist', () => {
  for (const slug of [home.hero, ...home.photos, home.lab.render, home.lab.letters]) assert.ok(gallery.some((g) => g.slug === slug), slug);
  for (const slug of [home.lab.renderWork, ...home.lab.more, ...home.workDocs]) assert.ok(works.some((w) => w.slug === slug), slug);
  for (const slug of home.photos) assert.equal(gallery.find((g) => g.slug === slug).set, 'photo', `${slug} is a photograph`);
});

test('work lists every public project with its GitHub link, and the documents open in the terminal', () => {
  const html = renderPage('en');
  const work = html.slice(html.indexOf('id="work"'), html.indexOf('id="about"'));
  for (const p of projects) assert.ok(work.includes(`href="${p.url}"`) && work.includes(p.slug), p.slug);
  for (const slug of home.workDocs) assert.ok(work.includes(`data-term="work ${slug}"`), slug);
  assert.ok(html.includes(profile.github));
});

test('buttons that need JavaScript start hidden', () => {
  const html = renderPage('en');
  for (const b of html.matchAll(/<button[^>]*>/g)) assert.match(b[0], /\shidden>$/, b[0]);
});

test('exposure: the short line and the values the readout ticks through', () => {
  assert.deepEqual(exposure({ focal: 35, aperture: 1.8, shutter: '1/3200' }), { text: '35mm · f/1.8 · 1/3200', data: '35|1.8|1/3200' });
  assert.deepEqual(exposure(undefined), { text: '', data: '' });
  assert.deepEqual(exposure({ aperture: 2 }), { text: 'f/2', data: '|2|' });
});

test('the divider is the ramp, dark to bright and back', () => {
  assert.match(ruleText(1), /^ \.:-=\+\*#%@%#\*\+=-:\. $/);
});

// ---- light and motion ----------------------------------------------------------------------
test('colour temperature: by the hour, by name, and as a colour', () => {
  assert.equal(kelvinForHour(12), 5200);
  assert.equal(kelvinForHour(17), 3400);
  assert.equal(kelvinForHour(22), 2700);
  assert.equal(kelvinForHour(0), 2700);
  assert.equal(kelvinForHour(3), 2200);
  assert.equal(kelvinForHour(-1), kelvinForHour(23));
  assert.equal(kelvinOf('2700k'), 2700);
  assert.equal(kelvinOf('auto'), null);
  assert.equal(kelvinOf('matrix'), null);
  for (const t of THEMES) if (t !== 'auto' && t !== 'matrix') assert.match(sunColor(kelvinOf(t)), /^#[0-9a-f]{6}$/, t);
  assert.notEqual(sunColor(5200), sunColor(2200), 'day and night look different');
  assert.equal(sunColor(3000), sunColor(2700), 'the nearest tone wins');
  assert.equal(clock(new Date(2026, 0, 1, 7, 5)), '07:05');
});

test('exposure readout: starts metering from f/22 and one second, and lands exactly on the real values', () => {
  const shot = parseExif('35|1.8|1/3200');
  assert.equal(tickExposure(shot, 0), '35mm · f/22 · 1"');
  assert.equal(tickExposure(shot, 1), '35mm · f/1.8 · 1/3200');
  const mid = tickExposure(shot, 0.5);
  assert.match(mid, /^35mm · f\/\d+(\.\d)? · 1\/\d+$/);
  assert.notEqual(mid, tickExposure(shot, 1));
  assert.equal(tickExposure(parseExif('14|7.1|2'), 0.3).endsWith('· 2'), true, 'a whole-second shutter is shown as it is');
  assert.equal(tickExposure(parseExif(''), 0.5), '');
});

test('decode: each character brightens through the ramp and lands on itself, CJK keeps its width', () => {
  const zero = () => 0;
  assert.equal(decodeFrame('Ezra Wu', 1, zero), 'Ezra Wu');
  const start = decodeFrame('Ezra Wu', 0, zero);
  assert.equal(start.length, 'Ezra Wu'.length);
  assert.equal(start[4], ' ', 'spaces stay spaces');
  for (const c of start.replace(' ', '')) assert.ok(RAMP.includes(c), c);
  const zh = decodeFrame('照片', 0, zero);
  for (const c of zh) assert.ok(RAMP_WIDE.includes(c), `full-width ramp for CJK: ${c}`);
  assert.equal(decodeFrame('照片', 1, zero), '照片');
  const half = decodeFrame('abcdefghij', 0.5, zero);
  assert.ok(half.startsWith('a') && !half.endsWith('j'), 'left to right');
});

test('develop steps, ramp and easing stay in range', () => {
  const steps = [10, 20, 40];
  assert.equal(developStep(steps, 0), 10);
  assert.equal(developStep(steps, 0.5), 20);
  assert.equal(developStep(steps, 1), 40);
  assert.equal(developStep(steps, 7), 40);
  assert.equal(rampIndex(0), 0);
  assert.equal(rampIndex(1), RAMP.length - 1);
  assert.equal(rampIndex(-3), 0);
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.5, 'fast start, gentle landing');
});
