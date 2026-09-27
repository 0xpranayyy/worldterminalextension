// Runs on world.xyz. Two jobs:
// 1. Hand the session token that world.xyz already obtained for this user to the extension.
// 2. On /event/<ticker> pages, show liquidity stats for that event's markets.
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

  // ---------- Event page overlay ----------

  let panel = null;
  let currentEvent = null;

  function eventTickerFromPath() {
    const m = location.pathname.match(/^\/event\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  const cents = (p) => (p === null || p === undefined ? "–" : `${Math.round(p * 100)}¢`);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const LOGO =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18" stroke="currentColor" stroke-width="2"/></svg>';

  async function render() {
    const ticker = eventTickerFromPath();
    if (!ticker) {
      panel?.remove();
      panel = null;
      currentEvent = null;
      return;
    }
    currentEvent = ticker;
    const [{ rows = [], wtOverlayCollapsed = false }, state] = await Promise.all([
      chrome.storage.local.get(["rows", "wtOverlayCollapsed"]),
      chrome.runtime.sendMessage({ type: "unlockState" }).catch(() => ({ unlocked: false })),
    ]);
    if (currentEvent !== ticker) return;
    const mine = rows.filter((r) => r.eventTicker === ticker).sort((a, b) => b.score - a.score);

    panel?.remove();
    panel = el("div", `wt-panel${wtOverlayCollapsed ? " wt-collapsed" : ""}`);
    const head = el("button", "wt-head");
    head.title = wtOverlayCollapsed ? "Expand" : "Collapse";
    const brand = el("span", "wt-brand");
    brand.innerHTML = LOGO;
    brand.append(el("span", "", "World Terminal"));
    head.append(brand);
    if (state.unlocked && mine.length) {
      const best = mine[0];
      head.append(el("span", `wt-pill ${best.score >= 65 ? "wt-good" : best.score < 35 ? "wt-bad" : ""}`, `Liq ${best.score}`));
    } else if (!state.unlocked) head.append(el("span", "wt-pill wt-gold", "PRO"));
    head.append(el("span", "wt-caret", wtOverlayCollapsed ? "▴" : "▾"));
    head.onclick = () => chrome.storage.local.set({ wtOverlayCollapsed: !wtOverlayCollapsed });
    panel.append(head);

    const body = el("div", "wt-body");
    if (!state.unlocked) {
      body.append(el("p", "wt-muted", "See spread, liquidity score and set alerts for every outcome on this page."));
      const btn = el("button", "wt-cta", "Unlock Pro, free");
      btn.onclick = () => chrome.runtime.sendMessage({ type: "openSidePanel" });
      body.append(btn);
    } else if (!mine.length) {
      body.append(el("p", "wt-muted", "No live quotes for this event yet."));
    } else {
      const table = el("table", "wt-table");
      const hr = el("tr");
      for (const h of ["Outcome", "YES", "Spread", "Liq"]) hr.append(el("th", "", h));
      table.append(hr);
      for (const r of mine.slice(0, 12)) {
        const tr = el("tr");
        const liq = el("td", "wt-liq");
        const bar = el("span", "wt-bar");
        const fill = el("span", r.score >= 65 ? "wt-fill-good" : r.score < 35 ? "wt-fill-bad" : "wt-fill");
        fill.style.width = `${r.score}%`;
        bar.append(fill);
        liq.append(bar, el("span", "wt-n", String(r.score)));
        tr.append(
          el("td", "wt-name", r.title),
          el("td", "wt-n", cents(r.yesAsk)),
          el("td", `wt-n ${r.spread !== null && r.spread <= 0.03 ? "wt-good" : r.spread >= 0.08 ? "wt-bad" : ""}`, cents(r.spread)),
          liq,
        );
        table.append(tr);
      }
      body.append(table);
      const open = el("button", "wt-link", "Open in World Terminal →");
      open.onclick = () => chrome.runtime.sendMessage({ type: "openSidePanel" });
      body.append(open);
    }
    panel.append(body);
    document.body.append(panel);
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
    if ((changes.rows || changes.unlock || changes.wtOverlayCollapsed) && eventTickerFromPath()) render().catch(() => {});
  });
})();
