import { CONFIG, DEFAULT_SETTINGS, DEV_BUILD, normalizeCode, inviteUrl, categoryName, WORLD_ORIGIN } from "../config.js";

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

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

const PATHS = {
  gauge: '<path d="M4 16a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12 16 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  radar: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 12 18 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 9.5h17M16 14h1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 6l9-2.5L16.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  crown: '<path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" fill="currentColor"/><rect x="4" y="18.5" width="16" height="2" rx="1" fill="currentColor"/>',
  puzzle: '<path d="M10 4.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H17a2 2 0 0 0 0 4h1.5V18a1 1 0 0 1-1 1H14v-1.5a2 2 0 0 0-4 0V19H6.5a1 1 0 0 1-1-1v-3.5H7a2 2 0 0 0 0-4H5.5V7a1 1 0 0 1 1-1H10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  pin: '<path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3zM12 14.5V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.8"/>',
};
const icon = (name) => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", html: PATHS[name] });

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "connect", label: "Connect World" },
  { id: "pro", label: "Unlock Pro" },
  { id: "personalize", label: "Personalize" },
  { id: "finish", label: "Pin & go" },
];

const DEFAULT_CATEGORIES = ["crypto", "football", "soccer", "basketball", "baseball", "economics", "politics", "mma", "tennis"];

const st = {
  step: 0,
  maxStep: 0,
  auth: null,
  status: null,
  unlocked: DEV_BUILD,
  dev: DEV_BUILD,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  tabId: null,
  autoAdvanced: false,
};

const connected = () => !!(st.auth && st.auth.expiry > Date.now());
const live = () => st.status?.state === "ok";

async function saveOnboarding(extra = {}) {
  await chrome.storage.local.set({ onboarding: { step: st.step, maxStep: st.maxStep, completed: false, ...extra } });
}

function go(i) {
  st.step = Math.max(0, Math.min(STEPS.length - 1, i));
  st.maxStep = Math.max(st.maxStep, st.step);
  saveOnboarding();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- chrome ----------

function renderChrome() {
  $("#progress-bar").style.width = `${((st.step + 1) / STEPS.length) * 100}%`;
  $("#step-count").textContent = `Step ${st.step + 1} of ${STEPS.length}`;
  $("#stepper").replaceChildren(
    ...STEPS.map((s, i) => {
      const done = i < st.step || (i <= st.maxStep && i !== st.step && isDone(s.id));
      const cls = i === st.step ? "current" : done ? "done" : "";
      return h(
        "li",
        { class: cls, onclick: () => (i <= st.maxStep ? go(i) : null), "aria-current": i === st.step ? "step" : null },
        h("span", { class: "n" }, done && i !== st.step ? "✓" : String(i + 1)),
        s.label,
      );
    }),
  );
  const pill = $("#preview-pill");
  pill.textContent = live() ? "Live" : connected() ? "Connecting" : "Preview";
  pill.classList.toggle("on", live());
  $("#preview-caption").textContent = live()
    ? `Live: ${st.status.markets} World markets, ranked. This is the real extension.`
    : "This is the real extension. It fills in as you finish each step.";
}

function isDone(id) {
  if (id === "connect") return connected();
  if (id === "pro") return st.unlocked;
  return true;
}

// ---------- steps ----------

function stepWelcome() {
  const f = (ic, title, text) => h("li", {}, h("span", { class: "f-icon" }, icon(ic)), h("div", {}, h("b", {}, title), h("span", {}, text)));
  return [
    h("div", { class: "eyebrow" }, "Welcome to World Terminal"),
    h("h1", {}, "Your edge on World's prediction markets."),
    h("p", { class: "lede" }, "Every market on world.xyz, ranked by how cheaply you can get in and out. Arbitrage and closing-favorite signals, price alerts, and your portfolio, in one place."),
    h(
      "ul",
      { class: "features" },
      f("gauge", "Liquidity score for every market", "Spread, volume and open interest in one number from 0 to 100."),
      f("radar", "Signals that find edge for you", "Outcome sets and YES+NO pairs priced under $1, favorites closing soon, big movers."),
      f("wallet", "Alerts and portfolio", "Price alerts on any outcome, and your positions valued at what they'd sell for now."),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "btn primary xl", onclick: () => go(1) }, "Get started"),
      h("span", { class: "meta" }, "Takes about 2 minutes"),
    ),
  ];
}

function stepConnect() {
  const ok = connected();
  const card = h(
    "div",
    { class: `status-card ${ok ? "ok" : ""}` },
    h("div", { class: "state-icon" }, ok ? icon("check") : h("div", { class: "spinner" })),
    h(
      "div",
      {},
      h("b", {}, ok ? (live() ? `Connected · ${st.status.markets.toLocaleString()} live markets` : "Connected · loading markets…") : "Waiting for world.xyz…"),
      h("span", {}, ok ? "World Terminal is reading live prices from World." : "Open world.xyz in a new tab. This page updates by itself."),
    ),
  );
  return [
    h("div", { class: "eyebrow" }, "Step 2"),
    h("h2", {}, "Connect to World"),
    h("p", { class: "lede" }, "World Terminal reads prices using the World session in your browser. Open world.xyz once and it connects automatically."),
    card,
    h(
      "div",
      { class: "actions" },
      ok
        ? h("button", { class: "btn primary xl", onclick: () => go(2) }, "Continue")
        : h("a", { class: "btn primary xl", href: WORLD_ORIGIN, target: "_blank", rel: "noopener" }, "Open world.xyz", icon("external")),
      ok ? null : h("button", { class: "btn ghost xl", onclick: () => go(2) }, "I'll do this later"),
    ),
    h(
      "p",
      { class: "note" },
      icon("shield"),
      "Read-only. World Terminal never sees your wallet keys, can't place trades, and only talks to World. Keep a world.xyz tab open while you use it.",
    ),
  ];
}

function stepPro() {
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  const head = [h("div", { class: "eyebrow" }, "Step 3"), h("h2", {}, "Unlock Pro, free")];
  if (st.dev) {
    return [
      ...head,
      h("p", { class: "lede" }, "Pro unlocks every market, all signals, the portfolio, alerts and on-page stats."),
      h("div", { class: "pro-hero" }, h("span", { class: "badge" }, icon("crown")), h("div", {}, h("b", {}, "Developer build: Pro is unlocked"), h("span", {}, "No invite code is set yet, so every feature is open for testing."))),
      h("div", { class: "actions" }, h("button", { class: "btn primary xl", onclick: () => go(3) }, "Continue")),
    ];
  }
  if (st.unlocked) {
    return [
      ...head,
      h("div", { class: "pro-hero" }, h("span", { class: "badge" }, icon("crown")), h("div", {}, h("b", {}, "You're on Pro"), h("span", {}, "Every market, signal and alert is unlocked."))),
      h("div", { class: "actions" }, h("button", { class: "btn primary xl", onclick: () => go(3) }, "Continue")),
    ];
  }
  const msg = h("div", { class: "msg" });
  const input = h("input", { type: "text", id: "wallet", placeholder: "Your Solana wallet address", spellcheck: "false", autocomplete: "off" });
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
          st.unlocked = true;
          render();
          return;
        }
        msg.className = "msg no";
        msg.textContent = res.reason;
      },
    },
    "Verify",
  );
  const signIn = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        const res = await send({ type: "connectUrl" });
        if (!res?.connected) {
          msg.className = "msg warn";
          msg.textContent = "Connect to World first (step 2) so we can check your invite.";
          return;
        }
        chrome.tabs.create({ url: res.url });
      },
    },
    "Sign in with wallet",
    icon("external"),
  );
  const task = (n, title, text, extra) => h("div", { class: "task" }, h("span", { class: "n" }, String(n)), h("div", {}, h("h4", {}, title), h("p", {}, text), extra));
  return [
    ...head,
    h("p", { class: "lede" }, "Pro is free for everyone who joins World through our invite link. It unlocks every market, all signals, the portfolio and alerts."),
    h(
      "div",
      { class: "tasks" },
      task(1, "Join World with our invite", code ? `Invite code ${code}` : "Opens world.xyz", h("div", { class: "row" }, h("a", { class: "btn gold", href: inviteUrl("/"), target: "_blank", rel: "noopener" }, "Open invite link", icon("external")))),
      task(2, "Confirm the invite in your wallet", "When World shows “Confirm your invite”, approve the signature. It's free and moves no funds."),
      CONFIG.BACKEND_URL
        ? task(3, "Sign in with your wallet", "Sign a free message with the wallet you used on World.", [h("div", { class: "row" }, signIn), msg])
        : task(3, "Verify your wallet", "Paste the wallet you used on World.", [h("div", { class: "row" }, input, verify), msg]),
    ),
    h("div", { class: "actions" }, h("button", { class: "btn ghost xl", onclick: () => go(3) }, "Skip · stay on Free")),
    h("p", { class: "note" }, icon("shield"), "World allows one invite per wallet. Wallets that already joined with another invite stay on the Free plan (top 10 markets)."),
  ];
}

function stepPersonalize() {
  const s = st.settings;
  const cats = st.categories.length ? st.categories : DEFAULT_CATEGORIES;
  const fav = new Set(s.favoriteCategories || []);
  const save = (patch) => {
    st.settings = { ...st.settings, ...patch };
    chrome.storage.local.set({ settings: st.settings });
  };
  const chip = (c) =>
    h(
      "button",
      {
        "aria-pressed": String(fav.has(c)),
        onclick: (e) => {
          fav.has(c) ? fav.delete(c) : fav.add(c);
          e.currentTarget.setAttribute("aria-pressed", String(fav.has(c)));
          save({ favoriteCategories: [...fav] });
        },
      },
      h("span", { class: "tick" }, "✓"),
      categoryName(c),
    );
  const toggle = (key) =>
    h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!s[key], onchange: (e) => save({ [key]: e.target.checked }) }), h("span"));
  const seg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Refresh interval" },
    ...[1, 2, 5].map((m) =>
      h(
        "button",
        {
          "aria-pressed": String(s.refreshMinutes === m),
          onclick: (e) => {
            save({ refreshMinutes: m });
            for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          },
        },
        `${m}m`,
      ),
    ),
  );
  const opt = (title, text, control) => h("div", { class: "option" }, h("div", {}, h("b", {}, title), h("span", {}, text)), control);
  return [
    h("div", { class: "eyebrow" }, "Step 4"),
    h("h2", {}, "Make it yours"),
    h("p", { class: "lede" }, "Pick what you trade and we'll put those markets first. You can change all of this later in Settings."),
    h("div", { class: "field" }, h("div", { class: "field-label" }, "Markets you follow"), h("div", { class: "pick" }, ...cats.map(chip))),
    h(
      "div",
      { class: "field" },
      h("div", { class: "field-label" }, "Notifications & data"),
      h(
        "div",
        { class: "options" },
        opt("Price alerts", "Desktop notification when an outcome hits your price", toggle("notifyAlerts")),
        opt("New arbitrage", "Notify me the moment a new arbitrage appears (Pro)", toggle("notifySignals")),
        opt("Refresh markets every", "Faster uses a little more battery", seg),
      ),
    ),
    h("div", { class: "actions" }, h("button", { class: "btn primary xl", onclick: () => go(4) }, "Continue")),
  ];
}

function stepFinish() {
  const openPanel = () => {
    if (st.tabId !== null) chrome.sidePanel.open({ tabId: st.tabId }).catch(() => {});
  };
  return [
    h("div", { class: "done-mark" }, icon("check")),
    h("div", { class: "eyebrow" }, "Last step"),
    h("h2", {}, "Pin it and you're ready"),
    h("p", { class: "lede" }, "Click the puzzle icon in Chrome's toolbar, then the pin next to World Terminal, so it's always one click away."),
    h(
      "div",
      { class: "pin-demo", "aria-hidden": "true" },
      h(
        "div",
        { class: "chrome-bar" },
        h("div", { class: "omnibox" }, "world.xyz"),
        h("span", { class: "tb-icon ours" }, icon("globe")),
        h("span", { class: "tb-icon hl pulse" }, icon("puzzle")),
      ),
      h(
        "div",
        { class: "ext-menu" },
        h("div", { class: "hd" }, "Extensions"),
        h("div", { class: "ext-item" }, h("img", { src: "../../icons/icon48.png", alt: "" }), "World Terminal", h("span", { class: "pin pulse" }, icon("pin"))),
      ),
    ),
    h("div", { class: "keys" }, "Or open it any time with", h("kbd", {}, "Alt"), "+", h("kbd", {}, "W")),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "btn primary xl",
          onclick: async () => {
            await chrome.storage.local.set({ onboarding: { step: st.step, maxStep: st.maxStep, completed: true, completedAt: Date.now() } });
            const tab = await chrome.tabs.getCurrent();
            if (connected()) chrome.tabs.update({ url: WORLD_ORIGIN }).catch(() => {});
            else if (tab) chrome.tabs.remove(tab.id);
          },
        },
        connected() ? "Finish and go to World" : "Finish setup",
      ),
      h("button", { class: "btn xl", onclick: openPanel }, "Open side panel"),
    ),
  ];
}

const RENDER = { welcome: stepWelcome, connect: stepConnect, pro: stepPro, personalize: stepPersonalize, finish: stepFinish };

function render() {
  renderChrome();
  // Keep typed input when a background update re-renders the Pro step.
  const active = document.activeElement;
  if (active?.id === "wallet" && STEPS[st.step].id === "pro" && !st.unlocked) return;
  $("#panel").replaceChildren(...RENDER[STEPS[st.step].id]());
}

// ---------- data ----------

async function load() {
  const [data, unlock, tab] = await Promise.all([
    chrome.storage.local.get(["auth", "status", "settings", "onboarding", "rows"]),
    send({ type: "unlockState" }).catch(() => null),
    chrome.tabs.getCurrent().catch(() => null),
  ]);
  const wasConnected = connected();
  st.auth = data.auth || null;
  st.status = data.status || null;
  st.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  st.unlocked = !!unlock?.unlocked;
  st.dev = !!unlock?.dev || DEV_BUILD;
  st.tabId = tab?.id ?? null;
  const counts = new Map();
  for (const r of data.rows || []) if (r.category) counts.set(r.category, (counts.get(r.category) || 0) + 1);
  st.categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 12);
  return { data, wasConnected };
}

async function init() {
  const { data } = await load();
  if (data.onboarding && !data.onboarding.completed) {
    st.maxStep = data.onboarding.maxStep || 0;
    st.step = Math.min(data.onboarding.step || 0, STEPS.length - 1);
  }
  render();
}

let pending;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !["auth", "status", "unlock", "rows"].some((k) => k in changes)) return;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const { wasConnected } = await load();
    render();
    // Move on by itself the moment World connects, once.
    if (!wasConnected && connected() && STEPS[st.step].id === "connect" && !st.autoAdvanced) {
      st.autoAdvanced = true;
      setTimeout(() => STEPS[st.step].id === "connect" && go(2), 1400);
    }
  }, 80);
});

$("#skip").addEventListener("click", async () => {
  await chrome.storage.local.set({ onboarding: { step: st.step, maxStep: st.maxStep, completed: true, skipped: true } });
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight" && st.step < st.maxStep) go(st.step + 1);
  if (e.key === "ArrowLeft" && st.step > 0) go(st.step - 1);
});

init();
