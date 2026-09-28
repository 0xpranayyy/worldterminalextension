// Realistic sample state for screenshots and UI smoke tests. Not real World prices.
import {
  flattenMarkets,
  findUnderround,
  findComplementArb,
  findNearExpiryFavorites,
  findMovers,
  snapshotMids,
  median,
} from "../src/lib/analytics.js";

const H = 3600 * 1000;

function mkt(ticker, sub, yesBid, yesAsk, closeInH, volume, oi, now) {
  const p = (x) => (x == null ? null : x.toFixed(4));
  return {
    ticker,
    title: sub,
    yesSubTitle: sub,
    status: "active",
    yesBid: p(yesBid),
    yesAsk: p(yesAsk),
    noBid: p(yesAsk == null ? null : 1 - yesAsk - 0.005),
    noAsk: p(yesBid == null ? null : 1 - yesBid + 0.005),
    volume,
    openInterest: oi,
    closeTime: Math.floor((now + closeInH * H) / 1000),
    accounts: { CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH: { marketLedger: `${ticker}-L`, yesMint: `${ticker}-YES`, noMint: `${ticker}-NO`, isInitialized: true } },
  };
}

export function sampleEvents(now = Date.now()) {
  const ev = (ticker, title, category, markets, volume24h = 0) => ({ ticker, title, category, volume24h, markets });
  return [
    ev("WXNCAAFB-26SEP26TEXTENN", "Texas vs Tennessee", "football", [
      mkt("WXNCAAFB-TEX", "Texas", 0.61, 0.62, 7, 842000, 311000, now),
      mkt("WXNCAAFB-TENN", "Tennessee", 0.37, 0.39, 7, 610000, 240000, now),
    ]),
    ev("WXNFL-28SEP-KCBUF", "Chiefs vs Bills", "football", [
      mkt("WXNFL-KC", "Chiefs", 0.47, 0.48, 30, 1250000, 520000, now),
      mkt("WXNFL-BUF", "Bills", 0.51, 0.53, 30, 1180000, 498000, now),
    ]),
    ev("WXBTC-OCT01-110K", "Bitcoin above $110k on Oct 1?", "crypto", [mkt("WXBTC-110K", "Bitcoin above $110k on Oct 1?", 0.955, 0.965, 20, 2300000, 880000, now)], 540000),
    ev("WXETH-OCT01-4500", "Ethereum above $4,500 on Oct 1?", "crypto", [mkt("WXETH-4500", "Ethereum above $4,500 on Oct 1?", 0.42, 0.45, 20, 390000, 150000, now)], 120000),
    ev("WXSOL-SEP28-250", "Solana above $250 on Sep 28?", "crypto", [mkt("WXSOL-250", "Solana above $250 on Sep 28?", 0.905, 0.92, 9, 210000, 64000, now)], 90000),
    ev("WXFED-OCT-CUT", "Fed cuts rates in October?", "economics", [mkt("WXFED-CUT", "Fed cuts rates in October?", 0.72, 0.74, 24 * 32, 980000, 410000, now)], 150000),
    ev("WXEPL-2627-WIN", "Premier League 2026–27 winner", "soccer", [
      mkt("WXEPL-ARS", "Arsenal", 0.33, 0.34, 24 * 240, 450000, 210000, now),
      mkt("WXEPL-LIV", "Liverpool", 0.27, 0.28, 24 * 240, 380000, 190000, now),
      mkt("WXEPL-MCI", "Manchester City", 0.2, 0.21, 24 * 240, 300000, 150000, now),
      mkt("WXEPL-CHE", "Chelsea", 0.08, 0.09, 24 * 240, 120000, 60000, now),
      mkt("WXEPL-OTH", "Any other club", 0.05, 0.06, 24 * 240, 40000, 22000, now),
    ]),
    ev("WXBALLON-2026", "Ballon d'Or 2026", "soccer", [
      mkt("WXBDO-YAM", "Lamine Yamal", 0.44, 0.46, 24 * 30, 260000, 120000, now),
      mkt("WXBDO-MBA", "Kylian Mbappé", 0.21, 0.23, 24 * 30, 140000, 70000, now),
      mkt("WXBDO-DEM", "Ousmane Dembélé", 0.17, 0.19, 24 * 30, 90000, 50000, now),
      mkt("WXBDO-OTH", "Anyone else", 0.07, 0.09, 24 * 30, 30000, 15000, now),
    ]),
    ev("WXMLB-WS-2026", "World Series 2026 winner", "baseball", [
      mkt("WXMLB-LAD", "Dodgers", 0.29, 0.31, 24 * 36, 310000, 140000, now),
      mkt("WXMLB-NYY", "Yankees", 0.16, 0.18, 24 * 36, 190000, 90000, now),
      mkt("WXMLB-PHI", "Phillies", 0.12, 0.14, 24 * 36, 120000, 60000, now),
      mkt("WXMLB-FLD", "Any other team", 0.4, 0.42, 24 * 36, 150000, 70000, now),
    ]),
    ev("WXUFC-OCT-MAIN", "UFC main event: Makhachev vs Topuria", "mma", [
      mkt("WXUFC-MAK", "Makhachev", 0.55, 0.6, 24 * 12, 70000, 20000, now),
      mkt("WXUFC-TOP", "Topuria", 0.38, 0.44, 24 * 12, 64000, 18000, now),
    ]),
    ev("WXNBA-OPEN-LAL", "Lakers win season opener?", "basketball", [mkt("WXNBA-LAL", "Lakers win season opener?", 0.52, 0.6, 24 * 25, 18000, 6000, now)], 4000),
  ];
}

export function sampleState(now = Date.now()) {
  const events = sampleEvents(now);
  const rows = flattenMarkets(events, now);
  // 12h of 10-minute snapshots with a gentle random walk ending at today's mid.
  const snapshots = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  // Walk backwards from the current mid so the series ends where the market is now.
  const walk = Object.fromEntries(rows.map((r) => [r.ticker, r.mid]));
  for (let i = 1; i <= 72; i++) {
    for (const r of rows) walk[r.ticker] = Math.min(0.99, Math.max(0.01, walk[r.ticker] + rand() * 0.008));
    snapshots.unshift({ t: now - i * 10 * 60 * 1000, mids: Object.fromEntries(Object.entries(walk).map(([k, v]) => [k, +v.toFixed(4)])) });
  }
  // Make a couple of clear movers against the ~1h-old snapshot.
  const base = snapshots.find((s) => now - s.t <= H + 10 * 60 * 1000) || snapshots[0];
  // Make two clear movers: shift history before the last hour, easing in over that hour.
  for (const snap of snapshots) {
    const age = now - snap.t;
    const k = age >= H ? 1 : age / H;
    snap.mids["WXFED-CUT"] = +(snap.mids["WXFED-CUT"] - 0.09 * k).toFixed(4);
    snap.mids["WXETH-4500"] = +(snap.mids["WXETH-4500"] + 0.07 * k).toFixed(4);
  }
  const moves = {};
  for (const r of rows) if (r.mid != null && typeof base.mids[r.ticker] === "number") moves[r.ticker] = +(r.mid - base.mids[r.ticker]).toFixed(4);
  const opportunities = {
    underround: findUnderround(events),
    complement: findComplementArb(rows),
    favorites: findNearExpiryFavorites(rows),
    movers: findMovers(rows, base.mids),
    moversSince: base.t,
  };
  return {
    rows,
    moves,
    snapshots,
    opportunities,
    status: {
      state: "ok",
      at: now,
      events: events.length,
      markets: rows.length,
      medianSpread: median(rows.map((r) => r.spread)),
      tightMarkets: rows.filter((r) => r.spread !== null && r.spread <= 0.03).length,
    },
    auth: { token: "sample", expiry: now + 20 * H },
    watchlist: ["WXNFL-KC", "WXBTC-110K", "WXFED-CUT"],
    alerts: [
      { id: "a1", ticker: "WXNFL-KC", eventTicker: "WXNFL-28SEP-KCBUF", title: "Chiefs vs Bills — Chiefs", side: "YES", op: "below", price: 0.44 },
      { id: "a2", ticker: "WXETH-4500", eventTicker: "WXETH-OCT01-4500", title: "Ethereum above $4,500 on Oct 1?", side: "YES", op: "above", price: 0.55 },
    ],
  };
}

// Token balances for a sample wallet, in the shape of getTokenAccountsByOwner (jsonParsed).
export const SAMPLE_HOLDINGS = [
  ["WXNFL-KC-YES", 250],
  ["WXBTC-110K-YES", 1200],
  ["WXFED-CUT-NO", 400],
  ["WXUFC-TOP-YES", 150],
  ["WXEPL-ARS-YES", 80],
];

export function sampleRpcReply(ids = [1, 2]) {
  const accounts = SAMPLE_HOLDINGS.map(([mint, amount]) => ({
    pubkey: `${mint}-ACC`,
    account: { data: { parsed: { info: { mint, tokenAmount: { uiAmount: amount, uiAmountString: String(amount), decimals: 6 } } } } },
  }));
  return ids.map((id, i) => ({ jsonrpc: "2.0", id, result: { value: i === 0 ? accounts : [] } }));
}

export { snapshotMids };
