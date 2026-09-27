// Edit these before publishing.
export const CONFIG = {
  // Your World invite code: the 8-character code at the end of your invite link
  // (https://world.xyz/?ref=XXXXXXXX). Copy it from World → profile → Invite Friends.
  REFERRAL_CODE: "",

  // Optional: your World wallet address. Some API responses report `referredBy` as the
  // referrer's wallet rather than the code, so we accept a match on either.
  REFERRER_WALLET: "",

  // Free (locked) users see only this many rows in the scanner.
  FREE_ROW_LIMIT: 10,

  // Re-check a user's referral status after this many hours.
  REVERIFY_HOURS: 24,

  // Optional v1 backend (see backend/README.md), e.g. "https://world-terminal-api.you.workers.dev".
  // When set, market data and Pro status come from the backend, and the extension falls back to
  // loading World directly if the backend has no data. Also add its origin to manifest.json:
  //   "host_permissions": [..., "https://<backend>/*"],
  //   "externally_connectable": { "matches": ["https://<backend>/*"] }
  BACKEND_URL: "",
};

// User-adjustable in Settings. Stored under `settings` in chrome.storage.local.
export const DEFAULT_SETTINGS = {
  refreshMinutes: 1,
  notifyAlerts: true,
  notifySignals: false,
  minEdgeCents: 0.5,
  favoriteMinCents: 85,
  favoriteMaxHours: 48,
  moverCents: 5,
};

export const WORLD_ORIGIN = "https://world.xyz";
export const MARKETS_API = "https://markets-api-proxy.world-xyz.workers.dev/api/v1";
export const USERS_API = "https://users-api.world.xyz/api/v1";

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export function normalizeCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

export function inviteUrl(path = "/") {
  const code = normalizeCode(CONFIG.REFERRAL_CODE);
  const url = new URL(path, WORLD_ORIGIN);
  if (code) url.searchParams.set("ref", code);
  return url.toString();
}

export function eventUrl(eventTicker) {
  return inviteUrl(`/event/${encodeURIComponent(eventTicker)}`);
}
