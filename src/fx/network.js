// Drifting points joined by lines when they are close, plus pointer interaction.
// With at most ~90 points, brute-force pair checks (~4k per frame) are cheaper
// than maintaining a spatial index.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createNetwork(rand = Math.random) {
  let pts = [];
  let w = 0;
  let h = 0;
  let reach = 140;

  return {
    get points() { return pts; },
    get reach() { return reach; },
    resize(width, height, level = 0) {
      w = width;
      h = height;
      reach = clamp(Math.min(width, height) * 0.22, 90, 170);
      const n = clamp(Math.round((width * height) / (20000 * (1 + level * 0.6))), 24, 90);
      pts = Array.from({ length: n }, () => ({
        x: rand() * width,
        y: rand() * height,
        vx: (rand() - 0.5) * 22,
        vy: (rand() - 0.5) * 22,
      }));
    },
    /** pointer: { x, y } | null */
    update(dt, pointer) {
      for (const p of pts) {
        if (pointer) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1 && d2 < 130 * 130) {
            const d = Math.sqrt(d2);
            const push = (1 - d / 130) * 60;
            p.vx += (dx / d) * push * dt;
            p.vy += (dy / d) * push * dt;
          }
        }
        // Ease back toward a gentle drift speed so pushed points settle.
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 26) { p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.5 * dt; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        else if (p.x > w) { p.x = w; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        else if (p.y > h) { p.y = h; p.vy = -Math.abs(p.vy); }
      }
    },
    draw(ctx, colors, alpha = 1, pointer = null) {
      const r2 = reach * reach;
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.body;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;
          ctx.globalAlpha = (1 - Math.sqrt(d2) / reach) * 0.55 * alpha;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        if (pointer) {
          const dx = a.x - pointer.x;
          const dy = a.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < reach * 1.3) {
            ctx.globalAlpha = (1 - d / (reach * 1.3)) * 0.8 * alpha;
            ctx.strokeStyle = colors.head;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
            ctx.strokeStyle = colors.body;
          }
        }
      }
      ctx.fillStyle = colors.head;
      ctx.globalAlpha = 0.75 * alpha;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
