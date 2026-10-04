import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/guard.js', import.meta.url), 'utf8');

/** Run guard.js in an isolated fake browser and hand back the pieces to poke at. */
function boot({ hasScreen = true } = {}) {
  const root = { dataset: {} };
  const listeners = {};
  const docListeners = {};
  const prepended = [];
  const node = (tag) => ({ tag, className: '', textContent: '', attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } });
  const screenNode = { prepend: (n) => prepended.push(n) };
  const bodyNode = { prepend: (n) => prepended.push(n) };
  const timers = [];
  const sandbox = {
    addEventListener: (t, f, capture) => { listeners[t] = { f, capture }; },
    document: {
      createElement: node,
      getElementById: () => (hasScreen ? screenNode : null),
      querySelector: (sel) => (sel === '.boot-fail' && prepended.length ? prepended[0] : null),
      body: bodyNode,
      documentElement: root,
      addEventListener: (t, f) => { docListeners[t] = f; },
    },
    navigator: { userAgent: 'TestBrowser/27.0' },
    location: { protocol: 'http:' },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    String, Math,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, listeners, docListeners, prepended, timers, root };
}

const textOf = (n) => [n.textContent, ...n.children.map(textOf)].join('\n');

test('guard: is a classic script that touches nothing until something goes wrong', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(source), 'must not be a module: it has to run when the module graph fails');
  const { prepended, timers } = boot();
  assert.equal(prepended.length, 0);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 2000 && timers[0].ms <= 6000, `waits ${timers[0].ms}ms`);
});

test('guard: stays silent when the app reports it is ready', () => {
  const { sandbox, timers, prepended } = boot();
  sandbox.__siteReady = true;
  timers[0].f();
  assert.equal(prepended.length, 0);
});

test('guard: shows a notice with the real error when the app never became ready', () => {
  const { listeners, timers, prepended } = boot();
  listeners.error.f({ message: 'TypeError: x is not a function', filename: 'http://127.0.0.1:5173/src/main.js', lineno: 12, colno: 7, target: {} });
  timers[0].f();
  assert.equal(prepended.length, 1);
  const box = prepended[0];
  assert.equal(box.className, 'boot-fail');
  assert.equal(box.attrs.role, 'alert');
  const text = textOf(box);
  assert.match(text, /did not start/);
  assert.match(text, /互動部分沒有/, 'bilingual');
  assert.match(text, /TypeError: x is not a function \(main\.js:12:7\)/);
  assert.match(text, /TestBrowser\/27\.0/, 'includes the browser string');
  assert.match(text, /protocol: http:/);
});

test('guard: captures failed script loads, rejections and CSP violations', () => {
  const { sandbox, listeners, docListeners, timers, prepended } = boot();
  assert.equal(listeners.error.capture, true, 'capture phase, because load errors do not bubble');
  listeners.error.f({ target: { src: 'http://127.0.0.1:5173/src/engine.js' } });
  listeners.unhandledrejection.f({ reason: new Error('nope') });
  docListeners.securitypolicyviolation({ violatedDirective: 'script-src', blockedURI: 'http://evil.example/x.js' });
  docListeners.securitypolicyviolation({ violatedDirective: 'style-src', blockedURI: '' });
  timers[0].f();
  const text = textOf(prepended[0]);
  assert.match(text, /failed to load http:\/\/127\.0\.0\.1:5173\/src\/engine\.js/);
  assert.match(text, /unhandled promise rejection: .*nope/);
  assert.match(text, /blocked by Content-Security-Policy: script-src -> http:\/\/evil\.example\/x\.js/);
  assert.match(text, /style-src -> \(inline\)/);
  assert.deepEqual(sandbox.__siteGuard.problems.length, 4);
});

test('guard: reports "no error" honestly, de-duplicates and caps the list', () => {
  const quiet = boot();
  quiet.timers[0].f();
  assert.match(textOf(quiet.prepended[0]), /No error was reported/);

  const { listeners, sandbox } = boot();
  for (let i = 0; i < 50; i++) listeners.error.f({ message: `e${i}`, filename: 'a.js', lineno: i, colno: 1, target: {} });
  listeners.error.f({ message: 'e0', filename: 'a.js', lineno: 0, colno: 1, target: {} });
  assert.equal(sandbox.__siteGuard.problems.length, 8, 'capped');
  assert.equal(new Set(sandbox.__siteGuard.problems).size, 8, 'no duplicates');
});

test('guard: never injects HTML (everything is textContent) and shows once only', () => {
  const { listeners, timers, prepended, sandbox } = boot();
  listeners.error.f({ message: '<img src=x onerror=alert(1)>', filename: '<b>.js', lineno: 1, colno: 1, target: {} });
  timers[0].f();
  const text = textOf(prepended[0]);
  assert.ok(text.includes('<img src=x onerror=alert(1)>'), 'shown literally as text');
  assert.ok(!('innerHTML' in prepended[0]) && !/innerHTML/.test(source), 'no innerHTML anywhere in the guard');
  sandbox.__siteGuard.show();
  assert.equal(prepended.length, 2, 'show() itself is unconditional; the timer path de-duplicates via .boot-fail');
  timers[0].f();
  assert.equal(prepended.length, 2, 'the timer does not add a second notice');
});

test('guard: falls back to <body> when the page has no <main>', () => {
  const { timers, prepended } = boot({ hasScreen: false });
  timers[0].f();
  assert.equal(prepended.length, 1);
});

test('index.html loads the guard first, as a classic script, and main.js declares readiness', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const guard = html.indexOf('<script src="src/guard.js"></script>');
  const main = html.indexOf('<script type="module" src="src/main.js"></script>');
  assert.ok(guard > 0 && main > guard, 'guard comes before the module');
  const js = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(js, /window\.__siteReady = true/);
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.boot-fail \{/);
});

test('guard: changes nothing on the page before something goes wrong (no layout to reserve any more)', () => {
  const { root, prepended, timers } = boot();
  assert.deepEqual(root.dataset, {});
  assert.equal(prepended.length, 0);
  assert.equal(timers.length, 1, 'only the watchdog timer');
});
