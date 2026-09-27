import { CONFIG, normalizeCode, eventUrl, inviteUrl } from "./config.js";
import { AuthRequiredError, fetchActiveEvents, fetchReferralStatus } from "./lib/api.js";
import {
  flattenMarkets,
  findUnderround,
  findComplementArb,
  findNearExpiryFavorites,
  findMovers,
  snapshotMids,
  evaluateAlerts,
} from "./lib/analytics.js";

const ALARM = "world-terminal-poll";
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOT_KEEP_MS = 3 * 60 * 60 * 1000;
const MOVER_LOOKBACK_MS = 60 * 60 * 1000;

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj),
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM, { periodInMinutes: CONFIG.POLL_MINUTES });
  refresh().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(ALARM, { periodInMinutes: CONFIG.POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh().catch(() => {});
});

async function getToken() {
  const { auth } = await store.get("auth");
  if (!auth || !auth.token || Date.now() >= auth.expiry) return null;
  return auth.token;
}

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
  try {
    const events = await fetchActiveEvents(token);
    const now = Date.now();
    const rows = flattenMarkets(events, now);

    const { snapshots = [], alerts = [] } = await store.get(["snapshots", "alerts"]);
    const kept = snapshots.filter((s) => now - s.t <= SNAPSHOT_KEEP_MS);
    const base = kept.find((s) => now - s.t >= MOVER_LOOKBACK_MS) || kept[0];
    if (!kept.length || now - kept[kept.length - 1].t >= SNAPSHOT_EVERY_MS) {
      kept.push({ t: now, mids: snapshotMids(rows) });
    }

    const opportunities = {
      underround: findUnderround(events).slice(0, 50),
      complement: findComplementArb(rows).slice(0, 50),
      favorites: findNearExpiryFavorites(rows).slice(0, 50),
      movers: base ? findMovers(rows, base.mids).slice(0, 50) : [],
      moversSince: base ? base.t : null,
    };

    const fired = evaluateAlerts(alerts, rows);
    if (fired.length) {
      const firedIds = new Set(fired.map((f) => f.alert.id));
      await store.set({ alerts: alerts.filter((a) => !firedIds.has(a.id)) });
      for (const f of fired) notifyAlert(f);
    }

    await store.set({
      rows,
      opportunities,
      snapshots: kept,
      status: { state: "ok", at: now, events: events.length, markets: rows.length },
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) await chrome.storage.local.remove("auth");
    await store.set({
      status: { state: err instanceof AuthRequiredError ? "auth" : "error", message: err.message, at: Date.now() },
    });
  }
}

function notifyAlert({ alert, price, row }) {
  chrome.notifications.create(`alert:${alert.id}:${row.eventTicker}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `${alert.side} ${alert.op} ${Math.round(alert.price * 100)}¢ — now ${Math.round(price * 100)}¢`,
    message: `${row.eventTitle} — ${row.title}`,
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  const [kind, , eventTicker] = id.split(":");
  if (kind === "alert" && eventTicker) chrome.tabs.create({ url: eventUrl(eventTicker) });
});

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
    const unlock = { wallet, ok, referredBy: status.referredBy ?? null, verifiedAt: Date.now() };
    await store.set({ unlock });
    if (ok) return { ok: true };
    return {
      ok: false,
      reason: status.referredBy
        ? "This wallet joined World with a different invite, so it can't unlock World Terminal."
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
