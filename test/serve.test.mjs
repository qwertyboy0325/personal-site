import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { classifyChange, affectsPrerender, injectLiveReload, createDevServer, CLIENT_URL, EVENTS_URL, CLIENT_SCRIPT } from '../scripts/serve.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('classifyChange: css swaps in place, code reloads, noise is ignored', () => {
  assert.equal(classifyChange('src/styles.css'), 'css');
  assert.equal(classifyChange('index.html'), 'reload');
  for (const f of ['src/main.js', 'src/fx/rain.js', 'scripts/x.mjs'.replace('scripts/', 'src/'), 'assets/cursor.svg', 'package.json']) assert.equal(classifyChange(f), 'reload', f);
  for (const f of ['.git/index', 'node_modules/x/y.js', '.shots/a.png', 'test/engine.test.mjs', 'scripts/serve.mjs', '.DS_Store', 'src/.DS_Store', 'README.md', 'notes.txt', '', null, undefined]) {
    assert.equal(classifyChange(f), null, String(f));
  }
});

test('affectsPrerender: only the files that feed the static fallback', () => {
  for (const f of ['src/content.js', 'src/engine.js', 'src/render.js', 'src/fx/face.js', 'src/fx/rain.js']) assert.ok(affectsPrerender(f), f);
  for (const f of ['src/main.js', 'src/styles.css', 'src/hud.js', 'src/fx/wipe.js', 'index.html', '']) assert.ok(!affectsPrerender(f), f);
});

const PAGE = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"></head><body><main>hi</main></body></html>`;

test('injectLiveReload: adds the client and connect-src, nothing else', () => {
  const out = injectLiveReload(PAGE);
  assert.ok(out.includes(`<script src="${CLIENT_URL}"></script>`));
  assert.match(out, /content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self'"/);
  assert.ok(out.indexOf(CLIENT_URL) < out.indexOf('</body>'), 'script sits just before </body>');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(out), 'the relaxed CSP is still strict');
});

test('injectLiveReload: idempotent on CSP, tolerant of odd pages', () => {
  const once = injectLiveReload(PAGE);
  assert.equal((injectLiveReload(once).match(/connect-src/g) ?? []).length, 1, 'connect-src is not duplicated');
  assert.ok(injectLiveReload('<p>no body tag</p>').endsWith(`<script src="${CLIENT_URL}"></script>`));
  assert.equal(injectLiveReload('<body></body>').includes('Content-Security-Policy'), false, 'no CSP is invented when the page has none');
  const withTrailingSemicolon = PAGE.replace("form-action 'none'", "form-action 'none';");
  assert.match(injectLiveReload(withTrailingSemicolon), /form-action 'none'; connect-src 'self'"/);
});

test('the reload client is valid JavaScript that handles css, reload and reconnect', () => {
  assert.doesNotThrow(() => new Function(CLIENT_SCRIPT));
  assert.match(CLIENT_SCRIPT, new RegExp(EVENTS_URL));
  assert.match(CLIENT_SCRIPT, /'css'/);
  assert.match(CLIENT_SCRIPT, /location\.reload\(\)/);
  assert.match(CLIENT_SCRIPT, /dropped/);
});

async function withServer(opts, fn) {
  const root = await mkdtemp(join(tmpdir(), 'site-serve-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'index.html'), PAGE);
  await writeFile(join(root, 'src/styles.css'), 'body{color:red}');
  await writeFile(join(root, 'src/main.js'), 'export {}');
  await writeFile(join(root, 'test/a.test.mjs'), '// test');
  await writeFile(join(root, 'secret.txt'), 'top secret');
  const logs = [];
  const dev = createDevServer({ root: join(root, 'src', '..'), livereload: true, log: (m) => logs.push(m), ...opts });
  const port = await dev.start(0);
  await sleep(400); // macOS FSEvents replays events from just before the watcher started; let those flush
  try { await fn({ base: `http://127.0.0.1:${port}`, root, port, logs }); } finally { dev.stop(); await rm(root, { recursive: true, force: true }); }
}

test('serves files with the right types and never caches', async () => {
  await withServer({}, async ({ base }) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(html.headers.get('cache-control'), 'no-store');
    assert.ok((await html.text()).includes(CLIENT_URL), 'html gets the client');
    const css = await fetch(`${base}/src/styles.css`);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await css.text(), 'body{color:red}', 'css is served untouched');
    const js = await fetch(`${base}/src/main.js?lr=123`);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    const client = await fetch(`${base}${CLIENT_URL}`);
    assert.equal(client.status, 200);
    assert.equal(await client.text(), CLIENT_SCRIPT);
  });
});

test('livereload:false serves pages exactly as they are on disk', async () => {
  await withServer({ livereload: false }, async ({ base }) => {
    assert.equal(await (await fetch(`${base}/`)).text(), PAGE);
    assert.equal((await fetch(`${base}${CLIENT_URL}`)).status, 404);
    assert.equal((await fetch(`${base}${EVENTS_URL}`)).status, 404);
  });
});

test('cannot read outside the served directory', async () => {
  await withServer({}, async ({ port }) => {
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/%2e%2e/%2e%2e/etc/passwd' }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.ok([403, 404].includes(status), `status ${status}`);
    assert.notEqual(status, 200);
  });
});

/** Read the event stream until `predicate(text)` holds or the time runs out. */
async function readEvents(url, predicate, ms = 2500) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body.getReader();
  let text = '';
  const done = (async () => {
    const dec = new TextDecoder();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) return text;
      text += dec.decode(value);
      if (predicate(text)) return text;
    }
  })();
  return { ctrl, text: () => text, wait: () => Promise.race([done, sleep(ms).then(() => text)]).finally(() => ctrl.abort()) };
}

test('file changes reach open pages over SSE: css -> "css", js -> "reload"', async () => {
  await withServer({}, async ({ base, root }) => {
    const css = await readEvents(`${base}${EVENTS_URL}`, (t) => t.includes('data: css'));
    await sleep(150); // let the stream open and the watcher settle
    await writeFile(join(root, 'src/styles.css'), 'body{color:blue}');
    assert.match(await css.wait(), /data: css\n\n/);

    const js = await readEvents(`${base}${EVENTS_URL}`, (t) => t.includes('data: reload'));
    await sleep(150);
    await writeFile(join(root, 'src/main.js'), 'export const x = 1');
    assert.match(await js.wait(), /data: reload\n\n/);
  });
});

test('a css and a js save in the same moment send a single reload', async () => {
  await withServer({}, async ({ base, root }) => {
    const ev = await readEvents(`${base}${EVENTS_URL}`, (t) => t.includes('data: reload'));
    await sleep(150);
    await Promise.all([writeFile(join(root, 'src/styles.css'), 'a{}'), writeFile(join(root, 'src/main.js'), 'export const y = 2')]);
    const text = await ev.wait();
    assert.equal((text.match(/data: /g) ?? []).length, 1, text);
    assert.match(text, /data: reload/);
  });
});

test('changes to tests, docs and the repo internals do not disturb the page', async () => {
  await withServer({}, async ({ base, root }) => {
    const ev = await readEvents(`${base}${EVENTS_URL}`, (t) => t.includes('data: '), 700);
    await sleep(150);
    await writeFile(join(root, 'test/a.test.mjs'), '// changed');
    await writeFile(join(root, 'notes.txt'), 'x');
    assert.ok(!(await ev.wait()).includes('data: '), 'no event for ignored files');
  });
});

test('editing a file that feeds the static fallback logs a rebuild hint', async () => {
  await withServer({}, async ({ base, root, logs }) => {
    await mkdir(join(root, 'src'), { recursive: true });
    const ev = await readEvents(`${base}${EVENTS_URL}`, (t) => t.includes('data: reload'));
    await sleep(150);
    await writeFile(join(root, 'src/content.js'), 'export const a = 1');
    await ev.wait();
    assert.ok(logs.some((l) => l.includes('npm run build')), JSON.stringify(logs));
  });
});

test('the real index.html is untouched by the dev server (strict CSP stays on disk)', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('__livereload'));
  assert.ok(!html.includes('connect-src'));
});
