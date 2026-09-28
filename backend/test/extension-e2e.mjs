// Full system: the real extension (pointed at a local backend) + wrangler dev + mock upstream.
// Signs in through /connect with a mock Phantom provider that signs with a real Ed25519 key.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, writeFileSync, readFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { sampleEvents } from "../../scripts/sample-data.mjs";

const UP = 8793;
const API = 8794;
const BASE = `http://127.0.0.1:${API}`;
const root = resolve(new URL("../..", import.meta.url).pathname);
const events = sampleEvents();

const upstream = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/events") {
    const cursor = Number(url.searchParams.get("cursor") || 0);
    return send(200, { events: events.slice(cursor, cursor + 40), cursor: cursor + 40 });
  }
  if (/^\/users\/[^/]+\/referral$/.test(url.pathname)) {
    if (req.headers.authorization !== "Bearer world-session") return send(401, {});
    return send(200, { code: "ABCDEFGH", referredCount: 0, referredBy: "AB12CD34" });
  }
  send(404, {});
}).listen(UP);

// Extension copy pointed at the local backend.
const ext = mkdtempSync(join(tmpdir(), "wt-ext-"));
for (const p of ["manifest.json", "src", "icons"]) cpSync(join(root, p), join(ext, p), { recursive: true });
const cfgPath = join(ext, "src/config.js");
writeFileSync(cfgPath, readFileSync(cfgPath, "utf8").replace('BACKEND_URL: ""', `BACKEND_URL: "${BASE}"`).replace('REFERRAL_CODE: ""', 'REFERRAL_CODE: "AB12CD34"'));
const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
manifest.host_permissions.push(`${BASE}/*`);
manifest.externally_connectable = { matches: [`${BASE}/*`] };
writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));

const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const profile = mkdtempSync(join(tmpdir(), "wt-prof-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];

writeFileSync(
  ".dev.vars",
  [`SESSION_SECRET=e2e-secret-0123456789abcdef`, `UPSTREAM_URL=http://127.0.0.1:${UP}`, `USERS_API_URL=http://127.0.0.1:${UP}`, `REFERRAL_CODE=AB12CD34`, `EXTENSION_IDS=${extId}`].join("\n"),
);
rmSync(".wrangler/state", { recursive: true, force: true });
execSync("npx wrangler d1 migrations apply world-terminal --local", { stdio: "ignore" });
const dev = spawn("npx", ["wrangler", "dev", "--local", "--port", String(API), "--test-scheduled", "--ip", "127.0.0.1"], { stdio: "ignore", detached: true });

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e.message;
    }
    if (Date.now() > end) throw new Error(`timed out (last: ${JSON.stringify(last)?.slice(0, 200)})`);
    await new Promise((r) => setTimeout(r, 300));
  }
};

try {
  await until(async () => (await fetch(`${BASE}/v1/health`)).ok, 60000);
  await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`);
  await until(async () => (await (await fetch(`${BASE}/v1/health`)).json()).status?.state === "ok");

  const app = await ctx.newPage();
  const errors = [];
  app.on("pageerror", (e) => errors.push(e.message));
  await app.setViewportSize({ width: 400, height: 600 });
  await app.goto(`chrome-extension://${extId}/src/ui/app.html`);
  // Pretend the user opened world.xyz: give the extension a World session token.
  await app.evaluate(() =>
    chrome.storage.local.set({ auth: { token: "world-session", expiry: Date.now() + 3600e3 }, onboarding: { step: 4, maxStep: 4, completed: true } }),
  );

  await check("free user gets the backend's top 10 via /v1/feed", async () => {
    await app.click("#btn-refresh");
    const st = await until(() => app.evaluate(async () => (await chrome.storage.local.get("status")).status?.source === "backend" && chrome.storage.local.get(["status", "rows"])));
    assert.equal(st.rows.length, 10);
    assert.ok(st.status.total > 10);
    await app.waitForTimeout(400);
    assert.equal(await app.locator("#view > .mrow").count(), 10);
    assert.match(await app.locator(".gate h3").first().textContent(), /more markets/);
  });

  await check("free signals arrive redacted from the server", async () => {
    await app.click('[data-tab="signals"]');
    await app.waitForTimeout(300);
    const text = await app.locator("#view").textContent();
    assert.match(text, /live signals? found/);
    const o = await app.evaluate(async () => (await chrome.storage.local.get("opportunities")).opportunities);
    assert.equal(o.underround[0].redacted, true);
  });

  let connectUrl;
  await check("unlock sheet opens the backend sign-in page", async () => {
    await app.click("#banner .btn");
    await app.waitForTimeout(300);
    const [tab] = await Promise.all([ctx.waitForEvent("page"), app.click("text=Sign in with wallet")]);
    await tab.waitForLoadState();
    assert.ok(tab.url().startsWith(`${BASE}/connect?ext=${extId}`));
    assert.ok(!tab.url().includes("#wt="), "World token should be removed from the address bar");
    await tab.close();
    // The tab strips the token from its URL on load, so take the original link from the extension.
    connectUrl = (await app.evaluate(() => chrome.runtime.sendMessage({ type: "connectUrl" }))).url;
    assert.ok(connectUrl.includes("#wt=world-session"));
  });

  await check("wallet sign-in hands a Pro session to the extension", async () => {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`connect: ${e.message}`));
    await page.addInitScript(() => {
      const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const b58 = (buf) => {
        const d = [0];
        for (const byte of buf) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
        let out = ""; for (const byte of buf) { if (byte !== 0) break; out += "1"; }
        return out + d.reverse().map((x) => B58[x]).join("");
      };
      let keys;
      window.phantom = {
        solana: {
          async connect() {
            keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
            const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
            this.publicKey = { toString: () => b58(raw) };
            return { publicKey: this.publicKey };
          },
          async signMessage(msg) {
            return { signature: new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, msg)) };
          },
        },
      };
    });
    await page.goto(connectUrl);
    await page.waitForTimeout(500);
    if (await page.locator("#go").isDisabled()) throw new Error(`button disabled; page said: ${await page.locator("#msg").textContent()} (url ${connectUrl})`);
    await page.click("#go");
    await page.waitForSelector(".msg.ok", { timeout: 15000 }).catch(async (e) => { throw new Error(`connect page said: ${await page.locator("#msg").textContent()}`); });
    assert.match(await page.locator("#msg").textContent(), /Pro is active/);
    await page.close();
    const s = await until(() => app.evaluate(async () => (await chrome.storage.local.get("unlock")).unlock?.ok && chrome.storage.local.get(["unlock", "session"])));
    assert.equal(s.unlock.via, "backend");
    assert.ok(s.session.token.split(".").length === 3);
  });

  await check("Pro user now gets every market from the backend", async () => {
    await app.reload();
    await app.click("#btn-refresh");
    const rows = await until(async () => {
      const { rows, status } = await app.evaluate(() => chrome.storage.local.get(["rows", "status"]));
      return rows.length === status.total && rows.length > 10 && rows;
    });
    assert.ok(rows.length > 10);
    await app.waitForTimeout(400);
    assert.equal(await app.locator(".pro-chip").count(), 1);
    await app.click('[data-tab="signals"]');
    await app.waitForTimeout(300);
    assert.equal(await app.locator(".scard").first().locator(".s-title").textContent().then((t) => t !== "Pro signal"), true);
  });

  await check("sign out drops back to free", async () => {
    await app.evaluate(() => chrome.runtime.sendMessage({ type: "signOut" }));
    await until(async () => (await app.evaluate(async () => (await chrome.storage.local.get("rows")).rows.length)) === 10);
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await ctx.close();
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
  upstream.close();
  rmSync(".dev.vars", { force: true });
  rmSync(ext, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("✗")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
