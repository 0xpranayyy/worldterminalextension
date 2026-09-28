import { MARKETS_API, USERS_API } from "../config.js";

// World's API wants a short-lived JWT that world.xyz issues after its Cloudflare Turnstile check.
// The extension never solves Turnstile itself: the content script picks up the token the user's
// own world.xyz tab already holds, and we ask the user to open world.xyz when it expires.
export class AuthRequiredError extends Error {
  constructor(message = "Open world.xyz once to connect World Terminal.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

async function getJson(url, token, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new AuthRequiredError();
  if (!res.ok) throw new Error(`World API ${res.status} for ${new URL(url).pathname}`);
  return res.json();
}

const PAGE = 40;
const MAX_PAGES = 25;

// fetchImpl lets the extension route requests through a world.xyz tab when needed.
export async function fetchActiveEvents(token, base = MARKETS_API, fetchImpl = fetch) {
  const events = [];
  let cursor = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      withNestedMarkets: "true",
      status: "active",
      limit: String(PAGE),
      cursor: String(cursor),
    });
    const data = await getJson(`${base}/events?${q}`, token, {}, fetchImpl);
    const batch = data.events || [];
    events.push(...batch);
    if (batch.length < PAGE || data.cursor == null) break;
    cursor = Number(data.cursor);
  }
  // The API can return an event on two pages when the list shifts mid-scan.
  const seen = new Set();
  return events.filter((e) => !seen.has(e.ticker) && seen.add(e.ticker));
}

// -> { code, referredCount, referredBy }
export function fetchReferralStatus(wallet, token, base = USERS_API, fetchImpl = fetch) {
  return getJson(`${base}/users/${encodeURIComponent(wallet)}/referral`, token, {}, fetchImpl);
}
