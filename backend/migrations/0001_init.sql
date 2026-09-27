-- Users who signed in with a wallet.
CREATE TABLE IF NOT EXISTS users (
  wallet       TEXT PRIMARY KEY,
  referred_by  TEXT,
  pro          INTEGER NOT NULL DEFAULT 0,
  verified_at  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);

-- One-time sign-in challenges.
CREATE TABLE IF NOT EXISTS nonces (
  nonce       TEXT PRIMARY KEY,
  wallet      TEXT NOT NULL,
  message     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Mid-price history, one row per market every 10 minutes.
CREATE TABLE IF NOT EXISTS snapshots (
  ticker  TEXT NOT NULL,
  t       INTEGER NOT NULL,
  mid     REAL NOT NULL,
  PRIMARY KEY (ticker, t)
);
CREATE INDEX IF NOT EXISTS snapshots_t ON snapshots (t);
