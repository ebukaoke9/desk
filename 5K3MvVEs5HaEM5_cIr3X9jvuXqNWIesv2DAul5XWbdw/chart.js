/* Canvas charts, DPR-aware. No library. */
(function () {
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

  function drawLine(cv, d, shift) {
    const { ctx, w, h } = setup(cv);
    const pts = d.points || [];
    if (pts.length < 2) return;
    const color = d.color || '#00d35a', top = 30, bot = h - 22;
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts;
    let lo = Math.min(...pts.map(p => p.value)), hi = Math.max(...pts.map(p => p.value));
    if (d.start != null) { lo = Math.min(lo, d.start); hi = Math.max(hi, d.start); }
    if (hi - lo < 1e-9) { hi += 0.5; lo -= 0.5; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = t => (t1 === t0 ? w : (t - t0) / (t1 - t0) * (w - 8)) + (shift || 0);
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    // gradient under line
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, rgba(color, 0.28)); g.addColorStop(1, rgba(color, 0));
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p.ts), Y(p.value)) : ctx.moveTo(X(p.ts), Y(p.value)));
    ctx.lineTo(X(t1), bot); ctx.lineTo(X(t0), bot); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // dashed start line
    if (d.start != null) {
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(235,235,245,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Y(d.start)); ctx.lineTo(w, Y(d.start)); ctx.stroke(); ctx.restore();
    }
    // line
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p.ts), Y(p.value)) : ctx.moveTo(X(p.ts), Y(p.value)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(X(last.ts), Y(last.value), 4, 0, 7); ctx.fillStyle = color; ctx.fill();
    // non-overlapping marks
    const colors = { buy: '#0a84ff', win: '#00d35a', loss: '#ff453a' };
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textBaseline = 'middle';
    const placed = [];
    (d.marks || []).filter(m => m.ts >= t0 && m.ts <= t1).forEach(m => {
      let near = pts[0]; for (const p of pts) { if (p.ts <= m.ts) near = p; else break; }
      const x = X(m.ts), y = Y(near.value), tw = ctx.measureText(m.label).width + 14;
      let bx = Math.min(Math.max(x - tw / 2, 0), w - tw), by = y < h / 2 ? y + 14 : y - 32;
      for (let k = 0; k < 6; k++) {
        const hit = placed.some(b => bx < b.x + b.w + 4 && bx + tw + 4 > b.x && by < b.y + 22 && by + 22 > b.y);
        if (!hit) break; by += (y < h / 2 ? 24 : -24);
      }
      by = Math.max(0, Math.min(h - 20, by)); placed.push({ x: bx, y: by, w: tw });
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = colors[m.kind] || '#fff'; ctx.fill();
      ctx.fillStyle = rgba(colors[m.kind] || '#ffffff', 0.18);
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw, 20, 10); ctx.fill(); } else ctx.fillRect(bx, by, tw, 20);
      ctx.fillStyle = colors[m.kind] || '#fff'; ctx.fillText(m.label, bx + 7, by + 10);
    });
  }

  function line(cv, d) {
    const prev = cv._last;
    cv._last = d;
    const grew = prev && d.points && prev.points && d.points.length && prev.points.length &&
      d.points[d.points.length - 1].ts > prev.points[prev.points.length - 1].ts;
    if (!grew || RM) return drawLine(cv, d, 0);
    const start = performance.now(), dx = 12;
    const step = now => { const k = Math.min(1, (now - start) / 250); const e = 1 - Math.pow(1 - k, 3);
      drawLine(cv, d, dx * (1 - e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function candles(cv, d) {
    const { ctx, w, h } = setup(cv);
    const cs = d.candles || []; if (!cs.length) return;
    const top = 10, bot = h - 10;
    let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
    [d.exitLine, d.entry].forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (hi - lo < 1e-12) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    const n = Math.max(cs.length, 30), bw = w / n;
    cs.forEach((c, i) => {
      const x = w - (cs.length - i) * bw + bw / 2, up = c.c >= c.o, col = up ? '#00d35a' : '#ff453a';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillRect(x - bw * 0.35, y1, bw * 0.7, Math.max(1, y2 - y1));
    });
    const dash = (v, col, label) => { if (v == null) return; ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.restore();
      ctx.fillStyle = col; ctx.font = '500 11px ui-monospace, Menlo, monospace'; ctx.fillText(label, 4, Y(v) - 5); };
    dash(d.entry, 'rgba(235,235,245,0.3)', 'entry');
    dash(d.exitLine, '#ff9f0a', 'exit');
  }

  function ring(cv, score, pass) {
    const { ctx, w, h } = setup(cv); const r = Math.min(w, h) / 2 - 4, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.strokeStyle = '#2c2c2e'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = score >= pass ? '#00d35a' : '#ff9f0a';
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, score / 100)); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.font = '700 17px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(score == null ? '–' : String(score), cx, cy + 1);
  }

  window.Charts = { line, candles, ring };
})();
