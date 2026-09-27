import { CONFIG, DEFAULT_SETTINGS, normalizeCode, eventUrl, inviteUrl } from "./config.js";
import { AuthRequiredError, fetchActiveEvents, fetchReferralStatus } from "./lib/api.js";
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
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/welcome.html") });
  refresh().catch(() => {});
});

chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    scheduleAlarm();
    refresh().catch(() => {});
  }
  if (changes.unlock || changes.opportunities || changes.status) updateBadge();
});

async function getToken() {
  const { auth } = await store.get("auth");
  if (!auth || !auth.token || Date.now() >= auth.expiry) return null;
  return auth.token;
}

async function isUnlocked() {
  const { unlock } = await store.get("unlock");
  return !!unlock?.ok;
}

// ---------- Polling ----------

let inflight = null;
function refresh() {
  inflight ??= doRefresh().finally(() => (inflight = null));
  return inflight;
}

async function doRefresh() {
  const token = await getToken();
  if (!token) {
    await store.set({ status: { state: "auth", message: new AuthRequiredError().message, at: Date.now() } });
    return;
  }
  const started = Date.now();
  try {
    const settings = await getSettings();
    const events = await fetchActiveEvents(token);
    const now = Date.now();
    const rows = flattenMarkets(events, now);

    const { snapshots = [], alerts = [] } = await store.get(["snapshots", "alerts"]);
    const kept = snapshots.filter((s) => now - s.t <= SNAPSHOT_KEEP_MS);
    const base = [...kept].reverse().find((s) => now - s.t >= MOVER_LOOKBACK_MS) || kept[0];
    if (!kept.length || now - kept[kept.length - 1].t >= SNAPSHOT_EVERY_MS) {
      kept.push({ t: now, mids: snapshotMids(rows) });
    }

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

    const unlocked = await isUnlocked();
    const fired = evaluateAlerts(alerts, rows);
    if (fired.length) {
      const firedIds = new Set(fired.map((f) => f.alert.id));
      await store.set({ alerts: alerts.filter((a) => !firedIds.has(a.id)) });
      if (settings.notifyAlerts) for (const f of fired) notifyAlert(f);
    }
    if (unlocked && settings.notifySignals) await notifyNewSignals(opportunities);

    await store.set({
      rows,
      opportunities,
      snapshots: kept,
      status: {
        state: "ok",
        at: now,
        tookMs: now - started,
        events: events.length,
        markets: rows.length,
        medianSpread: median(rows.map((r) => r.spread)),
        tightMarkets: rows.filter((r) => r.spread !== null && r.spread <= 0.03).length,
      },
    });
  } catch (err) {
    const auth = err instanceof AuthRequiredError;
    if (auth) await chrome.storage.local.remove("auth");
    await store.set({ status: { state: auth ? "auth" : "error", message: err.message, at: Date.now() } });
  }
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
  const fresh = [...opps.underround, ...opps.complement].filter((o) => !notified[`${o.type}:${o.eventTicker}:${o.ticker || ""}`]);
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
  await chrome.action.setBadgeText({ text: unlock?.ok && arbs ? String(Math.min(arbs, 99)) : "" });
}

// ---------- Invite unlock ----------

function matchesReferrer(referredBy) {
  if (!referredBy) return false;
  const v = String(referredBy).trim();
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  return (code && v.toUpperCase() === code) || (CONFIG.REFERRER_WALLET && v === CONFIG.REFERRER_WALLET.trim());
}

async function verifyWallet(wallet) {
  wallet = String(wallet || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return { ok: false, reason: "That doesn't look like a Solana wallet address." };
  }
  const token = await getToken();
  if (!token) return { ok: false, reason: new AuthRequiredError().message, auth: true };
  try {
    const status = await fetchReferralStatus(wallet, token);
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
  if (unlock?.ok && Date.now() - unlock.verifiedAt > CONFIG.REVERIFY_HOURS * 3600 * 1000) {
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
    await maybeReverify();
    const { unlock } = await store.get("unlock");
    return { unlocked: !!unlock?.ok, unlock: unlock || null };
  },
  async signOut() {
    await chrome.storage.local.remove(["unlock"]);
    return { ok: true };
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
  async links() {
    return { invite: inviteUrl("/") };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, reason: e.message }));
  return true;
});

updateBadge();
