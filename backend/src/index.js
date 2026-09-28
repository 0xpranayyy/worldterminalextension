import { poll } from "./poller.js";
import { isWallet, randomNonce, signInMessage, verifyWalletSignature, signSession, readSession } from "./auth.js";
import { connectPage } from "./connect-page.js";

const SESSION_DAYS = 30;
const NONCE_TTL_MS = 5 * 60 * 1000;
const PRO_RECHECK_MS = 24 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...headers } });
const fail = (status, error) => json({ error }, status);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function matchesReferrer(env, referredBy) {
  if (!referredBy) return false;
  const v = String(referredBy).trim();
  const code = String(env.REFERRAL_CODE || "").trim().toUpperCase();
  return Boolean((code && v.toUpperCase() === code) || (env.REFERRER_WALLET && v === env.REFERRER_WALLET.trim()));
}

async function referralStatus(env, wallet, worldToken) {
  const token = env.USERS_API_TOKEN || worldToken;
  if (!token) return { error: "World session required to check your invite. Open world.xyz, then try again." };
  const res = await fetch(`${env.USERS_API_URL}/users/${encodeURIComponent(wallet)}/referral`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401 || res.status === 403) return { error: "World session expired. Open world.xyz, then try again." };
  if (!res.ok) return { error: `World returned ${res.status}` };
  const data = await res.json();
  return { referredBy: data.referredBy ?? null };
}

async function session(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return readSession(auth.startsWith("Bearer ") ? auth.slice(7) : null, env.SESSION_SECRET);
}

// In-isolate cache so a burst of clients doesn't turn into a burst of KV reads.
let cached = { at: 0, value: null };
async function latest(env) {
  if (Date.now() - cached.at < 15000 && cached.value) return cached.value;
  const value = (await env.KV.get("latest", "json")) || null;
  cached = { at: Date.now(), value };
  return value;
}

function redact(list) {
  return (list || []).map((o) => ({ type: o.type, redacted: true }));
}

const routes = {
  "GET /v1/health": async (req, env) => {
    const l = await latest(env);
    return json({ ok: true, upstream: !!env.UPSTREAM_URL, status: l?.status ?? null });
  },

  "POST /v1/auth/nonce": async (req, env) => {
    const { wallet } = await body(req);
    if (!isWallet(wallet)) return fail(400, "Invalid Solana wallet address.");
    const nonce = randomNonce();
    const now = Date.now();
    const message = signInMessage(wallet, nonce, now);
    await env.DB.prepare("INSERT INTO nonces (nonce, wallet, message, expires_at) VALUES (?, ?, ?, ?)").bind(nonce, wallet, message, now + NONCE_TTL_MS).run();
    return json({ nonce, message });
  },

  "POST /v1/auth/verify": async (req, env) => {
    if (!env.SESSION_SECRET) return fail(500, "Server is missing SESSION_SECRET.");
    const { wallet, nonce, signature, worldToken } = await body(req);
    if (!isWallet(wallet) || !nonce || !signature) return fail(400, "wallet, nonce and signature are required.");
    const row = await env.DB.prepare("DELETE FROM nonces WHERE nonce = ? RETURNING wallet, message, expires_at").bind(nonce).first();
    if (!row || row.wallet !== wallet || row.expires_at < Date.now()) return fail(401, "Sign-in request expired. Try again.");
    if (!(await verifyWalletSignature(wallet, row.message, signature))) return fail(401, "Signature didn't match this wallet.");

    const ref = await referralStatus(env, wallet, worldToken);
    if (ref.error) return fail(502, ref.error);
    const pro = matchesReferrer(env, ref.referredBy);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO users (wallet, referred_by, pro, verified_at, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4, ?4)
       ON CONFLICT(wallet) DO UPDATE SET referred_by = ?2, pro = ?3, verified_at = ?4, last_seen = ?4`,
    )
      .bind(wallet, ref.referredBy, pro ? 1 : 0, now)
      .run();
    const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
    const token = await signSession({ sub: wallet, exp }, env.SESSION_SECRET);
    return json({ token, wallet, pro, referredBy: ref.referredBy, exp });
  },

  "GET /v1/me": async (req, env) => {
    const s = await session(req, env);
    if (!s) return fail(401, "Not signed in.");
    const user = await env.DB.prepare("SELECT wallet, referred_by, pro, verified_at FROM users WHERE wallet = ?").bind(s.sub).first();
    if (!user) return fail(401, "Unknown user.");
    return json({ wallet: user.wallet, pro: !!user.pro, referredBy: user.referred_by, verifiedAt: user.verified_at, recheckDue: Date.now() - user.verified_at > PRO_RECHECK_MS });
  },

  // Everything the extension needs in one call. Free users get the top N markets and signal counts.
  "GET /v1/feed": async (req, env) => {
    const l = await latest(env);
    if (!l?.rows) return json({ status: l?.status ?? { state: "warming" }, rows: [], opportunities: null, plan: "free", total: 0 }, 503);
    const s = await session(req, env);
    let pro = false;
    if (s) {
      const user = await env.DB.prepare("SELECT pro FROM users WHERE wallet = ?").bind(s.sub).first();
      pro = !!user?.pro;
      // Keep last_seen coarse so reads don't turn into a write per request.
      if (user && Math.random() < 0.05) await env.DB.prepare("UPDATE users SET last_seen = ? WHERE wallet = ?").bind(Date.now(), s.sub).run();
    }
    const limit = Number(env.FREE_ROW_LIMIT) || 10;
    const rows = pro ? l.rows : [...l.rows].sort((a, b) => b.score - a.score).slice(0, limit);
    const o = l.opportunities;
    const opportunities = pro
      ? o
      : { underround: redact(o.underround), complement: redact(o.complement), favorites: redact(o.favorites), movers: redact(o.movers), moversSince: o.moversSince };
    return json({ status: l.status, rows, opportunities, plan: pro ? "pro" : "free", total: l.rows.length }, 200, {
      // Response depends on who's asking; never let a browser or proxy reuse it across sessions.
      "Cache-Control": "no-store",
      Vary: "Authorization",
    });
  },

  "GET /v1/history": async (req, env) => {
    const s = await session(req, env);
    const user = s && (await env.DB.prepare("SELECT pro FROM users WHERE wallet = ?").bind(s.sub).first());
    if (!user?.pro) return fail(403, "Price history is a Pro feature.");
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker");
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours")) || 24));
    if (!ticker) return fail(400, "ticker is required.");
    const { results } = await env.DB.prepare("SELECT t, mid FROM snapshots WHERE ticker = ? AND t >= ? ORDER BY t").bind(ticker, Date.now() - hours * 3600000).all();
    return json({ ticker, points: results });
  },

  "GET /v1/stats": async (req, env) => {
    const users = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(pro) AS pro FROM users").first();
    const l = await latest(env);
    return json({ users: users.total, pro: users.pro || 0, markets: l?.status?.markets ?? 0 });
  },

  "GET /connect": async (req, env) =>
    new Response(connectPage(env), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } }),
};

// Sign-in routes get a tight per-IP limit; data routes are limited per wallet (or IP when anonymous).
async function rateLimited(request, env, pathname) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (pathname.startsWith("/v1/auth/")) {
    return env.AUTH_LIMITER ? !(await env.AUTH_LIMITER.limit({ key: `ip:${ip}` })).success : false;
  }
  if (!env.API_LIMITER || pathname === "/connect") return false;
  const s = await session(request, env);
  return !(await env.API_LIMITER.limit({ key: s ? `w:${s.sub}` : `ip:${ip}` })).success;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(request.url);
    const handler = routes[`${request.method} ${pathname}`];
    if (!handler) return fail(404, "Not found.");
    if (await rateLimited(request, env, pathname)) return json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" });
    try {
      return await handler(request, env);
    } catch (err) {
      console.error(err);
      return fail(500, "Internal error.");
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env));
  },
};
