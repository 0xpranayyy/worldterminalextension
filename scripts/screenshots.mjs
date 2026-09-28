// Loads the unpacked extension in Chromium with sample data and captures every screen.
//   npm run screenshots          → store/screenshots/*.png (1280×800 store images + raw UI shots)
// Set CHROMIUM_PATH if Playwright's bundled Chromium isn't installed.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { sampleState, sampleRpcReply } from "./sample-data.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = join(root, "store/screenshots");
const raw = join(out, "raw");
mkdirSync(raw, { recursive: true });

// Mock Solana RPC for the Portfolio tab (CORS-enabled like public RPCs).
const rpc = createServer((req, res) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const calls = JSON.parse(body);
    res.writeHead(200, headers).end(JSON.stringify(sampleRpcReply(calls.map((c) => c.id))));
  });
}).listen(8899);

const profile = join(tmpdir(), `wt-shots-${Date.now()}`);
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--headless=new"],
});

const errors = [];
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const url = (p) => `chrome-extension://${id}/src/ui/${p}`;
await new Promise((r) => setTimeout(r, 1500)); // let the install-time refresh finish

async function page(path, size = { width: 400, height: 600 }) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${path}: ${m.text()}`));
  await p.setViewportSize(size);
  await p.goto(url(path));
  return p;
}

async function seed(p, { pro }) {
  const s = sampleState();
  await p.evaluate(
    async ({ s, pro }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        ...s,
        settings: { rpcUrl: "http://127.0.0.1:8899" },
        ...(pro ? { unlock: { ok: true, wallet: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", referredBy: "SAMPLE01", verifiedAt: Date.now() } } : {}),
      });
    },
    { s, pro },
  );
  await p.reload();
  await p.waitForTimeout(600);
}

const shot = (p, name) => p.screenshot({ path: join(raw, `${name}.png`) });

// ---- Free plan ----
let p = await page("app.html");
await seed(p, { pro: false });
await shot(p, "free-markets");
await p.click('[data-tab="signals"]');
await p.waitForTimeout(300);
await shot(p, "free-signals");
await p.click("#banner .btn");
await p.waitForTimeout(400);
await shot(p, "unlock");
await p.close();

// ---- Pro ----
p = await page("app.html");
await seed(p, { pro: true });
await p.click('[data-tab="markets"]');
await p.waitForTimeout(300);
await shot(p, "markets");
await p.locator(".mrow", { hasText: "Chiefs" }).first().click();
await p.waitForTimeout(500);
await shot(p, "detail");
await p.click("text=Share");
await p.waitForTimeout(500);
await shot(p, "share-market");
await p.locator(".share-preview").screenshot({ path: join(raw, "card-market.png") });
await p.keyboard.press("Escape");
await p.click('[data-tab="signals"]');
await p.waitForTimeout(300);
await shot(p, "signals");
await p.locator(".s-share").first().click();
await p.waitForTimeout(500);
await p.locator(".share-preview").screenshot({ path: join(raw, "card-signal.png") });
await p.keyboard.press("Escape");
await p.click('#signal-chips .chip:nth-child(4)');
await p.waitForTimeout(300);
await shot(p, "movers");
await p.click('[data-tab="watch"]');
await p.waitForTimeout(300);
await shot(p, "watchlist");
await p.click('[data-tab="portfolio"]');
await p.waitForSelector(".pf-row", { timeout: 8000 });
await p.waitForTimeout(300);
await shot(p, "portfolio");
await p.click("#btn-settings");
await p.waitForTimeout(400);
await shot(p, "settings");
await p.keyboard.press("Escape");
await p.click('[data-tab="markets"]');
await p.close();

// ---- Welcome ----
p = await page("welcome.html", { width: 1280, height: 800 });
await p.waitForTimeout(400);
await shot(p, "welcome");
await p.close();

// ---- Overlay on a stubbed world.xyz event page ----
p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(`overlay: ${e.message}`));
await p.setViewportSize({ width: 1280, height: 800 });
await p.route("https://world.xyz/**", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f2;font:16px system-ui;color:#111">
      <div style="padding:48px 64px;max-width:760px"><div style="color:#777;font-size:13px;letter-spacing:.08em">SOCCER · PREMIER LEAGUE</div>
      <h1 style="font-size:40px;margin:8px 0 24px">Premier League 2026–27 winner</h1>
      ${[["Arsenal", "34%"], ["Liverpool", "28%"], ["Manchester City", "21%"], ["Chelsea", "9%"], ["Any other club", "6%"]].map(([n, v]) => `<div style="display:flex;justify-content:space-between;padding:18px 0;border-top:1px solid #ddd"><b>${n}</b><span>${v}</span></div>`).join("")}
      <p style="color:#888;font-size:12px;margin-top:24px">Stub page for screenshots</p></div></body></html>`,
  }),
);
await p.goto("https://world.xyz/event/WXEPL-2627-WIN");
await p.waitForSelector(".wt-panel", { timeout: 5000 });
await p.waitForTimeout(600);
await p.screenshot({ path: join(raw, "overlay.png") });
await p.close();

await ctx.close();
rmSync(profile, { recursive: true, force: true });

// ---- 1280×800 store images (the store requires exactly this size, so render at 1×) ----
const browser = await chromium.launch({ executablePath, headless: true });
const frames = [
  ["01-markets", "markets", "Every World market,<br>ranked by liquidity.", "Spread, volume and open interest rolled into one score, refreshed every minute."],
  ["02-detail", "detail", "Know the price<br>before you trade.", "Live YES/NO quotes, a price chart, and why each market scores the way it does."],
  ["03-signals", "signals", "Arbitrage,<br>found for you.", "Outcome sets and YES+NO pairs priced under the $1 payout, plus closing favorites and movers."],
  ["04-portfolio", "portfolio", "Your positions,<br>valued live.", "What every World position would sell for right now, and which ones are hard to exit."],
];
p = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const [name, src, title, sub] of frames) {
  const img = readFileSync(join(raw, `${src}.png`)).toString("base64");
  await p.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;
    background:radial-gradient(60% 70% at 85% 40%,rgba(124,156,255,.20),transparent 70%),radial-gradient(40% 50% at 0% 100%,rgba(201,164,92,.10),transparent 70%),#0a0b0d;
    font-family:Inter,'SF Pro Display',-apple-system,'Segoe UI',system-ui,sans-serif;color:#edeff2;display:grid;grid-template-columns:1fr 480px;align-items:center;padding:0 96px;box-sizing:border-box;gap:40px">
    <div><div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#a3aab4"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#edeff2" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="#edeff2" stroke-width="1.8"/><path d="M3 12h18" stroke="#edeff2" stroke-width="1.8"/></svg>World Terminal</div>
    <h1 style="font-size:58px;line-height:1.02;letter-spacing:-.04em;margin:28px 0 20px">${title}</h1>
    <p style="font-size:21px;line-height:1.45;color:#a3aab4;max-width:30ch;margin:0">${sub}</p></div>
    <img src="data:image/png;base64,${img}" style="width:440px;border-radius:18px;border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 90px rgba(0,0,0,.6)"/>
    </body></html>`);
  await p.screenshot({ path: join(out, `${name}.png`) });
}
{
  const img = readFileSync(join(raw, "overlay.png")).toString("base64");
  await p.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/png;base64,${img}" style="width:1280px;height:800px;display:block"/></body></html>`);
  await p.screenshot({ path: join(out, "05-overlay.png") });
}
await browser.close();
rpc.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`Screenshots written to ${out}`);
