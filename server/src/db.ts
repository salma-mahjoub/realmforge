import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite storage (Node's built-in `node:sqlite`, no native build step).
 * Tables:
 *  - levels       : indexed from LevelNFT events (LevelPublished, PlayFeeUpdated, ...)
 *  - runs         : indexed RunRecorded (LevelNFT) + RunSettled (ForgeCoin)
 *  - sales        : indexed Sold events
 *  - races        : indexed Race* events
 *  - fee_splits   : indexed FeeSplit / FeeBurned (owner earnings, season pool, treasury, burn) + race payouts
 *  - activity     : one row per notable event of a level (published, play, record, listed, sold) for the UI feed
 *  - seasons      : indexed SeasonClosed (+ season_payouts: the ERC-20 transfers of that closeSeason tx)
 *  - pinned_levels: level JSON pinned through this API (+ min time computed at publish)
 *  - signed_runs  : RunResults signed by this server (replay storage for ghost races)
 *  - run_fingerprints : sha256 of every validated run, so the same recording is never signed twice
 *  - processed_logs / indexer_state : idempotent, resumable indexing
 */
export type Db = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS levels (
  id            INTEGER PRIMARY KEY,
  creator       TEXT NOT NULL,
  owner         TEXT NOT NULL,
  layout_hash   TEXT NOT NULL UNIQUE,
  parent_id     INTEGER NOT NULL DEFAULT 0,
  play_fee      TEXT NOT NULL DEFAULT '0',
  active        INTEGER NOT NULL DEFAULT 1,
  plays         INTEGER NOT NULL DEFAULT 0,
  clears        INTEGER NOT NULL DEFAULT 0,
  likes         INTEGER NOT NULL DEFAULT 0,
  best_time_ms  INTEGER,
  best_player   TEXT,
  listing_price TEXT,
  block_number  INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS levels_creator ON levels(creator);
CREATE INDEX IF NOT EXISTS levels_parent ON levels(parent_id);
CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  player       TEXT NOT NULL,
  time_ms      INTEGER NOT NULL,
  cleared      INTEGER NOT NULL,
  reward       TEXT,
  fee_paid     TEXT,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  UNIQUE (tx_hash, level_id, player)
);
CREATE INDEX IF NOT EXISTS runs_level_time ON runs(level_id, cleared, time_ms);
CREATE TABLE IF NOT EXISTS sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  seller       TEXT NOT NULL,
  buyer        TEXT NOT NULL,
  price        TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS races (
  room_id      TEXT PRIMARY KEY,
  level_id     INTEGER,
  stake        TEXT,
  status       TEXT NOT NULL,
  players      TEXT NOT NULL DEFAULT '[]',
  ranking      TEXT,
  updated_block INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fee_splits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  source       TEXT NOT NULL,
  owner        TEXT NOT NULL,
  owner_amt    TEXT NOT NULL,
  pool_amt     TEXT NOT NULL,
  treasury_amt TEXT NOT NULL,
  burned_amt   TEXT NOT NULL DEFAULT '0',
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS fee_splits_level ON fee_splits(level_id);
CREATE INDEX IF NOT EXISTS fee_splits_owner ON fee_splits(owner);
CREATE TABLE IF NOT EXISTS activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  actor        TEXT,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS activity_level ON activity(level_id, id DESC);
CREATE TABLE IF NOT EXISTS seasons (
  season       INTEGER PRIMARY KEY,
  pool         TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  closed_at    INTEGER NOT NULL
);
-- FORGE sent out of ForgeCoin's own balance in the transaction being indexed (only the latest tx is kept);
-- when that tx turns out to be a closeSeason, its rows become the season's payouts.
CREATE TABLE IF NOT EXISTS forge_outflows (
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  recipient    TEXT NOT NULL,
  amount       TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
-- What closeSeason paid, in transfer order (players first, then creators, as in the signed arrays).
CREATE TABLE IF NOT EXISTS season_payouts (
  season       INTEGER NOT NULL,
  position     INTEGER NOT NULL,
  recipient    TEXT NOT NULL,
  amount       TEXT NOT NULL,
  PRIMARY KEY (season, position)
);
CREATE TABLE IF NOT EXISTS badge_claims (
  holder TEXT NOT NULL,
  badge_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  PRIMARY KEY(holder, badge_id, ref)
);
CREATE TABLE IF NOT EXISTS pinned_levels (
  layout_hash  TEXT PRIMARY KEY,
  level_cid    TEXT NOT NULL,
  metadata_cid TEXT,
  thumbnail_cid TEXT,
  min_time_ms  INTEGER NOT NULL,
  json         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signed_runs (
  nonce        TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  player       TEXT NOT NULL,
  level_id     TEXT,
  layout_hash  TEXT,
  time_ms      INTEGER NOT NULL,
  cleared      INTEGER NOT NULL,
  coins        INTEGER NOT NULL,
  input_log    TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signed_runs_level ON signed_runs(level_id, cleared, time_ms);
CREATE TABLE IF NOT EXISTS relay_submissions (
  player TEXT NOT NULL, day INTEGER NOT NULL, nonce TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_fingerprints (
  level_id    TEXT NOT NULL,
  run_hash    TEXT NOT NULL,
  player      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (level_id, run_hash)
);
CREATE TABLE IF NOT EXISTS processed_logs (
  tx_hash   TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
