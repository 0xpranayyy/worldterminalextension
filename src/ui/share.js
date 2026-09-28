// Shareable image cards for markets and signals, in two formats:
//   landscape 1200×630 (X, Discord, Telegram link previews) and square 1080×1080 (Instagram, WhatsApp).
// Every card carries the invite link, which is the growth loop. Event images are not drawn:
// cross-origin images would taint the canvas and block export, so we use the same hue-tinted
// monogram the extension shows.

const FONT = '"WT Inter", "Inter", "SF Pro Display", -apple-system, "Segoe UI", system-ui, sans-serif';
const MONO = '"WT Mono", "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const C = {
  bg: "#08090b",
  surface: "rgba(255,255,255,0.045)",
  line: "rgba(255,255,255,0.09)",
  text: "#edeff2",
  text2: "#a3aab4",
  text3: "#6a727e",
  yes: "#3dd68c",
  no: "#ff6b6b",
  accent: "#7c9cff",
  accent2: "#a9bcff",
  gold: "#c9a45c",
};
const LEG_COLORS = ["#7c9cff", "#6a86e6", "#5a72c9", "#4c62ad", "#405493", "#36487d"];

export const FORMATS = {
  landscape: { w: 1200, h: 630, label: "Landscape · X, Telegram" },
  square: { w: 1080, h: 1080, label: "Square · Instagram" },
};

// ---------- primitives ----------

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, r = 22) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function text(ctx, str, x, y, { size = 24, weight = 500, color = C.text, font = FONT, align = "left", base = "alphabetic", spacing = 0 } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(str, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  return ctx.measureText(str).width;
}

function wrap(ctx, str, width, lines, font) {
  ctx.font = font;
  const words = String(str).split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      if (line) out.push(line);
      line = w;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && line) out.push(line);
  if (out.join(" ") !== words.join(" ") && out.length) {
    let last = out[out.length - 1];
    while (ctx.measureText(`${last}…`).width > width && last.length) last = last.slice(0, -1);
    out[out.length - 1] = `${last.trim()}…`;
  }
  return out;
}

function globe(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.15;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.44, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.stroke();
  ctx.restore();
}

function hueOf(seed) {
  return [...String(seed || "")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
}

function monogram(ctx, x, y, s, label, seed) {
  const hue = hueOf(seed);
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, `hsl(${hue} 38% 26%)`);
  g.addColorStop(1, `hsl(${hue} 32% 14%)`);
  rr(ctx, x, y, s, s, s * 0.28);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `hsla(${hue} 40% 40% / 0.6)`;
  ctx.lineWidth = 2;
  ctx.stroke();
  const letters = String(label || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  text(ctx, letters, x + s / 2, y + s / 2 + 1, { size: s * 0.36, weight: 700, color: `hsl(${hue} 75% 80%)`, align: "center", base: "middle" });
}

function pill(ctx, x, y, label, { color = C.text2, bg = "rgba(255,255,255,0.07)", size = 20, font = MONO, weight = 600 } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  const w = ctx.measureText(label).width + size * 1.1;
  const h = size * 1.75;
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, label, x + w / 2, y + h / 2 + 1, { size, weight, color, font, align: "center", base: "middle" });
  return w;
}

// ---------- frame ----------

function background(ctx, W, H, tone) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const toneColor = { up: "rgba(61,214,140,0.22)", down: "rgba(255,107,107,0.2)", gold: "rgba(201,164,92,0.2)", accent: "rgba(124,156,255,0.24)" }[tone] || "rgba(124,156,255,0.24)";
  glow(W * 0.92, H * 0.05, Math.max(W, H) * 0.75, toneColor);
  glow(W * 0.02, H * 1.02, Math.max(W, H) * 0.55, "rgba(124,156,255,0.08)");
  // Fine grid, faded toward the edges.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(8,9,11,0)");
  v.addColorStop(1, "rgba(8,9,11,0.85)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function header(ctx, W, pad, top, chip) {
  const s = 52;
  const g = ctx.createLinearGradient(pad, top, pad + s, top + s);
  g.addColorStop(0, "#262b36");
  g.addColorStop(1, "#12151b");
  rr(ctx, pad, top, s, s, 14);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();
  globe(ctx, pad + s / 2, top + s / 2, 14, C.text);
  text(ctx, "World Terminal", pad + s + 18, top + s / 2 + 1, { size: 27, weight: 700, base: "middle", spacing: -0.5 });
  if (chip) {
    ctx.font = `700 18px ${FONT}`;
    const w = ctx.measureText(chip.label).width + 36;
    pill(ctx, W - pad - w, top + 8, chip.label, { color: chip.color, bg: chip.bg, size: 18, font: FONT, weight: 700 });
  }
}

function cta(ctx, W, H, pad, invite) {
  const h = 92;
  const y = H - pad - h;
  const g = ctx.createLinearGradient(pad, y, W - pad, y);
  g.addColorStop(0, "rgba(255,255,255,0.07)");
  g.addColorStop(1, "rgba(255,255,255,0.03)");
  rr(ctx, pad, y, W - pad * 2, h, 22);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, "Trade it on World", pad + 28, y + 38, { size: 25, weight: 700 });
  const link = invite.replace(/^https:\/\//, "");
  ctx.font = `600 19px ${MONO}`;
  let shown = link;
  const maxW = W - pad * 2 - 300;
  while (ctx.measureText(shown).width > maxW && shown.length > 10) shown = `${shown.slice(0, -2)}`;
  if (shown !== link) shown = `${shown}…`;
  text(ctx, shown, pad + 28, y + 70, { size: 19, weight: 600, color: C.accent2, font: MONO });
  const bw = 196;
  const bh = 52;
  rr(ctx, W - pad - 20 - bw, y + (h - bh) / 2, bw, bh, bh / 2);
  ctx.fillStyle = C.text;
  ctx.fill();
  text(ctx, "world.xyz  →", W - pad - 20 - bw / 2, y + h / 2 + 1, { size: 21, weight: 700, color: "#0a0b0d", align: "center", base: "middle" });
  return y;
}

// ---------- pieces ----------

const cents = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);
const cents1 = (p) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`);
const compact = (n) => (n ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : "0");

function chart(ctx, points, x, y, w, h) {
  panel(ctx, x, y, w, h, 24);
  const px = 26;
  const top = y + 58;
  const bottom = y + h - 44;
  const left = x + px;
  const right = x + w - px;
  if (!points || points.length < 2) {
    text(ctx, "Price history builds up over time", x + w / 2, y + h / 2, { size: 20, color: C.text3, align: "center", base: "middle" });
    return;
  }
  const vals = points.map((p) => p.mid);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 0.02) {
    lo -= 0.01;
    hi += 0.01;
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const X = (t) => left + ((t - t0) / Math.max(1, t1 - t0)) * (right - left);
  const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? C.yes : C.no;
  // header + grid
  text(ctx, "12H PRICE", left, y + 38, { size: 16, weight: 700, color: C.text3, spacing: 1.5 });
  const change = vals[vals.length - 1] - vals[0];
  text(ctx, `${change >= 0 ? "+" : "−"}${cents1(Math.abs(change))}`, right, y + 38, { size: 20, weight: 700, color, font: MONO, align: "right" });
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 7]);
  for (let i = 0; i < 3; i++) {
    const gy = top + ((bottom - top) * i) / 2;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(right, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const path = () => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.mid)) : ctx.moveTo(X(p.t), Y(p.mid))));
  };
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, up ? "rgba(61,214,140,0.3)" : "rgba(255,107,107,0.3)");
  fill.addColorStop(1, "rgba(0,0,0,0)");
  path();
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  path();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(X(last.t), Y(last.mid), 12, 0, Math.PI * 2);
  ctx.fillStyle = up ? "rgba(61,214,140,0.25)" : "rgba(255,107,107,0.25)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X(last.t), Y(last.mid), 6.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  text(ctx, hhmm(t0), left, y + h - 16, { size: 16, weight: 500, color: C.text3, font: MONO });
  text(ctx, "now", right, y + h - 16, { size: 16, weight: 500, color: C.text3, font: MONO, align: "right" });
}

function stat(ctx, x, y, w, h, label, value, color = C.text) {
  panel(ctx, x, y, w, h, 18);
  text(ctx, label.toUpperCase(), x + 20, y + 34, { size: 15, weight: 700, color: C.text3, spacing: 1.4 });
  text(ctx, value, x + 20, y + h - 22, { size: 30, weight: 700, color, font: MONO, spacing: -1 });
}

function stackBar(ctx, x, y, w, h, legs, edge) {
  const total = legs.reduce((s, l) => s + l.ask, 0) + Math.max(0, edge);
  let cx = x;
  rr(ctx, x, y, w, h, h / 2);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x, y, w, h);
  legs.forEach((l, i) => {
    const lw = (l.ask / total) * w;
    ctx.fillStyle = l.color || LEG_COLORS[Math.min(i, LEG_COLORS.length - 1)];
    ctx.fillRect(cx, y, lw - 3, h);
    cx += lw;
  });
  // edge: hatched green
  const ew = (Math.max(0, edge) / total) * w;
  ctx.fillStyle = "rgba(61,214,140,0.35)";
  ctx.fillRect(cx, y, ew, h);
  ctx.strokeStyle = "rgba(61,214,140,0.95)";
  ctx.lineWidth = 4;
  for (let sx = cx - h; sx < cx + ew; sx += 11) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.stroke();
  }
  ctx.restore();
  // $1 marker
  ctx.fillStyle = C.text2;
  rr(ctx, x + w - 2, y - 10, 4, h + 20, 2);
  ctx.fill();
  text(ctx, "$1", x + w, y - 18, { size: 17, weight: 700, color: C.text2, font: MONO, align: "right" });
}

// ---------- cards ----------

function marketCard(ctx, W, H, f, { row, history, invite }) {
  const pad = f === "square" ? 64 : 56;
  const change = history && history.length > 1 ? history[history.length - 1].mid - history[0].mid : 0;
  background(ctx, W, H, change > 0.004 ? "up" : change < -0.004 ? "down" : "accent");
  header(ctx, W, pad, pad - 6, { label: (row.category || "Market").toUpperCase(), color: C.text2, bg: "rgba(255,255,255,0.07)" });
  const price = row.yesAsk ?? row.mid;
  const sub = row.eventTitle !== row.title ? row.eventTitle : "";
  const ctaY = H - pad - 92;

  if (f === "square") {
    let y = pad + 104;
    monogram(ctx, pad, y, 72, row.eventTitle || row.title, row.eventTicker);
    if (sub) text(ctx, wrap(ctx, sub, W - pad * 2 - 96, 1, `500 24px ${FONT}`)[0], pad + 96, y + 28, { size: 24, color: C.text2 });
    const titleLines = wrap(ctx, row.title, W - pad * 2 - 96, 2, `800 44px ${FONT}`);
    titleLines.forEach((l, i) => text(ctx, l, pad + 96, y + (sub ? 72 : 46) + i * 50, { size: 44, weight: 800, spacing: -1.2 }));
    y += 150 + (titleLines.length - 1) * 40;
    text(ctx, cents(price), pad, y + 100, { size: 132, weight: 800, color: C.yes, font: MONO, spacing: -6 });
    text(ctx, `YES · ${Math.round((price ?? 0) * 100)}% chance`, pad + 6, y + 142, { size: 22, weight: 600, color: C.text2 });
    const chartY = y + 176;
    const chartH = ctaY - 150 - chartY;
    chart(ctx, history, pad, chartY, W - pad * 2, chartH);
    const sw = (W - pad * 2 - 32) / 3;
    const sy = ctaY - 132;
    stat(ctx, pad, sy, sw, 108, "Spread", cents1(row.spread), row.spread !== null && row.spread <= 0.03 ? C.yes : C.text);
    stat(ctx, pad + sw + 16, sy, sw, 108, "Liquidity", `${row.score}/100`, row.score >= 65 ? C.yes : C.text);
    stat(ctx, pad + (sw + 16) * 2, sy, sw, 108, "Volume", compact(row.volume));
  } else {
    const colW = 560;
    let y = pad + 110;
    monogram(ctx, pad, y, 60, row.eventTitle || row.title, row.eventTicker);
    if (sub) text(ctx, wrap(ctx, sub, colW - 80, 1, `500 22px ${FONT}`)[0], pad + 80, y + 36, { size: 22, color: C.text2 });
    else text(ctx, "World market", pad + 80, y + 36, { size: 22, color: C.text2 });
    const titleLines = wrap(ctx, row.title, colW, 2, `800 46px ${FONT}`);
    titleLines.forEach((l, i) => text(ctx, l, pad, y + 118 + i * 52, { size: 46, weight: 800, spacing: -1.2 }));
    const py = y + 118 + titleLines.length * 52 + 92;
    text(ctx, cents(price), pad - 4, py, { size: 112, weight: 800, color: C.yes, font: MONO, spacing: -5 });
    ctx.font = `800 112px ${MONO}`;
    const pw = ctx.measureText(cents(price)).width - 5 * (cents(price).length - 1);
    text(ctx, "YES", pad + pw + 18, py - 58, { size: 20, weight: 700, color: C.text3, spacing: 1.5 });
    text(ctx, `${Math.round((price ?? 0) * 100)}% chance`, pad + pw + 18, py - 26, { size: 22, weight: 600, color: C.text2 });
    const rx = pad + colW + 44;
    const rw = W - pad - rx;
    const chartH = ctaY - 24 - (pad + 90) - 124;
    chart(ctx, history, rx, pad + 90, rw, chartH);
    const sw = (rw - 24) / 3;
    const sy = pad + 90 + chartH + 16;
    stat(ctx, rx, sy, sw, 104, "Spread", cents1(row.spread), row.spread !== null && row.spread <= 0.03 ? C.yes : C.text);
    stat(ctx, rx + sw + 12, sy, sw, 104, "Liquidity", String(row.score), row.score >= 65 ? C.yes : C.text);
    stat(ctx, rx + (sw + 12) * 2, sy, sw, 104, "Volume", compact(row.volume));
  }
  cta(ctx, W, H, pad, invite);
}

function signalCard(ctx, W, H, f, { signal: s, invite }) {
  const pad = f === "square" ? 64 : 56;
  const tone = s.type === "mover" ? (s.move > 0 ? "up" : "down") : s.type === "favorite" ? "accent" : "up";
  background(ctx, W, H, tone);
  const labels = { underround: "ARBITRAGE · OUTCOME SET", complement: "ARBITRAGE · YES + NO", favorite: "CLOSING FAVORITE", mover: "BIG MOVER" };
  header(ctx, W, pad, pad - 6, { label: labels[s.type] || "SIGNAL", color: "#1d1606", bg: "#d9bd7a" });

  let big;
  let bigColor = C.yes;
  let line;
  if (s.type === "underround" || s.type === "complement") {
    big = `+${cents1(s.edge)}`;
    line = `per $1 · ${s.returnPct}% return`;
  } else if (s.type === "favorite") {
    big = `+${s.returnPct}%`;
    bigColor = C.accent2;
    line = `${s.side} at ${cents(s.price)} · closes in ${s.hoursToClose}h`;
  } else {
    big = `${s.move > 0 ? "+" : "−"}${Math.abs(Math.round(s.move * 100))}¢`;
    bigColor = s.move > 0 ? C.yes : C.no;
    line = `${cents(s.from)} → ${cents(s.to)} in about an hour`;
  }

  const ctaY = H - pad - 92;
  const col = f === "square" ? W - pad * 2 : 600;
  let y = pad + 120;
  monogram(ctx, pad, y, f === "square" ? 72 : 60, s.title, s.eventTicker);
  const tFont = f === "square" ? 46 : 44;
  const lines = wrap(ctx, s.title, col - (f === "square" ? 96 : 80), 2, `800 ${tFont}px ${FONT}`);
  lines.forEach((l, i) => text(ctx, l, pad + (f === "square" ? 96 : 80), y + (f === "square" ? 50 : 44) + i * (tFont + 8), { size: tFont, weight: 800, spacing: -1.2 }));
  y += Math.max(f === "square" ? 72 : 60, lines.length * (tFont + 8)) + (f === "square" ? 150 : 128);
  text(ctx, big, pad - 4, y, { size: f === "square" ? 150 : 120, weight: 800, color: bigColor, font: MONO, spacing: -6 });
  text(ctx, line, pad, y + 46, { size: 25, weight: 600, color: C.text2 });

  // Visual
  const vx = f === "square" ? pad : pad + col + 40;
  const vy = f === "square" ? y + 90 : pad + 96;
  const vw = f === "square" ? W - pad * 2 : W - pad - vx;
  const vh = f === "square" ? ctaY - 24 - vy : ctaY - 24 - vy;
  panel(ctx, vx, vy, vw, vh, 24);
  const ix = vx + 28;
  const iw = vw - 56;
  if ((s.type === "underround" && s.legs?.length) || s.type === "complement") {
    const legs =
      s.type === "underround"
        ? s.legs.map((l, i) => ({ ...l, color: LEG_COLORS[Math.min(i, LEG_COLORS.length - 1)] }))
        : [
            { title: "YES", ask: s.yesAsk ?? s.cost / 2, color: "rgba(61,214,140,0.8)" },
            { title: "NO", ask: s.noAsk ?? s.cost / 2, color: "rgba(255,107,107,0.8)" },
          ];
    text(ctx, "COST OF ONE FULL SET", ix, vy + 44, { size: 16, weight: 700, color: C.text3, spacing: 1.5 });
    text(ctx, `${cents1(s.cost)} → $1`, vx + vw - 28, vy + 44, { size: 22, weight: 700, color: C.yes, font: MONO, align: "right" });
    stackBar(ctx, ix, vy + 92, iw, 34, legs, s.edge);
    // Leave room at the bottom for the "+N more" line and the edge line.
    const rowH = 36;
    const rowsMax = Math.max(1, Math.floor((vh - 164 - 44) / rowH));
    const shown = legs.slice(0, rowsMax);
    let ly = vy + 170;
    for (const l of shown) {
      ctx.fillStyle = l.color;
      rr(ctx, ix, ly - 14, 14, 14, 4);
      ctx.fill();
      text(ctx, wrap(ctx, l.title, iw - 120, 1, `500 21px ${FONT}`)[0], ix + 26, ly, { size: 21, color: C.text2 });
      text(ctx, cents(l.ask), vx + vw - 28, ly, { size: 21, weight: 700, font: MONO, align: "right" });
      ly += rowH;
    }
    if (legs.length > shown.length) text(ctx, `+${legs.length - shown.length} more`, vx + vw - 28, vy + vh - 28, { size: 19, color: C.text3, align: "right" });
    ctx.fillStyle = "rgba(61,214,140,0.9)";
    rr(ctx, ix, vy + vh - 42, 14, 14, 4);
    ctx.fill();
    text(ctx, `Edge +${cents1(s.edge)} · ${vw > 700 ? "check the market rules" : "check rules"}`, ix + 26, vy + vh - 28, { size: 19, weight: 600, color: C.yes });
  } else if (s.type === "favorite") {
    const cx = vx + vw / 2;
    const cy = vy + vh / 2 - 10;
    const r = Math.min(vw, vh) * 0.3;
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.price);
    ctx.stroke();
    text(ctx, cents(s.price), cx, cy + 6, { size: 64, weight: 800, font: MONO, align: "center", base: "middle", spacing: -3 });
    text(ctx, `${s.side} · implied ${Math.round(s.price * 100)}%`, cx, cy + r + 58, { size: 21, weight: 600, color: C.text2, align: "center" });
  } else {
    const ty = vy + vh / 2;
    text(ctx, "LAST HOUR", ix, vy + 44, { size: 16, weight: 700, color: C.text3, spacing: 1.5 });
    rr(ctx, ix, ty - 8, iw, 16, 8);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    const X = (p) => ix + p * iw;
    const lo = Math.min(s.from, s.to);
    const hi = Math.max(s.from, s.to);
    rr(ctx, X(lo), ty - 8, Math.max(8, X(hi) - X(lo)), 16, 8);
    ctx.fillStyle = s.move > 0 ? "rgba(61,214,140,0.5)" : "rgba(255,107,107,0.5)";
    ctx.fill();
    for (const [p, col] of [
      [s.from, C.text3],
      [s.to, s.move > 0 ? C.yes : C.no],
    ]) {
      ctx.beginPath();
      ctx.arc(X(p), ty, 14, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#101216";
      ctx.stroke();
    }
    text(ctx, cents(s.from), X(s.from), ty + 58, { size: 24, weight: 700, color: C.text2, font: MONO, align: "center" });
    text(ctx, cents(s.to), X(s.to), ty - 34, { size: 30, weight: 800, color: s.move > 0 ? C.yes : C.no, font: MONO, align: "center" });
    text(ctx, "0¢", ix, vy + vh - 24, { size: 16, color: C.text3, font: MONO });
    text(ctx, "100¢", vx + vw - 28, vy + vh - 24, { size: 16, color: C.text3, font: MONO, align: "right" });
  }
  cta(ctx, W, H, pad, invite);
}

// kind: "market" → {row, history}; "signal" → {signal}. format: "landscape" | "square".
export function drawCard(canvas, data) {
  const f = FORMATS[data.format] ? data.format : "landscape";
  const { w: W, h: H } = FORMATS[f];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (data.kind === "market") marketCard(ctx, W, H, f, data);
  else signalCard(ctx, W, H, f, data);
  return canvas;
}

export function shareText({ kind, row, signal }) {
  if (kind === "market") {
    return `${row.eventTitle !== row.title ? `${row.eventTitle}: ${row.title}` : row.title} is trading at ${cents(row.yesAsk ?? row.mid)} YES on World (spread ${cents1(row.spread)}, liquidity ${row.score}/100).`;
  }
  const s = signal;
  if (s.type === "underround" || s.type === "complement") return `Arbitrage on World: ${s.title}. A full set costs ${cents1(s.cost)} for a $1 payout (+${s.returnPct}%).`;
  if (s.type === "favorite") return `${s.title}: ${s.side} at ${cents(s.price)}, closing in ${s.hoursToClose}h on World.`;
  return `${s.title} moved ${s.move > 0 ? "+" : "−"}${Math.abs(Math.round(s.move * 100))}¢ in the last hour on World.`;
}
