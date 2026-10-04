import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isEmail, seg, renderBlocks } from '../src/render.js';
import { execute } from '../src/engine.js';
import { renderPage } from '../src/page.js';
import { profile, ui, LANGS } from '../src/content.js';

const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], ...over });
const contact = (lang = 'en') => renderBlocks(execute('contact', ctx({ lang })).blocks);

/** Run `fn` with profile.email set, always restoring it. */
function withEmail(value, fn) {
  const before = profile.email;
  profile.email = value;
  try { return fn(); } finally { profile.email = before; }
}

test('isEmail accepts normal addresses and rejects anything that could break out of an attribute', () => {
  for (const ok of ['a@b.co', 'ezra.wu+site@example.com', 'x_y-z@sub.domain.tw', '中文@例子.tw']) assert.ok(isEmail(ok), ok);
  for (const bad of ['', 'no-at-sign', 'a@b', '@b.co', 'a@.co', 'a b@c.de', 'a@b.c d', '"><script>@x.y', "a'b@c.de", 'a`b@c.de', 'a\\b@c.de', 'a<b@c.de', null, undefined, 42]) assert.ok(!isEmail(bad), String(bad));
});

test('mail segment: a safe mailto link for a real address, plain text otherwise', () => {
  assert.equal(seg({ mail: 'a@b.co' }), '<a class="lnk" href="mailto:a@b.co">a@b.co</a>');
  assert.equal(seg({ mail: '"><script>x</script>' }), '&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  assert.ok(!seg({ mail: 'javascript:alert(1)' }).includes('<a '));
});

test('copy segment: a button for a real address, inert text for the static page or a bad address', () => {
  assert.equal(seg({ copy: 'a@b.co', text: 'copy' }), '<button type="button" class="cmd" data-copy="a@b.co">copy</button>');
  assert.equal(seg({ copy: 'a@b.co', text: 'copy' }, { interactive: false }), '<code class="cmd">copy</code>');
  assert.equal(seg({ copy: 'not an email', text: 'copy' }), '<code class="cmd">copy</code>');
  assert.ok(!seg({ copy: '"><img onerror=x>@x.y', text: 'c' }).includes('<img'));
});

test('the published address is exactly the one the owner gave, and it is well-formed', () => {
  assert.equal(profile.email, 'ezra40907@gmail.com', 'only the address the owner supplied may be published; never guess or invent one');
  assert.ok(isEmail(profile.email));
});

test('with no email set, nothing about email appears anywhere (setting profile.email to null hides it all)', () => {
  withEmail(null, () => {
    assert.ok(!/mailto:|data-copy|@/.test(contact()), contact());
    for (const lang of LANGS) assert.ok(!/data-copy|mailto:|gmail/.test(renderPage(lang)));
  });
});

test('with an email set: contact shows a mailto link and a copy button, in both languages', () => {
  withEmail('hello@example.com', () => {
    for (const lang of LANGS) {
      const out = contact(lang);
      assert.match(out, /<a class="lnk" href="mailto:hello@example\.com">hello@example\.com<\/a>/);
      assert.match(out, /data-copy="hello@example\.com">(copy|複製)<\/button>/);
    }
  });
});

test('with an email set: the page shows the address as a mailto link with a copy button in the contact section', () => {
  withEmail('hello@example.com', () => {
    for (const lang of LANGS) {
      const html = renderPage(lang);
      const contact = html.slice(html.indexOf('id="contact"'));
      assert.equal((html.match(/data-copy="hello@example\.com"/g) ?? []).length, 1, 'one copy button, in the contact section');
      assert.match(contact, /data-copy="hello@example\.com"/);
      assert.match(contact, /<a class="addr" href="mailto:hello@example\.com">hello@example\.com<\/a>/, 'the address itself is visible and selectable');
      assert.ok(html.includes(ui[lang].contactButton));
      assert.ok(!/<[^>]*\son\w+=/.test(html));
    }
  });
});

test('a malformed address is ignored rather than rendered', () => {
  withEmail('"><script>alert(1)</script>', () => {
    assert.ok(!renderPage('en').includes('data-copy'));
    assert.ok(!contact().includes('<script'));
  });
});

test('copy feedback strings exist in both languages and the failure message includes the address', () => {
  for (const lang of LANGS) {
    assert.ok(ui[lang].contactCopied && ui[lang].contactButton && ui[lang].contactCopy);
    assert.ok(ui[lang].contactFailed('x@y.zz').includes('x@y.zz'));
  }
});

test('index.html: contact buttons start hidden, and the toast is a polite live region', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" class="pill" data-copy="[^"]+" aria-label="[^"]+" hidden>/, 'the copy button only appears once the script can copy');
  assert.match(html, /<div id="toast" class="toast" role="status" aria-live="polite"><\/div>/);
});

test('main.js: copies with the Clipboard API, falls back, and always tells the person what happened', async () => {
  const js = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /execCommand\('copy'\)/);
  assert.match(js, /contactFailed\(addr\)/, 'if copying is impossible the address is shown instead');
  assert.match(js, /profile\.email\) copyEmail/, 'nothing is copied unless an address is set');
});

test('styles: the toast is out of the way until shown, and hidden in print', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.toast \{[^}]*pointer-events: none/);
  assert.match(css, /\.toast\.show \{ opacity: 1;/);
  assert.ok(!/\.toast:empty/.test(css), 'an empty live region must stay in the accessibility tree');
});
