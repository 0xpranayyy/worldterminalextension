// Shareable 1200×630 image cards (the size X and Discord preview well) for markets and signals.
// Every card carries the invite link, which is the growth loop.

const W = 1200;
const H = 630;
const FONT = '"Inter", "SF Pro Display", -apple-system, "Segoe UI", system-ui, sans-serif';
const MONO = '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Wrap text to at most `lines` lines within `width`, adding an ellipsis when cut.
function wrap(ctx, text, width, lines) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      out.push(line);
      line = w;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(" ") !== out.join(" ")) {
    let last = out[lines - 1];
    while (ctx.measureText(`${last}…`).width > width && last.length) last = last.slice(0, -1);
    out[lines - 1] = `${last}…`;
  }
  return out;
}

function globe(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.16;
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

function frame(ctx) {
  ctx.fillStyle = "#0a0b0d";
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W * 0.9, H * 0.1, 0, W * 0.9, H * 0.1, W * 0.7);
  g1.addColorStop(0, "rgba(124,156,255,0.22)");
  g1.addColorStop(1, "rgba(124,156,255,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.5);
  g2.addColorStop(0, "rgba(201,164,92,0.12)");
  g2.addColorStop(1, "rgba(201,164,92,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  globe(ctx, 88, 82, 18, "#edeff2");
  ctx.fillStyle = "#edeff2";
  ctx.font = `700 28px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("World Terminal", 120, 83);
}

function footer(ctx, invite) {
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#6a727e";
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText("Trade it on World", 70, H - 58);
  ctx.fillStyle = "#a9bcff";
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText(invite.replace(/^https:\/\//, ""), 70, H - 26);
  const label = "world.xyz";
  ctx.font = `600 20px ${FONT}`;
  const w = ctx.measureText(label).width + 36;
  roundRect(ctx, W - 70 - w, H - 76, w, 44, 22);
  ctx.fillStyle = "#edeff2";
  ctx.fill();
  ctx.fillStyle = "#0a0b0d";
  ctx.textBaseline = "middle";
  ctx.fillText(label, W - 70 - w + 18, H - 54);
}

function statBox(ctx, x, y, w, label, value, color = "#edeff2") {
  roundRect(ctx, x, y, w, 110, 18);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#6a727e";
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(label.toUpperCase(), x + 22, y + 38);
  ctx.fillStyle = color;
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText(value, x + 22, y + 88);
}

function spark(ctx, points, x, y, w, h) {
  if (!points || points.length < 2) return;
  const vals = points.map((p) => p.mid);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 0.02) {
    lo -= 0.01;
    hi += 0.01;
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const px = (t) => x + ((t - t0) / Math.max(1, t1 - t0)) * w;
  const py = (v) => y + h - ((v - lo) / (hi - lo)) * h;
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#3dd68c" : "#ff6b6b";
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, up ? "rgba(61,214,140,0.28)" : "rgba(255,107,107,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(px(p.t), py(p.mid)) : ctx.moveTo(px(p.t), py(p.mid))));
  ctx.lineTo(px(t1), y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(px(p.t), py(p.mid)) : ctx.moveTo(px(p.t), py(p.mid))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.stroke();
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(px(last.t), py(last.mid), 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

const c = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);
const c1 = (p) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`);

// kind: "market" → {row, history}; "signal" → {signal}
export function drawCard(canvas, { kind, row, history, signal, invite }) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  frame(ctx);
  ctx.textBaseline = "alphabetic";

  if (kind === "market") {
    ctx.fillStyle = "#a3aab4";
    ctx.font = `500 24px ${FONT}`;
    const sub = row.eventTitle !== row.title ? row.eventTitle : row.category || "";
    ctx.fillText(wrap(ctx, sub, 640, 1)[0] || "", 70, 168);
    ctx.fillStyle = "#edeff2";
    ctx.font = `800 54px ${FONT}`;
    wrap(ctx, row.title, 640, 2).forEach((l, i) => ctx.fillText(l, 70, 236 + i * 62));
    ctx.fillStyle = "#3dd68c";
    ctx.font = `800 104px ${MONO}`;
    ctx.fillText(c(row.yesAsk ?? row.mid), 70, 420);
    ctx.fillStyle = "#6a727e";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("YES PRICE", 76, 454);
    spark(ctx, history, 760, 150, 370, 150);
    statBox(ctx, 760, 336, 175, "Spread", c1(row.spread), row.spread !== null && row.spread <= 0.03 ? "#3dd68c" : "#edeff2");
    statBox(ctx, 955, 336, 175, "Liquidity", `${row.score}`, row.score >= 65 ? "#3dd68c" : "#edeff2");
  } else {
    const s = signal;
    const labels = { underround: "ARBITRAGE · OUTCOME SET", complement: "ARBITRAGE · YES + NO", favorite: "CLOSING FAVORITE", mover: "BIG MOVER" };
    ctx.fillStyle = "#c9a45c";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(labels[s.type] || "SIGNAL", 70, 168);
    ctx.fillStyle = "#edeff2";
    ctx.font = `800 54px ${FONT}`;
    wrap(ctx, s.title, 1060, 2).forEach((l, i) => ctx.fillText(l, 70, 236 + i * 62));
    let big;
    let line;
    if (s.type === "underround" || s.type === "complement") {
      big = `+${c1(s.edge)}`;
      line = s.type === "underround" ? `${s.outcomes} outcomes cost ${c1(s.cost)} per $1 payout · ${s.returnPct}%` : `YES + NO cost ${c1(s.cost)} per $1 payout · ${s.returnPct}%`;
    } else if (s.type === "favorite") {
      big = `+${s.returnPct}%`;
      line = `${s.side} at ${c(s.price)} · closes in ${s.hoursToClose}h`;
    } else {
      big = `${s.move > 0 ? "+" : "−"}${Math.abs(Math.round(s.move * 100))}¢`;
      line = `${c(s.from)} → ${c(s.to)} in about an hour`;
    }
    ctx.fillStyle = s.type === "mover" && s.move < 0 ? "#ff6b6b" : "#3dd68c";
    ctx.font = `800 104px ${MONO}`;
    ctx.fillText(big, 70, 440);
    ctx.fillStyle = "#a3aab4";
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(line, 70, 486);
  }
  footer(ctx, invite);
  return canvas;
}

export function shareText({ kind, row, signal }) {
  if (kind === "market") {
    return `${row.eventTitle !== row.title ? `${row.eventTitle}: ${row.title}` : row.title} is trading at ${c(row.yesAsk ?? row.mid)} YES on World (spread ${c1(row.spread)}, liquidity ${row.score}/100).`;
  }
  const s = signal;
  if (s.type === "underround" || s.type === "complement") return `Arbitrage on World: ${s.title}. Full set costs ${c1(s.cost)} for a $1 payout (+${s.returnPct}%).`;
  if (s.type === "favorite") return `${s.title}: ${s.side} at ${c(s.price)}, closing in ${s.hoursToClose}h on World.`;
  return `${s.title} moved ${s.move > 0 ? "+" : "−"}${Math.abs(Math.round(s.move * 100))}¢ in the last hour on World.`;
}
