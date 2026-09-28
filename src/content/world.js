// Runs on world.xyz. Two jobs:
// 1. Hand the session token that world.xyz already obtained for this user to the extension.
// 2. On /event/<ticker> pages, show a World Terminal panel for that event's outcomes.
(() => {
  const TOKEN_KEY = "TURNSTILE_JWT";
  let lastToken = null;

  function syncToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return;
      const { token, expiry } = JSON.parse(raw);
      if (!token || !expiry || Date.now() >= expiry || token === lastToken) return;
      lastToken = token;
      chrome.runtime.sendMessage({ type: "setToken", token, expiry }).catch(() => {});
    } catch {
      // Malformed value; world.xyz will replace it.
    }
  }

  // ---------- Request relay ----------
  // The extension asks us to make World API calls when World only accepts them from world.xyz.
  const RELAY_ALLOWED = ["https://markets-api-proxy.world-xyz.workers.dev/api/v1/", "https://users-api.world.xyz/api/v1/"];
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "relayFetch" || !RELAY_ALLOWED.some((p) => String(msg.url).startsWith(p))) return false;
    const headers = {};
    if (typeof msg.headers?.Authorization === "string") headers.Authorization = msg.headers.Authorization;
    fetch(msg.url, { headers, credentials: "omit", signal: AbortSignal.timeout(15000) })
      .then(async (res) => sendResponse({ status: res.status, body: await res.text() }))
      .catch((err) => sendResponse({ status: 0, body: "", error: err.message }));
    return true;
  });

  // ---------- Event page panel ----------
  // Rendered inside a shadow root so world.xyz's CSS can't touch it (and ours can't leak out).

  let host = null;
  let root = null;
  let currentEvent = null;

  function eventTickerFromPath() {
    const m = location.pathname.match(/^\/event\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  const cents = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);
  const cents1 = (p) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`);
  const SVG = {
    logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.9"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" fill="currentColor"/></svg>',
    crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" fill="currentColor"/><rect x="4" y="18.5" width="16" height="2" rx="1" fill="currentColor"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svgEl(name, cls = "ic") {
    const s = el("span", cls);
    s.innerHTML = SVG[name];
    return s;
  }

  function ensureHost() {
    if (host && document.body.contains(host)) return;
    host = document.createElement("world-terminal-panel");
    host.style.cssText = "all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;";
    root = host.attachShadow({ mode: "closed" });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/content/panel.css");
    root.append(link);
    document.body.append(host);
  }

  function removeHost() {
    host?.remove();
    host = null;
    root = null;
  }

  function ring(score) {
    const r = 9.5;
    const c = 2 * Math.PI * r;
    const color = score >= 65 ? "#3dd68c" : score >= 35 ? "#7c9cff" : "#ff6b6b";
    const w = el("span", "ring");
    w.title = `Liquidity score ${score}/100`;
    w.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="2.4"/><circle cx="12" cy="12" r="${r}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 12 12)"/></svg>`;
    w.append(el("b", "", String(score)));
    return w;
  }

  async function render() {
    const ticker = eventTickerFromPath();
    if (!ticker) {
      currentEvent = null;
      removeHost();
      return;
    }
    currentEvent = ticker;
    const [data, state] = await Promise.all([
      chrome.storage.local.get(["rows", "moves", "watchlist", "status", "wtOverlayCollapsed", "wtOverlayHidden"]),
      chrome.runtime.sendMessage({ type: "unlockState" }).catch(() => ({ unlocked: false })),
    ]);
    if (currentEvent !== ticker) return;
    // "Hide here" lasts a day, then the panel comes back.
    if (data.wtOverlayHidden?.[ticker] && Date.now() - data.wtOverlayHidden[ticker] < 24 * 3600 * 1000) {
      removeHost();
      return;
    }
    const rows = (data.rows || []).filter((r) => r.eventTicker === ticker).sort((a, b) => (b.yesAsk ?? b.mid ?? 0) - (a.yesAsk ?? a.mid ?? 0));
    const moves = data.moves || {};
    const watch = new Set(data.watchlist || []);
    const collapsed = !!data.wtOverlayCollapsed;
    const unlocked = !!state?.unlocked;

    // Event-level numbers
    const asks = rows.map((r) => r.yesAsk).filter((a) => a !== null && a !== undefined);
    const arbEdge = rows.length >= 3 && asks.length === rows.length ? 1 - asks.reduce((s, a) => s + a, 0) : null;
    const spreads = rows.map((r) => r.spread).filter((x) => x !== null && x !== undefined);
    const bestSpread = spreads.length ? Math.min(...spreads) : null;
    const avgLiq = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null;

    ensureHost();
    const panel = el("div", `panel${collapsed ? " collapsed" : ""}`);

    // Header (also the collapsed pill)
    const head = el("button", "head");
    head.setAttribute("aria-expanded", String(!collapsed));
    head.title = collapsed ? "Expand World Terminal" : "Collapse";
    const logo = svgEl("logo", "logo");
    head.append(logo, el("span", "brand", "World Terminal"));
    if (!unlocked) head.append(el("span", "pill gold", "PRO"));
    else if (arbEdge !== null && arbEdge > 0.001) {
      const p = el("span", "pill good");
      p.append(svgEl("bolt", "ic xs"), document.createTextNode(`Arb +${cents1(arbEdge)}`));
      head.append(p);
    } else if (avgLiq !== null) head.append(el("span", `pill ${avgLiq >= 65 ? "good" : ""}`, `Liq ${avgLiq}`));
    head.append(svgEl("chevron", `ic chev${collapsed ? " up" : ""}`));
    head.onclick = () => chrome.storage.local.set({ wtOverlayCollapsed: !collapsed });
    panel.append(head);

    if (!collapsed) {
      const body = el("div", "body");
      if (!unlocked) {
        const card = el("div", "locked");
        card.append(svgEl("crown", "crown"), el("b", "", "Unlock this event's edge"), el("p", "", "Spread, liquidity and hourly moves for every outcome, arbitrage checks and one-click watchlist."));
        const cta = el("button", "cta", "Unlock Pro, free");
        cta.onclick = () => chrome.runtime.sendMessage({ type: "openSidePanel" });
        card.append(cta);
        body.append(card);
      } else if (!rows.length) {
        const empty = el("div", "empty");
        empty.append(el("b", "", "No live quotes for this event"), el("span", "", data.status?.state === "ok" ? "It may be closed or not trading yet." : "Open the extension to connect to World."));
        body.append(empty);
      } else {
        // Summary strip
        const stats = el("div", "stats");
        const stat = (k, v, cls = "") => {
          const d = el("div", "stat");
          d.append(el("span", "k", k), el("b", `v ${cls}`, v));
          return d;
        };
        stats.append(
          stat("Outcomes", String(rows.length)),
          stat("Best spread", cents1(bestSpread), bestSpread !== null && bestSpread <= 0.03 ? "good" : ""),
          stat("Avg liquidity", avgLiq === null ? "–" : String(avgLiq), avgLiq >= 65 ? "good" : avgLiq < 35 ? "bad" : ""),
        );
        body.append(stats);

        if (arbEdge !== null && arbEdge > 0.001) {
          const arb = el("div", "arb");
          arb.append(svgEl("bolt", "ic"), el("span", "", `All outcomes cost ${cents1(1 - arbEdge)}: +${cents1(arbEdge)} per $1 set. Check the rules.`));
          body.append(arb);
        }

        const list = el("div", "list");
        rows.slice(0, 12).forEach((r, i) => {
          const price = r.yesAsk ?? r.mid;
          const row = el("div", "row");
          row.append(el("span", "rank", String(i + 1)));
          const main = el("div", "main");
          main.append(el("div", "name", r.title));
          const bar = el("div", "prob");
          const fill = el("span");
          fill.style.width = `${Math.round((price ?? 0) * 100)}%`;
          bar.append(fill);
          main.append(bar);
          row.append(main);

          const px = el("div", "px");
          px.append(el("b", "", cents(price)));
          const mv = moves[r.ticker];
          if (typeof mv === "number" && Math.abs(mv) >= 0.005) px.append(el("span", `chg ${mv > 0 ? "up" : "down"}`, `${mv > 0 ? "▲" : "▼"}${Math.abs(Math.round(mv * 100)) || "<1"}¢`));
          else px.append(el("span", `sp ${r.spread !== null && r.spread <= 0.03 ? "good" : r.spread >= 0.08 ? "bad" : ""}`, `sprd ${cents(r.spread)}`));
          row.append(px, ring(r.score));

          const star = el("button", `star${watch.has(r.ticker) ? " on" : ""}`);
          star.title = watch.has(r.ticker) ? "Remove from watchlist" : "Add to watchlist";
          star.setAttribute("aria-label", star.title);
          star.append(svgEl(watch.has(r.ticker) ? "starOn" : "star", "ic"));
          star.onclick = () => chrome.runtime.sendMessage({ type: "toggleWatch", ticker: r.ticker });
          row.append(star);
          list.append(row);
        });
        body.append(list);
      }

      const foot = el("div", "foot");
      const open = el("button", "open");
      open.append(document.createTextNode("Open World Terminal"), svgEl("external", "ic xs"));
      open.onclick = () => chrome.runtime.sendMessage({ type: "openSidePanel" });
      const right = el("div", "foot-right");
      if (data.status?.at) right.append(el("span", "ago", ago(data.status.at)));
      const hide = el("button", "hide", "Hide here");
      hide.title = "Hide the panel on this event for 24 hours";
      hide.onclick = () => chrome.storage.local.set({ wtOverlayHidden: { ...(data.wtOverlayHidden || {}), [ticker]: Date.now() } });
      right.append(hide);
      foot.append(open, right);
      body.append(foot);
      panel.append(body);
    }

    root.querySelector(".panel")?.remove();
    root.append(panel);
  }

  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
  }

  let lastPath = null;
  function tick() {
    syncToken();
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      render().catch(() => {});
    }
  }

  tick();
  setInterval(tick, 1500);
  chrome.storage.onChanged.addListener((changes) => {
    if (["rows", "moves", "unlock", "watchlist", "wtOverlayCollapsed", "wtOverlayHidden"].some((k) => k in changes) && eventTickerFromPath()) render().catch(() => {});
  });
})();
