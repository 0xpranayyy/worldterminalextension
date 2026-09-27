import { inviteUrl } from "../config.js";

document.getElementById("invite").href = inviteUrl("/");

async function render() {
  const { auth, status, unlock } = await chrome.storage.local.get(["auth", "status", "unlock"]);
  const connected = auth && auth.expiry > Date.now();
  const c = document.getElementById("connect-status");
  document.getElementById("step-connect").classList.toggle("done", !!connected);
  c.className = `status ${connected ? "yes" : "warn"}`;
  c.textContent = connected
    ? status?.state === "ok"
      ? `✓ Connected · ${status.markets} live markets`
      : "✓ Connected · loading markets…"
    : "Waiting for world.xyz…";

  const p = document.getElementById("pro-status");
  document.getElementById("step-pro").classList.toggle("done", !!unlock?.ok);
  p.className = `status ${unlock?.ok ? "yes" : "faint"}`;
  p.textContent = unlock?.ok ? "✓ Pro unlocked" : "Free plan";
}

chrome.storage.onChanged.addListener(render);
render();
