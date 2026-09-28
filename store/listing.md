# Chrome Web Store listing

Copy these fields into the Chrome Web Store developer dashboard.

**Name:** World Terminal — Market Scanner for world.xyz

**Summary (132 chars max):**
Find the most liquid world.xyz markets, spot arbitrage and closing favorites, and get price alerts.

**Category:** Productivity · **Language:** English

## Description

World Terminal is a market terminal for World (world.xyz), the onchain prediction market on Solana.

MARKETS, RANKED BY LIQUIDITY
Every live World market gets a 0–100 liquidity score built from spread, volume and open interest, so you can see at a glance where it's cheap to get in and out. Sort by liquidity, tightest spread, volume, open interest or closing time, and filter by sport, crypto, economics and more.

SIGNALS
• Outcome arbitrage: multi-outcome events where buying YES on every outcome costs less than the $1 payout.
• YES+NO arbitrage: markets where both sides together cost less than $1.
• Closing favorites: high-probability outcomes that close within 48 hours, ranked by return per hour.
• Movers: the biggest price moves over the last hour.

MARKET DETAIL
Live YES/NO quotes, a 12-hour price chart, and a breakdown of each market's liquidity score.

PORTFOLIO
Every World position in your wallet, valued at what it would sell for right now, with a warning on positions that are hard to exit.

SHARE
Turn any market or signal into an image card and post it on X in one click.

ALERTS
Star markets, set YES or NO price alerts, and get desktop notifications. Pro users can also be notified when new arbitrage appears.

ON world.xyz
A compact panel on every World event page shows each outcome's price, spread and liquidity.

FREE AND PRO
The free plan shows the top 10 markets. Pro unlocks every market, all signals, the portfolio, the watchlist, alerts and the on-page panel. Pro is free for anyone who joins World through our invite link and confirms the invite in their wallet.

Disclosures: World Terminal is not affiliated with World. Links to world.xyz from the extension include our invite code. Nothing here is financial advice; prediction markets carry risk of loss.

## Single purpose (for the review form)
Show World (world.xyz) prediction market data ranked by liquidity, with pricing signals and price alerts.

## Permission justifications
- **storage / unlimitedStorage:** caches market data and up to 12 hours of price history locally for charts and movers.
- **alarms:** refreshes market data on the interval the user picks.
- **notifications:** price alerts and optional new-arbitrage notifications.
- **sidePanel:** lets users keep the terminal open next to world.xyz.
- **Host access to world.xyz:** reads the user's World session so the extension can load market data, and shows the stats panel on event pages.
- **Host access to markets-api-proxy.world-xyz.workers.dev and users-api.world.xyz:** World's market data and the invite status check.

## Data use (privacy practices form)
- Does not sell or transfer user data. Does not use data for purposes unrelated to the single purpose.
- Collects: wallet address the user types in (to check invite status with World and read its public token balances from a Solana RPC for the Portfolio tab). Stored locally only.
- No remote code. No analytics.

## Assets
- Icon: `icons/icon128.png`
- Screenshots (1280×800): `store/screenshots/01-markets.png`, `02-detail.png`, `03-signals.png`, `04-portfolio.png`, `05-overlay.png`
- Privacy policy URL: host `PRIVACY.md` (for example as a GitHub Pages page) and paste the link.
