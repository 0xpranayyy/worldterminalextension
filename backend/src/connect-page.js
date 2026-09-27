// Wallet sign-in page served at /connect. Opened by the extension as
//   /connect?ext=<extension id>#wt=<user's World session token>
// It signs a nonce with the user's Solana wallet, gets a session from /v1/auth/verify and hands
// it to the extension via chrome.runtime.sendMessage (externally_connectable).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function connectPage(env) {
  const invite = env.REFERRAL_CODE ? `https://world.xyz/?ref=${encodeURIComponent(env.REFERRAL_CODE)}` : "https://world.xyz";
  const allowed = String(env.EXTENSION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · World Terminal</title>
<style>
  :root { color-scheme: dark; --bg:#0a0b0d; --s:#13151a; --line:rgba(255,255,255,.1); --t:#edeff2; --t2:#a3aab4; --t3:#6a727e; --yes:#3dd68c; --no:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:radial-gradient(60% 50% at 50% 0%, rgba(124,156,255,.12), transparent 70%), var(--bg); color:var(--t);
    font:14px/1.5 "Inter","SF Pro Text",-apple-system,"Segoe UI",system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .card { width:100%; max-width:400px; background:var(--s); border:1px solid var(--line); border-radius:18px; padding:28px 24px; display:grid; gap:14px; box-shadow:0 30px 80px rgba(0,0,0,.5); }
  .brand { display:flex; align-items:center; gap:8px; font-weight:700; }
  h1 { margin:6px 0 0; font-size:22px; letter-spacing:-.02em; }
  p { margin:0; color:var(--t2); }
  button, a.btn { all:unset; box-sizing:border-box; display:flex; align-items:center; justify-content:center; height:44px; border-radius:11px; font-weight:700; cursor:pointer; text-align:center; }
  .primary { background:var(--t); color:#0a0b0d; }
  .gold { background:linear-gradient(135deg,#f5e2a8,#c9a45c); color:#1d1606; }
  button:disabled { opacity:.55; cursor:default; }
  .msg { font-size:13px; min-height:20px; }
  .ok { color:var(--yes); } .err { color:var(--no); }
  .fine { color:var(--t3); font-size:12px; }
  code { font:12px "SF Mono",ui-monospace,Menlo,monospace; color:var(--t2); }
</style></head>
<body><main class="card">
  <div class="brand"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.8"/></svg>World Terminal</div>
  <h1>Sign in with your wallet</h1>
  <p>Use the wallet you connected on World. You'll sign a short message; it costs nothing and moves no funds.</p>
  <button id="go" class="primary">Connect wallet</button>
  <div id="msg" class="msg" role="status" aria-live="polite"></div>
  <a id="invite" class="btn gold" href="${esc(invite)}" target="_blank" rel="noopener" hidden>Join World with our invite</a>
  <p class="fine">Works with Phantom, Solflare and Backpack. World Terminal never asks for your seed phrase.</p>
</main>
<script>
(() => {
  const ALLOWED = ${JSON.stringify(allowed)};
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const ext = params.get("ext");
  const worldToken = hash.get("wt") || null;
  history.replaceState(null, "", location.pathname + location.search); // keep the World token out of history
  const $ = (id) => document.getElementById(id);
  const say = (text, cls = "") => { $("msg").textContent = text; $("msg").className = "msg " + cls; };

  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58(buf) {
    const d = [0];
    for (const byte of buf) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
    let out = ""; for (const byte of buf) { if (byte !== 0) break; out += "1"; }
    return out + d.reverse().map((x) => B58[x]).join("");
  }
  function provider() {
    return window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana || null;
  }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  if (!ext || (ALLOWED.length && !ALLOWED.includes(ext))) {
    say("Open this page from the World Terminal extension.", "err");
    $("go").disabled = true;
    return;
  }

  $("go").onclick = async () => {
    const p = provider();
    if (!p) { say("No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.", "err"); return; }
    $("go").disabled = true;
    try {
      say("Connecting…");
      const conn = await p.connect();
      const wallet = (conn?.publicKey || p.publicKey).toString();
      const { nonce, message } = await post("/v1/auth/nonce", { wallet });
      say("Approve the message in your wallet…");
      const signed = await p.signMessage(new TextEncoder().encode(message), "utf8");
      const sig = signed?.signature || signed;
      const session = await post("/v1/auth/verify", { wallet, nonce, signature: b58(new Uint8Array(sig)), worldToken });
      await new Promise((resolve, reject) => {
        if (!window.chrome?.runtime?.sendMessage) return reject(new Error("Open this page in Chrome with World Terminal installed."));
        chrome.runtime.sendMessage(ext, { type: "backendSession", ...session }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) reject(new Error("Couldn't reach the extension. Is World Terminal installed?"));
          else resolve();
        });
      });
      if (session.pro) {
        say("Signed in. Pro is active. You can close this tab.", "ok");
        $("go").hidden = true;
      } else {
        say(session.referredBy ? "Signed in on the free plan. This wallet joined World with a different invite." : "Signed in on the free plan. Join World with our invite and confirm it in your wallet to unlock Pro, then sign in again.", "err");
        $("invite").hidden = !!session.referredBy;
        $("go").textContent = "Sign in again";
        $("go").disabled = false;
      }
    } catch (e) {
      say(e.message || String(e), "err");
      $("go").disabled = false;
    }
  };
})();
</script></body></html>`;
}
