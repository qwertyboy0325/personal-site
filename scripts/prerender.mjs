// Renders the English home page (src/page.js) into index.html between the
// prerender markers, so the page is complete without JavaScript and the static
// copy can never drift from src/content.js.
//
//   node scripts/prerender.mjs          write index.html
//   node scripts/prerender.mjs --check  exit 1 if index.html is out of date

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../src/page.js';

const START = '<!-- prerender:start -->';
const END = '<!-- prerender:end -->';

export function buildStatic() {
  return renderPage('en');
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
