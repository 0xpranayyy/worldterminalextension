import { CONFIG, DEFAULT_SETTINGS, DEV_BUILD, normalizeCode, inviteUrl, eventUrl, categoryName, WORLD_ORIGIN } from "../config.js";
import { SORTS, SCORE_WEIGHTS, scoreParts, historyFor, marketLabel } from "../lib/analytics.js";
import { drawCard, shareText, FORMATS } from "./share.js";

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

// Canvas share cards need the bundled fonts loaded before drawing.
for (const f of ['400 16px "WT Inter"', '700 16px "WT Inter"', '800 16px "WT Inter"', '600 16px "WT Mono"', '800 16px "WT Mono"']) document.fonts.load(f).catch(() => {});

const isPopup = chrome.extension.getViews({ type: "popup" }).includes(window);
// Embedded as the live preview inside the onboarding page.
const isEmbedded = window.top !== window;
if (!isPopup) document.body.classList.add("panel");
// Chrome's side panel (or the full-tab fallback): sits next to world.xyz, so it follows that tab.
const isSidePanel = !isPopup && !isEmbedded;
if (isSidePanel) document.body.classList.add("side");

const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem("wt-prefs")) || {};
  } catch {
    return {};
  }
})();
function savePrefs() {
  try {
    localStorage.setItem("wt-prefs", JSON.stringify(prefs));
  } catch {}
}

const state = {
  rows: [],
  opportunities: null,
  status: null,
  auth: null,
  watchlist: [],
  alerts: [],
  settings: { ...DEFAULT_SETTINGS },
  unlocked: false,
  unlock: null,
  loaded: false,
  tab: prefs.tab || "markets",
  signal: prefs.signal || "underround",
  sort: prefs.sort || "liquidity",
  chip: "all",
  query: "",
  selected: -1,
  sheet: null, // {type: "market"|"unlock"|"settings"|"share", ...}
  portfolio: { loading: false, data: null, error: null },
  moves: {}, // ticker -> mid change vs ~1h ago
  flash: new Map(), // ticker -> "up" | "down" for rows whose price just changed
  prevMids: null,
  ctx: null, // side panel: {tabId, eventTicker, live} for the world.xyz tab it follows
  ctxAll: false,
};

// ---------- tiny DOM helpers ----------

function h(tag, attrs = {}, ...children) {
  const n = tag === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.setAttribute("class", v);
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

const ICONS = {
  chevron: '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14.5 4.5v15" stroke="currentColor" stroke-width="1.8"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  starFill: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  crown: '<path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" fill="currentColor"/><rect x="4" y="18.5" width="16" height="2" rx="1" fill="currentColor"/>',
  radar: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 12 18 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  share: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  spread: '<path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 8v8" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2.5"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  split: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5v17" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" opacity=".35"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  trend: '<path d="M4 16l5-5 3.5 3.5L20 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5.5M12 7.8v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  server: '<rect x="4" y="4.5" width="16" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="4" y="13.5" width="16" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 7.5h.01M7.5 16.5h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12 16 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  globe: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="1.7"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 9.5h17M16 14h1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (name) => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", html: ICONS[name] });

const cents = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);
const cents1 = (p) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`);
const compact = (n) => (n ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : "0");

function closesIn(hours) {
  if (hours === null || hours === undefined) return "";
  if (hours < 0) return "closed";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function ago(t) {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function ring(score) {
  const r = 14.5;
  const c = 2 * Math.PI * r;
  const color = score >= 65 ? "var(--yes)" : score >= 35 ? "var(--accent)" : "var(--no)";
  return h(
    "div",
    { class: "ring", title: `Liquidity score ${score}/100` },
    h("svg", {
      viewBox: "0 0 34 34",
      html: `<circle class="track" cx="17" cy="17" r="${r}" fill="none" stroke-width="2.5"/><circle cx="17" cy="17" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}"/>`,
    }),
    h("span", {}, String(score)),
  );
}

// ---------- header, live line, KPIs, banner ----------

function renderHeader() {
  $("#btn-refresh").replaceChildren(icon("refresh"));
  $("#btn-panel").replaceChildren(icon("panel"));
  $("#btn-settings").replaceChildren(icon("gear"));
  $("#btn-panel").hidden = !isPopup;
  $("#plan").replaceChildren(
    DEV_BUILD ? h("span", { class: "dev-chip", title: "No invite code set: Pro is unlocked for testing" }, "DEV") : state.unlocked ? h("span", { class: "pro-chip" }, "PRO") : h("span", { class: "free-chip" }, "FREE"),
  );
}

function renderLive() {
  const s = state.status;
  const el = $("#live");
  const left = h("div", { class: "sb-left" });
  if (!state.loaded) left.append(h("span", { class: "dot off" }), "Loading…");
  else if (!s || s.state === "auth") left.append(h("span", { class: "dot warn" }), "Not connected to World");
  else if (s.state === "error") left.append(h("span", { class: "dot warn" }), `Retrying · last update ${ago(state.rowsAt)}`);
  else {
    const src = { relay: "via world.xyz", backend: "cloud" }[s.source];
    left.append(h("span", { class: "dot" }), h("b", {}, "Live"), h("span", { class: "sb-sep" }), `${compact(s.markets)} markets`, h("span", { class: "sb-sep" }), ago(s.at));
    if (src) left.append(h("span", { class: "sb-sep" }), src);
  }
  el.replaceChildren(left, h("div", { class: "sb-right" }, h("kbd", {}, "/"), "search", h("kbd", {}, "R"), "refresh"));
}

function renderKpis() {
  const s = state.status?.state === "ok" ? state.status : null;
  const o = state.opportunities;
  const arbs = o ? o.underround.length + o.complement.length : 0;
  const signals = o ? arbs + o.favorites.length + o.movers.length : 0;
  const tile = (ic, label, value, sub, { hot = false, onclick } = {}) =>
    h(
      onclick ? "button" : "div",
      { class: `kpi${hot ? " hot" : ""}${onclick ? " click" : ""}`, onclick },
      h("div", { class: "kpi-label" }, icon(ic), label),
      h("div", { class: "kpi-value" }, value),
      h("div", { class: "kpi-sub" }, sub),
    );
  $("#kpis").replaceChildren(
    tile("grid", "Markets", s ? compact(s.total || s.markets) : "—", s ? `${compact(s.tightMarkets)} tight ≤3¢` : "live on World", {
      onclick: s
        ? () => {
            state.chip = "tight";
            setTab("markets");
            renderChips();
          }
        : null,
    }),
    tile("spread", "Spread", s?.medianSpread != null ? cents1(s.medianSpread) : "—", "median YES"),
    tile("bolt", "Signals", o ? String(signals) : "—", o ? (arbs ? `${arbs} arbitrage live` : "no arbitrage now") : "scanning", {
      hot: arbs > 0,
      onclick: o ? () => setTab("signals") : null,
    }),
  );
}

function renderBanner() {
  const b = $("#banner");
  const ob = state.onboarding;
  if (ob && !ob.completed && !isEmbedded) {
    b.replaceChildren(
      h(
        "div",
        { class: "banner setup" },
        h("div", { class: "setup-ring", style: `--p:${Math.round(((ob.maxStep || 0) / 5) * 100)}` }, h("span", {}, `${Math.min(5, (ob.maxStep || 0) + 1)}/5`)),
        h("div", { class: "banner-text" }, h("b", {}, "Finish setting up"), "Connect World, unlock Pro and pick your markets."),
        h("button", { class: "btn primary", onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/welcome.html") }) }, "Continue"),
      ),
    );
    return;
  }
  if (state.loaded && (!state.status || state.status.state === "auth")) {
    b.replaceChildren(
      h(
        "div",
        { class: "banner connect" },
        h(
          "div",
          { class: "banner-text" },
          h("b", {}, "Connect to World"),
          state.status?.message && /tab open/.test(state.status.message) ? state.status.message : "Open world.xyz once in a tab. World Terminal picks up your session.",
        ),
        h("a", { class: "btn primary", href: WORLD_ORIGIN, target: "_blank", rel: "noopener" }, "Open"),
      ),
    );
    return;
  }
  if (!state.unlocked) {
    b.replaceChildren(
      h(
        "div",
        { class: "banner" },
        h("div", { class: "banner-text" }, h("b", {}, "Unlock Pro, free"), "Every market, arbitrage signals, alerts."),
        h("button", { class: "btn gold", onclick: () => openSheet({ type: "unlock" }) }, "Unlock"),
      ),
    );
    return;
  }
  b.replaceChildren();
}

// ---------- side panel: ticker tape + the world.xyz tab it follows ----------

function eventFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.origin !== WORLD_ORIGIN) return null;
    const m = u.pathname.match(/^\/event\/([^/?#]+)/);
    return { eventTicker: m ? decodeURIComponent(m[1]) : null };
  } catch {
    return null;
  }
}

// The active tab if it's world.xyz, otherwise the world.xyz event tab used most recently.
// Tab URLs are only visible for world.xyz (host permission), which is all we need.
async function trackTab() {
  if (!isSidePanel) return;
  let ctx = null;
  try {
    const win = await chrome.windows.getCurrent();
    const [active] = await chrome.tabs.query({ active: true, windowId: win.id });
    const hit = active?.url && eventFromUrl(active.url);
    if (hit) ctx = { tabId: active.id, eventTicker: hit.eventTicker, live: true };
    else {
      const recent = (await chrome.tabs.query({ url: "https://world.xyz/event/*" })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      const ev = recent && eventFromUrl(recent.url);
      if (ev?.eventTicker) ctx = { tabId: recent.id, eventTicker: ev.eventTicker, live: false };
    }
  } catch {
    ctx = null;
  }
  const changed = JSON.stringify(ctx) !== JSON.stringify(state.ctx);
  if (changed && ctx?.eventTicker !== state.ctx?.eventTicker) state.ctxAll = false;
  state.ctx = ctx;
  if (changed) renderContext();
}

function eventArb(eventTicker, rows) {
  const o = state.opportunities;
  if (!o) return null;
  const u = o.underround?.find((x) => x.eventTicker === eventTicker);
  if (u) return { edge: u.edge, returnPct: u.returnPct, label: "outcome set" };
  const tickers = new Set(rows.map((r) => r.ticker));
  const c = o.complement?.find((x) => tickers.has(x.ticker));
  return c ? { edge: c.edge, returnPct: c.returnPct, label: "YES+NO" } : null;
}

function ctxRow(r) {
  const price = r.yesAsk ?? r.mid;
  const pct = Math.round((price ?? 0) * 100);
  return h(
    "button",
    { class: "orow", title: marketLabel(r), onclick: () => openSheet({ type: "market", ticker: r.ticker }) },
    h("span", { class: "o-fill", style: `width:${pct}%` }),
    h("span", { class: "o-name" }, state.watchlist.includes(r.ticker) ? h("span", { class: "star" }, "★") : null, r.title),
    changePill(r.ticker),
    h("span", { class: "o-price num" }, cents(price)),
  );
}

function renderContext() {
  const box = $("#context");
  const c = state.ctx;
  if (!isSidePanel || !c) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const hint = (title, text) => box.replaceChildren(h("div", { class: "ctx-hint" }, icon("globe"), h("span", {}, h("b", {}, title), text)));
  if (!c.eventTicker) return hint("world.xyz is open", "Open any event and its outcomes show up here.");
  const rows = state.rows.filter((r) => r.eventTicker === c.eventTicker).sort((a, b) => (b.yesAsk ?? b.mid ?? 0) - (a.yesAsk ?? a.mid ?? 0));
  if (!rows.length) return hint(state.rows.length ? "Event not in the live feed" : "Waiting for market data", state.rows.length ? "It may be closed or not listed yet." : "Outcomes appear once World Terminal connects.");

  const first = rows[0];
  const arb = eventArb(c.eventTicker, rows);
  const collapsed = !!prefs.ctxCollapsed;
  const avgLiq = Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);
  const vol = rows.reduce((s, r) => s + (r.volume || 0), 0);
  const hours = rows.map((r) => r.hoursToClose).filter((x) => x !== null && x !== undefined);
  const toggle = () => {
    prefs.ctxCollapsed = !collapsed;
    savePrefs();
    renderContext();
  };

  const head = h(
    "button",
    { class: "ctx-head", "aria-expanded": String(!collapsed), onclick: toggle },
    avatar(first),
    h(
      "div",
      { class: "ctx-main" },
      h("div", { class: "ctx-eyebrow" }, h("span", { class: `dot${c.live ? "" : " off"}` }), c.live ? "On this page" : "Last viewed on world.xyz"),
      h("div", { class: "ctx-title" }, first.eventTitle || first.title),
    ),
    arb ? h("span", { class: "ctx-arb" }, icon("bolt"), `+${cents1(arb.edge)}`) : null,
    h("span", { class: "ctx-chev" }, icon("chevron")),
  );
  const card = h("section", { class: `ctx${collapsed ? " collapsed" : ""}${arb ? " hot" : ""}` }, head);

  if (!collapsed) {
    const stat = (k, v, cls = "") => h("div", {}, h("span", {}, k), h("b", { class: `num ${cls}` }, v));
    card.append(
      h(
        "div",
        { class: "ctx-stats" },
        stat("Outcomes", String(rows.length)),
        stat("Liquidity", String(avgLiq), avgLiq >= 65 ? "yes" : avgLiq < 35 ? "no" : ""),
        stat("Volume", compact(vol)),
        stat("Closes", hours.length ? closesIn(Math.min(...hours)).replace(/^in /, "") : "–"),
      ),
    );
    if (arb) {
      card.append(
        h("div", { class: "ctx-callout" }, icon("bolt"), h("span", { title: `Arbitrage on the ${arb.label}` }, h("b", {}, `+${cents1(arb.edge)} per $1`), ` · ${arb.returnPct}% return`), h("button", { class: "linkish", onclick: () => setTab("signals") }, "Details")),
      );
    }
    const limit = state.unlocked ? (state.ctxAll ? rows.length : 5) : 2;
    const list = h("div", { class: "ctx-list" }, ...rows.slice(0, limit).map(ctxRow));
    card.append(list);
    const foot = h("div", { class: "ctx-foot" });
    if (!state.unlocked && rows.length > limit) {
      foot.append(h("button", { class: "btn gold sm", onclick: () => openSheet({ type: "unlock" }) }, icon("crown"), `Unlock all ${rows.length} outcomes`));
    } else if (rows.length > 5) {
      foot.append(
        h(
          "button",
          {
            class: "linkish",
            onclick: () => {
              state.ctxAll = !state.ctxAll;
              renderContext();
            },
          },
          state.ctxAll ? "Show fewer" : `Show all ${rows.length}`,
        ),
      );
    }
    if (!c.live) foot.append(h("button", { class: "linkish", onclick: () => chrome.tabs.update(c.tabId, { active: true }).catch(() => {}) }, "Go to tab"));
    if (foot.childNodes.length) card.append(foot);
  }
  box.replaceChildren(card);
}

function renderTape() {
  const el = $("#tape");
  if (!isSidePanel) return;
  const byTicker = new Map(state.rows.map((r) => [r.ticker, r]));
  const items = Object.entries(state.moves)
    .filter(([t, d]) => Math.abs(d) >= 0.01 && byTicker.has(t))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 12)
    .map(([t, d]) => [byTicker.get(t), d]);
  if (items.length < 3) {
    el.hidden = true;
    return;
  }
  // Rebuilding restarts the scroll animation, so only rebuild when the content changes.
  const key = items.map(([r, d]) => `${r.ticker}:${Math.round(d * 100)}:${cents(r.yesAsk ?? r.mid)}`).join();
  if (el.dataset.key === key && !el.hidden) return;
  el.dataset.key = key;
  const item = ([r, d], copy) =>
    h(
      "button",
      { class: "tk", title: marketLabel(r), tabindex: copy ? "-1" : null, "aria-hidden": copy ? "true" : null, onclick: () => openSheet({ type: "market", ticker: r.ticker }) },
      avatar(r, "xs"),
      h("span", { class: "tk-t" }, r.title),
      h("span", { class: "num tk-p" }, cents(r.yesAsk ?? r.mid)),
      h("span", { class: `num ${d > 0 ? "yes" : "no"}` }, `${d > 0 ? "▲" : "▼"}${Math.abs(Math.round(d * 100))}¢`),
    );
  el.replaceChildren(
    h("span", { class: "tape-label" }, icon("trend"), "1h"),
    h("div", { class: "tape-track" }, h("div", { class: "tape-run", style: `--dur:${items.length * 5}s` }, ...items.map((x) => item(x, false)), ...items.map((x) => item(x, true)))),
  );
  el.hidden = false;
}

if (isSidePanel) {
  let t;
  const again = () => {
    clearTimeout(t);
    t = setTimeout(trackTab, 120);
  };
  chrome.tabs.onActivated.addListener(again);
  chrome.tabs.onUpdated.addListener((_id, info) => (info.url || info.status === "complete") && again());
  chrome.tabs.onRemoved.addListener(again);
  chrome.windows.onFocusChanged.addListener(again);
  trackTab();

  // Links to world.xyz drive the tab next to the panel instead of piling up new tabs.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="https://world.xyz"]');
    if (!a || !state.ctx?.live || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    chrome.tabs.update(state.ctx.tabId, { url: a.href }).catch(() => chrome.tabs.create({ url: a.href }));
  });
}

// ---------- tabs ----------

function renderTabs() {
  const buttons = [...document.querySelectorAll("#tabs button")];
  buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const active = buttons.find((b) => b.dataset.tab === state.tab);
  const ink = $("#tab-ink");
  if (active) {
    ink.style.left = `${active.offsetLeft}px`;
    ink.style.width = `${active.offsetWidth}px`;
  }
  const o = state.opportunities;
  const arbs = o ? o.underround.length + o.complement.length : 0;
  const cs = $("#count-signals");
  cs.textContent = arbs ? String(arbs) : "";
  cs.classList.toggle("hot", arbs > 0);
  $("#count-watch").textContent = state.watchlist.length ? String(state.watchlist.length) : "";
  $("#toolbar-markets").hidden = state.tab !== "markets";
  $("#chips").hidden = state.tab !== "markets";
  $("#signal-chips").hidden = state.tab !== "signals";
}

function setTab(tab) {
  state.tab = prefs.tab = tab;
  state.selected = -1;
  savePrefs();
  renderTabs();
  renderView();
  $("#scroll").scrollTop = 0;
}

// ---------- markets ----------

const QUICK = [
  { id: "all", label: "All", test: () => true },
  { id: "tight", label: "Tight ≤3¢", test: (r) => r.spread !== null && r.spread <= 0.03 },
  { id: "soon", label: "Closing <24h", test: (r) => r.hoursToClose !== null && r.hoursToClose > 0 && r.hoursToClose < 24 },
];

function renderChips() {
  const cats = new Map();
  for (const r of state.rows) if (r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1);
  const fav = new Set(state.settings.favoriteCategories || []);
  const top = [...cats.entries()].sort((a, b) => fav.has(b[0]) - fav.has(a[0]) || b[1] - a[1]).slice(0, 8);
  const chip = (id, label, n) =>
    h(
      "button",
      {
        class: `chip${state.chip === id ? " on" : ""}`,
        onclick: () => {
          state.chip = state.chip === id && id !== "all" ? "all" : id;
          state.selected = -1;
          renderChips();
          renderView();
        },
      },
      label,
      n ? h("span", { class: "n" }, compact(n)) : null,
    );
  $("#chips").replaceChildren(
    ...QUICK.map((q) => chip(q.id, q.label)),
    ...top.map(([c, n]) => chip(`cat:${c}`, categoryName(c), n)),
  );
}

function filteredRows() {
  const q = state.query.trim().toLowerCase();
  const quick = QUICK.find((x) => x.id === state.chip);
  const cat = state.chip.startsWith("cat:") ? state.chip.slice(4) : null;
  return state.rows
    .filter(
      (r) =>
        (!quick || quick.test(r)) &&
        (!cat || r.category === cat) &&
        (!q || `${r.eventTitle} ${r.title} ${r.ticker}`.toLowerCase().includes(q)),
    )
    .sort(SORTS[state.sort] || SORTS.liquidity);
}

// Event image, or a monogram tinted by a hash of the event so each event keeps its color.
function avatar(r, size = "") {
  const seed = [...(r.eventTicker || r.ticker || "")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hue = seed % 360;
  const letters = (r.eventTitle || r.title || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const mono = h("span", { class: `avatar mono ${size}`, style: `--h:${hue}` }, letters || "?");
  if (!r.imageUrl) return mono;
  const img = h("img", { class: `avatar ${size}`, src: r.imageUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(mono), { once: true });
  return img;
}

function changePill(ticker) {
  const d = state.moves[ticker];
  if (d === undefined || Math.abs(d) < 0.005) return null;
  return h("span", { class: `chg ${d > 0 ? "up" : "down"}` }, `${d > 0 ? "▲" : "▼"}${Math.abs(Math.round(d * 100)) || "<1"}¢`);
}

function marketRow(r, i) {
  const spreadClass = r.spread === null ? "" : r.spread <= 0.03 ? "sp-tight" : r.spread >= 0.08 ? "sp-wide" : "";
  const watching = state.watchlist.includes(r.ticker);
  const sub = [r.eventTitle !== r.title ? r.eventTitle : null, r.hoursToClose !== null ? closesIn(r.hoursToClose) : null, `vol ${compact(r.volume)}`]
    .filter(Boolean)
    .join(" · ");
  const price = r.yesAsk ?? r.mid;
  const flash = state.flash.get(r.ticker);
  return h(
    "button",
    { class: `mrow${state.selected === i ? " sel" : ""}${flash ? ` flash-${flash}` : ""}`, "data-i": i, onclick: () => openSheet({ type: "market", ticker: r.ticker }) },
    avatar(r),
    h(
      "div",
      { class: "m-main" },
      h("div", { class: "m-title", title: marketLabel(r) }, watching ? h("span", { class: "star" }, "★") : null, r.title),
      h("div", { class: "m-meta" }, sub),
    ),
    h(
      "div",
      { class: "m-price" },
      h("div", { class: "m-top" }, changePill(r.ticker), h("span", { class: "m-yes" }, cents(price))),
      h("div", { class: "prob", title: `${Math.round((price ?? 0) * 100)}% implied` }, h("span", { style: `width:${Math.round((price ?? 0) * 100)}%` })),
      h("div", { class: "m-book" }, `${cents(r.yesBid)}–${cents(r.yesAsk)} · `, h("span", { class: spreadClass }, cents(r.spread))),
    ),
    // Extra columns, shown only when the side panel is wide enough.
    h(
      "div",
      { class: "m-ext" },
      h("span", { class: spreadClass }, cents1(r.spread)),
      h("span", {}, compact(r.volume)),
      h("span", {}, r.hoursToClose !== null ? closesIn(r.hoursToClose).replace(/^in /, "") : "–"),
    ),
    ring(r.score),
  );
}

function skeleton(n = 7) {
  return Array.from({ length: n }, () => h("div", { class: "skel" }));
}

function renderMarkets(view) {
  if (!state.rows.length) {
    if (state.status?.state === "auth" || !state.status) {
      view.append(emptyState("radar", "No market data yet", "Open world.xyz once so World Terminal can connect."));
    } else view.append(...skeleton());
    return;
  }
  let rows = filteredRows();
  const total = rows.length;
  if (!rows.length) {
    view.append(emptyState("radar", "No markets match", "Try another filter or search."));
    return;
  }
  const limit = state.unlocked ? 300 : CONFIG.FREE_ROW_LIMIT;
  rows = rows.slice(0, limit);
  // With the backend, free users only receive the top rows; the full count comes from status.total.
  const hidden = Math.max(total, state.status?.total || 0) - rows.length;
  view.append(
    h("div", { class: "section-label" }, h("span", {}, `${compact(Math.max(total, state.status?.total || 0))} markets`), h("span", {}, $("#sort").selectedOptions[0]?.textContent || "")),
    h("div", { class: "mhead", "aria-hidden": "true" }, h("span", {}, "Market"), h("span", {}, "YES"), h("span", { class: "m-ext" }, h("span", {}, "Spread"), h("span", {}, "Volume"), h("span", {}, "Closes")), h("span", {}, "Liq")),
    ...rows.map(marketRow),
  );
  if (!state.unlocked && hidden > 0 && !state.query && state.chip === "all") {
    const preview = filteredRows().slice(limit, limit + 3);
    view.append(
      preview.length ? h("div", { class: "blur" }, ...preview.map((r, i) => marketRow(r, limit + i))) : null,
      gate(`${compact(hidden)} more markets`, "Pro shows every market on World, ranked live."),
    );
  }
}

// ---------- signals ----------

const SIGNALS = [
  { id: "underround", label: "Outcomes", icon: "layers", help: "Buy YES on every outcome for less than the $1 payout. Risk-free only if exactly one outcome must win, so read the rules." },
  { id: "complement", label: "YES + NO", icon: "split", help: "YES ask + NO ask under $1 on the same market: buy both and one side pays $1." },
  { id: "favorites", label: "Favorites", icon: "clock", help: "Outcomes priced 85–98.5¢ that close soon. Small, fast returns, but you lose the stake if wrong." },
  { id: "movers", label: "Movers", icon: "trend", help: "The biggest mid-price moves over roughly the last hour." },
];

function renderSignalChips() {
  const o = state.opportunities || {};
  $("#signal-chips").replaceChildren(
    h(
      "div",
      { class: "sig-tabs", role: "tablist" },
      ...SIGNALS.map((s) => {
        const n = (o[s.id] || []).length;
        const arb = s.id === "underround" || s.id === "complement";
        return h(
          "button",
          {
            role: "tab",
            "aria-selected": String(state.signal === s.id),
            class: `sig-tab${state.signal === s.id ? " on" : ""}${arb && n ? " live" : ""}`,
            onclick: () => {
              state.signal = prefs.signal = s.id;
              savePrefs();
              renderSignalChips();
              renderView();
            },
          },
          h("span", { class: "sig-tab-top" }, icon(s.icon), h("b", { class: "num" }, o[s.id] ? String(n) : "–")),
          h("span", { class: "sig-tab-label" }, s.label),
        );
      }),
    ),
  );
}

// Visual that explains each signal at a glance.
function signalVisual(o) {
  if (o.type === "underround" && o.legs?.length) {
    const segs = o.legs.map((l, i) => h("span", { class: `seg s${Math.min(i, 5)}`, style: `width:${(l.ask * 100).toFixed(2)}%`, title: `${l.title} ${cents(l.ask)}` }));
    const top = o.legs.slice(0, 3).map((l) => `${l.title} ${cents(l.ask)}`).join(" · ") + (o.legs.length > 3 ? ` · +${o.legs.length - 3} more` : "");
    return h(
      "div",
      { class: "viz" },
      h("div", { class: "stack" }, ...segs, h("span", { class: "seg edge-seg", style: `width:${(o.edge * 100).toFixed(2)}%` }), h("i", { class: "one" })),
      h("div", { class: "viz-legend" }, h("span", { class: "ellip" }, top), h("span", { class: "num yes" }, `${cents1(o.cost)} → $1`)),
    );
  }
  if (o.type === "complement") {
    const yes = o.yesAsk ?? o.cost / 2;
    return h(
      "div",
      { class: "viz" },
      h("div", { class: "stack" }, h("span", { class: "seg yes-seg", style: `width:${(yes * 100).toFixed(2)}%` }), h("span", { class: "seg no-seg", style: `width:${((o.cost - yes) * 100).toFixed(2)}%` }), h("span", { class: "seg edge-seg", style: `width:${(o.edge * 100).toFixed(2)}%` }), h("i", { class: "one" })),
      h("div", { class: "viz-legend" }, h("span", {}, "YES + NO"), h("span", { class: "num yes" }, `${cents1(o.cost)} → $1`)),
    );
  }
  if (o.type === "favorite") {
    return h(
      "div",
      { class: "viz" },
      h("div", { class: "track" }, h("span", { class: "fill", style: `width:${(o.price * 100).toFixed(1)}%` })),
      h("div", { class: "viz-legend" }, h("span", {}, `${o.side} at ${cents(o.price)} · pays $1`), h("span", { class: "num" }, `${o.hoursToClose}h left`)),
    );
  }
  if (o.type === "mover") {
    const lo = Math.min(o.from, o.to);
    const hi = Math.max(o.from, o.to);
    return h(
      "div",
      { class: "viz" },
      h(
        "div",
        { class: "track" },
        h("span", { class: `range ${o.move > 0 ? "up" : "down"}`, style: `left:${(lo * 100).toFixed(1)}%;width:${Math.max(1, (hi - lo) * 100).toFixed(1)}%` }),
        h("i", { class: "dot-from", style: `left:${(o.from * 100).toFixed(1)}%` }),
        h("i", { class: `dot-to ${o.move > 0 ? "up" : "down"}`, style: `left:${(o.to * 100).toFixed(1)}%` }),
      ),
      h("div", { class: "viz-legend" }, h("span", {}, `${cents(o.from)} → ${cents(o.to)}`), h("span", { class: "num" }, "last hour")),
    );
  }
  return null;
}

function signalCard(o, { hero = false } = {}) {
  if (o.redacted) {
    return h(
      "div",
      { class: "scard" },
      h("div", { class: "s-head" }, h("span", { class: "avatar mono", style: "--h:220" }, "?"), h("div", { class: "s-main" }, h("div", { class: "s-title" }, "Pro signal"), h("div", { class: "s-sub" }, "Unlock to see this opportunity")), h("div", { class: "s-edge" }, h("b", {}, "+?¢"), h("small", {}, "edge"))),
      h("div", { class: "viz" }, h("div", { class: "stack" }, h("span", { class: "seg s0", style: "width:45%" }), h("span", { class: "seg s1", style: "width:30%" }), h("span", { class: "seg s2", style: "width:20%" }))),
    );
  }
  const row = o.ticker ? state.rows.find((r) => r.ticker === o.ticker) : null;
  const av = avatar(row || { eventTicker: o.eventTicker, eventTitle: o.title, title: o.title, imageUrl: o.imageUrl });
  let big, small, tone = "";
  const pills = [];
  if (o.type === "underround" || o.type === "complement") {
    big = `+${cents1(o.edge)}`;
    small = "per $1";
    pills.push(h("span", { class: "pill good" }, `${o.returnPct}% return`));
    if (o.type === "underround") pills.push(h("span", { class: "pill" }, `${o.outcomes} outcomes`));
    if (o.closeMs) pills.push(h("span", { class: "pill" }, `closes ${closesIn((o.closeMs - Date.now()) / 3600000)}`));
  } else if (o.type === "favorite") {
    big = `${o.returnPct}%`;
    small = "if right";
    tone = "accent";
    pills.push(h("span", { class: "pill" }, `${o.side} ${cents(o.price)}`), h("span", { class: "pill" }, `liq ${o.score}`));
  } else {
    const up = o.move > 0;
    big = `${up ? "+" : "−"}${Math.abs(Math.round(o.move * 100))}¢`;
    small = "1h move";
    tone = up ? "" : "down";
    pills.push(h("span", { class: `pill ${up ? "good" : "bad"}` }, up ? "rising" : "falling"));
  }
  const open = () => (o.ticker ? openSheet({ type: "market", ticker: o.ticker }) : chrome.tabs.create({ url: eventUrl(o.eventTicker) }));
  const share = h(
    "button",
    {
      class: "icon-btn s-share",
      title: "Share",
      "aria-label": "Share this signal",
      onclick: (e) => {
        e.stopPropagation();
        openSheet({ type: "share", kind: "signal", signal: o });
      },
    },
    icon("share"),
  );
  const subtitle = row && row.eventTitle !== row.title ? row.eventTitle : o.type === "underround" ? "Multi-outcome event" : categoryName(row?.category || "");
  return h(
    "div",
    { class: `scard${hero ? " top-pick" : ""}`, role: "button", tabindex: "0", onclick: open, onkeydown: (e) => e.key === "Enter" && open() },
    hero ? h("div", { class: "hero-eyebrow" }, icon("bolt"), "Best right now") : null,
    h(
      "div",
      { class: "s-head" },
      av,
      h("div", { class: "s-main" }, h("div", { class: "s-title" }, row ? row.title : o.title), h("div", { class: "s-sub" }, subtitle)),
      h("div", { class: `s-edge ${tone}` }, h("b", {}, big), h("small", {}, small)),
    ),
    signalVisual(o),
    h("div", { class: "s-foot" }, h("div", { class: "pills" }, ...pills), share),
  );
}

function renderSignals(view) {
  const def = SIGNALS.find((s) => s.id === state.signal) || SIGNALS[0];
  view.append(h("div", { class: "sig-help" }, icon("info"), h("span", {}, def.help)));
  if (!state.opportunities) {
    view.append(...(state.status?.state === "ok" ? skeleton(4) : [emptyState("radar", "Waiting for World data", "Signals appear after the first scan.")]));
    return;
  }
  const list = state.opportunities[def.id] || [];
  if (!list.length) {
    view.append(
      h(
        "div",
        { class: "scanning" },
        h("div", { class: "radar", "aria-hidden": "true" }, h("i"), h("i"), h("span", { class: "sweep" })),
        h("b", {}, "Nothing right now"),
        h("span", {}, `Scanning ${compact(state.status?.markets || state.rows.length)} markets every ${state.settings.refreshMinutes} min.`),
        state.settings.notifySignals ? null : h("button", { class: "linkish", onclick: () => openSheet({ type: "settings" }) }, "Get notified when one appears"),
      ),
    );
    return;
  }
  if (!state.unlocked) {
    view.append(
      h("div", { class: "blur" }, ...list.slice(0, 2).map((o) => signalCard(o))),
      gate(`${list.length} live signal${list.length === 1 ? "" : "s"} found`, "Unlock Pro to see them and get notified the moment new ones appear."),
    );
    return;
  }
  view.append(signalCard(list[0], { hero: true }));
  if (list.length > 1) view.append(h("div", { class: "section-label" }, h("span", {}, `${list.length - 1} more`), h("span", {}, "by edge")), ...list.slice(1).map((o) => signalCard(o)));
}

// ---------- watchlist ----------

// Tiny 12h mid-price line for list rows.
function miniSpark(r, w = 64, hgt = 24) {
  const pts = historyFor(r.ticker, state.snapshots, { t: state.status?.at || Date.now(), mid: r.mid });
  if (pts.length < 2) return h("span", { class: "mini-spark empty" });
  const vals = pts.map((p) => p.mid);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 0.01) {
    lo -= 0.005;
    hi += 0.005;
  }
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2;
  const y = (v) => hgt - 3 - ((v - lo) / (hi - lo)) * (hgt - 6);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.mid).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const c = up ? "#3dd68c" : "#ff6b6b";
  const last = pts[pts.length - 1];
  return h("svg", {
    class: "mini-spark",
    viewBox: `0 0 ${w} ${hgt}`,
    width: w,
    height: hgt,
    "aria-hidden": "true",
    html: `<path d="${line} L${x(last.t).toFixed(1)},${hgt} L2,${hgt} Z" fill="${c}" opacity=".12"/><path d="${line}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(last.t).toFixed(1)}" cy="${y(last.mid).toFixed(1)}" r="2.2" fill="${c}"/>`,
  });
}

function watchRow(r) {
  const price = r.yesAsk ?? r.mid;
  return h(
    "button",
    { class: "wrow", onclick: () => openSheet({ type: "market", ticker: r.ticker }) },
    avatar(r),
    h("div", { class: "m-main" }, h("div", { class: "m-title" }, r.title), h("div", { class: "m-meta" }, [r.eventTitle !== r.title ? r.eventTitle : categoryName(r.category), r.hoursToClose !== null ? closesIn(r.hoursToClose) : null].filter(Boolean).join(" · "))),
    miniSpark(r),
    h("div", { class: "w-price" }, h("span", { class: "m-yes" }, cents(price)), changePill(r.ticker) || h("span", { class: "chg flat" }, "—")),
  );
}

function alertCard(a, r) {
  const now = r ? (a.side === "NO" ? r.noAsk : r.yesAsk) : null;
  // Distance to the trigger in cents; the bar fills as the price closes in (20¢ window).
  const dist = now === null ? null : a.op === "below" ? now - a.price : a.price - now;
  const progress = dist === null ? 0 : Math.max(0.04, Math.min(1, 1 - dist / 0.2));
  const near = dist !== null && dist <= 0.02;
  return h(
    "div",
    { class: `acard${near ? " near" : ""}` },
    h(
      "div",
      { class: "a-head" },
      h("span", { class: "a-bell" }, icon("bell")),
      h("div", { class: "m-main" }, h("div", { class: "m-title", title: a.title }, r ? r.title : a.title), h("div", { class: "m-meta" }, r && r.eventTitle !== r.title ? r.eventTitle : "Price alert")),
      h(
        "button",
        {
          class: "icon-btn",
          title: "Delete alert",
          "aria-label": "Delete alert",
          onclick: async () => {
            await send({ type: "removeAlert", id: a.id });
            toast("Alert deleted");
          },
        },
        icon("trash"),
      ),
    ),
    h(
      "div",
      { class: "a-body" },
      h("div", { class: "a-target" }, h("span", { class: `side-pill ${a.side === "YES" ? "yes" : "no"}` }, a.side), h("span", { class: "num" }, `${a.op === "below" ? "≤" : "≥"} ${cents(a.price)}`)),
      h("div", { class: "a-track" }, h("span", { style: `width:${(progress * 100).toFixed(0)}%` })),
      h("div", { class: "a-now num" }, `now ${cents(now)}`),
    ),
    h("div", { class: "a-foot" }, dist === null ? "Market not live" : dist <= 0 ? "Triggering on next refresh" : `${Math.round(dist * 100) || "<1"}¢ away`, h("span", { class: `pill ${near ? "good" : ""}` }, near ? "close" : "armed")),
  );
}

function renderWatch(view) {
  if (!state.unlocked) {
    view.append(gate("Watchlist & price alerts", "Star markets, set YES/NO price alerts, get desktop notifications."));
    return;
  }
  const byTicker = new Map(state.rows.map((r) => [r.ticker, r]));
  const watched = state.watchlist.map((t) => byTicker.get(t)).filter(Boolean);
  const biggest = watched.map((r) => ({ r, d: state.moves[r.ticker] ?? 0 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  view.append(
    h(
      "div",
      { class: "summary" },
      h("div", {}, h("div", { class: "sum-k" }, "Watching"), h("div", { class: "sum-v num" }, String(watched.length))),
      h("div", {}, h("div", { class: "sum-k" }, "Alerts armed"), h("div", { class: "sum-v num" }, String(state.alerts.length))),
      h(
        "div",
        {},
        h("div", { class: "sum-k" }, "Top mover"),
        biggest && Math.abs(biggest.d) >= 0.005
          ? h("div", { class: `sum-v num ${biggest.d > 0 ? "yes" : "no"}` }, `${biggest.d > 0 ? "+" : "−"}${Math.abs(Math.round(biggest.d * 100)) || "<1"}¢`)
          : h("div", { class: "sum-v num faint" }, "—"),
        biggest && Math.abs(biggest.d) >= 0.005 ? h("div", { class: "sum-sub" }, biggest.r.title) : null,
      ),
    ),
  );
  view.append(h("div", { class: "section-label" }, h("span", {}, "Watching"), h("span", {}, "12h")));
  view.append(
    ...(watched.length
      ? watched.map(watchRow)
      : [h("div", { class: "empty-card" }, h("span", { class: "empty-ic" }, icon("star")), h("b", {}, "Nothing starred yet"), h("span", {}, "Open any market and tap Watch to track it here."), h("button", { class: "btn", onclick: () => setTab("markets") }, "Browse markets"))]),
  );
  view.append(h("div", { class: "section-label" }, h("span", {}, "Price alerts"), h("span", {}, state.settings.notifyAlerts ? "notifications on" : "notifications off")));
  if (!state.alerts.length) {
    view.append(h("div", { class: "empty-card" }, h("span", { class: "empty-ic" }, icon("bell")), h("b", {}, "No alerts yet"), h("span", {}, "Open a market and set a YES or NO price. We'll notify you when it hits.")));
    return;
  }
  for (const a of state.alerts) view.append(alertCard(a, byTicker.get(a.ticker)));
}

// ---------- portfolio ----------

const usd = (n) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ALLOC = ["#7c9cff", "#3dd68c", "#c9a45c", "#e57bc3", "#5cc8e0", "#a78bfa"];

function portfolioWallet() {
  return prefs.portfolioWallet || state.unlock?.wallet || "";
}

async function loadPortfolio(wallet = portfolioWallet()) {
  if (!wallet) return;
  state.portfolio = { ...state.portfolio, loading: true, error: null };
  if (state.tab === "portfolio") renderView();
  const res = await send({ type: "portfolio", wallet });
  state.portfolio = res.ok ? { loading: false, data: res, error: null } : { loading: false, data: state.portfolio.data, error: res.reason };
  if (state.tab === "portfolio") renderView();
}

function walletForm() {
  const input = h("input", { type: "text", id: "pf-wallet", placeholder: "Solana wallet address", spellcheck: "false", autocomplete: "off", value: prefs.portfolioWallet || "" });
  return h(
    "div",
    { class: "empty-card wallet-card" },
    h("span", { class: "empty-ic" }, icon("wallet")),
    h("b", {}, "Track your World positions"),
    h("span", {}, "Enter the wallet you trade with. Read-only: we only look at public balances."),
    h(
      "form",
      {
        class: "pf-form",
        onsubmit: (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return toast("That doesn't look like a Solana address");
          prefs.portfolioWallet = v;
          savePrefs();
          state.portfolioEditing = false;
          state.portfolio = { loading: false, data: null, error: null };
          loadPortfolio();
        },
      },
      input,
      h("button", { class: "btn primary", type: "submit" }, "Load"),
    ),
  );
}

function renderPortfolio(view) {
  if (!state.unlocked) {
    view.append(gate("Portfolio", "See every World position you hold, what it would sell for right now, and which ones are hard to exit."));
    return;
  }
  const p = state.portfolio;
  const wallet = portfolioWallet();
  if (!wallet || state.portfolioEditing) {
    view.append(walletForm());
    return;
  }
  if (!p.data && !p.error && !p.loading) {
    loadPortfolio();
    view.append(...skeleton(4));
    return;
  }
  const d = p.data;
  view.append(
    h(
      "div",
      { class: "wallet-bar" },
      h("span", { class: "wb-ic" }, icon("wallet")),
      h("span", { class: "num wb-addr", title: wallet }, `${wallet.slice(0, 4)}…${wallet.slice(-4)}`),
      h(
        "button",
        {
          class: "linkish",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(wallet);
              toast("Address copied");
            } catch {}
          },
        },
        "Copy",
      ),
      h(
        "button",
        {
          class: "linkish",
          onclick: () => {
            state.portfolioEditing = true;
            renderView();
          },
        },
        "Change",
      ),
      h("span", { class: "wb-spacer" }),
      h("button", { class: "icon-btn", title: "Refresh positions", "aria-label": "Refresh positions", disabled: p.loading, onclick: () => loadPortfolio() }, icon("refresh")),
    ),
  );
  if (p.error) view.append(h("div", { class: "pf-error" }, p.error));
  if (!d) {
    if (p.loading) view.append(...skeleton(4));
    return;
  }
  const upside = d.maxPayout - d.exitValue;
  const total = d.exitValue || 1;
  view.append(
    h(
      "div",
      { class: "pf-hero" },
      h("div", { class: "pf-k" }, "Exit value", h("span", { class: "faint" }, ` · updated ${ago(d.at)}`)),
      h("div", { class: "pf-v num" }, usd(d.exitValue)),
      h(
        "div",
        { class: "pf-stats" },
        h("div", {}, h("span", {}, "If all win"), h("b", { class: "num" }, usd(d.maxPayout))),
        h("div", {}, h("span", {}, "Upside"), h("b", { class: "num yes" }, `+${usd(upside)}`)),
        h("div", {}, h("span", {}, "Positions"), h("b", { class: "num" }, String(d.positions.length))),
      ),
      d.positions.length
        ? h(
            "div",
            { class: "alloc", title: "Allocation by exit value" },
            ...d.positions.map((pos, i) => h("span", { style: `width:${((pos.exitValue / total) * 100).toFixed(2)}%;background:${ALLOC[i % ALLOC.length]}`, title: `${pos.title} ${usd(pos.exitValue)}` })),
          )
        : null,
      d.thinCount ? h("div", { class: "pf-warn" }, icon("info"), `${d.thinCount} position${d.thinCount === 1 ? " is" : "s are"} hard to exit right now`) : null,
    ),
  );
  if (!d.positions.length) {
    view.append(h("div", { class: "empty-card" }, h("span", { class: "empty-ic" }, icon("radar")), h("b", {}, "No open World positions"), h("span", {}, d.tokens ? `This wallet holds ${d.tokens} tokens, none in live World markets.` : "Positions show up here after you trade on World.")));
    return;
  }
  view.append(h("div", { class: "section-label" }, h("span", {}, "Positions"), h("span", {}, "by value")));
  d.positions.forEach((pos, i) => {
    const r = state.rows.find((x) => x.ticker === pos.ticker);
    const share = d.exitValue ? (pos.exitValue / d.exitValue) * 100 : 0;
    view.append(
      h(
        "button",
        { class: "pcard", onclick: () => openSheet({ type: "market", ticker: pos.ticker }) },
        h("span", { class: "pc-swatch", style: `background:${ALLOC[i % ALLOC.length]}` }),
        avatar(r || pos),
        h(
          "div",
          { class: "m-main" },
          h("div", { class: "m-title" }, h("span", { class: `side-pill ${pos.side === "YES" ? "yes" : "no"}` }, pos.side), pos.title),
          h("div", { class: "m-meta" }, [`${pos.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`, pos.hoursToClose !== null ? closesIn(pos.hoursToClose) : null, `${share.toFixed(0)}%`].filter(Boolean).join(" · ")),
          h("div", { class: "prob wide" }, h("span", { style: `width:${Math.round((pos.mark ?? 0) * 100)}%` })),
        ),
        h(
          "div",
          { class: "w-price" },
          h("span", { class: "m-yes" }, usd(pos.exitValue)),
          pos.thin ? h("span", { class: "pill bad" }, "thin") : h("span", { class: "m-book" }, `bid ${cents(pos.bid)}`),
        ),
      ),
    );
  });
  if (d.thinCount) view.append(h("p", { class: "sig-help" }, icon("info"), h("span", {}, "“Thin” means no buyer right now or a spread of 6¢+. Selling early may cost more than the quote suggests.")));
}

function emptyState(ic, title, text) {
  return h("div", { class: "empty" }, icon(ic), h("b", {}, title), h("span", {}, text));
}

function gate(title, text) {
  return h(
    "div",
    { class: "gate" },
    h("div", { class: "hero-badge", style: "width:40px;height:40px;border-radius:12px" }, icon("crown")),
    h("h3", {}, title),
    h("p", {}, text),
    h("button", { class: "btn gold", onclick: () => openSheet({ type: "unlock" }) }, "Unlock Pro, free"),
  );
}

function renderView() {
  const view = h("div");
  if (state.tab === "markets") renderMarkets(view);
  if (state.tab === "signals") renderSignals(view);
  if (state.tab === "watch") renderWatch(view);
  if (state.tab === "portfolio") renderPortfolio(view);
  view.append(h("div", { class: "foot" }, "Not affiliated with World · Not financial advice · Links include our invite code"));
  $("#view").replaceWith(Object.assign(view, { id: "view" }));
}

// ---------- sheets ----------

function openSheet(sheet) {
  state.sheet = sheet;
  renderSheet(true);
}

function closeSheet() {
  state.sheet = null;
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
}

$("#backdrop").addEventListener("click", closeSheet);

function sheetHead(title, sub) {
  return h(
    "div",
    { class: "sheet-head" },
    h("div", { style: "min-width:0" }, h("h2", {}, title), sub ? h("p", {}, sub) : null),
    h("button", { class: "icon-btn", "aria-label": "Close", onclick: closeSheet }, icon("close")),
  );
}

function renderSheet(fresh = false) {
  const s = state.sheet;
  if (!s) return;
  const el = $("#sheet");
  // Background refreshes re-render; keep typed input and scroll inside forms.
  if (!fresh && el.contains(document.activeElement) && document.activeElement.matches("input, select")) return;
  let body;
  if (s.type === "market") body = marketSheet(s.ticker);
  else if (s.type === "unlock") body = unlockSheet();
  else if (s.type === "settings") body = settingsSheet();
  else if (s.type === "share") body = shareSheet(s);
  if (!body) return closeSheet();
  const scroll = el.scrollTop;
  el.replaceChildren(...[body].flat());
  el.hidden = false;
  $("#backdrop").hidden = false;
  if (!fresh) el.scrollTop = scroll;
  else el.scrollTop = 0;
}

function sparkline(points) {
  const W = 340;
  const H = 76;
  if (points.length < 2) {
    return h("svg", { viewBox: `0 0 ${W} ${H}`, html: `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" fill="#6a727e" font-size="11">Price history builds up every 10 minutes</text>` });
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const vals = points.map((p) => p.mid);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 0.02) {
    lo -= 0.01;
    hi += 0.01;
  }
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 8) + 4;
  const y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.mid).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#3dd68c" : "#ff6b6b";
  const last = points[points.length - 1];
  return h("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    html: `<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="M4,${(H / 2).toFixed(0)} H${W - 4}" stroke="rgba(255,255,255,.06)" stroke-dasharray="3 4"/>
      <path d="${line} L${x(last.t).toFixed(1)},${H} L4,${H} Z" fill="url(#sg)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last.t).toFixed(1)}" cy="${y(last.mid).toFixed(1)}" r="3.2" fill="${color}"/>`,
  });
}

function marketSheet(ticker) {
  const r = state.rows.find((x) => x.ticker === ticker);
  if (!r) return null;
  const watching = state.watchlist.includes(r.ticker);
  const hist = historyFor(r.ticker, state.snapshots, { t: state.status?.at || Date.now(), mid: r.mid });
  const first = hist[0]?.mid;
  const change = first != null && r.mid != null ? r.mid - first : null;
  const parts = scoreParts(r);
  const closeDate = r.closeMs ? new Date(r.closeMs).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const bar = (label, v, w) =>
    h(
      "div",
      { class: "bar" },
      h("span", {}, label, h("span", { class: "faint" }, ` ${Math.round(w * 100)}%`)),
      h("div", { class: "track" }, h("div", { class: "fill", style: `width:${Math.round(v * 100)}%` })),
      h("span", { class: "pct" }, String(Math.round(v * 100))),
    );

  const alertForm = h(
    "form",
    {
      class: "alert-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const price = Number(f.price.value);
        if (!(price >= 1 && price <= 99)) return toast("Enter a price from 1 to 99¢");
        await send({
          type: "addAlert",
          alert: { ticker: r.ticker, eventTicker: r.eventTicker, title: marketLabel(r), side: f.side.value, op: f.op.value, price: price / 100 },
        });
        toast("Alert set");
        f.reset();
      },
    },
    h("select", { name: "side", "aria-label": "Side" }, h("option", {}, "YES"), h("option", {}, "NO")),
    h("select", { name: "op", "aria-label": "Condition" }, h("option", { value: "below" }, "ask ≤"), h("option", { value: "above" }, "ask ≥")),
    h("input", { name: "price", type: "number", min: "1", max: "99", step: "1", placeholder: `e.g. ${Math.round((r.yesAsk ?? 0.5) * 100)}¢`, "aria-label": "Price in cents" }),
    h("button", { class: "btn", type: "submit" }, icon("bell"), "Set"),
  );

  return [
    h(
      "div",
      { class: "sheet-head" },
      h("div", { class: "sheet-title" }, avatar(r, "lg"), h("div", { style: "min-width:0" }, h("h2", {}, r.title), h("p", {}, r.eventTitle !== r.title ? r.eventTitle : categoryName(r.category)))),
      h("button", { class: "icon-btn", "aria-label": "Close", onclick: closeSheet }, icon("close")),
    ),
    h(
      "div",
      { class: "spark" },
      h(
        "div",
        { class: "spark-head" },
        h("span", { class: "spark-price" }, cents1(r.mid)),
        change !== null && hist.length > 1
          ? h("span", { class: `spark-change ${change > 0 ? "yes" : change < 0 ? "no" : "faint"}` }, `${change >= 0 ? "+" : "−"}${cents1(Math.abs(change))} · ${ago(hist[0].t).replace(" ago", "")}`)
          : h("span", { class: "spark-change faint" }, "mid price"),
      ),
      sparkline(hist),
      h("div", { class: "spark-foot" }, h("span", {}, hist.length > 1 ? new Date(hist[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""), h("span", {}, "now")),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h(
        "div",
        { class: "book" },
        h("div", { class: "side y" }, h("div", { class: "lbl yes" }, "YES"), h("div", { class: "ask num" }, cents(r.yesAsk)), h("div", { class: "bid" }, `bid ${cents(r.yesBid)}`)),
        h("div", { class: "side n" }, h("div", { class: "lbl no" }, "NO"), h("div", { class: "ask num" }, cents(r.noAsk)), h("div", { class: "bid" }, `bid ${cents(r.noBid)}`)),
      ),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Spread"), h("div", { class: `v ${r.spread !== null && r.spread <= 0.03 ? "yes" : r.spread >= 0.08 ? "no" : ""}` }, cents1(r.spread))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Liquidity score"), h("div", { class: "v" }, `${r.score}/100`)),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Volume"), h("div", { class: "v" }, compact(r.volume))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Open interest"), h("div", { class: "v" }, compact(r.openInterest))),
        h("div", { class: "stat", style: "grid-column: span 2" }, h("div", { class: "k" }, "Closes"), h("div", { class: "v" }, `${closeDate} · ${closesIn(r.hoursToClose)}`)),
      ),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h("div", { class: "label" }, "Why this score"),
      h("div", { class: "bars" }, bar("Tight spread", parts.tight, SCORE_WEIGHTS.tight), bar("Volume", parts.vol, SCORE_WEIGHTS.vol), bar("Open interest", parts.oi, SCORE_WEIGHTS.oi)),
    ),
    state.unlocked ? h("div", { class: "sheet-section" }, h("div", { class: "label" }, "Price alert"), alertForm) : null,
    h(
      "div",
      { class: "actions" },
      h("a", { class: "btn primary lg", href: eventUrl(r.eventTicker), target: "_blank", rel: "noopener" }, "Trade on World", icon("external")),
      state.unlocked
        ? h(
            "button",
            {
              class: `btn lg${watching ? " on" : ""}`,
              onclick: async () => {
                const res = await send({ type: "toggleWatch", ticker: r.ticker });
                toast(res.watching ? "Added to watchlist" : "Removed from watchlist");
              },
            },
            icon(watching ? "starFill" : "star"),
            watching ? "Watching" : "Watch",
          )
        : h("button", { class: "btn lg gold", onclick: () => openSheet({ type: "unlock" }) }, icon("crown"), "Pro"),
      h("button", { class: "btn lg", title: "Share", onclick: () => openSheet({ type: "share", kind: "market", ticker: r.ticker }) }, icon("share"), "Share"),
    ),
  ];
}

function shareSheet(s) {
  const data = { kind: s.kind };
  if (s.kind === "market") {
    const r = state.rows.find((x) => x.ticker === s.ticker);
    if (!r) return null;
    Object.assign(data, { row: r, history: historyFor(r.ticker, state.snapshots, { t: state.status?.at || Date.now(), mid: r.mid }) });
    data.link = eventUrl(r.eventTicker);
  } else {
    data.signal = s.signal;
    data.link = eventUrl(s.signal.eventTicker);
  }
  data.invite = data.link;
  data.format = prefs.shareFormat || "landscape";
  const canvas = drawCard(document.createElement("canvas"), data);
  const formatSwitch = h(
    "div",
    { class: "seg share-format", role: "group", "aria-label": "Image size" },
    ...Object.entries(FORMATS).map(([id, f]) =>
      h(
        "button",
        {
          "aria-pressed": String(data.format === id),
          title: f.label,
          onclick: () => {
            prefs.shareFormat = id;
            savePrefs();
            renderSheet(true);
          },
        },
        id === "square" ? "Square" : "Landscape",
      ),
    ),
  );
  const text = shareText(data);
  const blob = () => new Promise((res) => canvas.toBlob(res, "image/png"));
  const intent = `https://x.com/intent/post?${new URLSearchParams({ text, url: data.link })}`;
  return [
    sheetHead("Share", "Every share carries your invite link."),
    h("div", { class: "share-top" }, formatSwitch, h("span", { class: "faint num" }, `${canvas.width}×${canvas.height}`)),
    h("img", { class: `share-preview ${data.format}`, src: canvas.toDataURL("image/png"), alt: text }),
    h("p", { class: "share-text" }, text),
    h(
      "div",
      { class: "share-actions" },
      h("a", { class: "btn primary lg", href: intent, target: "_blank", rel: "noopener" }, "Post on X"),
      h(
        "button",
        {
          class: "btn lg",
          onclick: async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
              toast("Image copied");
            } catch {
              toast("Couldn't copy. Use Download");
            }
          },
        },
        "Copy image",
      ),
      h(
        "button",
        {
          class: "btn lg",
          onclick: async () => {
            const url = URL.createObjectURL(await blob());
            const a = h("a", { href: url, download: `world-terminal-${(s.ticker || s.signal?.eventTicker || "signal").toLowerCase()}-${data.format}.png` });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        "Download",
      ),
      h(
        "button",
        {
          class: "btn lg",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(`${text} ${data.link}`);
              toast("Text and link copied");
            } catch {
              toast("Couldn't copy");
            }
          },
        },
        "Copy text",
      ),
    ),
  ];
}

function unlockSheet() {
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  if (state.unlocked) {
    const w = state.unlock?.wallet || "";
    const line = DEV_BUILD
      ? "Developer build: no invite code is set, so Pro is unlocked for testing. Add your code in src/config.js before publishing."
      : `Wallet ${w.slice(0, 4)}…${w.slice(-4)} joined World with our invite.`;
    return [
      sheetHead("World Terminal Pro", DEV_BUILD ? "Developer build" : "Active"),
      h("div", { class: "hero" }, h("div", { class: "hero-badge" }, icon("crown")), h("h2", {}, "You're on Pro"), h("p", {}, line)),
      perks(),
    ];
  }
  const msg = h("div", { class: "msg" });
  const signIn = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        const res = await send({ type: "connectUrl" });
        if (!res?.ok) return;
        if (!res.connected) {
          msg.className = "msg warn";
          msg.textContent = "Open world.xyz once first so World Terminal can check your invite.";
          return;
        }
        chrome.tabs.create({ url: res.url });
      },
    },
    "Sign in with wallet",
    icon("external"),
  );
  const input = h("input", { type: "text", id: "wallet", placeholder: "Solana wallet address", value: state.unlock?.wallet || "", spellcheck: "false", autocomplete: "off" });
  const verify = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        verify.disabled = true;
        verify.textContent = "Checking…";
        msg.textContent = "";
        const res = await send({ type: "verifyWallet", wallet: input.value });
        verify.disabled = false;
        verify.textContent = "Verify";
        if (res.ok) {
          toast("Pro unlocked");
          return;
        }
        msg.className = "msg no";
        msg.textContent = res.reason;
      },
    },
    "Verify",
  );
  return [
    sheetHead("", null),
    h(
      "div",
      { class: "hero" },
      h("div", { class: "hero-badge" }, icon("crown")),
      h("h2", {}, "Unlock World Terminal Pro"),
      h("p", {}, "Free for everyone who joins World through our invite link."),
    ),
    perks(),
    h(
      "div",
      { class: "steps" },
      h(
        "div",
        { class: "step" },
        h("div", { class: "step-n" }, "1"),
        h(
          "div",
          {},
          h("h4", {}, "Join World with our invite"),
          h("p", {}, code ? `Invite code ${code}` : "Opens world.xyz"),
          h("div", { class: "row" }, h("a", { class: "btn gold", href: inviteUrl("/"), target: "_blank", rel: "noopener" }, "Open invite link", icon("external"))),
        ),
      ),
      h(
        "div",
        { class: "step" },
        h("div", { class: "step-n" }, "2"),
        h("div", {}, h("h4", {}, "Connect your wallet and confirm"), h("p", {}, "When World shows “Confirm your invite”, approve the signature. That's what makes the invite count.")),
      ),
      h(
        "div",
        { class: "step" },
        h("div", { class: "step-n" }, "3"),
        CONFIG.BACKEND_URL
          ? h("div", {}, h("h4", {}, "Sign in with your wallet"), h("p", {}, "Sign a free message with the wallet you used on World. Pro turns on automatically."), h("div", { class: "row" }, signIn), msg)
          : h("div", {}, h("h4", {}, "Verify your wallet"), h("p", {}, "Paste the wallet you used on World."), h("div", { class: "row" }, input, verify), msg),
      ),
    ),
    h("p", { class: "fineprint" }, "World allows one invite per wallet. Wallets that joined with another invite can't unlock Pro."),
  ];
}

function perks() {
  const li = (b, t) => h("li", {}, icon("check"), h("span", {}, h("b", {}, b), ` ${t}`));
  return h(
    "ul",
    { class: "perks" },
    li("Every market", "ranked live by liquidity, spread and depth"),
    li("Arbitrage radar", "outcome sets and YES+NO pairs priced under $1"),
    li("Alerts", "price alerts and new-signal notifications"),
    li("On-page stats", "spread and liquidity right on world.xyz"),
  );
}

function settingsSheet() {
  const s = state.settings;
  let savedTimer;
  const save = async (patch, quiet = false) => {
    Object.assign(state.settings, patch);
    await chrome.storage.local.set({ settings: { ...state.settings } });
    if (!quiet) {
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => toast("Saved"), 250);
    }
  };
  const sw = (key) =>
    h("label", { class: "switch" }, h("input", { type: "checkbox", id: `set-${key}`, checked: !!s[key], onchange: (e) => save({ [key]: e.target.checked }) }), h("span"));
  // − value + stepper with a unit; saves after the user stops clicking.
  const stepper = (key, { min, max, step = 1, unit = "" }) => {
    const out = h("output", { class: "num", id: `set-${key}` });
    const show = () => (out.textContent = `${+Number(s[key]).toFixed(step < 1 ? 1 : 0)}${unit}`);
    let t;
    const bump = (dir) => {
      const v = Math.min(max, Math.max(min, +(Number(s[key]) + dir * step).toFixed(2)));
      s[key] = v;
      show();
      clearTimeout(t);
      t = setTimeout(() => save({ [key]: v }), 450);
    };
    show();
    return h(
      "div",
      { class: "stepper" },
      h("button", { "aria-label": "Decrease", onclick: () => bump(-1) }, "−"),
      out,
      h("button", { "aria-label": "Increase", onclick: () => bump(1) }, "+"),
    );
  };
  const segmented = (key, values, fmt) =>
    h(
      "div",
      { class: "seg", role: "group" },
      ...values.map((v) =>
        h(
          "button",
          {
            "aria-pressed": String(s[key] === v),
            onclick: (e) => {
              for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
              save({ [key]: v });
            },
          },
          fmt(v),
        ),
      ),
    );
  const row = (ic, k, hint, control) =>
    h("div", { class: "set-row" }, h("span", { class: "set-ic" }, icon(ic)), h("div", { class: "set-text" }, h("div", { class: "k" }, k), hint ? h("div", { class: "h" }, hint) : null), control);
  const section = (title, ...rows) => h("div", { class: "sheet-section" }, h("div", { class: "label" }, title), h("div", { class: "set-group" }, ...rows));

  const auth = state.auth;
  const connected = auth && auth.expiry > Date.now();
  const hoursLeft = connected ? Math.max(1, Math.round((auth.expiry - Date.now()) / 3600000)) : 0;
  const st = state.status;
  const source = { direct: "World API", relay: "via world.xyz tab", backend: "World Terminal cloud" }[st?.source];

  const planCard = DEV_BUILD
    ? h("div", { class: "acct-card dev" }, h("span", { class: "acct-badge" }, icon("crown")), h("div", {}, h("div", { class: "acct-k" }, "Plan"), h("b", {}, "Developer"), h("span", {}, "Pro unlocked for testing")))
    : state.unlocked
    ? h(
        "div",
        { class: "acct-card pro" },
        h("span", { class: "acct-badge" }, icon("crown")),
        h("div", {}, h("div", { class: "acct-k" }, "Plan"), h("b", {}, "Pro"), h("span", { class: "num" }, state.unlock?.wallet ? `${state.unlock.wallet.slice(0, 4)}…${state.unlock.wallet.slice(-4)}` : "Active")),
      )
    : h(
        "button",
        { class: "acct-card free", onclick: () => openSheet({ type: "unlock" }) },
        h("span", { class: "acct-badge" }, icon("crown")),
        h("div", {}, h("div", { class: "acct-k" }, "Plan"), h("b", {}, "Free"), h("span", { class: "gold-text" }, "Unlock Pro →")),
      );
  const connCard = h(
    connected ? "div" : "a",
    connected ? { class: "acct-card conn ok" } : { class: "acct-card conn", href: WORLD_ORIGIN, target: "_blank", rel: "noopener" },
    h("span", { class: "acct-badge" }, h("span", { class: `dot ${connected ? "" : "warn"}` })),
    h("div", {}, h("div", { class: "acct-k" }, "World"), h("b", {}, connected ? "Connected" : "Not connected"), h("span", {}, connected ? `${source || "Live"} · ${hoursLeft}h left` : "Open world.xyz →")),
  );

  return [
    sheetHead("Settings", `World Terminal ${chrome.runtime.getManifest().version}${DEV_BUILD ? " · developer build" : ""}`),
    h("div", { class: "acct" }, planCard, connCard),
    section(
      "Data",
      row("refresh", "Refresh markets", "How often World is rescanned", segmented("refreshMinutes", [1, 2, 5, 10], (v) => `${v}m`)),
      row(
        "server",
        "Solana RPC",
        "Reads your positions for Portfolio",
        h("input", {
          type: "text",
          id: "set-rpc",
          class: "rpc",
          value: s.rpcUrl,
          spellcheck: "false",
          onchange: (e) => {
            const v = e.target.value.trim();
            if (/^https:\/\/\S+$/.test(v)) save({ rpcUrl: v });
            else {
              e.target.value = s.rpcUrl;
              toast("Enter an https:// RPC URL");
            }
          },
        }),
      ),
    ),
    section(
      "Notifications",
      row("bell", "Price alerts", "When an outcome hits your price", sw("notifyAlerts")),
      row("bolt", "New arbitrage", "The moment a new one appears · Pro", sw("notifySignals")),
    ),
    section(
      "Signal thresholds",
      row("layers", "Minimum arbitrage edge", "Profit per $1 set", stepper("minEdgeCents", { min: 0.1, max: 10, step: 0.1, unit: "¢" })),
      row("clock", "Favorites priced from", "Lowest price counted", stepper("favoriteMinCents", { min: 70, max: 98, unit: "¢" })),
      row("clock", "Favorites closing within", "Time to close", stepper("favoriteMaxHours", { min: 1, max: 168, unit: "h" })),
      row("trend", "Mover threshold", "Move in about an hour", stepper("moverCents", { min: 1, max: 30, unit: "¢" })),
    ),
    section(
      "Shortcuts",
      h(
        "div",
        { class: "keys-grid" },
        ...[
          [["Alt", "W"], "Open World Terminal"],
          [["/"], "Search markets"],
          [["↑", "↓"], "Move through markets"],
          [["Enter"], "Open market"],
          [["R"], "Refresh"],
          [["Esc"], "Close"],
        ].map(([keys, label]) => h("div", { class: "key-row" }, h("span", {}, label), h("span", { class: "keys" }, ...keys.map((k) => h("kbd", {}, k))))),
      ),
    ),
    diagnosticsSection(),
    section(
      "About",
      row("globe", "Replay setup", "Walk through onboarding again", h("button", { class: "btn", onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/welcome.html") }) }, "Open")),
      row("shield", "Privacy", "What World Terminal stores and sends", h("a", { class: "btn", href: "https://github.com/0xpranayyy/worldterminalextension/blob/main/PRIVACY.md", target: "_blank", rel: "noopener" }, "Read")),
      row("info", "Help & feedback", "Report a bug or ask a question", h("a", { class: "btn", href: "https://github.com/0xpranayyy/worldterminalextension/issues", target: "_blank", rel: "noopener" }, "Contact")),
      state.unlocked && !DEV_BUILD
        ? row(
            "wallet",
            "Sign out",
            "Back to the Free plan on this browser",
            h(
              "button",
              {
                class: "btn",
                onclick: async () => {
                  await send({ type: "signOut" });
                  toast("Signed out");
                },
              },
              "Sign out",
            ),
          )
        : null,
    ),
    h("p", { class: "fineprint" }, "Not affiliated with World. Nothing here is financial advice. Links to world.xyz include our invite code."),
  ];
}

function diagnosticsSection() {
  const st = state.status;
  const source = { direct: "World API", relay: "World API via world.xyz tab", backend: "World Terminal cloud" }[st?.source] || "—";
  const left = state.auth ? state.auth.expiry - Date.now() : 0;
  const kv = (k, v, cls = "") => h("div", { class: "diag-row" }, h("span", { class: "faint" }, k), h("span", { class: `num ${cls}` }, v));
  return h(
    "div",
    { class: "sheet-section" },
    h(
      "details",
      { class: "diag-box" },
      h("summary", {}, h("span", { class: "set-ic" }, icon("gauge")), h("span", {}, "Diagnostics"), h("span", { class: `diag-state ${st?.state === "ok" ? "yes" : "warn"}` }, st?.state === "ok" ? "All good" : st?.state || "idle")),
      h(
        "div",
        { class: "diag" },
        kv("State", st?.state || "not started", st?.state === "ok" ? "yes" : "warn"),
        kv("Data source", source),
        kv("Last update", st?.at ? ago(st.at) : "never"),
        kv("Markets", String(state.rows.length)),
        kv("World session", state.auth ? (left > 0 ? (left > 90 * 60000 ? `${Math.round(left / 3600000)}h left` : `${Math.round(left / 60000)} min left`) : "expired") : "not connected", left > 0 ? "" : "warn"),
        st?.state && st.state !== "ok" ? kv("Error", st.message || "—", "no") : null,
      ),
      h(
        "button",
        {
          class: "btn block",
          onclick: async () => {
            const info = await send({ type: "diagnostics" });
            try {
              await navigator.clipboard.writeText("World Terminal debug info\n" + JSON.stringify(info, null, 2));
              toast("Debug info copied");
            } catch {
              toast("Couldn't copy");
            }
          },
        },
        "Copy debug info",
      ),
      h("p", { class: "fineprint", style: "text-align:left;margin:8px 2px 0" }, "Never includes your World session token or wallet keys."),
    ),
  );
}

// ---------- events ----------

document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  state.selected = -1;
  renderView();
});
$("#sort").value = state.sort;
$("#sort").addEventListener("change", (e) => {
  state.sort = prefs.sort = e.target.value;
  savePrefs();
  renderView();
});

async function doRefresh() {
  const b = $("#btn-refresh");
  b.classList.add("spin");
  b.disabled = true;
  await send({ type: "refresh" });
  b.classList.remove("spin");
  b.disabled = false;
}
$("#btn-refresh").addEventListener("click", doRefresh);
$("#btn-panel").addEventListener("click", async () => {
  await send({ type: "openSidePanel" });
  if (isPopup) window.close();
});
$("#btn-settings").addEventListener("click", () => openSheet({ type: "settings" }));

document.addEventListener("keydown", (e) => {
  const typing = e.target.matches("input, select, textarea");
  if (e.key === "Escape") {
    if (state.sheet) {
      closeSheet();
      e.preventDefault();
    } else if (typing) e.target.blur();
    return;
  }
  if (typing || state.sheet) return;
  if (e.key === "/") {
    e.preventDefault();
    if (state.tab !== "markets") setTab("markets");
    $("#search").focus();
  } else if (e.key === "r" || e.key === "R") doRefresh();
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const rows = [...document.querySelectorAll("#view .mrow")].filter((r) => !r.closest(".blur"));
    if (!rows.length) return;
    e.preventDefault();
    state.selected = Math.max(0, Math.min(rows.length - 1, state.selected + (e.key === "ArrowDown" ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle("sel", i === state.selected));
    rows[state.selected].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && state.selected >= 0) {
    document.querySelectorAll("#view .mrow")[state.selected]?.click();
  }
});

// ---------- data ----------

function renderAll() {
  renderHeader();
  renderLive();
  renderKpis();
  renderBanner();
  renderTape();
  renderContext();
  renderTabs();
  renderChips();
  renderSignalChips();
  renderView();
  renderSheet();
}

async function load() {
  const [data, unlock] = await Promise.all([
    chrome.storage.local.get(["rows", "opportunities", "status", "watchlist", "alerts", "settings", "snapshots", "auth", "onboarding"]),
    send({ type: "unlockState" }).catch(() => null),
  ]);
  Object.assign(state, {
    rows: data.rows || [],
    rowsAt: data.status?.state === "ok" ? data.status.at : state.rowsAt,
    opportunities: data.opportunities || null,
    status: data.status || null,
    auth: data.auth || null,
    onboarding: data.onboarding || null,
    watchlist: data.watchlist || [],
    alerts: data.alerts || [],
    snapshots: data.snapshots || [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    unlocked: !!unlock?.unlocked,
    unlock: unlock?.unlock || null,
    loaded: true,
  });
  computeMoves();
  renderAll();
  if (state.flash.size) setTimeout(() => state.flash.clear(), 1600);
}

// Hourly change per market from the stored snapshots, and which prices moved since the last render.
function computeMoves() {
  const now = state.status?.at || Date.now();
  const snaps = state.snapshots || [];
  const base = [...snaps].reverse().find((x) => now - x.t >= 55 * 60 * 1000) || snaps[0];
  const moves = {};
  const mids = {};
  for (const r of state.rows) {
    if (r.mid === null || r.mid === undefined) continue;
    mids[r.ticker] = r.mid;
    const b = base?.mids?.[r.ticker];
    if (typeof b === "number" && base.t < now) moves[r.ticker] = r.mid - b;
  }
  state.moves = moves;
  if (state.prevMids) {
    for (const [t, m] of Object.entries(mids)) {
      const prev = state.prevMids[t];
      if (typeof prev === "number" && Math.abs(m - prev) >= 0.005) state.flash.set(t, m > prev ? "up" : "down");
    }
  }
  state.prevMids = mids;
}

let pending;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!["rows", "opportunities", "status", "watchlist", "alerts", "unlock", "settings", "auth", "onboarding"].some((k) => k in changes)) return;
  clearTimeout(pending);
  pending = setTimeout(load, 60);
});

renderAll();
load().then(() => {
  if (!state.status || Date.now() - state.status.at > 60_000) doRefresh();
});
setInterval(renderLive, 5000);
window.addEventListener("resize", renderTabs);
