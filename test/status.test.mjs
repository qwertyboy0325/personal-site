import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { VERSION, ui } from '../src/content.js';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const html = await read('index.html');
const pkg = JSON.parse(await read('package.json'));

/** Every .js file under src/, with its text. */
async function sources(dir = 'src') {
  const out = [];
  for (const e of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await sources(rel)));
    else if (e.name.endsWith('.js')) out.push({ rel, text: await read(rel) });
  }
  return out;
}
const files = await sources();

test('the version shown on the page is the package version', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(VERSION, pkg.version);
  const shown = html.match(/<span class="status-ver">v([^<]+)<\/span>/)?.[1];
  assert.equal(shown, VERSION, 'index.html shows the same version (bump content.js, package.json and index.html together)');
});

test('the static status line matches the English text, and both languages have one', () => {
  const shown = html.match(/<span class="status-claims">([^<]+)<\/span>/)?.[1];
  assert.equal(shown, ui.en.status.claims);
  assert.match(ui.zh.status.claims, /^0 .*0 .*0 /);
  assert.ok(ui.en.status.label && ui.zh.status.label);
  assert.match(html, /<footer class="status" id="status" aria-label="Site details">/);
});

test('claim "0 dependencies": nothing to install, and nothing imported from outside the project', () => {
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.ok(!pkg[k] || Object.keys(pkg[k]).length === 0, `package.json has no ${k}`);
  }
  for (const { rel, text } of files) {
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*from\s*['"]([^'"]+)['"]/g)) {
      assert.match(m[1], /^\.\.?\//, `${rel} imports "${m[1]}" (only relative imports are allowed)`);
    }
    assert.ok(!/\bimport\s*\(/.test(text), `${rel} has no dynamic import`);
  }
  assert.ok(!/<script[^>]+src="(?!src\/)/.test(html), 'only our own scripts are loaded');
});

test('claim "0 cookies": the code never touches cookies', () => {
  for (const { rel, text } of files) assert.ok(!/document\.cookie|cookieStore/.test(text), `${rel} does not use cookies`);
});

test('claim "0 trackers": no network calls from the page, and the CSP forbids any', () => {
  for (const { rel, text } of files) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(text), `${rel} makes no network requests`);
  }
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.ok(!/connect-src/.test(csp), 'no connect-src: the page cannot talk to any server');
  assert.ok(!/https?:\/\//.test(csp), 'no external host is allowed anywhere in the policy');
  const loaded = [...html.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of loaded) assert.ok(/github\.com\/qwertyboy0325/.test(url), `external reference ${url} is only a link, not a resource`);
  assert.ok(!/<(?:img|script|link|iframe|video|audio|source)\b[^>]+(?:src|href)="https?:/.test(html), 'no external resource is loaded');
});
