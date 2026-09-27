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

  async function render() {
    const ticker = eventTickerFromPath();
    if (!ticker) {
      panel?.remove();
      panel = null;
      currentEvent = null;
      return;
    }
    currentEvent = ticker;
    const [{ rows = [] }, state] = await Promise.all([
      chrome.storage.local.get("rows"),
      chrome.runtime.sendMessage({ type: "unlockState" }).catch(() => ({ unlocked: false })),
    ]);
    if (currentEvent !== ticker) return;

    panel?.remove();
    panel = el("div", "wt-panel");
    const head = el("div", "wt-head");
    head.append(el("span", "wt-brand", "World Terminal"));
    const close = el("button", "wt-close", "×");
    close.title = "Hide";
    close.onclick = () => panel.remove();
    head.append(close);
    panel.append(head);

    if (!state.unlocked) {
      panel.append(el("p", "wt-muted", "Unlock spread, liquidity score and alerts for this market."));
      const btn = el("button", "wt-cta", "Unlock World Terminal");
      btn.onclick = () => chrome.runtime.sendMessage({ type: "openSidePanel" });
      panel.append(btn);
    } else {
      const mine = rows.filter((r) => r.eventTicker === ticker).sort((a, b) => b.score - a.score);
      if (!mine.length) {
        panel.append(el("p", "wt-muted", "No live quotes for this event yet."));
      } else {
        const table = el("table", "wt-table");
        const hr = el("tr");
        for (const h of ["Outcome", "Bid", "Ask", "Spread", "Liq"]) hr.append(el("th", "", h));
        table.append(hr);
        for (const r of mine.slice(0, 12)) {
          const tr = el("tr");
          tr.append(
            el("td", "wt-name", r.title),
            el("td", "", cents(r.yesBid)),
            el("td", "", cents(r.yesAsk)),
            el("td", r.spread !== null && r.spread <= 0.03 ? "wt-good" : "", cents(r.spread)),
            el("td", r.score >= 60 ? "wt-good" : r.score < 30 ? "wt-bad" : "", String(r.score)),
          );
          table.append(tr);
        }
        panel.append(table);
      }
    }
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
    if ((changes.rows || changes.unlock) && eventTickerFromPath()) render().catch(() => {});
  });
})();
