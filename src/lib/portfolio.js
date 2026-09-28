// Match a wallet's token balances to World markets and value them at what they'd sell for now.

export const TOKEN_PROGRAMS = [
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022 (World position tokens)
  "TokenkegQfeZyiNwAJbNbGZPGpD2vxRGGs8Wz7fkoLF", // classic SPL Token
];

// A position is hard to exit when there's no bid or the spread is wide.
export const THIN_SPREAD = 0.06;

// balances: [{mint, amount}] (amount in whole tokens; 1 token pays $1 if it wins)
export function matchPositions(balances, rows) {
  const byMint = new Map();
  for (const r of rows) {
    for (const m of r.yesMints || []) byMint.set(m, { row: r, side: "YES" });
    for (const m of r.noMints || []) byMint.set(m, { row: r, side: "NO" });
  }
  const positions = [];
  for (const b of balances) {
    const hit = byMint.get(b.mint);
    if (!hit || !(b.amount > 0)) continue;
    const { row, side } = hit;
    const bid = side === "YES" ? row.yesBid : row.noBid;
    const ask = side === "YES" ? row.yesAsk : row.noAsk;
    const spread = bid !== null && ask !== null ? ask - bid : null;
    positions.push({
      ticker: row.ticker,
      eventTicker: row.eventTicker,
      title: row.title,
      eventTitle: row.eventTitle,
      side,
      qty: b.amount,
      bid,
      mark: bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask,
      exitValue: bid !== null ? b.amount * bid : 0,
      maxPayout: b.amount,
      thin: bid === null || (spread !== null && spread >= THIN_SPREAD),
      hoursToClose: row.hoursToClose,
    });
  }
  positions.sort((a, b) => b.exitValue - a.exitValue);
  return {
    positions,
    exitValue: positions.reduce((s, p) => s + p.exitValue, 0),
    maxPayout: positions.reduce((s, p) => s + p.maxPayout, 0),
    thinCount: positions.filter((p) => p.thin).length,
  };
}

// Reads all SPL/Token-2022 balances for a wallet from a Solana JSON-RPC endpoint.
export async function fetchBalances(rpcUrl, wallet) {
  const calls = TOKEN_PROGRAMS.map((programId, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "getTokenAccountsByOwner",
    params: [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
  }));
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) throw new Error("The Solana RPC is rate limiting. Try again in a minute, or set your own RPC URL in Settings.");
  if (!res.ok) throw new Error(`Solana RPC returned ${res.status}`);
  const out = await res.json();
  const replies = Array.isArray(out) ? out : [out];
  const balances = [];
  for (const r of replies) {
    if (r.error) throw new Error(r.error.message || "Solana RPC error");
    for (const acc of r.result?.value || []) {
      const info = acc.account?.data?.parsed?.info;
      const amount = Number(info?.tokenAmount?.uiAmountString ?? info?.tokenAmount?.uiAmount ?? 0);
      if (info?.mint && amount > 0) balances.push({ mint: info.mint, amount });
    }
  }
  return balances;
}
