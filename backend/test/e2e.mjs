// End-to-end: runs the Worker locally (wrangler dev, local D1 + KV) against a mock upstream
// that serves sample events and referral lookups, then exercises every endpoint.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import { sampleEvents } from "../../scripts/sample-data.mjs";
import { base58Encode } from "../src/auth.js";

const UP = 8791;
const API = 8792;
const BASE = `http://127.0.0.1:${API}`;
const events = sampleEvents();

function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { address: base58Encode(raw), signMsg: (m) => base58Encode(sign(null, Buffer.from(m), privateKey)) };
}
const pro = wallet();
const other = wallet();
const fresh = wallet();
const referrals = { [pro.address]: "REFCODE1", [other.address]: "SOMEONE9" };

// ---- mock upstream (markets + users API) ----
const upstream = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/events") {
    if (req.headers.authorization !== "Bearer up-token") return send(401, { error: "Unauthorized" });
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const limit = Number(url.searchParams.get("limit") || 40);
    return send(200, { events: events.slice(cursor, cursor + limit), cursor: cursor + limit });
  }
  const m = url.pathname.match(/^\/users\/([^/]+)\/referral$/);
  if (m) {
    if (req.headers.authorization !== "Bearer world-session") return send(401, { error: "Unauthorized" });
    return send(200, { code: "ABCDEFGH", referredCount: 0, referredBy: referrals[decodeURIComponent(m[1])] ?? null });
  }
  send(404, {});
}).listen(UP);

writeFileSync(
  ".dev.vars",
  [
    `SESSION_SECRET=test-secret-please-change-0123456789`,
    `UPSTREAM_URL=http://127.0.0.1:${UP}`,
    `UPSTREAM_TOKEN=up-token`,
    `USERS_API_URL=http://127.0.0.1:${UP}`,
    `REFERRAL_CODE=REFCODE1`,
    `EXTENSION_IDS=testextensionid`,
  ].join("\n"),
);
rmSync(".wrangler/state", { recursive: true, force: true });
execSync("npx wrangler d1 migrations apply world-terminal --local", { stdio: "ignore" });

const dev = spawn("npx", ["wrangler", "dev", "--local", "--port", String(API), "--test-scheduled", "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/v1/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev did not start:\n" + log);
}

const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
async function signIn(w, { worldToken = "world-session", tamper = false } = {}) {
  const n = await post("/v1/auth/nonce", { wallet: w.address });
  assert.equal(n.status, 200);
  const signature = tamper ? other.signMsg(n.body.message) : w.signMsg(n.body.message);
  return { nonce: n.body.nonce, res: await post("/v1/auth/verify", { wallet: w.address, nonce: n.body.nonce, signature, worldToken }) };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
}

try {
  await waitReady();

  await check("feed is warming before the first poll", async () => {
    const r = await get("/v1/feed");
    assert.equal(r.status, 503);
  });

  await check("cron poll ingests the upstream feed", async () => {
    await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`);
    await new Promise((r) => setTimeout(r, 1500));
    const r = await get("/v1/health");
    assert.equal(r.body.status.state, "ok");
    assert.equal(r.body.status.events, events.length);
    assert.ok(r.body.status.markets > 20);
  });

  await check("anonymous feed: top 10 rows, redacted signals", async () => {
    const r = await get("/v1/feed");
    assert.equal(r.status, 200);
    assert.equal(r.body.plan, "free");
    assert.equal(r.body.rows.length, 10);
    assert.ok(r.body.total > 10);
    assert.ok(r.body.opportunities.underround.length > 0);
    assert.equal(r.body.opportunities.underround[0].redacted, true);
    assert.equal(r.body.opportunities.underround[0].title, undefined);
  });

  let proToken;
  await check("referred wallet signs in as Pro", async () => {
    const { res } = await signIn(pro);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.pro, true);
    proToken = res.body.token;
  });

  await check("Pro feed: all rows and full signals", async () => {
    const r = await get("/v1/feed", proToken);
    assert.equal(r.body.plan, "pro");
    assert.equal(r.body.rows.length, r.body.total);
    assert.ok(r.body.opportunities.underround[0].title);
  });

  await check("/v1/me and /v1/history for Pro", async () => {
    const me = await get("/v1/me", proToken);
    assert.equal(me.body.pro, true);
    const h = await get("/v1/history?ticker=WXNFL-KC&hours=24", proToken);
    assert.equal(h.status, 200);
    assert.ok(h.body.points.length >= 1);
  });

  await check("wallet referred by someone else is free", async () => {
    const { res } = await signIn(other);
    assert.equal(res.body.pro, false);
    assert.equal(res.body.referredBy, "SOMEONE9");
    const f = await get("/v1/feed", res.body.token);
    assert.equal(f.body.plan, "free");
    assert.equal((await get("/v1/history?ticker=WXNFL-KC", res.body.token)).status, 403);
  });

  await check("wallet with no referral is free", async () => {
    const { res } = await signIn(fresh);
    assert.equal(res.body.pro, false);
    assert.equal(res.body.referredBy, null);
  });

  await check("signature from another key is rejected", async () => {
    const { res } = await signIn(fresh, { tamper: true });
    assert.equal(res.status, 401);
  });

  await check("nonce can't be reused", async () => {
    const n = await post("/v1/auth/nonce", { wallet: pro.address });
    const signature = pro.signMsg(n.body.message);
    const first = await post("/v1/auth/verify", { wallet: pro.address, nonce: n.body.nonce, signature, worldToken: "world-session" });
    const second = await post("/v1/auth/verify", { wallet: pro.address, nonce: n.body.nonce, signature, worldToken: "world-session" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 401);
  });

  await check("expired World session gives a clear error", async () => {
    const { res } = await signIn(pro, { worldToken: "stale" });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /World session/);
  });

  await check("forged session token is ignored", async () => {
    const [h, , s] = proToken.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: pro.address, exp: 9999999999 })).toString("base64url")}.${s}`;
    assert.equal((await get("/v1/me", forged)).status, 401);
    assert.equal((await get("/v1/feed", forged)).body.plan, "free");
  });

  await check("invalid wallet is rejected", async () => {
    assert.equal((await post("/v1/auth/nonce", { wallet: "not-a-wallet" })).status, 400);
  });

  await check("/connect serves the sign-in page", async () => {
    const r = await fetch(`${BASE}/connect?ext=testextensionid`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Sign in with your wallet/);
  });

  await check("/v1/stats counts users", async () => {
    const r = await get("/v1/stats");
    assert.equal(r.body.users, 3);
    assert.equal(r.body.pro, 1);
  });
} finally {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
  upstream.close();
  rmSync(".dev.vars", { force: true });
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("✗")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
