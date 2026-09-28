# World Terminal API (v1 backend)

A Cloudflare Worker that gives World Terminal one shared market poller, wallet sign-in, and Pro gating enforced on the server.

```
 Extension ──GET /v1/feed (Bearer session)──► Worker ──reads──► KV "latest" ◄──cron every 1 min── poll()
     │                                           │                                   │
     └─opens /connect?ext=ID#wt=… ──► wallet signs nonce ──► POST /v1/auth/verify     └─► upstream feed (UPSTREAM_URL)
                                                 │                                     └─► D1 snapshots (every 10 min, 7 days)
                                                 └─► World users API: referredBy == REFERRAL_CODE → pro
```

## What it does

| | |
|---|---|
| **Shared poller** | A cron job fetches the market feed once a minute for everyone, scores it with the same `src/lib/analytics.js` the extension uses, and stores the result in KV. |
| **Server-side Pro** | `/v1/feed` returns the top 10 markets and hidden signal placeholders to free users. Pro users get everything. Free clients never receive Pro data. |
| **Wallet sign-in** | `/connect` signs a one-time nonce with Phantom, Solflare or Backpack. The server checks the ed25519 signature, looks up the wallet's World referral, and hands the extension a 30-day HMAC session. |
| **Signal bot** | New arbitrage worth at least `BROADCAST_MIN_EDGE_CENTS` is posted to Telegram and/or Discord with your invite link, once per signal per day. |
| **Rate limits** | 20 sign-in requests per minute per IP; 120 data requests per minute per wallet (or IP). |
| **Price history** | Mid prices every 10 minutes for 7 days in D1 (`/v1/history`, Pro). |

## API

| Route | Auth | Returns |
|---|---|---|
| `GET /v1/health` | – | poller status |
| `POST /v1/auth/nonce` `{wallet}` | – | `{nonce, message}` to sign |
| `POST /v1/auth/verify` `{wallet, nonce, signature, worldToken?}` | – | `{token, pro, referredBy, exp}` |
| `GET /v1/me` | session | wallet, pro, referredBy |
| `GET /v1/feed` | optional | `{status, rows, opportunities, plan, total}` |
| `GET /v1/history?ticker=&hours=` | Pro | `{points: [{t, mid}]}` |
| `GET /v1/stats` | – | user and Pro counts |
| `GET /connect?ext=<id>` | – | wallet sign-in page |

## The data source: read this first

World's own market API only accepts a token that world.xyz issues after a Cloudflare Turnstile check in a real browser. A server can't get one without bypassing that check, and this backend doesn't try. You need official access to a feed in the same `/events` format:

- **World:** ask the team for partner or API access (they're activating distribution partners).
- **DFlow:** World trades through DFlow, which offers a prediction-markets metadata API with developer keys.

Put the base URL in `UPSTREAM_URL` and the key in the `UPSTREAM_TOKEN` secret. Until then the poller stays idle, `/v1/feed` returns `503`, and the extension automatically keeps loading World directly for each user. Wallet sign-in and server-side Pro status still work, using the user's own World session for the referral lookup (or `USERS_API_TOKEN` if World gives you one).

## Deploy

```bash
cd backend
npm install
npx wrangler login
npx wrangler d1 create world-terminal         # paste database_id into wrangler.toml
npx wrangler kv namespace create KV           # paste id into wrangler.toml
npm run db:migrate
npx wrangler secret put SESSION_SECRET        # e.g. `openssl rand -hex 32`
npx wrangler secret put UPSTREAM_TOKEN        # once you have feed access
```

Then fill in `[vars]` in `wrangler.toml`:
- `REFERRAL_CODE` and optionally `REFERRER_WALLET`
- `UPSTREAM_URL`, once you have feed access
- `EXTENSION_IDS`: your extension's ID from `chrome://extensions` or the Web Store. Only these IDs may receive sessions from `/connect`.

Then run `npm run deploy`.

Finally, point the extension at it:
1. `src/config.js`: `BACKEND_URL: "https://world-terminal-api.<you>.workers.dev"`
2. `manifest.json`: add `"https://world-terminal-api.<you>.workers.dev/*"` to `host_permissions`, and add
   `"externally_connectable": { "matches": ["https://world-terminal-api.<you>.workers.dev/*"] }`

## Cost

Needs the Workers Paid plan ($5/month): the snapshot writes (~288k rows/day at 2,000 markets) and the minute-by-minute KV writes exceed the free tier. That plan covers about 700 daily users polling every minute; beyond that, extra requests cost $0.30 per million (about $45/month at 10,000 daily users).

## Tests

```bash
npm test                        # 17 checks: poller, signal bot, free vs Pro feed, sign-in, bad signatures, nonce reuse, forged sessions, rate limits
npm run test:extension     # 7 checks: real extension + local Worker, including wallet sign-in handoff
```

Both run the Worker locally (`wrangler dev`, local D1 and KV) against a mock upstream, and need no Cloudflare account.

## Signal bot setup (optional)

- **Telegram:**
  1. Message @BotFather, send `/newbot` and copy the token.
  2. Add the bot as an admin of your channel.
  3. Run `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
  4. Run `npx wrangler secret put TELEGRAM_CHAT_ID`. The chat ID is `@yourchannel`, or the numeric ID for a private group.
- **Discord:**
  1. In the channel, open Settings → Integrations → Webhooks → New Webhook, and copy its URL.
  2. Run `npx wrangler secret put DISCORD_WEBHOOK_URL`.
- Set `EXTENSION_STORE_URL` in `wrangler.toml` once you're on the Chrome Web Store, so every post links to the extension.

The bot only posts when the poller has data, which means it needs `UPSTREAM_URL`.

## Not built yet
- Live push over WebSocket or Durable Objects. Clients poll `/v1/feed` on their refresh interval.
