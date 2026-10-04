// Zero-dependency static server for local development.
//
//   node scripts/serve.mjs [port]
//
// Live reload (on by default; LIVERELOAD=0 turns it off): the server watches the
// project and tells open pages what to do over Server-Sent Events.
//   .css          -> swap the stylesheet in place (no reload, page state kept)
//   .js .html ... -> full reload
// The reload client and a relaxed CSP (connect-src 'self') are injected into
// served HTML only; the files on disk, and what you deploy, are never touched.
//
// Env: PORT, SITE_ROOT (serve another directory), LIVERELOAD=0.

import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Parse an HTTP Range header ("bytes=0-99", "bytes=500-", "bytes=-200") against a
 * file of `size` bytes. Returns { start, end } (inclusive), null for "no range",
 * or 'invalid' (answer 416). Safari will not play <video> without this.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start <= end) || start >= size) return 'invalid';
  return { start, end };
}

const IGNORED = /(^|\/)(\.git|node_modules|\.shots|test|scripts|\.DS_Store)(\/|$)/;
const PRERENDER_INPUTS = /^src\/(content|page|render)\.js$|^src\/fx\/(face|rain)\.js$/;

/** What should an open page do after `rel` changed? 'css' | 'reload' | null. */
export function classifyChange(rel) {
  const path = String(rel ?? '').split(sep).join('/');
  if (!path || IGNORED.test(path)) return null;
  if (/\.css$/.test(path)) return 'css';
  if (/\.(js|mjs|html|svg|json)$/.test(path)) return 'reload';
  return null;
}

/** True when the change affects the pre-rendered no-JS content in index.html. */
export const affectsPrerender = (rel) => PRERENDER_INPUTS.test(String(rel ?? '').split(sep).join('/'));

export const CLIENT_URL = '/__livereload.js';
export const EVENTS_URL = '/__livereload';

/** Add the reload client and allow it to open its event stream. HTML in, HTML out. */
export function injectLiveReload(html) {
  let out = html.replace(/(http-equiv="Content-Security-Policy"\s+content=")([^"]*)"/, (m, head, policy) =>
    (/connect-src/.test(policy) ? m : `${head}${policy.replace(/;?\s*$/, '')}; connect-src 'self'"`));
  const tag = `<script src="${CLIENT_URL}"></script>`;
  out = out.includes('</body>') ? out.replace('</body>', `${tag}\n</body>`) : out + tag;
  return out;
}

export const CLIENT_SCRIPT = `(() => {
  let opened = false;
  let dropped = false;
  const es = new EventSource('${EVENTS_URL}');
  es.onopen = () => {
    window.__livereload = 'connected';
    if (dropped) location.reload(); // the dev server restarted: pick up whatever changed meanwhile
    opened = true;
  };
  es.onerror = () => { dropped = opened; };
  es.onmessage = (e) => {
    if (e.data !== 'css') { location.reload(); return; }
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const url = new URL(link.href);
      url.searchParams.set('lr', Date.now());
      link.href = url.href;
    }
  };
})();
`;

export function createDevServer({ root, livereload = true, log = () => {} }) {
  const clients = new Set();
  const send = (data) => { for (const res of clients) res.write(`data: ${data}\n\n`); };

  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

      if (livereload && path === EVENTS_URL) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (livereload && path === CLIENT_URL) {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        res.end(CLIENT_SCRIPT);
        return;
      }

      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(join(root, normalize(path)));
      if (file !== root && !file.startsWith(root + sep)) throw Object.assign(new Error('forbidden'), { code: 'EFORBIDDEN' });
      if (!(await stat(file)).isFile()) throw Object.assign(new Error('nf'), { code: 'ENOENT' });
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      let body = await readFile(file);
      // Always a Buffer: Content-Length and Range are measured in BYTES (a string's length counts characters).
      if (livereload && type.startsWith('text/html')) body = Buffer.from(injectLiveReload(body.toString('utf8')), 'utf8');
      const range = parseRange(req.headers.range, body.length);
      if (range === 'invalid') {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}`, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Range not satisfiable');
        return;
      }
      if (range) {
        res.writeHead(206, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${range.start}-${range.end}/${body.length}`, 'Content-Length': range.end - range.start + 1 });
        res.end(body.subarray(range.start, range.end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': body.length });
      res.end(body);
    } catch (e) {
      res.writeHead(e.code === 'EFORBIDDEN' ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.code === 'EFORBIDDEN' ? 'Forbidden' : 'Not found');
    }
  });

  let watcher = null;
  let timer = 0;
  let pending = new Set();
  let ping = 0;

  return {
    server,
    start(port) {
      return new Promise((resolveStart) => {
        server.listen(port, '127.0.0.1', () => {
          if (livereload) {
            // Editors fire several events per save, so batch them for a moment.
            watcher = watch(root, { recursive: true }, (_event, filename) => {
              const kind = classifyChange(filename);
              if (!kind) return;
              pending.add(kind);
              if (affectsPrerender(filename)) log(`note: ${filename} feeds the no-JS fallback in index.html; run "npm run build" to refresh it`);
              clearTimeout(timer);
              timer = setTimeout(() => {
                const action = pending.has('reload') ? 'reload' : 'css';
                pending = new Set();
                log(`${action === 'css' ? 'css   ' : 'reload'}  ${filename}  -> ${clients.size} page(s)`);
                send(action);
              }, 60);
            });
            ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);
          }
          resolveStart(server.address().port);
        });
      });
    },
    stop() {
      watcher?.close();
      clearInterval(ping);
      clearTimeout(timer);
      for (const res of clients) res.end();
      server.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.env.SITE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
  const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
  const livereload = process.env.LIVERELOAD !== '0';
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const dev = createDevServer({ root, livereload, log: (m) => console.log(`[${stamp()}] ${m}`) });
  const bound = await dev.start(port);
  console.log(`http://127.0.0.1:${bound}   (${livereload ? 'live reload on' : 'live reload off'}; serving ${relative(process.cwd(), root) || '.'})`);
}
