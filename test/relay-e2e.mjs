// Simulates a World API that only answers requests coming from https://world.xyz and checks that
// the extension falls back to relaying through the world.xyz tab. Run: node test/relay-e2e.mjs
import { chromium } from "playwright";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { sampleEvents } from "../scripts/sample-data.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const profile = mkdtempSync(join(tmpdir(), "wt-relay-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--headless=new"],
});

const events = sampleEvents();
const seen = { direct: 0, relayed: 0 };
await ctx.route("https://markets-api-proxy.world-xyz.workers.dev/**", async (route) => {
  const req = route.request();
  const origin = req.headers()["origin"];
  const cors = { "Access-Control-Allow-Origin": "https://world.xyz", "Access-Control-Allow-Headers": "authorization", "Content-Type": "application/json" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (origin !== "https://world.xyz") {
    seen.direct++;
    return route.fulfill({ status: 403, headers: cors, body: JSON.stringify({ error: "Forbidden" }) });
  }
  if (req.headers()["authorization"] !== "Bearer tok-123") return route.fulfill({ status: 401, headers: cors, body: "{}" });
  seen.relayed++;
  const url = new URL(req.url());
  const cursor = Number(url.searchParams.get("cursor") || 0);
  route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ events: events.slice(cursor, cursor + 40), cursor: cursor + 40 }) });
});
await ctx.route("https://world.xyz/**", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><title>World</title><p>stub</p>
      <script>localStorage.setItem("TURNSTILE_JWT", JSON.stringify({ token: "tok-123", expiry: Date.now() + 3600e3 }));</script>`,
  }),
);

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
let ok = false;
try {
  const world = await ctx.newPage();
  await world.goto("https://world.xyz/");
  const app = await ctx.newPage();
  await app.goto(`chrome-extension://${id}/src/ui/app.html`);
  let st;
  for (let i = 0; i < 60; i++) {
    st = await app.evaluate(() => chrome.storage.local.get(["status", "rows", "auth"]));
    if (st.status?.state === "ok") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(st.auth?.token, "tok-123", "content script should hand over the world.xyz session");
  assert.equal(st.status?.state, "ok", `status: ${JSON.stringify(st.status)}`);
  assert.equal(st.status.source, "relay");
  assert.ok(st.rows.length > 20);
  assert.ok(seen.relayed > 0);
  await app.waitForTimeout(500);
  assert.match(await app.locator("#live").textContent(), /Live/);
  ok = true;
  console.log(`✓ API rejected direct calls (${seen.direct}); extension relayed ${seen.relayed} through world.xyz and loaded ${st.rows.length} markets`);
} catch (e) {
  console.log(`✗ relay fallback: ${e.message}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
