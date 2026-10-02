import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, complete, parse, PUBLIC_COMMANDS, NAV, bootLines, welcomeBlocks } from '../src/engine.js';
import { renderBlocks } from '../src/render.js';
import { projects, works, gallery, THEMES } from '../src/content.js';

const ctx = (over = {}) => ({ lang: 'en', theme: 'dark', history: [], now: () => new Date('2026-10-01T03:00:00Z'), ...over });
const html = (line, c = ctx()) => renderBlocks(execute(line, c).blocks);
const text = (line, c) => html(line, c).replace(/<[^>]+>/g, '');

test('parse: splits, lowercases the name, honours quotes', () => {
  assert.deepEqual(parse('  Theme   LIGHT '), { name: 'theme', args: ['LIGHT'] });
  assert.deepEqual(parse('echo "a  b" \'c d\' e'), { name: 'echo', args: ['a  b', 'c d', 'e'] });
  assert.deepEqual(parse(''), { name: '', args: [] });
});

test('empty input produces no output', () => {
  assert.deepEqual(execute('   ', ctx()), { blocks: [], effects: [] });
});

test('every public command runs without throwing, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (const name of PUBLIC_COMMANDS) {
      const out = execute(name, ctx({ lang, history: ['help'] }));
      assert.ok(Array.isArray(out.blocks), `${name}/${lang}`);
      assert.ok(Array.isArray(out.effects), `${name}/${lang}`);
    }
  }
});

test('help lists every public command with a description', () => {
  const out = text('help');
  for (const name of PUBLIC_COMMANDS) assert.ok(out.includes(name), `help is missing ${name}`);
});

test('aliases resolve (repos, ?, cls)', () => {
  assert.match(text('repos'), /handoff-semantics/);
  assert.match(text('?'), /Available commands/);
  assert.deepEqual(execute('cls', ctx()).effects, [{ type: 'clear' }]);
});

test('navigation commands expose a hash; commands with args do not', () => {
  for (const n of NAV) assert.equal(execute(n, ctx()).nav, n);
  assert.equal(execute('theme', ctx()).nav, undefined);
  assert.equal(execute('about now', ctx()).nav, undefined);
});

test('unknown command: error plus a close suggestion', () => {
  const out = text('projcets');
  assert.match(out, /command not found: projcets/);
  assert.match(out, /Did you mean projects\?/);
});

test('unknown command with nothing close points to help', () => {
  assert.match(text('zzzzzzzzzz'), /for the list of commands/);
});

test('prototype-polluting names are treated as unknown, not executed', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.match(text(name), /command not found/, name);
  }
});

test('theme: shows current, sets valid, rejects invalid', () => {
  assert.match(text('theme'), /theme: dark/);
  const ok = execute('theme light', ctx());
  assert.deepEqual(ok.effects, [{ type: 'theme', value: 'light' }]);
  const bad = execute('theme neon', ctx());
  assert.deepEqual(bad.effects, []);
  assert.match(renderBlocks(bad.blocks), /unknown theme/);
  for (const t of THEMES) assert.deepEqual(execute(`theme ${t.toUpperCase()}`, ctx()).effects, [{ type: 'theme', value: t }]);
});

test('lang: accepts aliases and confirms in the NEW language', () => {
  const zh = execute('lang zh', ctx());
  assert.deepEqual(zh.effects, [{ type: 'lang', value: 'zh' }]);
  assert.match(renderBlocks(zh.blocks), /語言已切換/);
  assert.deepEqual(execute('lang 中文', ctx()).effects, [{ type: 'lang', value: 'zh' }]);
  assert.deepEqual(execute('lang English', ctx({ lang: 'zh' })).effects, [{ type: 'lang', value: 'en' }]);
  assert.deepEqual(execute('lang fr', ctx()).effects, []);
});

test('ls / cat: a small virtual filesystem', () => {
  assert.match(text('ls'), /about\.md.*skills\.md.*contact\.md.*projects\//);
  assert.match(text('ls projects'), /handoff-semantics.*vox-proof.*echlub.*echlub-demo/);
  assert.match(text('cat about.md'), /Backend \/ Platform Engineer/);
  assert.match(text('cat ./skills.md'), /PostgreSQL/);
  assert.match(text('cat projects/vox-proof'), /never rewrites text on its own/);
  assert.match(text('cat projects'), /Is a directory/);
  assert.match(text('cat nope.txt'), /No such file or directory/);
  assert.match(text('cat'), /usage: cat/);
  assert.match(text('ls about.md'), /Not a directory/);
  assert.match(text('ls nowhere'), /No such file or directory/);
});

test('project: by number, by name, and errors', () => {
  assert.match(text('project 1'), /handoff-semantics/);
  assert.match(text('project vox-proof'), /Rust/);
  assert.match(text('project 99'), /no match/);
  assert.match(text('project'), /usage: project/);
  for (const [i, p] of projects.entries()) assert.match(text(`project ${i + 1}`), new RegExp(p.slug));
});

test('open: returns an https URL effect only for known targets', () => {
  const gh = execute('open github', ctx());
  assert.equal(gh.effects[0].type, 'open');
  assert.match(gh.effects[0].url, /^https:\/\/github\.com\//);
  assert.equal(execute('open echlub', ctx()).effects[0].url, 'https://github.com/qwertyboy0325/echlub');
  assert.deepEqual(execute('open javascript:alert(1)', ctx()).effects, []);
  assert.deepEqual(execute('open https://evil.example', ctx()).effects, []);
  assert.deepEqual(execute('open', ctx()).effects, []);
});

test('history: empty and populated', () => {
  assert.match(text('history'), /history is empty/);
  const out = text('history', ctx({ history: ['about', 'help'] }));
  assert.match(out, /1about/);
  assert.match(out, /2help/);
});

test('date is deterministic when a clock is injected', () => {
  assert.match(text('date'), /2026/);
});

test('easter eggs exist but are not advertised in help', () => {
  assert.match(text('sudo rm -rf /'), /sudoers/);
  assert.match(text('exit'), /no exit/);
  assert.match(text('whoami'), /ezra/);
  assert.match(text('neofetch'), /ezra@site/);
  const help = text('help');
  for (const hidden of ['sudo', 'neofetch', 'whoami']) assert.ok(!help.includes(hidden), hidden);
});

test('echo output is HTML-escaped (no injection through the terminal)', () => {
  const out = html('echo <img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), out);
  assert.match(out, /&lt;img/);
  const out2 = html('echo "<script>alert(1)</script>"');
  assert.ok(!out2.includes('<script'), out2);
});

test('completion: commands, arguments, paths', () => {
  assert.deepEqual(complete('ab'), { line: 'about ', options: [] });
  assert.deepEqual(complete('theme a'), { line: 'theme amber ', options: [] });
  assert.deepEqual(complete('lang z'), { line: 'lang zh ', options: [] });
  assert.deepEqual(complete('cat pro'), { line: 'cat projects/', options: [] });
  assert.deepEqual(complete('cat projects/vox'), { line: 'cat projects/vox-proof ', options: [] });
  // Ambiguous: first Tab extends to the common prefix, second Tab lists options.
  assert.deepEqual(complete('open e'), { line: 'open echlub', options: [] });
  assert.deepEqual(complete('open echlub'), { line: 'open echlub', options: ['echlub', 'echlub-demo'] });
  assert.deepEqual(complete('zzz'), { line: 'zzz', options: [] });
  assert.deepEqual(complete('about extra args here'), { line: 'about extra args here', options: [] });
  assert.ok(complete('c').options.includes('clear'));
});

test('completion works through aliases and leading whitespace', () => {
  assert.equal(complete('  th').line, '  theme ');
  assert.equal(complete('dir pro').line, 'dir projects ');
});

test('boot and welcome content is present in both languages', () => {
  for (const lang of ['en', 'zh']) {
    assert.equal(bootLines(ctx({ lang })).length, 3);
    assert.ok(welcomeBlocks(ctx({ lang })).length >= 3);
  }
  assert.match(bootLines(ctx())[1], new RegExp(String(projects.length)));
});

test('works: list is grouped by kind, numbered and clickable; work shows details', () => {
  const list = text('works');
  assert.match(list, /Visual and 3D/);
  assert.match(list, /Research and thinking/);
  assert.match(list, /Design/);
  assert.match(list, /1\.\s*Black hole renderer/);
  assert.match(html('works'), /data-cmd="work 1"/);
  assert.match(text('work 1'), /Black hole renderer[\s\S]*physics equations[\s\S]*github\.com\/qwertyboy0325\/blackhole-rust/);
  assert.match(text('work explosion-fx'), /fictional/);
  assert.equal(text('work'), text('works'), '`work` alone lists the works');
  assert.match(text('work 99'), /no match/);
  assert.match(text('work nonsense'), /no match/);
  assert.match(text('work 3', ctx({ lang: 'zh' })), /不是產品|個人的設置/);
});

test('works: appear in help, navigation hash and completion', () => {
  assert.match(text('help'), /works/);
  assert.equal(execute('works', ctx()).nav, 'works');
  assert.equal(execute('work 1', ctx()).nav, undefined);
  assert.equal(complete('wor').line, 'work');
  assert.deepEqual(complete('work b'), { line: 'work black-hole ', options: [] });
  assert.ok(complete('wo').options.includes('works') || complete('wo').line.startsWith('work'));
});

test('every work can be opened by number and by name, in both languages', () => {
  for (const lang of ['en', 'zh']) {
    for (let i = 1; i <= works.length; i++) {
      assert.ok(text(`work ${i}`, ctx({ lang })).includes(works[i - 1][lang].title), `work ${i}/${lang}`);
      assert.ok(text(`work ${works[i - 1].slug}`, ctx({ lang })).includes(works[i - 1][lang].title));
    }
  }
});

test('gallery: list, view by number and name, errors, aliases, both languages', () => {
  assert.match(text('gallery'), /gallery/);
  for (let i = 1; i <= gallery.length; i++) assert.match(html('gallery'), new RegExp(`data-cmd="view ${i}"`));
  assert.match(html('gallery'), /▶ video/, 'the video is marked');
  assert.equal(text('images'), text('gallery'));
  assert.equal(text('pictures'), text('gallery'));
  assert.equal(text('view'), text('gallery'), '`view` alone lists the gallery');
  const one = execute('view 1', ctx()).blocks.find((b) => b.t === 'image');
  assert.ok(one && one.slug === gallery[0].slug && one.kind === 'image');
  assert.equal(one.width, gallery[0].width);
  assert.equal(one.alt, gallery[0].en.alt);
  assert.equal(execute(`view ${gallery[1].slug}`, ctx()).blocks.find((b) => b.t === 'image').slug, gallery[1].slug);
  const video = execute(`view ${gallery.length}`, ctx()).blocks.find((b) => b.t === 'image');
  assert.equal(video.kind, 'video');
  assert.ok(video.poster.endsWith('.jpg'));
  assert.match(text('view 99'), /no match/);
  assert.match(text('view nonsense'), /no match/);
  const zh = execute('view 1', ctx({ lang: 'zh' })).blocks.find((b) => b.t === 'image');
  assert.equal(zh.title, gallery[0].zh.title);
  assert.match(text('view 1'), /about this: Black hole renderer/, 'links back to the related work');
  assert.equal(execute('gallery', ctx()).nav, 'gallery');
  assert.equal(execute('view 1', ctx()).nav, undefined);
  assert.deepEqual(complete('view black'), { line: 'view black-hole-', options: [] }, 'common prefix of the slugs');
});

test('works that have pictures link to them; works without pictures do not', () => {
  assert.match(html('work 1'), /data-cmd="view 1"/);
  assert.match(text('work 1'), /pictures: .*A black hole, prepared for viewing/);
  assert.ok(!/pictures:/.test(text('work 3')), 'the AI work has no pictures yet');
  assert.match(text('work 1', ctx({ lang: 'zh' })), /相關圖片/);
});

test('image block: width and height are rendered, text is escaped, video gets a play badge', () => {
  const b = { t: 'image', index: 2, slug: 'x', kind: 'video', src: 'a.mp4', poster: 'p.jpg', width: 640, height: 480, alt: '"><img src=x onerror=alert(1)>', title: '<b>t</b>', caption: '<script>1</script>', open: 'Open' };
  const out = renderBlocks([b]);
  assert.match(out, /<img class="shot-img" src="p\.jpg" width="640" height="480"/);
  assert.ok(!out.includes('<script') && !out.includes('<b>') && !/<img src=x/.test(out), out);
  assert.match(out, /class="shot-play"/);
  assert.doesNotMatch(renderBlocks([{ ...b, kind: 'image', poster: null }]), /shot-play/);
  assert.match(out, /aria-label="Open: &lt;b&gt;t&lt;\/b&gt;"/);
});
