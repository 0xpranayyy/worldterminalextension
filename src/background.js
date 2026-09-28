import { CONFIG, DEFAULT_SETTINGS, DEV_BUILD, normalizeCode, eventUrl, inviteUrl } from "./config.js";
import { AuthRequiredError, fetchActiveEvents, fetchReferralStatus } from "./lib/api.js";
import { fetchBalances, matchPositions } from "./lib/portfolio.js";
import {
  flattenMarkets,
  findUnderround,
  findComplementArb,
  findNearExpiryFavorites,
  findMovers,
  snapshotMids,
  evaluateAlerts,
  median,
  marketLabel,
} from "./lib/analytics.js";

const ALARM = "world-terminal-poll";
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOT_KEEP_MS = 12 * 60 * 60 * 1000;
const MOVER_LOOKBACK_MS = 60 * 60 * 1000;
const NOTIFIED_KEEP_MS = 24 * 60 * 60 * 1000;

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

async function getSettings() {
  const { settings } = await store.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function scheduleAlarm() {
  const { refreshMinutes } = await getSettings();
  await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(0.5, refreshMinutes) });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await scheduleAlarm();
  if (reason === "install") {
    await store.set({ onboarding: { step: 0, maxStep: 0, completed: false } });
    chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/welcome.html") });
  }
  refresh().catch(() => {});
});

chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    // Only settings that change what we fetch or compute need a rescan.
    const DATA_KEYS = ["refreshMinutes", "minEdgeCents", "favoriteMinCents", "favoriteMaxHours", "moverCents"];
    // Compare with defaults filled in, so the first save of an unchanged value isn't a "change".
    const before = { ...DEFAULT_SETTINGS, ...(changes.settings.oldValue || {}) };
    const after = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    if (DATA_KEYS.some((k) => before[k] !== after[k])) {
      scheduleAlarm();
      refresh().catch(() => {});
    }
  }
  if (changes.unlock || changes.opportunities || changes.status) updateBadge();
});

async function getToken() {
  const { auth } = await store.get("auth");
  if (!auth || !auth.token || Date.now() >= auth.expiry) return null;
  return auth.token;
}

async function isUnlocked() {
  if (DEV_BUILD) return true;
  const { unlock } = await store.get("unlock");
  return !!unlock?.ok;
}

// ---------- Polling ----------

// One refresh at a time. A request that arrives mid-run (e.g. a fresh World token) queues exactly
// one more run instead of being folded into the one that started without it.
let inflight = null;
let queued = null;
function refresh() {
  if (!inflight) {
    inflight = doRefresh().finally(() => (inflight = null));
    return inflight;
  }
  queued ??= inflight.then(() => {
    queued = null;
    return refresh();
  });
  return queued;
}

async function doRefresh() {
  if (CONFIG.BACKEND_URL) {
    const served = await refreshFromBackend().catch(async (err) => {
      await store.set({ lastError: { message: `Backend: ${err.message}`, at: Date.now(), transport: "backend" } });
      return false;
    });
    if (served) return;
  }
  return refreshDirect();
}

// v1: one shared poller on the backend. Returns false when the backend can't serve data yet,
// so the caller falls back to loading World directly.
async function refreshFromBackend() {
  const { session } = await store.get("session");
  const token = session && session.exp * 1000 > Date.now() ? session.token : null;
  const res = await fetch(`${CONFIG.BACKEND_URL}/v1/feed`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return false;
  const feed = await res.json();
  if (!feed.rows?.length) return false;
  if (session) {
    const { unlock } = await store.get("unlock");
    const pro = feed.plan === "pro";
    if (!unlock || unlock.ok !== pro) await store.set({ unlock: { wallet: session.wallet, ok: pro, via: "backend", verifiedAt: Date.now() } });
  }
  await commit(feed.rows, applyThresholds(feed.opportunities, await getSettings()), { ...feed.status, total: feed.total, source: "backend" });
  return true;
}

// The backend scans with loose thresholds; narrow its signals to this user's Settings.
function applyThresholds(o, s) {
  if (!o) return o;
  const keep = (list, test) => (list || []).filter((x) => x.redacted || test(x)).slice(0, 50);
  const minEdge = s.minEdgeCents / 100;
  return {
    ...o,
    underround: keep(o.underround, (x) => x.edge >= minEdge),
    complement: keep(o.complement, (x) => x.edge >= minEdge),
    favorites: keep(o.favorites, (x) => x.price >= s.favoriteMinCents / 100 && x.hoursToClose <= s.favoriteMaxHours),
    movers: keep(o.movers, (x) => Math.abs(x.move) >= s.moverCents / 100),
  };
}

// ---------- Relay through a world.xyz tab ----------
// If World's API rejects requests that don't come from world.xyz, the same request made by the
// content script carries world.xyz's origin. We switch to that transport after a rejection while
// the token is still valid, and remember it for this service-worker lifetime.
let transport = "direct";

async function relayFetch(url, init = {}) {
  const tabs = await chrome.tabs.query({ url: "https://world.xyz/*" });
  if (!tabs.length) {
    const err = new AuthRequiredError("Keep a world.xyz tab open. World only answers requests made from its own site.");
    err.keepToken = true; // the session is fine; we just have no tab to send it through
    throw err;
  }
  let lastErr;
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "relayFetch", url, headers: init.headers || {} });
      if (res && typeof res.status === "number") return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      lastErr = err; // tab still loading or content script not injected yet
    }
  }
  throw new Error(`Couldn't reach the world.xyz tab (${lastErr?.message || "no response"}). Reload world.xyz.`);
}

// Runs an API call directly, falling back to the world.xyz tab when a valid token is rejected.
async function withTransport(call) {
  if (transport === "relay") return call(relayFetch);
  try {
    return await call(fetch);
  } catch (err) {
    // Rejected with a valid token, or blocked at the network level ("Failed to fetch").
    const retry = err instanceof AuthRequiredError || err instanceof TypeError;
    if (!retry || !(await getToken())) throw err;
    const result = await call(relayFetch);
    transport = "relay";
    return result;
  }
}

async function refreshDirect() {
  const token = await getToken();
  if (!token) {
    await store.set({ status: { state: "auth", message: new AuthRequiredError().message, at: Date.now() } });
    return;
  }
  const started = Date.now();
  try {
    const settings = await getSettings();
    const events = await withTransport((f) => fetchActiveEvents(token, undefined, f));
    const now = Date.now();
    const rows = flattenMarkets(events, now);
    const { snapshots = [] } = await store.get("snapshots");
    const base = [...snapshots].reverse().find((s) => now - s.t >= MOVER_LOOKBACK_MS) || snapshots[0];
    const minEdge = settings.minEdgeCents / 100;
    const opportunities = {
      underround: findUnderround(events, { minEdge }).slice(0, 50),
      complement: findComplementArb(rows, { minEdge }).slice(0, 50),
      favorites: findNearExpiryFavorites(rows, {
        minPrice: settings.favoriteMinCents / 100,
        maxHours: settings.favoriteMaxHours,
      }).slice(0, 50),
      movers: base ? findMovers(rows, base.mids, { minMove: settings.moverCents / 100 }).slice(0, 50) : [],
      moversSince: base ? base.t : null,
    };
    await commit(rows, opportunities, {
      state: "ok",
      at: now,
      tookMs: now - started,
      events: events.length,
      markets: rows.length,
      total: rows.length,
      source: transport === "relay" ? "relay" : "direct",
      medianSpread: median(rows.map((r) => r.spread)),
      tightMarkets: rows.filter((r) => r.spread !== null && r.spread <= 0.03).length,
    });
  } catch (err) {
    const auth = err instanceof AuthRequiredError;
    if (auth && !err.keepToken) await chrome.storage.local.remove("auth");
    const at = Date.now();
    await store.set({ status: { state: auth ? "auth" : "error", message: err.message, at }, lastError: { message: err.message, at, transport } });
  }
}

// Shared tail of both refresh paths: local price history, alerts, notifications, storage.
async function commit(rows, opportunities, status) {
  const now = Date.now();
  const settings = await getSettings();
  const { snapshots = [], alerts = [] } = await store.get(["snapshots", "alerts"]);
  const kept = snapshots.filter((s) => now - s.t <= SNAPSHOT_KEEP_MS);
  if (!kept.length || now - kept[kept.length - 1].t >= SNAPSHOT_EVERY_MS) kept.push({ t: now, mids: snapshotMids(rows) });
  // History is megabytes; only rewrite it when a snapshot was added or pruned.
  const historyChanged = kept.length !== snapshots.length || kept[kept.length - 1] !== snapshots[snapshots.length - 1];

  const fired = evaluateAlerts(alerts, rows);
  if (fired.length) {
    const firedIds = new Set(fired.map((f) => f.alert.id));
    await store.set({ alerts: alerts.filter((a) => !firedIds.has(a.id)) });
    if (settings.notifyAlerts) for (const f of fired) notifyAlert(f);
  }
  if ((await isUnlocked()) && settings.notifySignals) await notifyNewSignals(opportunities);
  await store.set({ rows, opportunities, status, ...(historyChanged ? { snapshots: kept } : {}) });
}

// ---------- Notifications & badge ----------

function notifyAlert({ alert, price, row }) {
  chrome.notifications.create(`alert:${alert.id}:${row.eventTicker}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `${alert.side} ${alert.op === "below" ? "≤" : "≥"} ${Math.round(alert.price * 100)}¢ · now ${Math.round(price * 100)}¢`,
    message: marketLabel(row),
    priority: 2,
  });
}

async function notifyNewSignals(opps) {
  const { notified = {} } = await store.get("notified");
  const now = Date.now();
  for (const k of Object.keys(notified)) if (now - notified[k] > NOTIFIED_KEEP_MS) delete notified[k];
  const fresh = [...opps.underround, ...opps.complement].filter((o) => !o.redacted && !notified[`${o.type}:${o.eventTicker}:${o.ticker || ""}`]);
  for (const o of fresh.slice(0, 3)) {
    notified[`${o.type}:${o.eventTicker}:${o.ticker || ""}`] = now;
    chrome.notifications.create(`signal:${o.type}:${o.eventTicker}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `Arbitrage +${(o.edge * 100).toFixed(1)}¢ (${o.returnPct}%)`,
      message: o.title,
      priority: 1,
    });
  }
  await store.set({ notified });
}

chrome.notifications.onClicked.addListener((id) => {
  const parts = id.split(":");
  const eventTicker = parts[2];
  if ((parts[0] === "alert" || parts[0] === "signal") && eventTicker) chrome.tabs.create({ url: eventUrl(eventTicker) });
  chrome.notifications.clear(id);
});

async function updateBadge() {
  const { status, opportunities, unlock } = await store.get(["status", "opportunities", "unlock"]);
  if (!status || status.state === "auth") {
    await chrome.action.setBadgeBackgroundColor({ color: "#E0A43B" });
    await chrome.action.setBadgeText({ text: "!" });
    return;
  }
  const arbs = (opportunities?.underround?.length || 0) + (opportunities?.complement?.length || 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#3DD68C" });
  await chrome.action.setBadgeText({ text: (unlock?.ok || DEV_BUILD) && arbs ? String(Math.min(arbs, 99)) : "" });
}

// ---------- Invite unlock ----------

function matchesReferrer(referredBy) {
  if (!referredBy) return false;
  const v = String(referredBy).trim();
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  return Boolean((code && v.toUpperCase() === code) || (CONFIG.REFERRER_WALLET && v === CONFIG.REFERRER_WALLET.trim()));
}

async function verifyWallet(wallet) {
  wallet = String(wallet || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return { ok: false, reason: "That doesn't look like a Solana wallet address." };
  }
  const token = await getToken();
  if (!token) return { ok: false, reason: new AuthRequiredError().message, auth: true };
  try {
    const status = await withTransport((f) => fetchReferralStatus(wallet, token, undefined, f));
    const ok = matchesReferrer(status.referredBy);
    await store.set({ unlock: { wallet, ok, referredBy: status.referredBy ?? null, verifiedAt: Date.now() } });
    if (ok) return { ok: true };
    return {
      ok: false,
      reason: status.referredBy
        ? "This wallet joined World with a different invite, so it can't unlock Pro."
        : "No invite confirmed yet. Open the invite link, connect this wallet on World and approve “Confirm invite”.",
    };
  } catch (err) {
    return { ok: false, reason: err.message, auth: err instanceof AuthRequiredError };
  }
}

async function maybeReverify() {
  const { unlock } = await store.get("unlock");
  // Backend unlocks are re-checked by the server on every /v1/feed call.
  if (unlock?.ok && unlock.via !== "backend" && Date.now() - unlock.verifiedAt > CONFIG.REVERIFY_HOURS * 3600 * 1000) {
    // verifyWallet only rewrites `unlock` when World answers, so outages don't relock anyone.
    await verifyWallet(unlock.wallet);
  }
}

// ---------- Messages ----------

const handlers = {
  async setToken({ token, expiry }, sender) {
    if (!sender.url?.startsWith("https://world.xyz/")) return { ok: false };
    const { auth } = await store.get("auth");
    const changed = !auth || auth.token !== token;
    await store.set({ auth: { token, expiry } });
    if (changed) refresh().catch(() => {});
    return { ok: true };
  },
  async refresh() {
    await refresh();
    return { ok: true };
  },
  async verifyWallet({ wallet }) {
    return verifyWallet(wallet);
  },
  async unlockState() {
    if (DEV_BUILD) {
      const { unlock } = await store.get("unlock");
      return { unlocked: true, dev: true, unlock: { ...(unlock || {}), wallet: unlock?.wallet || "", ok: true, via: "dev" } };
    }
    await maybeReverify();
    const { unlock } = await store.get("unlock");
    return { unlocked: !!unlock?.ok, unlock: unlock || null };
  },
  async signOut() {
    await chrome.storage.local.remove(["unlock", "session"]);
    refresh().catch(() => {});
    return { ok: true };
  },
  async connectUrl() {
    if (!CONFIG.BACKEND_URL) return { ok: false };
    const token = await getToken();
    const url = new URL("/connect", CONFIG.BACKEND_URL);
    url.searchParams.set("ext", chrome.runtime.id);
    if (token) url.hash = `wt=${encodeURIComponent(token)}`;
    return { ok: true, url: url.toString(), connected: !!token };
  },
  async portfolio({ wallet }) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(wallet || ""))) return { ok: false, reason: "Enter a Solana wallet address." };
    const settings = await getSettings();
    const { rows = [] } = await store.get("rows");
    try {
      const balances = await fetchBalances(settings.rpcUrl, wallet);
      return { ok: true, wallet, at: Date.now(), tokens: balances.length, ...matchPositions(balances, rows) };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  },
  async addAlert({ alert }) {
    const { alerts = [] } = await store.get("alerts");
    alerts.push({ ...alert, id: crypto.randomUUID(), createdAt: Date.now() });
    await store.set({ alerts });
    return { ok: true };
  },
  async removeAlert({ id }) {
    const { alerts = [] } = await store.get("alerts");
    await store.set({ alerts: alerts.filter((a) => a.id !== id) });
    return { ok: true };
  },
  async toggleWatch({ ticker }) {
    const { watchlist = [] } = await store.get("watchlist");
    const next = watchlist.includes(ticker) ? watchlist.filter((t) => t !== ticker) : [...watchlist, ticker];
    await store.set({ watchlist: next });
    return { ok: true, watching: next.includes(ticker) };
  },
  async openSidePanel(_msg, sender) {
    const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
    try {
      await chrome.sidePanel.open({ windowId });
    } catch {
      // sidePanel.open needs a user gesture; fall back to a tab when Chrome didn't forward it.
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/app.html") });
    }
    return { ok: true };
  },
  async diagnostics() {
    const d = await store.get(["status", "auth", "lastError", "rows", "snapshots", "unlock", "session", "settings"]);
    return {
      version: chrome.runtime.getManifest().version,
      build: DEV_BUILD ? "developer" : "release",
      referralCode: normalizeCode(CONFIG.REFERRAL_CODE) || null,
      backend: CONFIG.BACKEND_URL || null,
      transport,
      status: d.status || null,
      lastError: d.lastError || null,
      worldSession: d.auth ? { expiresInMin: Math.round((d.auth.expiry - Date.now()) / 60000) } : null,
      markets: d.rows?.length || 0,
      sampleMarket: d.rows?.[0] ? { ticker: d.rows[0].ticker, yesBid: d.rows[0].yesBid, yesAsk: d.rows[0].yesAsk, mints: (d.rows[0].yesMints || []).length } : null,
      snapshots: d.snapshots?.length || 0,
      unlock: d.unlock ? { ok: !!d.unlock.ok, via: d.unlock.via || "direct" } : null,
      backendSession: d.session ? { expiresAt: new Date(d.session.exp * 1000).toISOString() } : null,
      settings: d.settings || {},
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    };
  },
  async links() {
    return { invite: inviteUrl("/") };
  },
};

// The backend's /connect page hands over a signed session after the wallet signature.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!CONFIG.BACKEND_URL || sender.origin !== new URL(CONFIG.BACKEND_URL).origin || msg?.type !== "backendSession") return false;
  if (typeof msg.token !== "string" || typeof msg.wallet !== "string" || typeof msg.exp !== "number") return false;
  store
    .set({
      session: { token: msg.token, wallet: msg.wallet, exp: msg.exp },
      unlock: { wallet: msg.wallet, ok: !!msg.pro, referredBy: msg.referredBy ?? null, via: "backend", verifiedAt: Date.now() },
    })
    .then(() => {
      refresh().catch(() => {});
      sendResponse({ ok: true });
    });
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, reason: e.message }));
  return true;
});

updateBadge();
