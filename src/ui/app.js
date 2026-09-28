import { CONFIG, DEFAULT_SETTINGS, normalizeCode, inviteUrl, eventUrl, WORLD_ORIGIN } from "../config.js";
import { SORTS, SCORE_WEIGHTS, scoreParts, historyFor, marketLabel } from "../lib/analytics.js";
import { drawCard, shareText } from "./share.js";

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

const isPopup = chrome.extension.getViews({ type: "popup" }).includes(window);
if (!isPopup) document.body.classList.add("panel");

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
  $("#plan").replaceChildren(state.unlocked ? h("span", { class: "pro-chip" }, "PRO") : h("span", { class: "free-chip" }, "FREE"));
}

function renderLive() {
  const s = state.status;
  const el = $("#live");
  if (!state.loaded) return el.replaceChildren(h("span", { class: "dot off" }), "Loading…");
  if (!s || s.state === "auth") return el.replaceChildren(h("span", { class: "dot warn" }), "Not connected to World");
  if (s.state === "error") return el.replaceChildren(h("span", { class: "dot warn" }), `Update failed · retrying · last good ${ago(state.rowsAt)}`);
  el.replaceChildren(h("span", { class: "dot" }), h("b", {}, "Live"), ` · updated ${ago(s.at)} · ${s.events} events${s.source === "backend" ? " · cloud" : ""}`);
}

function renderKpis() {
  const s = state.status?.state === "ok" ? state.status : null;
  const o = state.opportunities;
  const arbs = o ? o.underround.length + o.complement.length : 0;
  const signals = o ? arbs + o.favorites.length + o.movers.length : 0;
  const tile = (label, value, sub) =>
    h("div", { class: "kpi" }, h("div", { class: "kpi-label" }, label), h("div", { class: "kpi-value" }, value), h("div", { class: "kpi-sub" }, sub));
  $("#kpis").replaceChildren(
    tile("Markets", s ? compact(s.markets) : "—", s ? `${compact(s.tightMarkets)} tight (≤3¢)` : "live on World"),
    tile("Spread", s?.medianSpread != null ? cents1(s.medianSpread) : "—", "median YES"),
    tile("Signals", o ? String(signals) : "—", o ? (arbs ? h("span", { class: "yes" }, `${arbs} arbitrage`) : "no arbitrage now") : "scanning"),
  );
}

function renderBanner() {
  const b = $("#banner");
  if (state.loaded && (!state.status || state.status.state === "auth")) {
    b.replaceChildren(
      h(
        "div",
        { class: "banner connect" },
        h("div", { class: "banner-text" }, h("b", {}, "Connect to World"), "Open world.xyz once in a tab. World Terminal picks up your session."),
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
  const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
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
    ...top.map(([c, n]) => chip(`cat:${c}`, c.replace(/(^|[-_\s])\w/g, (m) => m.toUpperCase()).replace(/[-_]/g, " "), n)),
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

function marketRow(r, i) {
  const spreadClass = r.spread === null ? "" : r.spread <= 0.03 ? "sp-tight" : r.spread >= 0.08 ? "sp-wide" : "";
  const watching = state.watchlist.includes(r.ticker);
  const sub = [r.eventTitle !== r.title ? r.eventTitle : null, r.hoursToClose !== null ? `closes ${closesIn(r.hoursToClose)}` : null, `vol ${compact(r.volume)}`]
    .filter(Boolean)
    .join(" · ");
  return h(
    "button",
    { class: `mrow${state.selected === i ? " sel" : ""}`, "data-i": i, onclick: () => openSheet({ type: "market", ticker: r.ticker }) },
    h(
      "div",
      { class: "m-main" },
      h("div", { class: "m-title", title: marketLabel(r) }, watching ? h("span", { class: "star" }, "★") : null, r.title),
      h("div", { class: "m-meta" }, sub),
    ),
    h(
      "div",
      { class: "m-price" },
      h("div", { class: "m-yes" }, cents(r.yesAsk ?? r.mid)),
      h("div", { class: "m-book" }, `${cents(r.yesBid)}/${cents(r.yesAsk)} · `, h("span", { class: spreadClass }, cents(r.spread))),
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
  { id: "underround", label: "Outcome arb", help: "Buy YES on every outcome for less than the $1 payout. Risk-free only if exactly one outcome must win, so check the rules." },
  { id: "complement", label: "YES+NO arb", help: "YES ask + NO ask under $1 on the same market: buy both and one side pays $1." },
  { id: "favorites", label: "Closing favorites", help: "Outcomes priced 85–98.5¢ closing soon. Small, fast returns, but you lose the stake if wrong." },
  { id: "movers", label: "Movers", help: "Biggest mid-price moves over roughly the last hour." },
];

function renderSignalChips() {
  const o = state.opportunities || {};
  $("#signal-chips").replaceChildren(
    ...SIGNALS.map((s) =>
      h(
        "button",
        {
          class: `chip${state.signal === s.id ? " on" : ""}`,
          onclick: () => {
            state.signal = prefs.signal = s.id;
            savePrefs();
            renderSignalChips();
            renderView();
          },
        },
        s.label,
        (o[s.id] || []).length ? h("span", { class: "n" }, String(o[s.id].length)) : null,
      ),
    ),
  );
}

function signalCard(o) {
  if (o.redacted) {
    return h(
      "div",
      { class: "scard" },
      h("div", { class: "edge" }, h("b", {}, "+?¢"), h("small", {}, "Pro")),
      h("div", {}, h("div", { class: "s-title" }, "Pro signal"), h("div", { class: "s-line" }, "Unlock to see this opportunity")),
    );
  }
  let edge, line;
  if (o.type === "underround") {
    edge = h("div", { class: "edge" }, h("b", {}, `+${cents1(o.edge)}`), h("small", {}, `${o.returnPct}%`));
    line = `${o.outcomes} outcomes · cost ${cents1(o.cost)} per $1 set`;
  } else if (o.type === "complement") {
    edge = h("div", { class: "edge" }, h("b", {}, `+${cents1(o.edge)}`), h("small", {}, `${o.returnPct}%`));
    line = `YES + NO cost ${cents1(o.cost)}`;
  } else if (o.type === "favorite") {
    edge = h("div", { class: "edge neutral" }, h("b", {}, `${o.returnPct}%`), h("small", {}, `${o.hoursToClose}h`));
    line = `Buy ${o.side} @ ${cents(o.price)} · liquidity ${o.score}`;
  } else {
    const up = o.move > 0;
    edge = h("div", { class: `edge ${up ? "" : "down"}` }, h("b", {}, `${up ? "+" : "−"}${Math.abs(Math.round(o.move * 100))}¢`), h("small", {}, up ? "up" : "down"));
    line = `${cents(o.from)} → ${cents(o.to)}`;
  }
  const open = () => (o.ticker ? openSheet({ type: "market", ticker: o.ticker }) : chrome.tabs.create({ url: eventUrl(o.eventTicker) }));
  return h(
    "div",
    { class: "scard", role: "button", tabindex: "0", onclick: open, onkeydown: (e) => e.key === "Enter" && open() },
    edge,
    h("div", { style: "min-width:0" }, h("div", { class: "s-title" }, o.title), h("div", { class: "s-line" }, line)),
    h(
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
    ),
  );
}

function renderSignals(view) {
  const def = SIGNALS.find((s) => s.id === state.signal) || SIGNALS[0];
  view.append(h("div", { class: "signal-help" }, def.help));
  if (!state.opportunities) {
    view.append(...(state.status?.state === "ok" ? skeleton(4) : [emptyState("radar", "Waiting for World data", "Signals appear after the first scan.")]));
    return;
  }
  const list = state.opportunities[def.id] || [];
  if (!list.length) {
    view.append(emptyState("radar", "Nothing right now", `Rescanning every ${state.settings.refreshMinutes} min. Turn on signal notifications in Settings.`));
    return;
  }
  if (!state.unlocked) {
    view.append(
      h("div", { class: "blur" }, ...list.slice(0, 3).map(signalCard)),
      gate(`${list.length} live signal${list.length === 1 ? "" : "s"} found`, "Unlock Pro to see them and get notified the moment new ones appear."),
    );
    return;
  }
  view.append(...list.map(signalCard));
}

// ---------- watchlist ----------

function renderWatch(view) {
  if (!state.unlocked) {
    view.append(gate("Watchlist & price alerts", "Star markets, set YES/NO price alerts, get desktop notifications."));
    return;
  }
  const byTicker = new Map(state.rows.map((r) => [r.ticker, r]));
  const watched = state.watchlist.map((t) => byTicker.get(t)).filter(Boolean);
  view.append(h("div", { class: "section-label" }, h("span", {}, "Watching"), h("span", {}, String(watched.length))));
  view.append(...(watched.length ? watched.map(marketRow) : [emptyState("star", "Nothing starred yet", "Open any market and tap Watch.")]));
  view.append(h("div", { class: "section-label" }, h("span", {}, "Price alerts"), h("span", {}, String(state.alerts.length))));
  if (!state.alerts.length) {
    view.append(emptyState("bell", "No alerts", "Open a market and set a YES or NO price."));
    return;
  }
  for (const a of state.alerts) {
    const r = byTicker.get(a.ticker);
    const now = r ? (a.side === "NO" ? r.noAsk : r.yesAsk) : null;
    view.append(
      h(
        "div",
        { class: "arow" },
        h("div", { style: "min-width:0" }, h("div", { class: "t", title: a.title }, a.title), h("div", { class: "d" }, `${a.side} ask ${a.op === "below" ? "≤" : "≥"} ${cents(a.price)} · now ${cents(now)}`)),
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
    );
  }
}

// ---------- portfolio ----------

const usd = (n) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function portfolioWallet() {
  return state.unlock?.wallet || prefs.portfolioWallet || "";
}

async function loadPortfolio(wallet = portfolioWallet()) {
  if (!wallet) return;
  state.portfolio = { ...state.portfolio, loading: true, error: null };
  if (state.tab === "portfolio") renderView();
  const res = await send({ type: "portfolio", wallet });
  state.portfolio = res.ok ? { loading: false, data: res, error: null } : { loading: false, data: state.portfolio.data, error: res.reason };
  if (state.tab === "portfolio") renderView();
}

function renderPortfolio(view) {
  if (!state.unlocked) {
    view.append(gate("Portfolio", "See every World position you hold, what it would sell for right now, and which ones are hard to exit."));
    return;
  }
  const p = state.portfolio;
  const wallet = portfolioWallet();
  if (!wallet) {
    const input = h("input", { type: "text", id: "pf-wallet", placeholder: "Solana wallet address", spellcheck: "false", style: "flex:1;min-width:0" });
    view.append(
      emptyState("radar", "Which wallet?", "Enter the wallet you trade with on World."),
      h(
        "form",
        {
          class: "pf-form",
          onsubmit: (e) => {
            e.preventDefault();
            prefs.portfolioWallet = input.value.trim();
            savePrefs();
            loadPortfolio();
          },
        },
        input,
        h("button", { class: "btn primary", type: "submit" }, "Load"),
      ),
    );
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
      { class: "section-label" },
      h("span", { class: "case", title: wallet }, `${wallet.slice(0, 4)}…${wallet.slice(-4)}`),
      h("button", { class: "linkish", onclick: () => loadPortfolio(), disabled: p.loading }, p.loading ? "Updating…" : d ? `Updated ${ago(d.at)} · refresh` : "Refresh"),
    ),
  );
  if (p.error) view.append(h("div", { class: "pf-error" }, p.error));
  if (!d) {
    if (p.loading) view.append(...skeleton(4));
    return;
  }
  const tile = (label, value, sub, cls = "") => h("div", { class: "kpi" }, h("div", { class: "kpi-label" }, label), h("div", { class: `kpi-value ${cls}` }, value), h("div", { class: "kpi-sub" }, sub));
  view.append(
    h(
      "div",
      { class: "kpis pf-kpis" },
      tile("Exit value", usd(d.exitValue), "sell now at bid"),
      tile("If all win", usd(d.maxPayout), "$1 per share"),
      tile("Positions", String(d.positions.length), d.thinCount ? h("span", { class: "warn" }, `${d.thinCount} hard to exit`) : "all liquid"),
    ),
  );
  if (!d.positions.length) {
    view.append(emptyState("radar", "No open World positions", d.tokens ? `This wallet holds ${d.tokens} tokens, none in live World markets.` : "Positions show up here after you trade on World."));
    return;
  }
  for (const pos of d.positions) {
    const meta = [pos.eventTitle !== pos.title ? pos.eventTitle : null, `${pos.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`, pos.hoursToClose !== null ? `closes ${closesIn(pos.hoursToClose)}` : null]
      .filter(Boolean)
      .join(" · ");
    view.append(
      h(
        "button",
        { class: "mrow pf-row", onclick: () => openSheet({ type: "market", ticker: pos.ticker }) },
        h(
          "div",
          { class: "m-main" },
          h("div", { class: "m-title" }, h("span", { class: `side-pill ${pos.side === "YES" ? "yes" : "no"}` }, pos.side), pos.title),
          h("div", { class: "m-meta" }, meta),
        ),
        h(
          "div",
          { class: "m-price" },
          h("div", { class: "m-yes" }, usd(pos.exitValue)),
          h("div", { class: "m-book" }, `bid ${cents(pos.bid)}`, pos.thin ? h("span", { class: "sp-wide" }, " · thin") : null),
        ),
      ),
    );
  }
  if (d.thinCount) view.append(h("p", { class: "signal-help" }, "“Thin” means no buyer right now or a spread of 6¢+. Selling early may cost more than the quote suggests."));
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
    sheetHead(r.title, r.eventTitle !== r.title ? r.eventTitle : r.category),
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
  const canvas = drawCard(document.createElement("canvas"), data);
  const text = shareText(data);
  const blob = () => new Promise((res) => canvas.toBlob(res, "image/png"));
  const intent = `https://x.com/intent/post?${new URLSearchParams({ text, url: data.link })}`;
  return [
    sheetHead("Share", "Every share carries your invite link."),
    h("img", { class: "share-preview", src: canvas.toDataURL("image/png"), alt: text }),
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
            const a = h("a", { href: url, download: `world-terminal-${(s.ticker || s.signal?.eventTicker || "signal").toLowerCase()}.png` });
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
    const w = state.unlock.wallet;
    return [
      sheetHead("World Terminal Pro", "Active"),
      h("div", { class: "hero" }, h("div", { class: "hero-badge" }, icon("crown")), h("h2", {}, "You're on Pro"), h("p", {}, `Wallet ${w.slice(0, 4)}…${w.slice(-4)} joined World with our invite.`)),
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
  const save = async (patch) => {
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
    toast("Saved");
  };
  const sw = (key) =>
    h("label", { class: "switch" }, h("input", { type: "checkbox", id: `set-${key}`, checked: !!s[key], onchange: (e) => save({ [key]: e.target.checked }) }), h("span"));
  const num = (key, min, max, step = 1) =>
    h("input", {
      type: "number",
      id: `set-${key}`,
      min,
      max,
      step,
      value: s[key],
      onchange: (e) => {
        const v = Math.min(max, Math.max(min, Number(e.target.value) || s[key]));
        e.target.value = v;
        save({ [key]: v });
      },
    });
  const row = (k, hint, control) => h("div", { class: "set-row" }, h("div", {}, h("div", { class: "k" }, k), hint ? h("div", { class: "h" }, hint) : null), control);
  const auth = state.auth;
  const connected = auth && auth.expiry > Date.now();

  return [
    sheetHead("Settings", `World Terminal ${chrome.runtime.getManifest().version}`),
    h(
      "div",
      { class: "sheet-section" },
      h("div", { class: "label" }, "Data"),
      h(
        "div",
        { class: "set-group" },
        row(
          "Refresh every",
          "How often markets are rescanned",
          h(
            "select",
            { id: "set-refresh", onchange: (e) => save({ refreshMinutes: Number(e.target.value) }) },
            ...[1, 2, 5, 10].map((m) => h("option", { value: m, selected: s.refreshMinutes === m }, `${m} min`)),
          ),
        ),
        row(
          "Solana RPC",
          "Used to read your positions",
          h("input", {
            type: "text",
            id: "set-rpc",
            value: s.rpcUrl,
            spellcheck: "false",
            style: "width:170px;font-family:var(--mono);font-size:11px",
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
        row(
          "World connection",
          connected ? `Session valid for ${Math.max(1, Math.round((auth.expiry - Date.now()) / 3600000))}h` : "Open world.xyz to connect",
          connected ? h("span", { class: "yes", style: "font-weight:600;font-size:12px" }, "Connected") : h("a", { class: "btn", href: WORLD_ORIGIN, target: "_blank", rel: "noopener" }, "Connect"),
        ),
      ),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h("div", { class: "label" }, "Notifications"),
      h("div", { class: "set-group" }, row("Price alerts", "Notify when an alert price is hit", sw("notifyAlerts")), row("New arbitrage", "Pro · notify on new arbitrage signals", sw("notifySignals"))),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h("div", { class: "label" }, "Signal thresholds"),
      h(
        "div",
        { class: "set-group" },
        row("Minimum arbitrage edge", "In cents per $1", num("minEdgeCents", 0.1, 10, 0.1)),
        row("Favorites from", "Lowest price counted, in cents", num("favoriteMinCents", 70, 98)),
        row("Favorites close within", "Hours", num("favoriteMaxHours", 1, 168)),
        row("Mover threshold", "Cents moved in ~1h", num("moverCents", 1, 30)),
      ),
    ),
    h(
      "div",
      { class: "sheet-section" },
      h("div", { class: "label" }, "Account"),
      h(
        "div",
        { class: "set-group" },
        state.unlocked
          ? row(
              "Pro · active",
              `${state.unlock.wallet.slice(0, 6)}…${state.unlock.wallet.slice(-4)}`,
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
          : row("Free plan", "Unlock Pro with our invite", h("button", { class: "btn gold", onclick: () => openSheet({ type: "unlock" }) }, "Unlock")),
        row("Keyboard", "/ search · ↑↓ move · Enter open · R refresh · Esc close", h("span")),
      ),
    ),
    h("p", { class: "fineprint" }, "Not affiliated with World. Nothing here is financial advice. Links to world.xyz include our invite code."),
  ];
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
  renderTabs();
  renderChips();
  renderSignalChips();
  renderView();
  renderSheet();
}

async function load() {
  const [data, unlock] = await Promise.all([
    chrome.storage.local.get(["rows", "opportunities", "status", "watchlist", "alerts", "settings", "snapshots", "auth"]),
    send({ type: "unlockState" }).catch(() => null),
  ]);
  Object.assign(state, {
    rows: data.rows || [],
    rowsAt: data.status?.state === "ok" ? data.status.at : state.rowsAt,
    opportunities: data.opportunities || null,
    status: data.status || null,
    auth: data.auth || null,
    watchlist: data.watchlist || [],
    alerts: data.alerts || [],
    snapshots: data.snapshots || [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    unlocked: !!unlock?.unlocked,
    unlock: unlock?.unlock || null,
    loaded: true,
  });
  renderAll();
}

let pending;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!["rows", "opportunities", "status", "watchlist", "alerts", "unlock", "settings", "auth"].some((k) => k in changes)) return;
  clearTimeout(pending);
  pending = setTimeout(load, 60);
});

renderAll();
load().then(() => {
  if (!state.status || Date.now() - state.status.at > 60_000) doRefresh();
});
setInterval(renderLive, 5000);
window.addEventListener("resize", renderTabs);
