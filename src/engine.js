// Pure command engine: no DOM, no globals. `execute` and `complete` take a
// context ({ lang, theme, history, now }) and return plain data, so the whole
// terminal can be tested under Node.

import { profile, projects, works, gallery, skillGroups, THEMES, LANGS, LANG_NAMES, ui, banner } from './content.js';
import { FX_MODES } from './fx/fx.js';
import { TRANSITION_MODES } from './fx/transition.js';
import { CURSOR_MODES } from './fx/reticle.js';
import { SHAPES, REST_POSE, renderFrame } from './fx/ascii3d.js';
import { renderFace } from './fx/face.js';
import { isPhoto, formatShot } from './photos.js';

/** Photography only appears (command, help, aliases) once there is at least one photo in the gallery. */
export const HAS_PHOTOS = gallery.some(isPhoto);
export const PUBLIC_COMMANDS = ['about', 'projects', 'works', 'gallery', ...(HAS_PHOTOS ? ['photos'] : []), 'view', 'skills', 'contact', 'ls', 'cat', 'open', 'theme', 'lang', 'ascii', '3d', 'fx', 'transition', 'cursor', 'hud', 'mode', 'clear', 'history', 'help'];
const HIDDEN_COMMANDS = ['home', 'project', 'work', 'whoami', 'date', 'echo', 'neofetch', 'sudo', 'exit'];
const ALIASES = { '~': 'home', face: 'ascii', gui: 'hud', images: 'gallery', pictures: 'gallery', ...(HAS_PHOTOS ? { photo: 'photos', photography: 'photos' } : {}), repos: 'projects', '?': 'help', man: 'help', cls: 'clear', dir: 'ls', ll: 'ls' };
/** Commands whose output is addressable through the URL hash. */
export const HUD_MODES = ['on', 'off'];
/** `page`: each page replaces the last (like a document); `log`: every command's output stays and scrolls (like a classic terminal). */
export const LAYOUT_MODES = ['page', 'log'];
/** Typing a shape's name on its own (`cube`) is a shortcut for `3d cube`. */
const SHAPE_ALIASES = { donut: 'donut', torus: 'donut', cube: 'cube', sphere: 'sphere' };
export const NAV = new Set(['about', 'projects', 'works', 'gallery', 'skills', 'contact', 'help']);
export const ALL_COMMANDS = [...PUBLIC_COMMANDS, ...HIDDEN_COMMANDS];

const FILES = ['about.md', 'skills.md', 'contact.md'];
const FILE_COMMAND = { 'about.md': 'about', 'skills.md': 'skills', 'contact.md': 'contact' };

// ---- block builders ---------------------------------------------------------
const h = (v) => ({ t: 'h', v });
const p = (...v) => ({ t: 'p', v });
const err = (...v) => ({ t: 'err', v });
const kv = (rows) => ({ t: 'kv', rows });
const ul = (items) => ({ t: 'ul', items });
const quote = (...v) => ({ t: 'quote', v });
const gap = { t: 'gap' };
const T = (ctx) => ui[ctx.lang] ?? ui.en;

// ---- parsing ----------------------------------------------------------------
/** Split a command line into a lowercase name and args; supports "quoted args". */
export function parse(line) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(line)); ) tokens.push(m[1] ?? m[2] ?? m[3]);
  const [name = '', ...args] = tokens;
  return { name: name.toLowerCase(), args };
}

/** The canonical command name and arguments for a line, after aliases (`pictures` -> `gallery`, `~` -> `home`). */
export function resolveCommand(line) {
  const { name, args } = parse(line);
  if (Object.hasOwn(SHAPE_ALIASES, name)) return { name: '3d', args: [SHAPE_ALIASES[name]] };
  return { name: ALIASES[name] ?? name, args };
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggest(name) {
  let best = null;
  for (const c of ALL_COMMANDS) {
    const d = distance(name, c);
    if (d <= 2 && (!best || d < best.d)) best = { c, d };
  }
  return best?.c ?? null;
}

// ---- shared content blocks --------------------------------------------------
function aboutBlocks(ctx) {
  const t = T(ctx);
  return [
    h(t.aboutTitle),
    ...t.bio.map((line) => p(line)),
    h(t.workStyleTitle),
    quote(t.workStyle),
    p(...t.aboutNext),
  ];
}

function projectsBlocks(ctx) {
  const t = T(ctx);
  return [
    h(t.projectsTitle),
    ul(
      projects.map((pr, i) => [
        { dim: `${i + 1}.` },
        ' ',
        { cmd: `project ${i + 1}`, text: pr.slug },
        { dim: `  ${pr[ctx.lang].tag}` },
      ]),
    ),
    p(...t.projectsHint),
  ];
}

function projectBlocks(pr, ctx) {
  const t = T(ctx);
  const c = pr[ctx.lang];
  return [
    h(pr.slug),
    p(c.summary),
    kv([
      [t.projectLabels.stack, pr.stack],
      [t.projectLabels.repo, { link: pr.url, text: pr.url.replace('https://', '') }],
    ]),
    ul(c.points),
    p({ dim: `${t.projectLabels.notes}: ${c.nongoals}` }),
    p({ dim: `${t.projectLabels.tech}: ${c.tech}` }),
  ];
}

const findWork = (q) => {
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= works.length) return works[n - 1];
  return works.find((w) => w.slug === String(q).toLowerCase()) ?? null;
};

const findView = (q) => {
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= gallery.length) return [gallery[n - 1], n - 1];
  const i = gallery.findIndex((g) => g.slug === String(q).toLowerCase());
  return i >= 0 ? [gallery[i], i] : null;
};

const firstSentence = (text) => text.match(/^.*?[.。]/)?.[0] ?? text;

/** A contact sheet of gallery entries: thumbnails that open the picture viewer, each with its title as a link to the full page. The numbers are the entries' positions in the whole gallery (what `view` takes). */
function pictureList(entries, ctx) {
  const t = T(ctx);
  return {
    t: 'sheet',
    open: t.viewer.open,
    items: entries.map(([g, i]) => ({ index: i + 1, slug: g.slug, thumb: g.thumb, width: g.thumbWidth, height: g.thumbHeight, title: g[ctx.lang].title, play: g.kind === 'video' ? t.viewer.play : null })),
  };
}

function galleryBlocks(ctx) {
  const t = T(ctx);
  const all = gallery.map((g, i) => [g, i]);
  const works = all.filter(([g]) => !isPhoto(g));
  const photos = all.filter(([g]) => isPhoto(g));
  if (!photos.length) return [h(t.galleryTitle), pictureList(works, ctx), p(...t.galleryHint)];
  return [h(t.galleryTitle), p({ dim: t.galleryWorksHeading }), pictureList(works, ctx), p({ dim: t.galleryPhotosHeading }), pictureList(photos, ctx), p(...t.galleryHint)];
}

function photosBlocks(ctx) {
  const t = T(ctx);
  const photos = gallery.map((g, i) => [g, i]).filter(([g]) => isPhoto(g));
  return [h(t.photosTitle), pictureList(photos, ctx), p(...t.photosHint(photos[0][1] + 1))];
}

/** One picture or video as a block; main.js animates it and the lightbox opens it. */
function viewBlocks(g, index, ctx) {
  const t = T(ctx);
  const c = g[ctx.lang];
  const out = [
    { t: 'image', index: index + 1, slug: g.slug, kind: g.kind, src: g.src, poster: g.poster ?? null, width: g.width, height: g.height, alt: c.alt, title: c.title, caption: c.caption, shot: formatShot(g.shot), source: g.source ?? null, open: t.viewer.open },
  ];
  const wi = works.findIndex((w) => w.slug === g.work);
  if (wi >= 0) out.push(p({ dim: `${t.viewer.related}: ` }, { cmd: `work ${wi + 1}`, text: works[wi][ctx.lang].title }));
  return out;
}

function worksBlocks(ctx) {
  const t = T(ctx);
  const out = [h(t.worksTitle)];
  let n = 0;
  for (const kind of Object.keys(t.workKinds)) {
    const group = works.map((w, i) => [w, i]).filter(([w]) => w.kind === kind);
    if (!group.length) continue;
    out.push(p({ dim: t.workKinds[kind] }));
    out.push(ul(group.map(([w, i]) => [{ cmd: `work ${i + 1}`, text: `${i + 1}. ${w[ctx.lang].title}` }, { sub: w[ctx.lang].tag }])));
    n += group.length;
  }
  out.push(p(...t.worksHint));
  return out;
}

function workBlocks(w, ctx) {
  const t = T(ctx);
  const c = w[ctx.lang];
  const rows = [[t.workLabels.kind, t.workKinds[w.kind]]];
  if (w.url) rows.push([t.workLabels.repo, { link: w.url, text: w.url.replace('https://', '') }]);
  const out = [
    h(c.title),
    p(c.summary),
    kv(rows),
    ul(c.points),
    p({ dim: `${t.projectLabels.notes}: ${c.nongoals}` }),
    p({ dim: `${t.projectLabels.tech}: ${c.tech}` }),
  ];
  const pics = gallery.map((g, i) => [g, i]).filter(([g]) => g.work === w.slug);
  if (pics.length) out.push(p({ dim: `${t.viewer.pictures}: ` }, ...pics.flatMap(([g, i], n) => [...(n ? [' · '] : []), { cmd: `view ${i + 1}`, text: g[ctx.lang].title }])));
  return out;
}

function skillsBlocks(ctx) {
  const t = T(ctx);
  return [h(t.skillsTitle), kv(skillGroups.map((g) => [g[ctx.lang][0], g[ctx.lang][1].join(' · ')]))];
}

function contactBlocks(ctx) {
  const t = T(ctx);
  const rows = [[t.contactLabels.github, { link: profile.github, text: profile.github.replace('https://', '') }]];
  if (profile.email) rows.push([t.contactLabels.email, [{ mail: profile.email }, '  ', { copy: profile.email, text: t.contactCopy }]]);
  rows.push([t.contactLabels.mode, t.contactMode]);
  return [h(t.contactTitle), kv(rows)];
}

/** Banner + one-liner shown when the page boots. */
export function welcomeBlocks(ctx) {
  const t = T(ctx);
  return [
    { t: 'row', items: [{ t: 'asciiface', v: renderFace({ invert: ctx.theme === 'light' }), label: t.asciiLabel }, { t: 'pre', v: banner }] },
    p({ em: profile.name }, ' — ', t.role),
    p(t.welcome),
    p(...t.welcomeHint),
  ];
}

export function bootLines(ctx) {
  const t = T(ctx);
  return [t.boot[0], t.bootCount(projects.length), t.boot[2]];
}

// ---- virtual filesystem -----------------------------------------------------
const normalizePath = (raw) => raw.replace(/^(~\/|\.\/)/, '').replace(/^~$/, '').replace(/\/+$/, '');
const findProject = (q) => {
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= projects.length) return projects[n - 1];
  return projects.find((pr) => pr.slug === String(q).toLowerCase()) ?? null;
};

// ---- commands ---------------------------------------------------------------
const commands = {
  help(_a, ctx) {
    const t = T(ctx);
    const label = (n) => ({ cmd: n, text: n === 'cat' ? 'cat <file>' : n === 'open' ? 'open <target>' : n });
    return {
      blocks: [h(t.helpTitle), kv(PUBLIC_COMMANDS.map((n) => [label(n), t.cmds[n]])), p(...t.helpFooter)],
    };
  },
  home: (_a, ctx) => ({ blocks: welcomeBlocks(ctx) }),
  about: (_a, ctx) => ({ blocks: aboutBlocks(ctx) }),
  skills: (_a, ctx) => ({ blocks: skillsBlocks(ctx) }),
  contact: (_a, ctx) => ({ blocks: contactBlocks(ctx) }),
  projects: (_a, ctx) => ({ blocks: projectsBlocks(ctx) }),

  works: (_a, ctx) => ({ blocks: worksBlocks(ctx) }),

  gallery: (_a, ctx) => ({ blocks: galleryBlocks(ctx) }),

  ...(HAS_PHOTOS ? { photos: (_a, ctx) => ({ blocks: photosBlocks(ctx) }) } : {}),

  view(args, ctx) {
    const t = T(ctx);
    if (!args.length) return { blocks: galleryBlocks(ctx) };
    const hit = findView(args.join(' '));
    return { blocks: hit ? viewBlocks(hit[0], hit[1], ctx) : [err(t.noView(args.join(' ')))] };
  },

  work(args, ctx) {
    const t = T(ctx);
    if (!args.length) return { blocks: worksBlocks(ctx) };
    const w = findWork(args.join(' '));
    return { blocks: w ? workBlocks(w, ctx) : [err(t.noWork(args.join(' ')))] };
  },

  project(args, ctx) {
    const t = T(ctx);
    if (!args.length) return { blocks: [err(...t.projectUsage)] };
    const pr = findProject(args.join(' '));
    return { blocks: pr ? projectBlocks(pr, ctx) : [err(t.noProject(args.join(' ')))] };
  },

  ls(args, ctx) {
    const t = T(ctx);
    const target = args.find((a) => !a.startsWith('-'));
    if (!target) return { blocks: [p(...FILES.map((f) => ({ cmd: `cat ${f}`, text: f })).flatMap((s) => [s, '  ']), { cmd: 'ls projects', text: 'projects/' })] };
    const path = normalizePath(target);
    if (path === '' || path === '.') return commands.ls([], ctx);
    if (path === 'projects') {
      return { blocks: [p(...projects.flatMap((pr) => [{ cmd: `cat projects/${pr.slug}`, text: pr.slug }, '  ']).slice(0, -1))] };
    }
    if (FILES.includes(path) || path.startsWith('projects/')) return { blocks: [err(t.notDir(path))] };
    return { blocks: [err(t.noSuchDir(path))] };
  },

  cat(args, ctx) {
    const t = T(ctx);
    if (!args.length) return { blocks: [err(...t.catUsage)] };
    const path = normalizePath(args[0]);
    if (FILE_COMMAND[path]) return commands[FILE_COMMAND[path]]([], ctx);
    if (path === 'projects' || path === '') return { blocks: [err(t.isDir(path || '~'))] };
    if (path.startsWith('projects/')) {
      const pr = projects.find((x) => x.slug === path.slice('projects/'.length));
      if (pr) return { blocks: projectBlocks(pr, ctx) };
    }
    return { blocks: [err(t.noFile(path))] };
  },

  open(args, ctx) {
    const t = T(ctx);
    const names = ['github', ...projects.map((x) => x.slug)].join(' | ');
    if (!args.length) return { blocks: [err(t.openUsage(names))] };
    const q = args[0].toLowerCase();
    const url = q === 'github' ? profile.github : (findProject(q)?.url ?? null);
    if (!url) return { blocks: [err(t.openBad(args[0]))] };
    return { blocks: [p({ dim: t.opening(url) })], effects: [{ type: 'open', url }] };
  },

  theme(args, ctx) {
    const t = T(ctx);
    const all = THEMES.join(', ');
    if (!args.length) return { blocks: [p(t.themeCurrent(ctx.theme, all))] };
    const q = args[0].toLowerCase();
    if (!THEMES.includes(q)) return { blocks: [err(t.themeBad(args[0], all))] };
    return { blocks: [p({ ok: t.themeSet(q) })], effects: [{ type: 'theme', value: q }] };
  },

  lang(args, ctx) {
    if (!args.length) return { blocks: [p(T(ctx).langCurrent(LANG_NAMES[ctx.lang]))] };
    const q = args[0].toLowerCase();
    const next = { en: 'en', english: 'en', zh: 'zh', 'zh-tw': 'zh', 'zh-hant': 'zh', 中文: 'zh', 繁體中文: 'zh' }[q];
    if (!next || !LANGS.includes(next)) return { blocks: [err(T(ctx).langBad(args[0]))] };
    // Confirm in the language that was just selected.
    return { blocks: [p({ ok: ui[next].langSet(LANG_NAMES[next]) })], effects: [{ type: 'lang', value: next }] };
  },

  // An ASCII face that main.js animates (it follows the pointer and reacts to
  // typing). The block carries a static frame so it is complete without JS.
  ascii(_a, ctx) {
    const t = T(ctx);
    return {
      blocks: [{ t: 'asciiface', v: renderFace({ invert: ctx.theme === 'light' }), label: t.asciiLabel }, p({ dim: t.asciiHint })],
    };
  },

  // Background effect: Matrix rain and/or a drifting point network.
  hud(args, ctx) {
    const t = T(ctx);
    const all = HUD_MODES.join(', ');
    if (!args.length) return { blocks: [p(t.hudCurrent(ctx.hud ?? 'on', all))] };
    const q = args[0].toLowerCase();
    if (!HUD_MODES.includes(q)) return { blocks: [err(t.hudBad(args[0], all))] };
    return { blocks: [p({ ok: t.hudSet(q) })], effects: [{ type: 'hud', value: q }] };
  },

  mode(args, ctx) {
    const t = T(ctx);
    const all = LAYOUT_MODES.join(', ');
    if (!args.length) return { blocks: [p(t.modeCurrent(ctx.mode ?? 'page', all))] };
    const q = args[0].toLowerCase();
    if (!LAYOUT_MODES.includes(q)) return { blocks: [err(t.modeBad(args[0], all))] };
    return { blocks: [p({ ok: t.modeSet(q) })], effects: [{ type: 'mode', value: q }] };
  },

  cursor(args, ctx) {
    const t = T(ctx);
    const all = CURSOR_MODES.join(', ');
    if (!args.length) return { blocks: [p(t.cursorCurrent(ctx.cursor ?? 'off', all))] };
    const q = args[0].toLowerCase();
    if (!CURSOR_MODES.includes(q)) return { blocks: [err(t.cursorBad(args[0], all))] };
    return { blocks: [p({ ok: t.cursorSet(q) })], effects: [{ type: 'cursor', value: q }] };
  },

  '3d'(args, ctx) {
    const t = T(ctx);
    const asked = (args[0] ?? 'donut').toLowerCase();
    const shape = SHAPE_ALIASES[asked] ?? asked;
    if (!SHAPES.includes(shape)) return { blocks: [err(t.modelBad(args[0], SHAPES.join(', ')))] };
    return {
      blocks: [
        // A static first frame; main.js animates it (and the frame is what reduced-motion visitors keep).
        { t: 'ascii3d', shape, v: renderFrame({ shape, ...REST_POSE, invert: ctx.theme === 'light' }), label: t.modelLabel(shape) },
        p(...t.modelHint),
      ],
    };
  },

  transition(args, ctx) {
    const t = T(ctx);
    const all = TRANSITION_MODES.join(', ');
    if (!args.length) return { blocks: [p(t.transitionCurrent(ctx.transition ?? 'auto', all))] };
    const q = args[0].toLowerCase();
    if (!TRANSITION_MODES.includes(q)) return { blocks: [err(t.transitionBad(args[0], all))] };
    return { blocks: [p({ ok: t.transitionSet(q) })], effects: [{ type: 'transition', value: q }] };
  },

  fx(args, ctx) {
    const t = T(ctx);
    const all = FX_MODES.join(', ');
    if (!args.length) return { blocks: [p(t.fxCurrent(ctx.fx ?? 'off', all))] };
    const q = args[0].toLowerCase();
    if (!FX_MODES.includes(q)) return { blocks: [err(t.fxBad(args[0], all))] };
    return { blocks: [p({ ok: t.fxSet(q) })], effects: [{ type: 'fx', value: q }] };
  },

  clear: () => ({ blocks: [], effects: [{ type: 'clear' }] }),

  history(_a, ctx) {
    const t = T(ctx);
    if (!ctx.history?.length) return { blocks: [p({ dim: t.historyEmpty })] };
    return { blocks: [kv(ctx.history.map((c, i) => [{ dim: String(i + 1) }, c]))] };
  },

  whoami: (_a, ctx) => ({ blocks: [p(T(ctx).whoami)] }),
  echo: (args) => ({ blocks: [p(args.join(' '))] }),
  date(_a, ctx) {
    const d = (ctx.now ?? (() => new Date()))();
    return { blocks: [p(d.toString())] };
  },
  neofetch(_a, ctx) {
    const t = T(ctx);
    return {
      blocks: [
        { t: 'pre', v: banner },
        kv([
          [`${profile.user}@${profile.host}`, ''],
          [t.labels.role, t.role],
          [t.labels.repos, String(projects.length)],
          [t.labels.language, LANG_NAMES[ctx.lang]],
          [t.labels.theme, ctx.theme],
          [t.labels.shell, 'ezra-sh 1.0 (no framework)'],
        ]),
      ],
    };
  },
  sudo: (_a, ctx) => ({ blocks: [err(T(ctx).sudo)] }),
  exit: (_a, ctx) => ({ blocks: [p({ dim: T(ctx).exit })] }),
};

// ---- public API -------------------------------------------------------------
/**
 * Run one command line.
 * @returns {{ blocks: object[], effects: object[], nav?: string }}
 */
export function execute(line, ctx) {
  const { name: typed, args } = parse(line);
  if (!typed) return { blocks: [], effects: [] };
  if (Object.hasOwn(SHAPE_ALIASES, typed)) return execute(`3d ${SHAPE_ALIASES[typed]}`, ctx);
  const name = ALIASES[typed] ?? typed;
  const fn = Object.hasOwn(commands, name) ? commands[name] : null;
  if (!fn) {
    const t = T(ctx);
    const s = suggest(typed);
    return { blocks: [err(t.notFound(typed)), p(...(s ? t.didYouMean(s) : t.tryHelp))], effects: [] };
  }
  const out = fn(args, ctx);
  return {
    blocks: out.blocks ?? [],
    effects: out.effects ?? [],
    ...(NAV.has(name) && args.length === 0 ? { nav: name } : {}),
  };
}

const lcp = (list) => list.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });

function argCandidates(cmd) {
  const projectNames = projects.map((x) => x.slug);
  switch (cmd) {
    case 'theme': return THEMES;
    case 'lang': return LANGS;
    case 'fx': return FX_MODES;
    case 'transition': return TRANSITION_MODES;
    case '3d': return SHAPES;
    case 'cursor': return CURSOR_MODES;
    case 'hud': return HUD_MODES;
    case 'mode': return LAYOUT_MODES;
    case 'cat': return [...FILES, 'projects/', ...projectNames.map((s) => `projects/${s}`)];
    case 'ls': return ['projects'];
    case 'open': return ['github', ...projectNames];
    case 'project': return projectNames;
    case 'work': return works.map((w) => w.slug);
    case 'view': return gallery.map((g) => g.slug);
    default: return [];
  }
}

/**
 * Tab completion. Returns the new line and, when the match is ambiguous, the
 * list of options to show.
 */
export function complete(line) {
  const lead = line.match(/^\s*/)[0];
  const body = line.slice(lead.length);
  const parts = body.split(/\s+/);
  const last = parts.at(-1);
  const before = parts.slice(0, -1);

  let pool;
  if (before.length === 0) pool = ALL_COMMANDS;
  else if (before.length === 1) pool = argCandidates(ALIASES[before[0].toLowerCase()] ?? before[0].toLowerCase());
  else pool = [];

  const matches = pool.filter((c) => c.startsWith(last.toLowerCase()));
  const head = lead + before.map((b) => `${b} `).join('');
  if (matches.length === 0) return { line, options: [] };
  if (matches.length === 1) {
    const m = matches[0];
    return { line: `${head}${m}${m.endsWith('/') ? '' : ' '}`, options: [] };
  }
  // Like a shell: extend to the common prefix first; list the options only when
  // that makes no progress (i.e. on the next Tab press).
  const common = lcp(matches);
  return { line: head + common, options: common.length > last.length ? [] : matches };
}
