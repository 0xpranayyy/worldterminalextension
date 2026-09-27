import { CONFIG, normalizeCode, inviteUrl, eventUrl, WORLD_ORIGIN } from "../config.js";
import { SORTS } from "../lib/analytics.js";

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

const state = {
  rows: [],
  opportunities: null,
  status: null,
  watchlist: [],
  alerts: [],
  unlocked: false,
  unlock: null,
  tab: "scanner",
  opp: "underround",
};

const isPopup = chrome.extension.getViews({ type: "popup" }).includes(window);
if (!isPopup) document.body.classList.add("wide");

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

const cents = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);
const compact = (n) => (n ? Intl.NumberFormat("en", { notation: "compact" }).format(n) : "0");

function closesIn(hours) {
  if (hours === null || hours === undefined) return "";
  if (hours < 0) return "closed";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m left`;
  if (hours < 48) return `${Math.round(hours)}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function ago(t) {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function tradeLink(eventTicker, label = "Trade on World") {
  return h("a", { href: eventUrl(eventTicker), target: "_blank", rel: "noopener" }, label);
}

function gate(text) {
  return h(
    "div",
    { class: "gate" },
    h("p", {}, text),
    h("button", { class: "primary", onclick: () => switchTab("unlock") }, "Unlock free with invite"),
  );
}

// ---------- tabs ----------

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === `tab-${tab}`));
  render();
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
document.querySelectorAll("#opp-seg button").forEach((b) =>
  b.addEventListener("click", () => {
    state.opp = b.dataset.opp;
    document.querySelectorAll("#opp-seg button").forEach((x) => x.classList.toggle("active", x === b));
    renderOpps();
  }),
);
$("#search").addEventListener("input", () => renderScanner());
$("#sort").addEventListener("change", () => renderScanner());
$("#category").addEventListener("change", () => renderScanner());
$("#refresh").addEventListener("click", async () => {
  $("#refresh").disabled = true;
  await send({ type: "refresh" });
  $("#refresh").disabled = false;
});
$("#panel").addEventListener("click", async () => {
  await send({ type: "openSidePanel" });
  if (isPopup) window.close();
});
if (!isPopup) $("#panel").hidden = true;

// ---------- status / header ----------

function renderStatus() {
  const s = state.status;
  const el = $("#status");
  el.className = "status";
  el.replaceChildren();
  if (!s || s.state === "auth") {
    el.classList.add("warn");
    el.append(
      "Connect to World data: ",
      h("a", { href: WORLD_ORIGIN, target: "_blank", rel: "noopener" }, "open world.xyz"),
      " in a tab once, then come back.",
    );
  } else if (s.state === "error") {
    el.classList.add("warn");
    el.append(`Update failed (${s.message}). Retrying automatically.`);
  } else {
    el.append(`${s.markets} markets in ${s.events} events · updated ${ago(s.at)}`);
  }
  const plan = $("#plan");
  plan.textContent = state.unlocked ? "PRO" : "FREE";
  plan.classList.toggle("pro", state.unlocked);
  $("#unlock-tab").textContent = state.unlocked ? "Account" : "Unlock";
}

// ---------- scanner ----------

function marketCard(r) {
  const watching = state.watchlist.includes(r.ticker);
  return h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "card-top" },
      h(
        "div",
        {},
        h("div", { class: "card-title", title: `${r.eventTitle} — ${r.title}` }, r.title),
        h("div", { class: "card-sub" }, [r.eventTitle !== r.title ? r.eventTitle : null, closesIn(r.hoursToClose)].filter(Boolean).join(" · ")),
      ),
      h("div", { class: `score ${r.score >= 60 ? "hi" : r.score < 30 ? "lo" : ""}`, title: "Liquidity score (0–100)" }, String(r.score)),
    ),
    h(
      "div",
      { class: "metrics" },
      h("div", {}, h("b", {}, `${cents(r.yesBid)} / ${cents(r.yesAsk)}`), h("span", {}, "YES bid/ask")),
      h("div", {}, h("b", { class: r.spread !== null && r.spread <= 0.03 ? "good" : r.spread >= 0.08 ? "bad" : "" }, cents(r.spread)), h("span", {}, "spread")),
      h("div", {}, h("b", {}, compact(r.volume)), h("span", {}, "volume")),
      h("div", {}, h("b", {}, compact(r.openInterest)), h("span", {}, "open int.")),
    ),
    h(
      "div",
      { class: "actions" },
      tradeLink(r.eventTicker),
      state.unlocked
        ? [
            h("button", { class: watching ? "on" : "", onclick: () => send({ type: "toggleWatch", ticker: r.ticker }) }, watching ? "★ Watching" : "☆ Watch"),
            h("button", { onclick: () => openAlertDialog(r) }, "🔔 Alert"),
          ]
        : null,
    ),
  );
}

function renderCategories() {
  const sel = $("#category");
  const current = sel.value;
  const cats = [...new Set(state.rows.map((r) => r.category).filter(Boolean))].sort();
  sel.replaceChildren(h("option", { value: "" }, "All"), ...cats.map((c) => h("option", { value: c }, c)));
  sel.value = cats.includes(current) ? current : "";
}

function renderScanner() {
  const q = $("#search").value.trim().toLowerCase();
  const cat = $("#category").value;
  const sort = SORTS[$("#sort").value] || SORTS.liquidity;
  let rows = state.rows.filter(
    (r) => (!cat || r.category === cat) && (!q || `${r.eventTitle} ${r.title} ${r.ticker}`.toLowerCase().includes(q)),
  );
  rows = rows.slice().sort(sort);
  const total = rows.length;
  if (!state.unlocked) rows = rows.slice(0, CONFIG.FREE_ROW_LIMIT);
  else rows = rows.slice(0, 200);

  $("#scanner-list").replaceChildren(
    ...(rows.length ? rows.map(marketCard) : [h("div", { class: "empty" }, state.status?.state === "ok" ? "No markets match." : "Waiting for World data…")]),
  );
  $("#scanner-gate").replaceChildren(
    !state.unlocked && total > rows.length
      ? gate(`Showing ${rows.length} of ${total} markets. Unlock every market, arbitrage scanner, watchlist and alerts.`)
      : "",
  );
}

// ---------- opportunities ----------

const OPP_HELP = {
  underround: "Events where YES on every outcome costs less than the $1 payout. Risk-free only if exactly one outcome resolves YES — check the rules.",
  complement: "Markets where YES ask + NO ask is under $1: buying both locks in the difference.",
  favorites: "Outcomes priced 85–98.5¢ that close within 48h. Small, fast returns — but you lose the stake if wrong.",
  movers: "Biggest mid-price moves over roughly the last hour.",
};

function oppCard(o) {
  const lines = [];
  if (o.type === "underround")
    lines.push(`${o.outcomes} outcomes cost ${cents(o.cost)} → +${cents(o.edge)} per set (${o.returnPct}%)`);
  if (o.type === "complement") lines.push(`YES+NO cost ${cents(o.cost)} → +${cents(o.edge)} (${o.returnPct}%)`);
  if (o.type === "favorite") lines.push(`${o.side} @ ${cents(o.price)} · ${o.hoursToClose}h · +${o.returnPct}% · liq ${o.score}`);
  if (o.type === "mover")
    lines.push(h("span", { class: o.move > 0 ? "good" : "bad" }, `${cents(o.from)} → ${cents(o.to)} (${o.move > 0 ? "+" : ""}${Math.round(o.move * 100)}¢)`));
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-title" }, o.title),
    h("div", { class: "card-sub" }, ...lines),
    o.note ? h("div", { class: "card-sub" }, o.note) : null,
    h("div", { class: "actions" }, tradeLink(o.eventTicker)),
  );
}

function renderOpps() {
  $("#opp-help").textContent = OPP_HELP[state.opp];
  const list = state.opportunities?.[state.opp] || [];
  const counts = state.opportunities || {};
  document.querySelectorAll("#opp-seg button").forEach((b) => {
    const n = (counts[b.dataset.opp] || []).length;
    b.textContent = `${b.textContent.replace(/ \(\d+\)$/, "")}${n ? ` (${n})` : ""}`;
  });
  if (!list.length) {
    $("#opp-list").replaceChildren(h("div", { class: "empty" }, state.opportunities ? "Nothing right now. Checked every minute." : "Waiting for World data…"));
    return;
  }
  if (!state.unlocked) {
    $("#opp-list").replaceChildren(
      h("div", { class: "locked" }, ...list.slice(0, 3).map(oppCard)),
      gate(`${list.length} live opportunit${list.length === 1 ? "y" : "ies"} found. Unlock to see them.`),
    );
    return;
  }
  $("#opp-list").replaceChildren(...list.map(oppCard));
}

// ---------- watchlist & alerts ----------

let alertTarget = null;
function openAlertDialog(r) {
  alertTarget = r;
  $("#alert-title").textContent = `Alert: ${r.title}`;
  const f = $("#alert-form");
  f.price.value = r.yesAsk !== null ? Math.round(r.yesAsk * 100) : "";
  $("#alert-dialog").showModal();
}
$("#alert-dialog").addEventListener("close", async () => {
  if ($("#alert-dialog").returnValue !== "ok" || !alertTarget) return;
  const f = $("#alert-form");
  await send({
    type: "addAlert",
    alert: {
      ticker: alertTarget.ticker,
      eventTicker: alertTarget.eventTicker,
      title: `${alertTarget.eventTitle} — ${alertTarget.title}`,
      side: f.side.value,
      op: f.op.value,
      price: Number(f.price.value) / 100,
    },
  });
  alertTarget = null;
});

function renderWatch() {
  if (!state.unlocked) {
    $("#watch-list").replaceChildren(gate("Watchlists and price alerts (desktop notifications) are part of World Terminal Pro."));
    $("#alert-list").replaceChildren();
    return;
  }
  const byTicker = new Map(state.rows.map((r) => [r.ticker, r]));
  const watched = state.watchlist.map((t) => byTicker.get(t)).filter(Boolean);
  $("#watch-list").replaceChildren(
    ...(watched.length ? watched.map(marketCard) : [h("div", { class: "empty" }, "Tap ☆ Watch on any market to track it here.")]),
  );
  $("#alert-list").replaceChildren(
    ...(state.alerts.length
      ? state.alerts.map((a) =>
          h(
            "div",
            { class: "card" },
            h("div", { class: "card-title" }, a.title),
            h("div", { class: "card-sub" }, `${a.side} ask ${a.op === "below" ? "≤" : "≥"} ${cents(a.price)} · now ${cents(a.side === "NO" ? byTicker.get(a.ticker)?.noAsk : byTicker.get(a.ticker)?.yesAsk)}`),
            h("div", { class: "actions" }, tradeLink(a.eventTicker, "Open"), h("button", { onclick: () => send({ type: "removeAlert", id: a.id }) }, "Delete")),
          ),
        )
      : [h("div", { class: "empty" }, "No alerts. Use 🔔 Alert on a market.")]),
  );
}

// ---------- unlock ----------

function renderUnlock() {
  const body = $("#unlock-body");
  const mode = state.unlocked ? "pro" : "locked";
  // Background refreshes re-render every minute; don't wipe a half-typed wallet address.
  if (body.dataset.mode === mode) return;
  body.dataset.mode = mode;
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  if (state.unlocked) {
    body.replaceChildren(
      h("div", { class: "unlock-hero" }, h("h2", {}, "You're on Pro ✓"), h("p", {}, `Wallet ${state.unlock.wallet.slice(0, 4)}…${state.unlock.wallet.slice(-4)} joined World with our invite.`)),
      h("ul", { class: "perks" }, h("li", {}, "All markets, sorted by liquidity"), h("li", {}, "Arbitrage & closing-favorite scanner"), h("li", {}, "Watchlist, price alerts, on-page stats")),
    );
    return;
  }
  const msg = h("div", { class: "msg" });
  const input = h("input", { placeholder: "Your Solana wallet address", value: state.unlock?.wallet || "", spellcheck: "false" });
  const verify = h(
    "button",
    {
      class: "primary",
      onclick: async () => {
        verify.disabled = true;
        msg.textContent = "Checking with World…";
        msg.className = "msg";
        const res = await send({ type: "verifyWallet", wallet: input.value });
        verify.disabled = false;
        msg.textContent = res.ok ? "Unlocked! Welcome to Pro." : res.reason;
        msg.className = `msg ${res.ok ? "good" : "bad"}`;
      },
    },
    "Verify",
  );

  body.replaceChildren(
    h("div", { class: "unlock-hero" }, h("h2", {}, "Unlock World Terminal Pro — free"), h("p", {}, "Pro is free for everyone who joins World through our invite link.")),
    h(
      "ul",
      { class: "perks" },
      h("li", {}, "Every market ranked by liquidity & spread"),
      h("li", {}, "Arbitrage, closing-favorite and mover scanners"),
      h("li", {}, "Watchlist, price alerts and stats on world.xyz pages"),
    ),
    h(
      "ol",
      { class: "steps" },
      h(
        "li",
        {},
        h("b", {}, "Join World with our invite"),
        h("div", {}, h("a", { class: "primary", href: inviteUrl("/"), target: "_blank", rel: "noopener", style: "margin-top:6px" }, code ? `Open invite (${code})` : "Open world.xyz")),
      ),
      h("li", {}, h("b", {}, "Connect your wallet on World"), h("div", { class: "card-sub" }, "When World asks you to “Confirm your invite”, approve the signature. That is what makes the invite count.")),
      h("li", {}, h("b", {}, "Verify here"), h("div", { class: "wallet-row" }, input, verify), msg),
    ),
    h("p", { class: "help" }, "Already joined World with someone else's invite? World only allows one invite per wallet."),
  );
}

// ---------- data ----------

function render() {
  renderStatus();
  if (state.tab === "scanner") renderScanner();
  if (state.tab === "opps") renderOpps();
  if (state.tab === "watch") renderWatch();
  if (state.tab === "unlock") renderUnlock();
}

async function load() {
  const [data, unlock] = await Promise.all([
    chrome.storage.local.get(["rows", "opportunities", "status", "watchlist", "alerts"]),
    send({ type: "unlockState" }),
  ]);
  Object.assign(state, {
    rows: data.rows || [],
    opportunities: data.opportunities || null,
    status: data.status || null,
    watchlist: data.watchlist || [],
    alerts: data.alerts || [],
    unlocked: !!unlock?.unlocked,
    unlock: unlock?.unlock || null,
  });
  renderCategories();
  render();
  if (!state.status || Date.now() - state.status.at > 60_000) send({ type: "refresh" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (["rows", "opportunities", "status", "watchlist", "alerts", "unlock"].some((k) => k in changes)) load();
});

load();
setInterval(renderStatus, 15000);
