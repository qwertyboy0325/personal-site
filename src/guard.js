// Start-up watchdog. A classic (non-module) script on purpose: it must still run
// when the module graph fails to load or throws, in any browser.
//
// main.js sets window.__siteReady = true once the terminal is operable. If that
// has not happened after a few seconds, the page is still perfectly readable (the
// content is pre-rendered), but nothing would tell the visitor why the prompt is
// missing, so show a notice with the real error messages and the browser string.

(() => {
  'use strict';

  // Reserve the split-screen layout before first paint. main.js turns the overview on a moment later;
  // without this the terminal starts centred and then jumps right (a large layout shift).
  try {
    let hud = 'on';
    try { if (localStorage.getItem('hud') === 'off') hud = 'off'; } catch { /* storage blocked: default */ }
    document.documentElement.dataset.hud = hud;
    document.documentElement.dataset.dock = 'on'; // space for the dock on wide screens (CSS decides whether it applies)
  } catch { /* nothing to reserve */ }

  const WAIT_MS = 3000;
  const MAX = 8;
  const problems = [];
  const note = (text) => {
    const line = String(text).replace(/\s+/g, ' ').slice(0, 280);
    if (problems.length < MAX && !problems.includes(line)) problems.push(line);
  };

  // Capture phase: failed <script> loads are reported on the element and do not bubble.
  addEventListener('error', (e) => {
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) note(`failed to load ${t.src || t.href}`);
    else note(`${e.message || 'script error'} (${String(e.filename || '').split('/').pop() || '?'}:${e.lineno || '?'}:${e.colno || '?'})`);
  }, true);
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    note(`unhandled promise rejection: ${(r && (r.stack || r.message)) || r}`);
  });
  document.addEventListener('securitypolicyviolation', (e) => {
    note(`blocked by Content-Security-Policy: ${e.violatedDirective} -> ${e.blockedURI || '(inline)'}`);
  });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function show() {
    const box = el('div', 'boot-fail');
    box.setAttribute('role', 'alert');
    box.append(
      el('strong', '', 'The interactive terminal did not start in this browser.'),
      el('p', '', 'The content below is complete and readable. If you are the site owner, the details below say why.'),
      el('strong', '', '互動式終端機沒有在這個瀏覽器啟動。'),
      el('p', '', '下方內容完整、可以閱讀。若你是網站擁有者，以下是原因。'),
      el('pre', '', `${problems.length ? problems.join('\n') : 'No error was reported (the script may be blocked, or still loading).'}\n\n${navigator.userAgent}\nprotocol: ${location.protocol}`),
    );
    (document.getElementById('screen') || document.body).prepend(box);
  }

  window.__siteGuard = { problems, show };
  setTimeout(() => { if (!window.__siteReady && !document.querySelector('.boot-fail')) show(); }, WAIT_MS);
})();
