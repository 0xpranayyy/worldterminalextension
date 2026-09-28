// Cron job: pull the upstream feed once for everyone, score it, store the latest view in KV
// and a mid-price snapshot in D1 every 10 minutes.
import { fetchActiveEvents } from "../../src/lib/api.js";
import { broadcast } from "./broadcast.js";
import {
  flattenMarkets,
  findUnderround,
  findComplementArb,
  findNearExpiryFavorites,
  findMovers,
  median,
} from "../../src/lib/analytics.js";

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const HISTORY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MOVER_LOOKBACK_MS = 60 * 60 * 1000;

export async function poll(env, now = Date.now()) {
  if (!env.UPSTREAM_URL) return { skipped: "UPSTREAM_URL not set" };
  const started = Date.now();
  let events;
  try {
    events = await fetchActiveEvents(env.UPSTREAM_TOKEN || null, env.UPSTREAM_URL);
  } catch (err) {
    const prev = (await env.KV.get("latest", "json")) || {};
    await env.KV.put("latest", JSON.stringify({ ...prev, status: { ...(prev.status || {}), state: "error", message: err.message, errorAt: now } }));
    return { error: err.message };
  }
  const rows = flattenMarkets(events, now);

  const base = await env.DB.prepare(
    "SELECT ticker, mid, t FROM snapshots WHERE t = (SELECT MAX(t) FROM snapshots WHERE t <= ?)",
  )
    .bind(now - MOVER_LOOKBACK_MS)
    .all();
  const baseMids = base.results.length ? Object.fromEntries(base.results.map((r) => [r.ticker, r.mid])) : null;

  // Loose thresholds here; each extension narrows them to the user's own Settings.
  const opportunities = {
    underround: findUnderround(events, { minEdge: 0.001 }).slice(0, 150),
    complement: findComplementArb(rows, { minEdge: 0.001 }).slice(0, 150),
    favorites: findNearExpiryFavorites(rows, { minPrice: 0.7, maxHours: 168 }).slice(0, 150),
    movers: baseMids ? findMovers(rows, baseMids, { minMove: 0.02 }).slice(0, 150) : [],
    moversSince: base.results[0]?.t ?? null,
  };

  const status = {
    state: "ok",
    at: now,
    tookMs: Date.now() - started,
    events: events.length,
    markets: rows.length,
    medianSpread: median(rows.map((r) => r.spread)),
    tightMarkets: rows.filter((r) => r.spread !== null && r.spread <= 0.03).length,
  };
  await env.KV.put("latest", JSON.stringify({ rows, opportunities, status }));
  await broadcast(env, opportunities, now).catch((err) => console.error("broadcast failed", err));

  const last = await env.DB.prepare("SELECT MAX(t) AS t FROM snapshots").first();
  if (!last?.t || now - last.t >= SNAPSHOT_EVERY_MS) {
    const stmt = env.DB.prepare("INSERT OR REPLACE INTO snapshots (ticker, t, mid) VALUES (?, ?, ?)");
    const batch = rows.filter((r) => r.mid !== null).map((r) => stmt.bind(r.ticker, now, +r.mid.toFixed(4)));
    for (let i = 0; i < batch.length; i += 500) await env.DB.batch(batch.slice(i, i + 500));
    await env.DB.prepare("DELETE FROM snapshots WHERE t < ?").bind(now - HISTORY_KEEP_MS).run();
    await env.DB.prepare("DELETE FROM nonces WHERE expires_at < ?").bind(now).run();
  }
  return { markets: rows.length, events: events.length };
}
