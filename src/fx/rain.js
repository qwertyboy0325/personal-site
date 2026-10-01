// Matrix-style falling glyphs. Pure simulation + a draw(ctx) that only calls
// 2D-context methods, so it can be tested with a fake context under Node.

export const GLYPHS = [...'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>|'];

/** Small deterministic integer hash -> [0, 1). */
export function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const CELL_SCALE = [1, 1.45, 2]; // quality levels: bigger cells = fewer glyphs per frame

export function createRain(rand = Math.random) {
  let cols = [];
  let rows = 0;
  let cell = 16;

  const spawn = (initial) => ({
    head: initial ? -rand() * rows * 1.4 : -rand() * rows * 0.6,
    speed: 7 + rand() * 15, // rows per second
    len: 8 + Math.floor(rand() * 18),
    seed: Math.floor(rand() * 1e9),
    idle: rand() < 0.3, // some columns stay empty for a sparser look
  });

  return {
    get cell() { return cell; },
    get columns() { return cols.length; },
    resize(width, height, level = 0) {
      cell = Math.round((width < 640 ? 14 : 16) * (CELL_SCALE[level] ?? 2));
      rows = Math.ceil(height / cell) + 1;
      cols = Array.from({ length: Math.ceil(width / cell) }, () => spawn(true));
    },
    update(dt) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        c.head += c.speed * dt;
        if (c.head - c.len > rows) cols[i] = spawn(false);
      }
    },
    /** colors: { head, body }; alpha: overall multiplier. */
    draw(ctx, t, colors, alpha = 1, font = 'monospace') {
      ctx.font = `${cell}px ${font}`;
      ctx.textBaseline = 'top';
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (c.idle) continue;
        const headRow = Math.floor(c.head);
        for (let i = 0; i < c.len; i++) {
          const row = headRow - i;
          if (row < 0 || row >= rows) continue;
          const flick = Math.floor(t * 3 + ((row * 13 + c.seed) % 5));
          const g = GLYPHS[Math.floor(hash(c.seed + row * 131, flick, ci) * GLYPHS.length)];
          if (i === 0) {
            ctx.fillStyle = colors.head;
            ctx.globalAlpha = 0.95 * alpha;
          } else {
            ctx.fillStyle = colors.body;
            ctx.globalAlpha = (1 - i / c.len) ** 1.7 * 0.7 * alpha;
          }
          ctx.fillText(g, ci * cell, row * cell);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
