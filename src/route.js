// Where a command line "lives": the page it shows, its address (URL hash), its
// breadcrumb and its title. Pure functions over the site data, so they run (and are
// tested) under Node. main.js uses them to show one page at a time, to give every
// page its own URL, and to make the browser's Back / Forward buttons work.
//
//   projects                  -> #projects
//   project handoff-semantics -> #projects/handoff-semantics
//   work black-hole           -> #works/black-hole
//   view looking-back         -> #photos/looking-back       (renders are #gallery/<name>)
//   mirror                    -> #mirror                    (opening the address never switches the camera on)
//   home                      -> (no hash)

import { projects, works, gallery, ui } from './content.js';
import { resolveCommand, HAS_PHOTOS } from './engine.js';
import { isPhoto } from './photos.js';

const SECTIONS = ['about', 'projects', 'works', 'gallery', 'skills', 'contact', 'help'];

/** Index of the entry named by a 1-based number or a slug, or -1. */
function find(list, q) {
  const text = String(q ?? '').trim().toLowerCase();
  if (!text) return -1;
  const n = Number(text);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return n - 1;
  return list.findIndex((x) => x.slug === text);
}

const page = (path, cmd) => ({ path, hash: path.join('/'), cmd, section: path[0] ?? null });

/** The page a command line shows, or null when the command is not a page (`theme dark`, `clear`, an unknown name, `project 99`...). */
export function routeFor(line) {
  const { name, args } = resolveCommand(line);
  const q = args.join(' ');
  if (name === 'home') return page([], 'home');
  if (SECTIONS.includes(name)) return page([name], name);
  // The mirror page only explains itself: the camera starts only when its button is pressed. `mirror off` is an action.
  if (name === 'mirror') return args.length ? null : page(['mirror'], 'mirror');
  if (name === 'photos') return HAS_PHOTOS ? page(['photos'], 'photos') : null;
  if (name === 'project') {
    if (!args.length) return page(['projects'], 'projects');
    const i = find(projects, q);
    return i < 0 ? null : page(['projects', projects[i].slug], `project ${projects[i].slug}`);
  }
  if (name === 'work') {
    if (!args.length) return page(['works'], 'works');
    const i = find(works, q);
    return i < 0 ? null : page(['works', works[i].slug], `work ${works[i].slug}`);
  }
  if (name === 'view') {
    if (!args.length) return page(['gallery'], 'gallery');
    const i = find(gallery, q);
    return i < 0 ? null : page([isPhoto(gallery[i]) ? 'photos' : 'gallery', gallery[i].slug], `view ${gallery[i].slug}`);
  }
  return null;
}

/** The command a URL hash stands for ('#projects/handoff-semantics' -> 'project handoff-semantics'), or null if it names no page. */
export function lineForHash(hash) {
  let text = String(hash ?? '').replace(/^#\/?/, '');
  try { text = decodeURIComponent(text); } catch { return null; }
  const parts = text.toLowerCase().split('/').filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'home')) return 'home';
  if (parts.length === 1) return routeFor(parts[0])?.hash === parts[0] ? parts[0] : null;
  if (parts.length !== 2) return null;
  const [section, slug] = parts;
  const verb = { projects: 'project', works: 'work', gallery: 'view', photos: 'view' }[section];
  const route = verb ? routeFor(`${verb} ${slug}`) : null;
  return route && route.hash === `${section}/${slug}` ? route.cmd : null;
}

/** The text shown for a page: an entry's own title, or the section's name. */
export function titleFor(route, lang) {
  const t = ui[lang] ?? ui.en;
  if (!route || !route.path.length) return t.pages.home;
  if (route.path.length === 1) return t.pages[route.path[0]];
  const [section, slug] = route.path;
  if (section === 'projects') return slug;
  const entry = (section === 'works' ? works : gallery).find((x) => x.slug === slug);
  return entry?.[lang]?.title ?? slug;
}

/** Breadcrumb parts: `~ / projects / handoff-semantics`. Every part but the last is a command you can run. */
export function crumbsFor(route) {
  const out = [{ label: '~', cmd: 'home' }];
  if (!route) return out;
  route.path.forEach((seg, i) => out.push({ label: seg, cmd: i < route.path.length - 1 ? route.path[0] : null }));
  return out;
}

/** The document title for a page. */
export function documentTitle(route, lang) {
  const t = ui[lang] ?? ui.en;
  return route && route.path.length ? `${titleFor(route, lang)} — ${t.documentTitle}` : t.documentTitle;
}
