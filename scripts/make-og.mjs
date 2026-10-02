// Draw the 1200x630 share-preview card (assets/og.png) with headless Chrome, using the
// site's own name, role, banner and colours, so it can never drift from src/content.js.
//
//   node scripts/make-og.mjs
//
// Requires Google Chrome (set CHROME to use another binary). The PNG is committed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { banner, profile, ui, SITE_URL } from '../src/content.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function cardHtml() {
  const t = ui.en;
  const host = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:${OG_WIDTH}px;height:${OG_HEIGHT}px;overflow:hidden}
body{position:relative;padding:48px 72px;color:#d7dee9;background:
 radial-gradient(900px 500px at 82% 12%,rgba(94,234,212,.16),transparent 70%),
 linear-gradient(rgba(94,234,212,.06) 1px,transparent 1px) 0 0/48px 48px,
 linear-gradient(90deg,rgba(94,234,212,.06) 1px,transparent 1px) 0 0/48px 48px,#0b0f14;
 font-family:ui-sans-serif,system-ui,-apple-system,"SF Pro Display","Helvetica Neue",sans-serif}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
.prompt{font-size:24px;color:#8b98ab;letter-spacing:.02em}
.prompt b{color:#5eead4;font-weight:400}
pre{margin:26px 0 0;font:700 17px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:0;color:#5eead4}
h1{margin-top:24px;font-size:108px;line-height:1;font-weight:800;letter-spacing:-.035em;color:#fff}
.role{margin-top:10px;font-size:40px;color:#f5c26b;letter-spacing:.005em}
.line{margin-top:18px;max-width:1000px;font-size:28px;line-height:1.35;color:#aab5c6}
.foot{position:absolute;left:72px;right:72px;bottom:40px;display:flex;justify-content:space-between;align-items:center;gap:24px;white-space:nowrap;font-size:22px}
.url{color:#5eead4}
.badge{color:#8b98ab;font-size:19px;letter-spacing:.02em}
.dot{display:inline-block;width:12px;height:12px;margin-right:12px;border-radius:50%;background:#5eead4;box-shadow:0 0 14px #5eead4}
</style>
<div class="prompt mono"><b>${esc(profile.user)}@${esc(profile.host)}</b>:~$ whoami</div>
<pre aria-hidden="true">${esc(banner)}</pre>
<h1>${esc(profile.name)}</h1>
<div class="role">${esc(t.role)}</div>
<div class="line">${esc(t.ogLine)}</div>
<div class="foot mono"><span class="url"><span class="dot"></span>${esc(host)}</span><span class="badge">${esc(t.status.claims)}</span></div>`;
}

export function renderCard(outFile) {
  const dir = mkdtempSync(join(tmpdir(), 'og-'));
  try {
    const html = join(dir, 'card.html');
    const raw = join(dir, 'card.png');
    writeFileSync(html, cardHtml());
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${OG_WIDTH},${OG_HEIGHT}`, `--screenshot=${raw}`, pathToFileURL(html).href], { stdio: 'ignore' });
    // Fewer colours and no metadata: a flat card compresses to a fraction of the size.
    execFileSync('magick', [raw, '-strip', '-colors', '256', '+dither', '-define', 'png:compression-level=9', `PNG8:${outFile}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../assets/og.png', import.meta.url));
  renderCard(out);
  console.log(`wrote ${out}`);
}
