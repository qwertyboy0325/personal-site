// Pure formatting helpers for the HUD panels (no DOM, testable under Node).

const pad2 = (n) => String(n).padStart(2, '0');

/** 24-hour local time, e.g. "09:05:03". */
export const formatClock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

/** Elapsed time as "MM:SS", or "H:MM:SS" once past an hour. Negative input counts as zero. */
export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Random 8-digit hex id for this page load. */
export function sessionId(rand = Math.random) {
  return Array.from({ length: 8 }, () => Math.floor(rand() * 16).toString(16)).join('').toUpperCase();
}

export const formatSpeed = (pxPerSecond) => `${Math.max(0, Math.round(pxPerSecond))} px/s`;

/** Append a sample, keeping only the newest `cap`. Returns a new array. */
export const pushSample = (samples, value, cap = 60) => [...samples, value].slice(-cap);

/**
 * SVG polyline points for a sparkline inside a w x h box. Values are clamped
 * to 0..max; the newest sample sits at the right edge. Empty input gives "".
 */
export function sparkPoints(values, w, h, max = 70) {
  if (!values.length) return '';
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const clamped = Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
      const x = values.length > 1 ? i * step : w;
      const y = h - (clamped / max) * h;
      return `${+x.toFixed(1)},${+y.toFixed(1)}`;
    })
    .join(' ');
}

/** The newest `n` distinct commands, newest first. */
export function recentCommands(history, n = 6) {
  const seen = new Set();
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < n; i--) {
    const cmd = history[i];
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    out.push(cmd);
  }
  return out;
}
