// Pure functions over World's /events payload. No chrome.* APIs here so it can be unit tested in Node.

const HOUR = 3600 * 1000;

// World returns prices as decimal strings ("0.4500"). Guard against cent-denominated values too.
export function toPrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

// World timestamps are unix seconds; accept milliseconds too.
export function toMs(t) {
  if (!t) return null;
  return t < 1e12 ? t * 1000 : t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function logNorm(x, max) {
  if (!x || x <= 0) return 0;
  return clamp01(Math.log10(1 + x) / Math.log10(1 + max));
}

// Liquidity score 0–100 from spread tightness, traded volume and open interest.
// A 10¢+ spread scores zero for tightness; volume/OI saturate at 1M contracts.
export const SCORE_WEIGHTS = { tight: 0.45, vol: 0.3, oi: 0.25 };

export function scoreParts({ spread, volume24h, volume, openInterest }) {
  return {
    tight: spread === null || spread === undefined ? 0 : clamp01(1 - spread / 0.1),
    vol: logNorm(volume24h || volume || 0, 1e6),
    oi: logNorm(openInterest || 0, 1e6),
  };
}

export function liquidityScore(row) {
  const p = scoreParts(row);
  return Math.round(100 * (SCORE_WEIGHTS.tight * p.tight + SCORE_WEIGHTS.vol * p.vol + SCORE_WEIGHTS.oi * p.oi));
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Mid-price series for one ticker from stored snapshots: [{t, mid}]
export function historyFor(ticker, snapshots, current) {
  const pts = (snapshots || [])
    .filter((s) => typeof s.mids?.[ticker] === "number")
    .map((s) => ({ t: s.t, mid: s.mids[ticker] }));
  if (current && typeof current.mid === "number") pts.push({ t: current.t, mid: current.mid });
  return pts;
}

export function flattenMarkets(events, now = Date.now()) {
  const rows = [];
  for (const ev of events || []) {
    for (const m of ev.markets || []) {
      if (m.status && m.status !== "active") continue;
      const yesBid = toPrice(m.yesBid);
      const yesAsk = toPrice(m.yesAsk);
      const noBid = toPrice(m.noBid);
      const noAsk = toPrice(m.noAsk);
      const spread = yesBid !== null && yesAsk !== null ? +(yesAsk - yesBid).toFixed(4) : null;
      const mid = yesBid !== null && yesAsk !== null ? (yesBid + yesAsk) / 2 : yesAsk ?? yesBid;
      const closeMs = toMs(m.closeTime) ?? toMs(m.expirationTime);
      const volume24h = ev.markets.length === 1 ? ev.volume24h ?? 0 : null;
      // Position tokens: one YES/NO mint pair per settlement currency.
      const accts = Object.values(m.accounts || {});
      const yesMints = accts.map((a) => a.yesMint).filter(Boolean);
      const noMints = accts.map((a) => a.noMint).filter(Boolean);
      const row = {
        ticker: m.ticker,
        eventTicker: ev.ticker || m.eventTicker,
        eventTitle: ev.title,
        title: m.yesSubTitle || m.title || ev.title,
        category: ev.category || (ev.tags && ev.tags[0]) || "",
        imageUrl: m.imageUrl || ev.imageUrl || null,
        yesBid,
        yesAsk,
        noBid,
        noAsk,
        mid,
        spread,
        volume: m.volume || 0,
        volume24h,
        eventVolume24h: ev.volume24h || 0,
        eventLiquidity: ev.liquidity || 0,
        openInterest: m.openInterest || 0,
        yesMints,
        noMints,
        closeMs,
        hoursToClose: closeMs ? (closeMs - now) / HOUR : null,
      };
      row.score = liquidityScore(row);
      rows.push(row);
    }
  }
  return rows;
}

export const SORTS = {
  liquidity: (a, b) => b.score - a.score,
  spread: (a, b) => (a.spread ?? 9) - (b.spread ?? 9),
  volume: (a, b) => (b.volume24h ?? b.volume) - (a.volume24h ?? a.volume),
  openInterest: (a, b) => b.openInterest - a.openInterest,
  closing: (a, b) => (a.closeMs ?? Infinity) - (b.closeMs ?? Infinity),
};

// ---------- Opportunities ----------

// "Event — Outcome", or just the event title when the market is the whole event.
export function marketLabel(r) {
  return !r.title || r.title === r.eventTitle ? r.eventTitle : `${r.eventTitle} — ${r.title}`;
}

// Multi-outcome events (e.g. "Who wins the World Cup?") where buying YES on every outcome
// costs less than the guaranteed $1 payout. Only valid when outcomes are mutually exclusive
// and exhaustive — World does not expose that flag, so we surface it with a "check rules" note.
export function findUnderround(events, { minOutcomes = 3, minEdge = 0.005 } = {}) {
  const out = [];
  for (const ev of events || []) {
    const active = (ev.markets || []).filter((m) => !m.status || m.status === "active");
    if (active.length < minOutcomes) continue;
    const asks = active.map((m) => toPrice(m.yesAsk));
    if (asks.some((a) => a === null)) continue;
    const cost = asks.reduce((s, a) => s + a, 0);
    const edge = 1 - cost;
    if (edge >= minEdge) {
      out.push({
        type: "underround",
        eventTicker: ev.ticker,
        title: ev.title,
        outcomes: active.length,
        cost: +cost.toFixed(4),
        edge: +edge.toFixed(4),
        returnPct: +((edge / cost) * 100).toFixed(2),
        imageUrl: ev.imageUrl || null,
        closeMs: Math.max(...active.map((m) => toMs(m.closeTime) ?? toMs(m.expirationTime) ?? 0)) || null,
        // Each outcome's YES ask, largest first, for the stacked cost bar.
        legs: active
          .map((m, i) => ({ title: m.yesSubTitle || m.title || m.ticker, ask: asks[i] }))
          .sort((a, b) => b.ask - a.ask),
        note: "Buy YES on every outcome. Only risk-free if exactly one outcome must resolve YES — read the rules.",
      });
    }
  }
  return out.sort((a, b) => b.edge - a.edge);
}

// Same market: YES ask + NO ask < $1 means buying both locks in a profit.
export function findComplementArb(rows, { minEdge = 0.003 } = {}) {
  return rows
    .filter((r) => r.yesAsk !== null && r.noAsk !== null)
    .map((r) => ({ r, cost: r.yesAsk + r.noAsk }))
    .filter(({ cost }) => 1 - cost >= minEdge)
    .map(({ r, cost }) => ({
      type: "complement",
      ticker: r.ticker,
      yesAsk: r.yesAsk,
      noAsk: r.noAsk,
      eventTicker: r.eventTicker,
      title: marketLabel(r),
      cost: +cost.toFixed(4),
      edge: +(1 - cost).toFixed(4),
      returnPct: +(((1 - cost) / cost) * 100).toFixed(2),
      note: "Buy YES and NO together; one side pays $1.",
    }))
    .sort((a, b) => b.edge - a.edge);
}

// High-probability outcomes closing soon: cheap-to-carry "yield" trades. Not risk free.
export function findNearExpiryFavorites(rows, { minPrice = 0.85, maxPrice = 0.985, maxHours = 48 } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.hoursToClose === null || r.hoursToClose <= 0 || r.hoursToClose > maxHours) continue;
    for (const [side, ask] of [
      ["YES", r.yesAsk],
      ["NO", r.noAsk],
    ]) {
      if (ask === null || ask < minPrice || ask > maxPrice) continue;
      const ret = (1 - ask) / ask;
      out.push({
        type: "favorite",
        ticker: r.ticker,
        eventTicker: r.eventTicker,
        title: marketLabel(r),
        side,
        price: ask,
        hoursToClose: +r.hoursToClose.toFixed(1),
        returnPct: +(ret * 100).toFixed(2),
        score: r.score,
        note: `Pays $1 if ${side} in ${r.hoursToClose.toFixed(1)}h. Loses ${Math.round(ask * 100)}¢ if wrong.`,
      });
    }
  }
  return out.sort((a, b) => b.returnPct / Math.max(b.hoursToClose, 1) - a.returnPct / Math.max(a.hoursToClose, 1));
}

// Price moves versus a previous snapshot ({ticker: mid}).
export function findMovers(rows, previousMids, { minMove = 0.05 } = {}) {
  if (!previousMids) return [];
  return rows
    .filter((r) => r.mid !== null && typeof previousMids[r.ticker] === "number")
    .map((r) => ({ r, move: r.mid - previousMids[r.ticker] }))
    .filter(({ move }) => Math.abs(move) >= minMove)
    .map(({ r, move }) => ({
      type: "mover",
      ticker: r.ticker,
      eventTicker: r.eventTicker,
      title: marketLabel(r),
      from: previousMids[r.ticker],
      to: r.mid,
      move: +move.toFixed(4),
      score: r.score,
    }))
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
}

export function snapshotMids(rows) {
  const mids = {};
  for (const r of rows) if (r.mid !== null) mids[r.ticker] = +r.mid.toFixed(4);
  return mids;
}

// Alerts: [{ticker, side: "YES"|"NO", op: "above"|"below", price}]
export function evaluateAlerts(alerts, rows) {
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const fired = [];
  for (const a of alerts || []) {
    const r = byTicker.get(a.ticker);
    if (!r) continue;
    const px = a.side === "NO" ? r.noAsk : r.yesAsk;
    if (px === null) continue;
    if ((a.op === "above" && px >= a.price) || (a.op === "below" && px <= a.price)) {
      fired.push({ alert: a, price: px, row: r });
    }
  }
  return fired;
}
