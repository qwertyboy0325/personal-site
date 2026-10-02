// Renders the English output of about/projects/skills/contact into index.html
// between the prerender markers, so the page is complete without JavaScript
// and the static copy can never drift from src/content.js.
//
//   node scripts/prerender.mjs          write index.html
//   node scripts/prerender.mjs --check  exit 1 if index.html is out of date

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execute, welcomeBlocks } from '../src/engine.js';
import { renderEntry } from '../src/render.js';

const START = '<!-- prerender:start -->';
const END = '<!-- prerender:end -->';
const ctx = { lang: 'en', theme: 'dark', history: [] };

export function buildStatic() {
  const opts = { interactive: false };
  const entries = [renderEntry(welcomeBlocks(ctx), opts)];
  for (const cmd of ['about', 'projects', 'works', 'gallery', 'skills', 'contact']) {
    entries.push(renderEntry([{ t: 'echo', v: cmd }, ...execute(cmd, ctx).blocks], opts));
  }
  return entries.join('\n');
}

export function inject(html, body) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('prerender markers not found in index.html');
  return `${html.slice(0, a + START.length)}\n${body}\n${html.slice(b)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('../index.html', import.meta.url);
  const current = await readFile(file, 'utf8');
  const next = inject(current, buildStatic());
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('index.html is out of date. Run: npm run build');
      process.exit(1);
    }
    console.log('index.html is up to date');
  } else {
    await writeFile(file, next);
    console.log('index.html updated');
  }
}
