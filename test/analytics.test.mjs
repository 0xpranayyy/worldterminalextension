import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPrice,
  flattenMarkets,
  liquidityScore,
  findUnderround,
  findComplementArb,
  findNearExpiryFavorites,
  findMovers,
  evaluateAlerts,
  SORTS,
  median,
  historyFor,
  marketLabel,
  scoreParts,
} from "../src/lib/analytics.js";

const NOW = Date.UTC(2026, 8, 27, 12);
const inHours = (h) => Math.floor((NOW + h * 3600e3) / 1000);

function market(ticker, yesBid, yesAsk, noBid, noAsk, extra = {}) {
  return {
    ticker, eventTicker: "EV", title: ticker, yesSubTitle: ticker, status: "active",
    yesBid, yesAsk, noBid, noAsk, volume: 1000, openInterest: 500, closeTime: inHours(10), ...extra,
  };
}

const events = [
  {
    ticker: "WC-WINNER", title: "World Cup winner", category: "sports", volume24h: 50000, liquidity: 1e5,
    markets: [
      market("BRA", "0.30", "0.31", "0.69", "0.70"),
      market("ARG", "0.28", "0.29", "0.71", "0.72"),
      market("FRA", "0.35", "0.36", "0.64", "0.65"),
      market("OLD", "0.10", "0.11", "0.89", "0.90", { status: "finalized" }),
    ],
  },
  {
    ticker: "BTC-100K", title: "BTC above 100k?", category: "crypto", volume24h: 2e6,
    markets: [market("BTC-100K-Y", "0.95", "0.96", "0.04", "0.05", { closeTime: inHours(6), volume: 5e5, openInterest: 2e5 })],
  },
];

test("toPrice handles decimal strings, cents, and nulls", () => {
  assert.equal(toPrice("0.4500"), 0.45);
  assert.equal(toPrice(45), 0.45);
  assert.equal(toPrice(null), null);
  assert.equal(toPrice("abc"), null);
});

test("flattenMarkets skips non-active markets and computes spread/mid", () => {
  const rows = flattenMarkets(events, NOW);
  assert.equal(rows.length, 4);
  const bra = rows.find((r) => r.ticker === "BRA");
  assert.equal(bra.spread, 0.01);
  assert.equal(bra.mid, 0.305);
  assert.equal(Math.round(bra.hoursToClose), 10);
  assert.equal(bra.eventTicker, "WC-WINNER");
});

test("liquidityScore rewards tight spreads and volume", () => {
  const tight = liquidityScore({ spread: 0.01, volume: 1e5, openInterest: 1e5 });
  const wide = liquidityScore({ spread: 0.12, volume: 1e5, openInterest: 1e5 });
  assert.ok(tight > wide);
  assert.ok(tight <= 100 && wide >= 0);
});

test("findUnderround flags multi-outcome events priced under $1", () => {
  const opps = findUnderround(events);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].eventTicker, "WC-WINNER");
  assert.equal(opps[0].cost, 0.96);
  assert.equal(opps[0].edge, 0.04);
  assert.deepEqual(opps[0].legs.map((l) => l.title), ["FRA", "BRA", "ARG"]);
  assert.equal(+opps[0].legs.reduce((s, l) => s + l.ask, 0).toFixed(4), 0.96);
});

test("findComplementArb requires YES+NO asks under $1", () => {
  const rows = flattenMarkets(events, NOW);
  assert.equal(findComplementArb(rows).length, 0);
  rows[0].noAsk = 0.6; // BRA: 0.31 + 0.60
  const arbs = findComplementArb(rows);
  assert.equal(arbs.length, 1);
  assert.equal(arbs[0].edge, 0.09);
});

test("findNearExpiryFavorites picks high-probability sides closing soon", () => {
  const favs = findNearExpiryFavorites(flattenMarkets(events, NOW));
  assert.equal(favs.length, 1);
  assert.equal(favs[0].side, "YES");
  assert.equal(favs[0].price, 0.96);
});

test("findMovers compares against previous mids", () => {
  const rows = flattenMarkets(events, NOW);
  const movers = findMovers(rows, { BRA: 0.2, ARG: 0.285 });
  assert.equal(movers.length, 1);
  assert.equal(movers[0].ticker, "BRA");
  assert.equal(findMovers(rows, null).length, 0);
});

test("evaluateAlerts fires on threshold crossings", () => {
  const rows = flattenMarkets(events, NOW);
  const fired = evaluateAlerts(
    [
      { id: 1, ticker: "BRA", side: "YES", op: "below", price: 0.32 },
      { id: 2, ticker: "BRA", side: "YES", op: "above", price: 0.5 },
      { id: 3, ticker: "BTC-100K-Y", side: "NO", op: "below", price: 0.05 },
    ],
    rows,
  );
  assert.deepEqual(fired.map((f) => f.alert.id), [1, 3]);
});

test("liquidity sort puts the deepest market first", () => {
  const rows = flattenMarkets(events, NOW).sort(SORTS.liquidity);
  assert.equal(rows[0].ticker, "BTC-100K-Y");
});

test("median ignores nulls and averages even-length input", () => {
  assert.equal(median([0.03, null, 0.01, 0.02]), 0.02);
  assert.equal(median([0.01, 0.03]), 0.02);
  assert.equal(median([]), null);
});

test("historyFor returns a ticker's mids in order plus the live point", () => {
  const snaps = [{ t: 1, mids: { A: 0.4 } }, { t: 2, mids: { B: 0.1 } }, { t: 3, mids: { A: 0.45 } }];
  assert.deepEqual(historyFor("A", snaps, { t: 4, mid: 0.5 }).map((p) => p.mid), [0.4, 0.45, 0.5]);
});

test("marketLabel avoids repeating single-market event titles", () => {
  assert.equal(marketLabel({ eventTitle: "BTC above 100k?", title: "BTC above 100k?" }), "BTC above 100k?");
  assert.equal(marketLabel({ eventTitle: "Chiefs vs Bills", title: "Chiefs" }), "Chiefs vs Bills — Chiefs");
});

test("scoreParts exposes the components of the liquidity score", () => {
  const p = scoreParts({ spread: 0.05, volume: 0, openInterest: 0 });
  assert.equal(p.tight, 0.5);
  assert.equal(p.vol, 0);
});

test("matchPositions values holdings at the bid and flags thin exits", async () => {
  const { matchPositions } = await import("../src/lib/portfolio.js");
  const rows = [
    { ticker: "A", eventTicker: "E", title: "A", eventTitle: "E", yesBid: 0.4, yesAsk: 0.41, noBid: 0.58, noAsk: 0.6, yesMints: ["ya"], noMints: ["na"] },
    { ticker: "B", eventTicker: "E", title: "B", eventTitle: "E", yesBid: 0.1, yesAsk: 0.2, noBid: null, noAsk: 0.9, yesMints: ["yb"], noMints: ["nb"] },
  ];
  const p = matchPositions(
    [
      { mint: "ya", amount: 100 },
      { mint: "nb", amount: 50 },
      { mint: "yb", amount: 10 },
      { mint: "unrelated", amount: 5 },
    ],
    rows,
  );
  assert.equal(p.positions.length, 3);
  assert.equal(p.exitValue, 100 * 0.4 + 10 * 0.1);
  assert.equal(p.maxPayout, 160);
  assert.equal(p.positions.find((x) => x.side === "NO").thin, true); // no bid
  assert.equal(p.positions.find((x) => x.ticker === "B" && x.side === "YES").thin, true); // 10¢ spread
  assert.equal(p.positions.find((x) => x.ticker === "A").thin, false);
});

test("flattenMarkets exposes YES/NO position mints", () => {
  const rows = flattenMarkets(
    [{ ticker: "E", title: "E", markets: [{ ticker: "M", status: "active", yesBid: "0.4", yesAsk: "0.5", accounts: { CASH: { yesMint: "Y1", noMint: "N1" } } }] }],
    NOW,
  );
  assert.deepEqual(rows[0].yesMints, ["Y1"]);
  assert.deepEqual(rows[0].noMints, ["N1"]);
});
