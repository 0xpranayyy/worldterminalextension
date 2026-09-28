# World Terminal privacy policy

_Last updated: September 27, 2026_

World Terminal is a Chrome extension that shows World (world.xyz) prediction market data. This policy explains what it handles and where that data goes.

## What the extension handles

| Data | Why | Where it goes |
|---|---|---|
| Your World session token (from world.xyz) | To load market data from World's API on your behalf | Stored in your browser. Sent only to World's own API. |
| Market prices and price history | To rank markets, draw charts and find signals | Stored in your browser |
| Your watchlist, alerts and settings | So they persist | Stored in your browser |
| A wallet address you type in to unlock Pro | To ask World whether that wallet joined through our invite | Stored in your browser. Sent only to World's API (`users-api.world.xyz`). |
| That wallet's public token balances | To show your World positions in the Portfolio tab | Read from a Solana RPC (default `api.mainnet-beta.solana.com`, or the one you set). Not stored. |

## What the extension does not do

- It has no servers of its own and sends nothing to its developer.
- It has no analytics, ads or tracking.
- It never asks for, reads or stores private keys or seed phrases, and it cannot sign transactions.
- It does not read pages other than world.xyz.
- It does not sell or share data with anyone.

## Referral disclosure

Links from World Terminal to world.xyz include the developer's World invite code. If you join World through such a link and confirm the invite in your wallet, the developer may receive referral rewards from World. The extension never changes invite codes on world.xyz itself.

## Removing your data

Uninstalling the extension deletes everything it stored.

## Contact

Questions: open an issue at https://github.com/0xpranayyy/worldterminalextension/issues
